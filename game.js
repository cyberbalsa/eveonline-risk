import { SYSTEMS, GROUPS, NEIGHBORS } from './map-data.js';
import { COLORS, CARD_TYPES, newGame, assertState, owned, enemies, income, borders, reinforce, attack, occupy, beginAttack, beginFortify, fortify, endTurn, connectedOwned, conquestChance, cardType, findSet, validSet, tradeCards, tradeValue } from './engine.js';
import { stepBot } from './bots.js';
import { initMap, renderMap, focusSystem, focusGroup, fitMap, GROUP_COLORS } from './map.js';
import { audioSettings, setAudio, sound } from './audio.js';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'eve-warfront-campaign-v1';
let state, started=false, selected=null, target=null, chosenCards=[], paused=false, botTimer=null, blitzTimer=null, blitzing=false, resultShown=false, toastTimer;
let saveProblem='';
try {
  const saved=localStorage.getItem(KEY);
  if(saved){const parsed=JSON.parse(saved);assertState(parsed);state=parsed;started=true;}
} catch { saveProblem='Saved campaign could not be loaded. Export is available after a new deployment.'; }
if(!state)state=newGame({seed:20260922});
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function save(){
  if(!started)return;
  try{localStorage.setItem(KEY,JSON.stringify(state));$('save-status').textContent='Campaign saved';}
  catch{$('save-status').textContent='Save failed · use Export';}
}
function stopBlitz(){clearTimeout(blitzTimer);blitzTimer=null;blitzing=false;}
function humanTurn(){return started && state.current===0 && state.winner===null;}
function canAct(){return humanTurn() && !document.querySelector('dialog[open]');}
function transact(action, effect='interface'){
  try{action();save();if(effect)sound(effect);render();}catch(error){stopBlitz();toast(error.message);render();}
}
function selectSystem(index){
  stopBlitz();
  const t=state.territories[index];
  if(humanTurn() && state.phase==='attack' && selected!==null && state.territories[selected].owner===0 && enemies(state,0,t.owner) && NEIGHBORS[selected].includes(index))target=index;
  else if(humanTurn() && state.phase==='fortify' && selected!==null && state.territories[selected].owner===0 && t.owner===0 && index!==selected && connectedOwned(state,selected,index))target=index;
  else{selected=index;target=null;}
  render();
}
initMap(selectSystem);
$('system-names').innerHTML=SYSTEMS.map(s=>`<option value="${s.name}"></option>`).join('');
$('map-group').innerHTML+=GROUPS.map((g,i)=>`<option value="${i}">${g.name} · +${g.bonus}</option>`).join('');
$('map-group').addEventListener('change',e=>e.target.value===''?fitMap():focusGroup(Number(e.target.value)));
function render(){
  renderRoster();renderOrders();renderIntel();renderCards();renderLog();renderMap(state,selected,target,$('system-search').value);
  $('round-label').textContent=`ROUND ${String(Math.floor((state.turn-1)/4)+1).padStart(2,'0')}`;
  $('pause-bots').textContent=paused?'Resume bots':'Pause bots';
  $('pause-bots').setAttribute('aria-pressed',String(paused));
  const phase=state.phase==='occupy'?'attack':state.phase;
  $('phase-steps').innerHTML=['reinforce','attack','fortify'].map((p,i)=>`<span class="phase-step ${phase===p?'active':''}"><b>${i+1}</b>${p[0].toUpperCase()+p.slice(1)}</span>`).join('');
  $('turn-badge').textContent=state.winner!==null?'COMPLETE':state.current===0?'YOUR TURN':paused?'PAUSED':'BOT TURN';
  if(state.winner!==null && started && !resultShown){
    resultShown=true;stopBlitz();
    const won=!enemies(state,0,state.winner);
    $('result-title').textContent=won?'The warzone is yours.':'The front has fallen.';
    $('result-description').textContent=`${state.mode==='teams' ? state.players[state.winner].faction==='caldari'?'The Caldari State':'The Gallente Federation' : state.players[state.winner].name} secured all 90 systems in ${state.turn} commander turns. ${won?'Your campaign ends in victory.':'A new campaign is a new chance.'}`;
    $('result-dialog').showModal();
  }
  scheduleBot();
}
function renderRoster(){
  const counts=state.players.map((_,i)=>owned(state,i).length);
  $('control-percent').textContent=`${Math.round(counts[0]/SYSTEMS.length*100)}%`;
  $('control-bar').innerHTML=counts.map((n,i)=>`<span style="width:${n/SYSTEMS.length*100}%;background:${COLORS[i]}"></span>`).join('');
  $('roster').innerHTML=state.players.map((p,i)=>`<button class="commander ${state.current===i?'active':''} ${!counts[i]?'eliminated':''}" style="--commander:${COLORS[i]}" data-player="${i}" aria-label="${escape(p.name)}, ${counts[i]} systems"><img src="assets/${p.ship}.png" alt=""><span class="pilot"><strong>${escape(p.name)}</strong><small>${i===0?'YOU':state.mode==='teams'&&p.team===0?'ALLY':'BOT'} · ${p.faction==='caldari'?'CALMIL':'GALMIL'}${i>0?` · ${p.style==='aggressive'?'AGG':p.style==='defensive'?'DEF':'BAL'}`:''}</small></span><span class="count">${counts[i]}<small>SYSTEMS</small></span></button>`).join('');
  $('constellations').innerHTML=GROUPS.map((g,i)=>{
    const n=g.systems.filter(id=>state.territories[id].owner===0).length;
    return `<button class="constellation ${n===g.systems.length?'held':''}" data-group="${i}" style="--group:${GROUP_COLORS[i]}" title="${escape(g.region)} · Hold all ${g.systems.length} systems for +${g.bonus} fleets"><i></i>${g.name}<span class="const-progress">${n}/${g.systems.length}</span><b>+${g.bonus}</b></button>`;
  }).join('');
}
function renderOrders(){
  const mine=selected!==null && state.territories[selected].owner===0;
  const stored=$('fleet-amount')?.value;
  const fleetInput=(min,max,value=max)=>`<input id="fleet-amount" type="number" aria-label="Fleet count" min="${min}" max="${max}" value="${Math.max(min,Math.min(max,Number(stored)||value))}">`;
  let html='';
  if(state.winner!==null){html='<h3 class="orders-title">The campaign is over.</h3><p class="orders-copy">Review the final board or begin a new campaign.</p><button class="primary wide next-phase" data-action="new">New campaign →</button>';}
  else if(state.current!==0){
    const p=state.players[state.current];
    html=`<h3 class="orders-title">${paused?'Holding position.':'Orders in motion.'}</h3><p class="orders-copy"><strong style="color:${COLORS[state.current]}">${escape(p.name)}</strong> is ${state.phase==='reinforce'?'deploying reinforcements':state.phase==='fortify'?'securing the frontier':'engaging the enemy'}. ${!owned(state,0).length?'Your fleet has been eliminated. You are spectating.':'Your next turn will begin automatically.'}</p>${battleHTML()}<button class="next-phase" data-action="pause">${paused?'Resume bot turns':'Pause bot turns'}</button>`;
  }else if(state.phase==='reinforce'){
    const inc=income(state);
    html=`<h3 class="orders-title">Strengthen the front.</h3><p class="orders-copy">${state.resumeAttack?'Deploy your elimination bonus, then resume the attack.':'Select one of your systems to deploy fleets.'}</p><div class="reserve-card"><strong>${state.reserve}</strong><span>FLEETS TO DEPLOY<br><span class="muted">${inc.base} base + ${inc.bonus} constellation income</span></span></div>${mine?`<p class="orders-copy">Deploy to <strong>${SYSTEMS[selected].name}</strong></p><div class="action-row">${fleetInput(1,Math.max(1,state.reserve))}<button class="primary" data-action="deploy" ${state.reserve===0?'disabled':''}>Deploy fleets</button></div>`:'<div class="cards-empty">Select a blue system on the map.</div>'}<button class="next-phase" data-action="attack-phase" ${state.reserve||state.players[0].cards.length>=5?'disabled':''}>${state.resumeAttack?'Resume attack':'Begin attack phase'} →</button>`;
  }else if(state.phase==='occupy'){
    const o=state.occupation;
    html=`<h3 class="orders-title">System captured.</h3><p class="orders-copy">Move ${o.min}–${o.max} fleets from ${SYSTEMS[o.from].name} into <strong>${SYSTEMS[o.to].name}</strong>. One fleet must stay behind.</p>${battleHTML()}<div class="action-row">${fleetInput(o.min,o.max)}<button class="primary" data-action="occupy">Occupy system</button></div>`;
  }else if(state.phase==='attack'){
    const valid=mine&&state.territories[selected].troops>1&&target!==null&&enemies(state,0,state.territories[target].owner)&&NEIGHBORS[selected].includes(target);
    html='<h3 class="orders-title">Push the frontline.</h3>';
    if(valid){
      const a=state.territories[selected],d=state.territories[target],chance=conquestChance(a.troops-1,d.troops);
      html+=`<p class="orders-copy"><strong>${SYSTEMS[selected].name}</strong> → <strong>${SYSTEMS[target].name}</strong></p><div class="odds"><span>${a.troops-1} attacking / ${d.troops} defending</span><strong>${a.troops>501||d.troops>500?'≈':''}${(chance*100).toFixed(0)}%</strong></div><p class="orders-copy">Chance to capture with maximum dice.</p><div class="action-row"><select id="attack-dice" aria-label="Attack dice">${Array.from({length:Math.min(3,a.troops-1)},(_,i)=>`<option value="${i+1}" ${i===Math.min(3,a.troops-1)-1?'selected':''}>${i+1} ${i?'dice':'die'}</option>`).join('')}</select><button class="primary" data-action="roll" ${blitzing?'disabled':''}>Roll attack</button></div><button class="next-phase" data-action="blitz">${blitzing?'Stop blitz':'Blitz until capture →'}</button>`;
    }else html+=`<p class="orders-copy">${mine?state.territories[selected].troops<2?'This system needs at least two fleets to attack.':'Select a connected enemy system. Eligible targets glow on the map.':'Select one of your systems, then a connected enemy.'}</p>`;
    html+=battleHTML()+`<button class="next-phase" data-action="fortify-phase">Finish attacks & fortify →</button>`;
  }else if(state.phase==='fortify'){
    html=`<h3 class="orders-title">Secure your gains.</h3><p class="orders-copy">${state.moved?'Fleet transfer complete. End your turn when ready.':'Optionally transfer fleets once through systems you own. Select an origin, then a friendly destination.'}</p>`;
    if(!state.moved&&mine&&target!==null&&target!==selected&&state.territories[target].owner===0&&connectedOwned(state,selected,target)&&state.territories[selected].troops>1){html+=`<p class="battle-summary">${SYSTEMS[selected].name} → ${SYSTEMS[target].name}</p><div class="action-row">${fleetInput(1,state.territories[selected].troops-1)}<button class="secondary" data-action="move">Transfer fleets</button></div>`;}
    html+='<button class="primary wide" style="margin-top:18px" data-action="end">End turn →</button>';
  }
  $('orders').innerHTML=html;
}
function battleHTML(){
  const b=state.lastBattle;if(!b)return '';
  return `<div class="dice-row" aria-label="Last battle dice: attacker ${b.attack.join(',')}, defender ${b.defense.join(',')}">${b.attack.map(n=>`<span class="dice">${n}</span>`).join('')}<span class="dice-divider">VS</span>${b.defense.map(n=>`<span class="dice defender">${n}</span>`).join('')}</div><p class="battle-summary">Last volley · attacker −${b.lostA} / defender −${b.lostD}</p>`;
}
function renderIntel(){
  const index=target??selected;
  if(index===null){$('intel').innerHTML='<div class="intel-placeholder"><span>◎</span><p>Select a system on the map<br>to inspect its fleet and stargates.</p></div>';return;}
  const s=SYSTEMS[index],t=state.territories[index],g=GROUPS[s.group],p=state.players[t.owner];
  $('intel').innerHTML=`<div class="selected-name">${s.name}<span class="security">${s.security.toFixed(1)}</span></div><p class="system-location">${g.region} / ${g.name}</p><div class="intel-stats"><div><small>COMMANDER</small><strong style="color:${COLORS[t.owner]}">${escape(p.name)}</strong></div><div><small>STANDING FLEET</small><strong>${t.troops} ${t.troops===1?'fleet':'fleets'}</strong></div><div><small>CONSTELLATION</small><strong>+${g.bonus} bonus fleets</strong></div><div><small>STARGATES</small><strong>${NEIGHBORS[index].length} connections</strong></div></div><div class="gate-list">${NEIGHBORS[index].map(i=>`<button data-system="${i}" class="${enemies(state,0,state.territories[i].owner)?'enemy':''}">${SYSTEMS[i].name} · ${state.territories[i].troops}</button>`).join('')}</div><button class="text-button" style="margin-top:13px" data-focus="${index}">Locate on map ↗</button>`;
}
function renderCards(){
  const hand=state.players[0].cards;
  chosenCards=chosenCards.filter(c=>hand.includes(c));
  $('card-count').textContent=`${hand.length} HELD`;
  if(!hand.length){$('cards').innerHTML='<div class="cards-empty">Conquer a system to earn a card.<br>Trade sets of three for more fleets.</div>';return;}
  const allowed=humanTurn()&&state.phase==='reinforce'&&(!state.resumeAttack||hand.length>=5);
  const eligible=chosenCards.filter(c=>c<SYSTEMS.length&&state.territories[c].owner===0);
  $('cards').innerHTML=`<div class="hand">${hand.map(c=>`<button class="card ${chosenCards.includes(c)?'selected':''}" data-card="${c}" aria-pressed="${chosenCards.includes(c)}"><img src="assets/${cardType(c)==='Frigate'?'catalyst':cardType(c)==='Cruiser'?'caracal':'dominix'}.png" alt=""><span>${c<SYSTEMS.length?SYSTEMS[c].name:'Wild card'}</span><small>${cardType(c).toUpperCase()}</small></button>`).join('')}</div><p class="trade-info">Next set: <strong>+${tradeValue(state.trades)} fleets</strong>. ${hand.length>=5?'A set must be exchanged before attacking.':'Choose three cards or find a valid set.'}</p>${eligible.length>1?`<label class="field-label" for="card-bonus">OWNED SYSTEM +2 BONUS</label><select id="card-bonus" style="width:100%;font-size:10px">${eligible.map(i=>`<option value="${i}">${SYSTEMS[i].name}</option>`).join('')}</select>`:''}<div class="action-row"><button class="secondary" data-action="find-set" ${findSet(hand)?'':'disabled'}>Find set</button><button class="secondary" data-action="trade" ${allowed&&validSet(chosenCards)?'':'disabled'}>Exchange</button></div>`;
}
function eventHTML(l){return `<div class="activity-entry ${['capture','battle'].includes(l.kind)?l.kind:''}"><time>${String(l.turn).padStart(2,'0')}</time><p>${escape(l.text)}</p></div>`;}
function renderLog(){
  $('activity').innerHTML=state.log.slice(-5).reverse().map(eventHTML).join('');
  if($('log-dialog').open){const query=$('log-search').value.toLowerCase();$('log-entries').innerHTML=state.log.filter(l=>l.text.toLowerCase().includes(query)).slice(-150).reverse().map(eventHTML).join('');}
}
function scheduleBot(){
  clearTimeout(botTimer);botTimer=null;
  if(!started||state.current===0||state.winner!==null||paused||document.hidden||document.querySelector('dialog[open]'))return;
  botTimer=setTimeout(()=>{
    if(paused||document.hidden||document.querySelector('dialog[open]'))return;
    try{
      const previous=state.current, action=stepBot(state);
      if(action?.type==='attack'){selected=action.from;target=action.to;sound('dice-roll');}
      if(action?.type==='occupy')sound('notification');
      if(state.current!==previous){selected=null;target=null;if(state.current===0)sound('complete');}
      save();render();
    }catch(error){paused=true;toast(`Bot paused: ${error.message}`);render();}
  },Number($('bot-speed').value));
}
function executeBlitz(){
  if(!blitzing||!canAct()||state.phase!=='attack'||selected===null||target===null||state.territories[selected].troops<2){stopBlitz();render();return;}
  transact(()=>attack(state,selected,target,Math.min(3,state.territories[selected].troops-1)),'dice-roll');
  if(state.phase==='attack'&&state.territories[selected].troops>1&&blitzing)blitzTimer=setTimeout(executeBlitz,110);
  else{stopBlitz();render();}
}
document.querySelector('.right-panel').addEventListener('click',e=>{
  const system=e.target.closest('[data-system]');if(system){selectSystem(Number(system.dataset.system));return;}
  const focus=e.target.closest('[data-focus]');if(focus){focusSystem(Number(focus.dataset.focus));return;}
  const card=e.target.closest('[data-card]');if(card){const id=Number(card.dataset.card);if(chosenCards.includes(id))chosenCards=chosenCards.filter(c=>c!==id);else if(chosenCards.length<3)chosenCards.push(id);else toast('Select no more than three cards.');renderCards();return;}
  const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
  if(action==='pause'){paused=!paused;render();return;}
  if(action==='new'){openSetup();return;}
  if(action==='find-set'){chosenCards=findSet(state.players[0].cards)||[];renderCards();return;}
  if(!canAct())return;
  const amount=Number($('fleet-amount')?.value);
  if(action!=='blitz')stopBlitz();
  switch(action){
    case 'deploy':transact(()=>reinforce(state,selected,amount));break;
    case 'attack-phase':transact(()=>{beginAttack(state);target=null;});break;
    case 'roll':transact(()=>attack(state,selected,target,Number($('attack-dice').value)),'dice-roll');break;
    case 'blitz':if(blitzing){stopBlitz();render();}else{blitzing=true;executeBlitz();}break;
    case 'occupy':transact(()=>{const to=state.occupation.to;occupy(state,amount);selected=to;target=null;},'notification');break;
    case 'fortify-phase':transact(()=>{beginFortify(state);target=null;});break;
    case 'move':transact(()=>fortify(state,selected,target,amount),'ship-thrust');break;
    case 'end':transact(()=>{endTurn(state);selected=null;target=null;chosenCards=[];});break;
    case 'trade':transact(()=>{tradeCards(state,chosenCards,$('card-bonus')?Number($('card-bonus').value):null);chosenCards=[];},'complete');break;
  }
});
$('roster').addEventListener('click',e=>{const button=e.target.closest('[data-player]');if(!button)return;const list=owned(state,Number(button.dataset.player));if(list.length){const id=list.reduce((a,b)=>state.territories[a].troops>=state.territories[b].troops?a:b);selected=id;target=null;focusSystem(id);render();}});
$('constellations').addEventListener('click',e=>{const button=e.target.closest('[data-group]');if(button)focusGroup(Number(button.dataset.group));});
$('system-search').addEventListener('input',()=>{renderMap(state,selected,target,$('system-search').value);const exact=SYSTEMS.findIndex(s=>s.name.toLowerCase()===$('system-search').value.toLowerCase());if(exact>=0){selected=exact;target=null;focusSystem(exact);render();}});
$('system-search').addEventListener('keydown',e=>{if(e.key==='Enter'){const index=SYSTEMS.findIndex(s=>s.name.toLowerCase().includes($('system-search').value.toLowerCase()));if(index>=0){selected=index;target=null;focusSystem(index);render();}}if(e.key==='Escape'){$('system-search').value='';renderMap(state,selected,target);}});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();$('system-search').focus();}});
$('pause-bots').addEventListener('click',()=>{paused=!paused;render();});
$('bot-speed').addEventListener('change',scheduleBot);
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(botTimer);stopBlitz();}else render();});
function openSetup(){stopBlitz();clearTimeout(botTimer);$('setup-warning').hidden=!started;$('close-setup').hidden=!started;$('setup-dialog').showModal();}
$('new-game').addEventListener('click',openSetup);
$('close-setup').addEventListener('click',()=>{$('setup-dialog').close();render();});
$('setup-dialog').addEventListener('cancel',e=>{if(!started)e.preventDefault();});
$('setup-form').addEventListener('submit',e=>{
  e.preventDefault();const data=new FormData(e.currentTarget);
  state=newGame({seed:crypto.getRandomValues(new Uint32Array(1))[0],faction:data.get('faction'),mode:data.get('mode'),difficulty:data.get('difficulty'),name:data.get('callsign')});
  started=true;selected=null;target=null;chosenCards=[];paused=false;resultShown=false;$('system-search').value='';
  $('setup-dialog').close();fitMap();save();sound('complete');render();
});
function openDialog(id){stopBlitz();clearTimeout(botTimer);$(id).showModal();}
$('help').addEventListener('click',()=>openDialog('manual-dialog'));
$('full-log').addEventListener('click',()=>{openDialog('log-dialog');renderLog();});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',scheduleBot));
$('log-search').addEventListener('input',renderLog);
$('result-map').addEventListener('click',()=>$('result-dialog').close());
$('result-new').addEventListener('click',()=>{$('result-dialog').close();openSetup();});
function updateAudio(){const config=audioSettings();$('audio-toggle').textContent=config.muted?'♩':'♫';$('audio-toggle').setAttribute('aria-label',config.muted?'Enable sound':'Mute sound');$('audio-toggle').setAttribute('aria-pressed',String(!config.muted));$('audio-toggle').title=config.muted?'Sound effects off':'Sound effects on';$('audio-volume').value=Math.round(config.volume*100);}
$('audio-toggle').addEventListener('click',()=>{setAudio({muted:!audioSettings().muted});updateAudio();sound('interface');});
$('audio-volume').addEventListener('input',e=>setAudio({volume:Number(e.target.value)/100}));
function download(filename,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export-save').addEventListener('click',()=>{if(!started){toast('Deploy a campaign before exporting.');return;}download('warfront-campaign.json',JSON.stringify(state,null,2),'application/json');});
$('export-log').addEventListener('click',()=>download('warfront-dispatches.txt',state.log.map(l=>`[Turn ${l.turn}] ${l.text}`).join('\n'),'text/plain'));
$('import-save').addEventListener('click',()=>{$('save-file').click();});
$('save-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>4_000_000)throw new Error('Save file is too large.');
    const incoming=JSON.parse(await file.text());assertState(incoming);
    // Import is an explicit replacement action; keep a recovery copy of the prior
    // campaign so accidental imports remain reversible.
    if(started)try{localStorage.setItem(`${KEY}-before-import`,JSON.stringify(state));}catch{}
    stopBlitz();clearTimeout(botTimer);state=incoming;started=true;paused=true;selected=null;target=null;chosenCards=[];resultShown=false;
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());save();render();toast('Campaign imported. Bot turns are paused.');
  }catch(error){toast(`Cannot import: ${error.message}`);}finally{e.target.value='';}
});
updateAudio();render();
if(!started)openSetup();
if(saveProblem)toast(saveProblem);
