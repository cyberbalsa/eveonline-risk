import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { newGame, owned, borders, findSet, connectedOwned, assertState } from '../engine.js';
import { stepBot, applyAction } from '../bots.js';

// Fixed, public-board baseline: stack the strongest border, attack only with
// at least 1.5x defenders, move rear reserves to a connected border.
function baseline(s){
  const mine=owned(s),front=mine.filter(i=>borders(s,i).length);
  if(s.phase==='reinforce'){
    const set=findSet(s.players[s.current].cards);
    if(set&&(!s.resumeAttack||s.players[s.current].cards.length>=5))return {type:'trade',cards:set};
    if(!s.reserve)return {type:'attackPhase'};
    return {type:'reinforce',target:(front.length?front:mine).reduce((a,b)=>s.territories[a].troops>=s.territories[b].troops?a:b),amount:s.reserve};
  }
  if(s.phase==='occupy')return {type:'occupy',amount:s.occupation.max};
  if(s.phase==='attack'){
    const choices=front.flatMap(from=>borders(s,from).filter(to=>s.territories[from].troops-1>=s.territories[to].troops*1.5).map(to=>({from,to,advantage:s.territories[from].troops-s.territories[to].troops})));
    choices.sort((a,b)=>b.advantage-a.advantage);
    return choices.length?{type:'attack',...choices[0],dice:Math.min(3,s.territories[choices[0].from].troops-1)}:{type:'fortifyPhase'};
  }
  if(s.phase==='fortify'){
    if(!s.moved)for(const from of mine.filter(i=>!borders(s,i).length&&s.territories[i].troops>1).sort((a,b)=>s.territories[b].troops-s.territories[a].troops)){
      const to=front.find(i=>connectedOwned(s,from,i));
      if(to!==undefined)return {type:'fortify',from,to,amount:s.territories[from].troops-1};
    }
    return {type:'end'};
  }
}
const games=Number(process.argv[2]||96), seedBase=Number(process.argv[3]||820000),start=performance.now();
const results=[];
for(let game=0;game<games;game++){
  const seat=game%4,seed=seedBase+game*7919,s=newGame({seed,mode:'conquest',difficulty:'veteran'});
  s.players[seat].style=['aggressive','balanced','defensive'][Math.floor(game/4)%3];
  let actions=0;
  while(s.winner===null&&s.turn<=600&&actions<60000){
    if(s.current===seat)stepBot(s);else applyAction(s,baseline(s));
    assertState(s);actions++;
  }
  results.push({seed,seat,style:s.players[seat].style,winner:s.winner,turns:s.turn,actions});
}
const report={createdAt:new Date().toISOString(),method:'One veteran heuristic commander versus three fixed 1.5x-advantage baselines. Rotating seats and three styles. Free-for-all, 600 commander-turn / 60000-action horizon. Baselines use visible board state only. No parameter tuning on these seeds.',games,seedBase,wins:results.filter(r=>r.winner===r.seat).length,losses:results.filter(r=>r.winner!==null&&r.winner!==r.seat).length,unfinished:results.filter(r=>r.winner===null).length,elapsedMs:Math.round(performance.now()-start),limitations:'A narrow local baseline comparison, not evidence of expert-human strength or a ranking of difficulty levels. Militia team play is covered by invariant simulations, not this comparison.',results};
writeFileSync(new URL('../research/bot-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,results:undefined},null,2));
