import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SYSTEMS, GROUPS, EDGES, NEIGHBORS } from '../map-data.js';
import { newGame, assertState, owned, enemies, income, reinforce, beginAttack, attack, occupy, beginFortify, fortify, endTurn, connectedOwned, compareDice, diceOutcomes, conquestChance, cardType, findSet, tradeCards, tradeValue } from '../engine.js';
import { observation, chooseAction, stepBot } from '../bots.js';

test('frozen ESI geography exactly matches the connected playable graph',()=>{
  const source=JSON.parse(readFileSync(new URL('../research/warzone.json',import.meta.url)));
  assert.equal(SYSTEMS.length,90);assert.equal(EDGES.length,110);assert.equal(GROUPS.length,15);
  assert.deepEqual(SYSTEMS.map(s=>s.id).sort(),source.roster.map(s=>s.solar_system_id).sort());
  const actual=EDGES.map(([a,b])=>[SYSTEMS[a].id,SYSTEMS[b].id].sort((x,y)=>x-y).join(',')).sort();
  assert.deepEqual(actual,source.edges.map(e=>e.join(',')).sort());
  const seen=new Set([0]),queue=[0];
  for(const i of queue)for(const j of NEIGHBORS[i]){assert.ok(NEIGHBORS[j].includes(i));if(!seen.has(j)){seen.add(j);queue.push(j);}}
  assert.equal(seen.size,90);
  assert.deepEqual(GROUPS.flatMap(g=>g.systems).sort((a,b)=>a-b),SYSTEMS.map((_,i)=>i));
  for(const g of GROUPS)assert.ok(g.bonus>0);
});
test('all copied icons and sounds match their preserved provenance hashes',()=>{
  const root=new URL('../',import.meta.url);
  const icons=JSON.parse(readFileSync(new URL('assets/icons/provenance.json',root)));
  for(const i of icons.icons)assert.equal(createHash('sha256').update(readFileSync(new URL(`assets/icons/${i.name}.png`,root))).digest('hex'),i.sha256);
  const sounds=JSON.parse(readFileSync(new URL('assets/sounds/provenance.json',root)));
  for(const s of sounds.files)assert.equal(createHash('sha256').update(readFileSync(new URL(s.file,root))).digest('hex'),s.sha256);
});
test('seeded setup deals every territory and gives equal starting fleets',()=>{
  const a=newGame({seed:73}),b=newGame({seed:73});assert.deepEqual(a,b);assertState(a);
  for(let p=0;p<4;p++)assert.equal(a.territories.filter(t=>t.owner===p).reduce((n,t)=>n+t.troops,0),55);
  assert.ok(enemies(a,0,1));assert.ok(!enemies(a,0,2));
  const f=newGame({mode:'conquest'});assert.ok(enemies(f,0,2));
});
test('territory and constellation income belong to the controlling commander',()=>{
  const s=newGame({seed:8});s.territories.forEach(t=>t.owner=1);
  const group=GROUPS.find(g=>g.systems.length>=5);group.systems.forEach(i=>s.territories[i].owner=0);
  assert.equal(income(s,0).bonus,group.bonus);assert.equal(income(s,0).base,Math.max(3,Math.floor(group.systems.length/3)));
  s.territories[group.systems[0]].owner=2;assert.equal(income(s,0).bonus,0);
  assert.equal(income(s,3).total,0);
});
test('dice compare high to low, ties favor defense, probabilities are exact',()=>{
  assert.deepEqual(compareDice([1,6,4],[6,2]),{attack:[6,4,1],defense:[6,2],lostA:1,lostD:1});
  assert.ok(Math.abs(conquestChance(1,1)-15/36)<1e-12);
  assert.ok(Math.abs(conquestChance(3,2)-.6559539998031296)<1e-12);
  const events=diceOutcomes(3,2);assert.ok(Math.abs(events.reduce((n,o)=>n+o.probability,0)-1)<1e-12);
  assert.ok(Math.abs(events.find(o=>o.losses[0]===0).probability-2890/7776)<1e-12);
  for(let a=1;a<12;a++)for(let d=1;d<12;d++){assert.ok(conquestChance(a+1,d)>=conquestChance(a,d));assert.ok(conquestChance(a,d+1)<=conquestChance(a,d));}
});
test('illegal operations leave state unchanged',()=>{
  const s=newGame({seed:4});const own=owned(s)[0],foreign=owned(s,1)[0];
  const unchanged=fn=>{const before=JSON.stringify(s);assert.throws(fn);assert.equal(JSON.stringify(s),before);};
  unchanged(()=>reinforce(s,foreign,1));unchanged(()=>reinforce(s,own,-1));unchanged(()=>reinforce(s,own,1.5));unchanged(()=>reinforce(s,own,s.reserve+1));unchanged(()=>beginAttack(s));unchanged(()=>endTurn(s));
  reinforce(s,own,s.reserve);beginAttack(s);
  unchanged(()=>attack(s,foreign,own,1));unchanged(()=>attack(s,own,own,1));unchanged(()=>attack(s,own,foreign,4));
});
test('capture is resumable and occupancy must leave a garrison',()=>{
  const s=newGame({seed:441,mode:'conquest'}),[a,b]=EDGES[0];
  s.territories[a]={owner:0,troops:100};s.territories[b]={owner:1,troops:1};s.phase='attack';s.reserve=0;
  while(s.phase==='attack')attack(s,a,b,3);
  assert.equal(s.phase,'occupy');assertState(s);
  const restored=JSON.parse(JSON.stringify(s));assertState(restored);
  assert.throws(()=>occupy(s,2));assert.throws(()=>occupy(s,s.occupation.max+1));
  occupy(s,s.occupation.max);assert.equal(s.territories[a].troops,1);assert.ok(s.territories[b].troops>=3);assertState(s);
});
test('cards trade progressively; owned bonus, forced trades, and one card per turn',()=>{
  const s=newGame({seed:5});
  const cards=[0,3,6];s.deck=s.deck.filter(c=>!cards.includes(c));s.players[0].cards=cards;s.territories[0].owner=0;s.territories[3].owner=0;
  const reserve=s.reserve,troops=s.territories[3].troops;tradeCards(s,cards,3);
  assert.equal(s.reserve,reserve+4);assert.equal(s.territories[3].troops,troops+2);assert.equal(s.trades,1);assertState(s);
  assert.deepEqual(Array.from({length:8},(_,i)=>tradeValue(i)),[4,6,8,10,12,15,20,25]);
  const hand=[1,2,4,5,7];s.players[0].cards=hand;s.deck=s.deck.filter(c=>!hand.includes(c));s.reserve=0;assert.throws(()=>beginAttack(s));
  assert.ok(findSet(hand));
  s.players[0].cards=[];s.discard.push(...hand);s.phase='attack';s.conquered=true;
  beginFortify(s);assert.equal(s.players[0].cards.length,1);assert.throws(()=>beginFortify(s));assertState(s);
});
test('eliminations transfer cards and force immediate reinforcement at six cards',()=>{
  const s=newGame({seed:123,mode:'conquest'}),[a,b]=EDGES[0];
  s.territories.forEach(t=>{if(t.owner===1)t.owner=2;});
  s.territories[a]={owner:0,troops:100};s.territories[b]={owner:1,troops:1};s.phase='attack';s.reserve=0;
  s.players[1].cards=[0,1,2,3,4,5,6,7];s.deck=s.deck.filter(c=>!s.players[1].cards.includes(c));
  while(s.phase==='attack')attack(s,a,b,3);occupy(s,s.occupation.max);
  assert.equal(s.phase,'reinforce');assert.equal(s.resumeAttack,true);assert.equal(s.players[0].cards.length,8);assert.equal(s.players[1].cards.length,0);
  tradeCards(s,findSet(s.players[0].cards));assert.equal(s.players[0].cards.length,5);assert.throws(()=>beginAttack(s));
  tradeCards(s,findSet(s.players[0].cards));assert.equal(s.players[0].cards.length,2);
  reinforce(s,a,s.reserve);beginAttack(s);assert.equal(s.resumeAttack,false);assertState(s);
});
test('fortification traverses only owned systems and happens once',()=>{
  const s=newGame({seed:7});s.territories.forEach(t=>{t.owner=0;t.troops=10;});s.phase='fortify';s.reserve=0;
  const from=0,to=89;assert.ok(connectedOwned(s,from,to));fortify(s,from,to,5);
  assert.equal(s.territories[from].troops,5);assert.equal(s.territories[to].troops,15);assert.throws(()=>fortify(s,to,from,1));
  s.moved=false;NEIGHBORS[from].forEach(i=>s.territories[i].owner=2);assert.equal(connectedOwned(s,from,to),false);assert.throws(()=>fortify(s,from,to,1));
});
test('team victory recognizes an allied surviving commander; FFA requires all systems',()=>{
  for(const mode of ['teams','conquest']){
    const s=newGame({seed:199,mode}),[a,b]=EDGES[0];s.territories.forEach(t=>{t.owner=2;t.troops=1;});
    s.territories[a]={owner:0,troops:100};s.territories[b]={owner:1,troops:1};s.phase='attack';s.reserve=0;
    while(s.phase==='attack')attack(s,a,b,3);occupy(s,s.occupation.max);
    assert.equal(s.winner,mode==='teams'?0:null);assertState(s);
  }
});
test('bot decisions cannot see future RNG, deck, or enemy card faces',()=>{
  const s=newGame({seed:17});const visible=observation(s);assert.equal('rng' in visible,false);assert.equal('deck' in visible,false);
  const action=chooseAction(visible);s.rng=98765;s.deck.reverse();assert.deepEqual(chooseAction(observation(s)),action);
});
test('save validation rejects corrupted counters, cards, occupation and victory',()=>{
  const mutations=[s=>s.territories[0].troops=-1,s=>s.players[0].cards.push(s.deck[0]),s=>s.current=7,s=>s.phase='invalid',s=>s.occupation={from:0,to:1},s=>s.rng=0,s=>s.phase='finished',s=>s.winner=0,s=>s.mode='broken'];
  for(const mutate of mutations){const s=newGame({seed:11});mutate(s);assert.throws(()=>assertState(s));}
});
test('96 seeded complete campaigns preserve rules and card accounting after every action',()=>{
  const outcomes={teams:0,conquest:0};
  for(let seed=1;seed<=96;seed++){
    const mode=seed%2?'teams':'conquest',s=newGame({seed:seed*719,mode,difficulty:['recruit','veteran','elite'][seed%3]});
    let actions=0;
    while(s.winner===null&&actions<40000){stepBot(s);assertState(s);actions++;}
    assert.notEqual(s.winner,null,`Campaign ${seed} stalled at turn ${s.turn}`);outcomes[mode]++;
  }
  assert.deepEqual(outcomes,{teams:48,conquest:48});
});
