import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SYSTEMS, GROUPS, EDGES, NEIGHBORS, MAP_LAYOUT } from '../map-data.js';
import { newGame, assertState, migrateSave, attack, occupy, plex, beginFortify, endTurn, reinforce, owned, income, tradeCards } from '../engine.js';
import { stepBot } from '../bots.js';
import { NEUTRAL, operationalState, distances, MIN_HOME_SYSTEMS, MIN_MILITIA_FRONTLINES } from '../warfare.js';

test('every star preserves CCP in-game 2D positions, north, distances, and aspect ratio', () => {
  const source = JSON.parse(readFileSync(new URL('../research/map-layout.json', import.meta.url)));
  const original = new Map(source.systems.map(s => [s.id, s.position2D]));
  assert.equal(MAP_LAYOUT.build, source.build);
  for (const s of SYSTEMS) {
    const p = original.get(s.id);
    assert.ok(Math.abs(s.x - (MAP_LAYOUT.offsetX + (p.x - MAP_LAYOUT.minX) * MAP_LAYOUT.scale)) < .000001);
    assert.ok(Math.abs(s.y - (MAP_LAYOUT.offsetY + (MAP_LAYOUT.maxY - p.y) * MAP_LAYOUT.scale)) < .000001);
  }
  for (const [a,b] of EDGES) {
    const p=original.get(SYSTEMS[a].id),q=original.get(SYSTEMS[b].id);
    const distance=Math.hypot(SYSTEMS[a].x-SYSTEMS[b].x,SYSTEMS[a].y-SYSTEMS[b].y);
    assert.ok(Math.abs(distance-Math.hypot(p.x-q.x,p.y-q.y)*MAP_LAYOUT.scale)<.000002);
  }
});
test('home territories stay connected and fixed, while neutral and contested middle varies', () => {
  const variants=new Set();
  for(let seed=1;seed<=96;seed++) {
    const s=newGame({seed,faction:seed%2?'caldari':'gallente'});assertState(s);
    assert.equal(s.rules,'fw');assert.ok(owned(s,NEUTRAL).length>=4);
    for(const home of s.homeSystems) {
      assert.equal(home.systems.length,MIN_HOME_SYSTEMS);
      for(const id of home.systems) { assert.equal(s.territories[id].owner,home.commander);assert.equal(s.territories[id].sovereignty,home.faction); }
      assert.equal(distances([home.anchor],i=>home.systems.includes(i)).size,MIN_HOME_SYSTEMS);
    }
    for(let p=0;p<4;p++)assert.equal(owned(s,p).reduce((n,i)=>n+s.territories[i].troops,0),55);
    for(const faction of ['caldari','gallente'])assert.ok(s.territories.filter((t,i)=>t.owner!==NEUTRAL&&s.players[t.owner].faction===faction&&operationalState(s,i)==='Frontline').length>=MIN_MILITIA_FRONTLINES);
    variants.add(s.territories.map(t=>`${t.owner}:${t.sovereignty}`).join(','));
  }
  assert.ok(variants.size>80);
});
function battleFixture(neutral=false) {
  const s=newGame({seed:401}),[from,to]=EDGES[0];
  s.phase='attack';s.reserve=0;s.operations=8;
  s.territories[from]={owner:0,troops:80,sovereignty:'caldari',contested:0,pending:null,home:false};
  s.territories[to]={owner:neutral?NEUTRAL:1,troops:1,sovereignty:'gallente',contested:0,pending:null,home:false};
  return {s,from,to};
}
test('offensive plexing is required before either a militia or neutral-held hostile hub can be attacked', () => {
  for(const neutral of [false,true]) {
    const {s,from,to}=battleFixture(neutral),before=JSON.stringify(s);
    assert.throws(()=>attack(s,from,to,3),/vulnerable/);assert.equal(JSON.stringify(s),before);
    for(let i=1;i<=4;i++){plex(s,from,to);assert.equal(s.territories[to].contested,i*25);assert.equal(s.territories[to].sovereignty,'gallente');}
    assert.throws(()=>plex(s,from,to),/already vulnerable/);
    while(s.phase==='attack')attack(s,from,to,3);
    occupy(s,s.occupation.max);assertState(s);
    assert.equal(s.territories[to].sovereignty,'gallente');assert.equal(s.territories[to].pending.faction,'caldari');
    assert.throws(()=>plex(s,to,to),/lost system/);
    beginFortify(s);endTurn(s);
    while(s.turn<5){s.reserve=0;s.phase='fortify';endTurn(s);}
    assert.equal(s.territories[to].pending,null);assert.equal(s.territories[to].sovereignty,'caldari');assert.equal(s.territories[to].contested,0);assertState(s);
  }
});
test('defensive plexing closes vulnerability and cannot spend beyond the operation budget',()=>{
  const {s,from,to}=battleFixture();s.territories[to].contested=100;s.current=1;s.territories[to].troops=4;s.operations=1;
  plex(s,to,to);assert.equal(s.territories[to].contested,75);assert.equal(s.operations,0);
  assert.throws(()=>plex(s,to,to),/No plex operations/);
  s.current=0;s.operations=4;assert.throws(()=>attack(s,from,to,3),/vulnerable/);
});
test('frontline, command operations and rearguard use militia occupancy rather than garrison owner',()=>{
  const s=newGame({seed:23});
  const expected=new Set(s.territories.flatMap((t,i)=>NEIGHBORS[i].some(j=>s.territories[j].sovereignty!==t.sovereignty)?[i]:[]));
  s.territories.forEach((t,i)=>assert.equal(operationalState(s,i),expected.has(i)?'Frontline':NEIGHBORS[i].some(j=>expected.has(j))?'Command Operations':'Rearguard'));
  const neutral=owned(s,NEUTRAL)[0],before=operationalState(s,neutral);
  s.territories[neutral].owner=s.players.findIndex(p=>p.faction===s.territories[neutral].sovereignty);
  assert.equal(operationalState(s,neutral),before);
});
test('clearing a neutral garrison in friendly militia space does not flip its hub',()=>{
  const {s,from,to}=battleFixture(true);s.territories[to].sovereignty='caldari';
  while(s.phase==='attack')attack(s,from,to,3);
  occupy(s,s.occupation.min);assert.equal(s.territories[to].owner,0);assert.equal(s.territories[to].pending,null);assert.equal(s.territories[to].sovereignty,'caldari');assertState(s);
});
test('a pending flip survives save/reload and cannot yield supply or serve as a launch point',()=>{
  const {s,from,to}=battleFixture();s.territories[to].contested=100;
  while(s.phase==='attack')attack(s,from,to,3);occupy(s,s.occupation.max);
  const restored=JSON.parse(JSON.stringify(s));assertState(restored);assert.deepEqual(restored.territories[to].pending,s.territories[to].pending);
  assert.throws(()=>plex(s,to,from),/lost system/);
  s.phase='reinforce';s.reserve=1;assert.throws(()=>reinforce(s,to,1),/downtime/);
  const cards=[to,...SYSTEMS.flatMap((_,i)=>i!==to&&i%3===to%3?[i]:[])].slice(0,3);
  s.players[0].cards=cards;s.deck=s.deck.filter(c=>!cards.includes(c));
  const before=JSON.stringify(s),fleets=s.territories[to].troops;
  assert.throws(()=>tradeCards(s,cards,to),/bonus/);assert.equal(JSON.stringify(s),before);
  tradeCards(s,cards);assert.equal(s.territories[to].troops,fleets);assertState(s);
});
test('version-one campaigns retain classic rules, state and fleet positions',()=>{
  const s=newGame({seed:57,rules:'classic'});s.version=1;delete s.rules;delete s.operations;delete s.homeSystems;
  s.territories.forEach(t=>{delete t.sovereignty;delete t.contested;delete t.pending;delete t.home;});
  const original=JSON.stringify(s),migrated=migrateSave(s);assertState(migrated);
  assert.equal(migrated.rules,'classic');assert.equal(JSON.stringify(s),original);assert.equal(migrated.rng,s.rng);
  assert.deepEqual(migrated.territories.map(t=>[t.owner,t.troops]),s.territories.map(t=>[t.owner,t.troops]));
});
test('twelve full militia campaigns preserve sovereignty and neutral accounting after every action',()=>{
  for(let seed=1;seed<=12;seed++){
    const s=newGame({seed,faction:seed%2?'caldari':'gallente'});let actions=0;
    while(s.winner===null&&actions<80000){stepBot(s);assertState(s);actions++;}
    assert.notEqual(s.winner,null,`Seed ${seed} unfinished at turn ${s.turn}`);
    assert.ok(s.territories.every(t=>!t.pending&&t.owner!==NEUTRAL&&t.sovereignty===s.players[s.winner].faction));
  }
});
