import { SYSTEMS, GROUPS, EDGES, NEIGHBORS } from './map-data.js';
import { COLORS, enemies, connectedOwned } from './engine.js';
import { NEUTRAL, FACTION_COLORS, fwEnabled, controllerName, operationalState, canLaunch } from './warfare.js';
const svg = document.querySelector('#warzone');
const viewport = document.querySelector('#map-viewport');
const NS = 'http://www.w3.org/2000/svg';
export const GROUP_COLORS = ['#a1bde9','#82bdab','#879ee1','#bbadb4','#86b9be','#b9b390','#90adca','#9cabc0','#84aba3','#a5a8db','#acbaa2','#91b9bc','#bbb3a0','#a8b7d7','#9cadc5'];
let box = { x: 0, y: 0, w: 1710, h: 1290 };
let choose, dragging = false, moved = false, pinchDistance = null;
const pointers = new Map();
const nodes = [], lines = [];
let lastState = null, activeSelected = null, activeTarget = null, hovered = null;
function el(tag, attrs = {}, text = '') {
  const e = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, value);
  if (text) e.textContent = text;
  return e;
}
function convex(points) {
  const sorted = points.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const lo = [], hi = [];
  for (const p of sorted) { while (lo.length >= 2 && cross(lo.at(-2),lo.at(-1),p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...sorted].reverse()) { while (hi.length >= 2 && cross(hi.at(-2),hi.at(-1),p) <= 0) hi.pop(); hi.push(p); }
  return [...lo.slice(0,-1), ...hi.slice(0,-1)];
}
export function initMap(onChoose) {
  choose = onChoose;
  const regions = document.querySelector('#map-regions'), links = document.querySelector('#map-links'), systems = document.querySelector('#map-systems');
  GROUPS.forEach((g,i) => {
    const pts = g.systems.flatMap(id => { const s = SYSTEMS[id]; return [[s.x-20,s.y-20],[s.x+20,s.y-20],[s.x+20,s.y+20],[s.x-20,s.y+20]]; });
    const hull = convex(pts);
    regions.append(el('path', { d: `M${hull.map(p=>p.join(',')).join('L')}Z`, fill: GROUP_COLORS[i], 'fill-opacity': .035, stroke: GROUP_COLORS[i], 'stroke-opacity': .13, 'stroke-width': 1, 'stroke-linejoin': 'round' }));
    const x = g.systems.reduce((v,id) => v+SYSTEMS[id].x,0)/g.systems.length;
    const y = Math.min(...g.systems.map(id => SYSTEMS[id].y))-45;
    regions.append(el('text',{x,y,class:'region-label'},g.name.toUpperCase()));
  });
  EDGES.forEach(([a,b]) => {
    const line = el('line', { x1:SYSTEMS[a].x,y1:SYSTEMS[a].y,x2:SYSTEMS[b].x,y2:SYSTEMS[b].y,class:'gate' });
    links.append(line); lines.push(line);
  });
  SYSTEMS.forEach((s,i) => {
    const group = el('g',{transform:`translate(${s.x} ${s.y})`,class:'system',tabindex:0,role:'button','data-system':i});
    group.append(el('title'),el('circle',{r:18,class:'hit'}),el('circle',{r:22,class:'halo'}),el('circle',{r:18,class:'front-ring'}),el('circle',{r:12,class:'ring'}),el('text',{class:'fleet',y:0}),el('text',{class:'name',y:29},s.name));
    group.addEventListener('click', e => { if (!moved) { e.stopPropagation(); choose(i); } });
    group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(i); } });
    group.addEventListener('focus', () => { const p=SYSTEMS[i]; if(p.x<box.x || p.x>box.x+box.w || p.y<box.y || p.y>box.y+box.h) focusSystem(i); });
    group.addEventListener('pointerenter', () => { hovered=i; layoutLabels(); });
    group.addEventListener('pointerleave', () => { hovered=null; layoutLabels(); });
    systems.append(group); nodes.push(group);
  });
  document.querySelector('#map-fit').addEventListener('click', fitMap);
  document.querySelector('#zoom-in').addEventListener('click',()=>zoom(.75));
  document.querySelector('#zoom-out').addEventListener('click',()=>zoom(1.33));
  document.querySelector('#map-labels').addEventListener('click', e => {
    const hidden = svg.classList.toggle('hide-labels'); e.currentTarget.setAttribute('aria-pressed',String(!hidden));
  });
  document.querySelector('#map-color').addEventListener('change',()=>{if(lastState)renderMap(lastState,activeSelected,activeTarget,document.querySelector('#system-search').value);});
  new ResizeObserver(layoutLabels).observe(viewport);
  viewport.addEventListener('wheel', e => {
    e.preventDefault(); const point = svgPoint(e.clientX,e.clientY);
    zoom(Math.exp(Math.max(-200,Math.min(200,e.deltaY))*.0015),point.x,point.y);
  }, {passive:false});
  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    dragging=true;moved=false;pinchDistance=null;
  });
  viewport.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const old = pointers.get(e.pointerId), next={x:e.clientX,y:e.clientY};
    pointers.set(e.pointerId,next);
    const dx=next.x-old.x,dy=next.y-old.y;
    if (Math.abs(dx)+Math.abs(dy)>2) { moved=true; viewport.setPointerCapture(e.pointerId); viewport.classList.add('dragging'); }
    if (pointers.size===2) {
      const [a,b]=[...pointers.values()],dist=Math.hypot(a.x-b.x,a.y-b.y),p=svgPoint((a.x+b.x)/2,(a.y+b.y)/2);
      if (pinchDistance) zoom(pinchDistance/dist,p.x,p.y);
      pinchDistance=dist;
    } else if(moved) {
      const p1=svgPoint(old.x,old.y),p2=svgPoint(next.x,next.y);
      box.x+=p1.x-p2.x;box.y+=p1.y-p2.y;applyBox();
    }
  });
  const release=e=>{pointers.delete(e.pointerId);pinchDistance=null;if(!pointers.size){dragging=false;viewport.classList.remove('dragging');}};
  viewport.addEventListener('pointerup',release);viewport.addEventListener('pointercancel',release);
}
function svgPoint(x,y) { const p=svg.createSVGPoint();p.x=x;p.y=y;return p.matrixTransform(svg.getScreenCTM().inverse()); }
function applyBox() {
  box.x=Math.max(-box.w*.6,Math.min(1710-box.w*.4,box.x));
  box.y=Math.max(-box.h*.6,Math.min(1290-box.h*.4,box.y));
  svg.setAttribute('viewBox',`${box.x} ${box.y} ${box.w} ${box.h}`);
  layoutLabels();
}
function zoom(factor,x=box.x+box.w/2,y=box.y+box.h/2) {
  const width=Math.max(280,Math.min(2400,box.w*factor));factor=width/box.w;
  box={x:x-(x-box.x)*factor,y:y-(y-box.y)*factor,w:width,h:box.h*factor};applyBox();
}
export function fitMap() { box={x:0,y:0,w:1710,h:1290};applyBox(); }
export function focusSystem(index) { const s=SYSTEMS[index];box={x:s.x-270,y:s.y-205,w:540,h:410};applyBox(); }
export function focusGroup(index) {
  const list=GROUPS[index].systems.map(i=>SYSTEMS[i]), minX=Math.min(...list.map(s=>s.x))-100,minY=Math.min(...list.map(s=>s.y))-100;
  const w=Math.max(500,Math.max(...list.map(s=>s.x))-minX+100),h=Math.max(400,Math.max(...list.map(s=>s.y))-minY+100);
  box={x:minX,y:minY,w,h};applyBox();
}
export function renderMap(state,selected,target,filter = '') {
  lastState=state;activeSelected=selected;activeTarget=target;
  const byMilitia=document.querySelector('#map-color').value==='militia'&&fwEnabled(state);
  const legend=document.querySelector('.map-legend');
  legend.querySelectorAll('.color-key').forEach(item=>item.remove());
  const keys=byMilitia?[['Caldari',FACTION_COLORS.caldari],['Gallente',FACTION_COLORS.gallente]]:state.players.map((p,i)=>[p.name,COLORS[i]]);
  if(fwEnabled(state))keys.push(['Neutral','#b1bac5']);
  for(const [name,color] of keys){
    const item=document.createElement('span'),dot=document.createElement('i');
    item.className='color-key';dot.className='legend-dot';dot.style.setProperty('--dot',color);
    item.append(dot,document.createTextNode(name));legend.insertBefore(item,document.querySelector('#frontline-key'));
  }
  document.querySelector('#frontline-key').hidden=!fwEnabled(state);
  nodes.forEach((node,i) => {
    const t=state.territories[i];
    let eligible=false;
    if(selected!==null && state.current===0 && state.territories[selected].owner===0) {
      if(state.phase==='attack')eligible=canLaunch(state,selected)&&canLaunch(state,i)&&NEIGHBORS[selected].includes(i)&&enemies(state,0,t.owner);
      if(state.phase==='fortify')eligible=selected!==i&&t.owner===0&&connectedOwned(state,selected,i);
    }
    node.style.setProperty('--owner',t.owner===NEUTRAL?'#b1bac5':byMilitia?FACTION_COLORS[t.sovereignty]:COLORS[t.owner]);
    node.style.setProperty('--sovereignty',FACTION_COLORS[t.sovereignty]||COLORS[t.owner]);
    node.style.setProperty('--fleet-color',COLORS[t.owner]||'#b1bac5');
    const frontline=fwEnabled(state)&&operationalState(state,i)==='Frontline';
    node.setAttribute('class',`system${selected===i?' selected':''}${target===i?' target':''}${eligible?' eligible':''}${frontline?' frontline':''}${t.pending?' pending':''}${t.owner===NEUTRAL?' neutral':''}${t.owner===0?' mine':''}${filter && !SYSTEMS[i].name.toLowerCase().includes(filter.toLowerCase())?' dimmed':''}`);
    node.querySelector('.fleet').textContent=t.troops;
    const description=`${SYSTEMS[i].name}, ${controllerName(state,t.owner)}, ${t.troops} fleets${fwEnabled(state)?`, ${t.sovereignty}, ${operationalState(state,i)}, ${t.pending?'lost until downtime':`${t.contested}% contested`}`:''}`;
    node.setAttribute('aria-label',description);
    node.querySelector('title').textContent=description;
    node.setAttribute('aria-pressed',String(selected===i));
  });
  lines.forEach((line,i) => {
    line.classList.toggle('highlight',selected!==null && EDGES[i].includes(selected));
    const [a,b]=EDGES[i];
    line.classList.toggle('frontline-gate',fwEnabled(state)&&state.territories[a].sovereignty!==state.territories[b].sovereignty);
  });
  layoutLabels();
}
function layoutLabels() {
  if(!nodes.length)return;
  const scale=svg.getScreenCTM()?.a||.5;
  const fontSize=Math.max(10,Math.min(24,12/scale)), height=fontSize*1.25;
  const occupied=[];
  const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  const visible=i=>SYSTEMS[i].x>=box.x-40&&SYSTEMS[i].x<=box.x+box.w+40&&SYSTEMS[i].y>=box.y-40&&SYSTEMS[i].y<=box.y+box.h+40;
  const priority=i=>(i===hovered?100:i===activeTarget?90:i===activeSelected?80:activeSelected!==null&&NEIGHBORS[activeSelected].includes(i)?20:0);
  const order=SYSTEMS.map((_,i)=>i).sort((a,b)=>priority(b)-priority(a));
  for(const i of order){
    const label=nodes[i].querySelector('.name'),s=SYSTEMS[i],width=s.name.length*fontSize*.54+8;
    label.style.fontSize=`${fontSize}px`;
    if(!visible(i)){label.style.visibility='hidden';continue;}
    const candidates=[{x:18,y:-height/2},{x:-width-18,y:-height/2},{x:-width/2,y:20},{x:-width/2,y:-height-20},{x:16,y:18},{x:-width-16,y:-height-18}];
    const clear=candidates.find(c=>{
      const rect={x:s.x+c.x,y:s.y+c.y,w:width,h:height};
      return !occupied.some(b=>intersects(rect,b))&&!SYSTEMS.some((other,j)=>j!==i&&intersects(rect,{x:other.x-14,y:other.y-14,w:28,h:28}));
    });
    const chosen=clear||(priority(i)>=80?candidates[0]:null);
    label.style.visibility=chosen?'visible':'hidden';
    if(chosen){label.setAttribute('x',chosen.x+width/2);label.setAttribute('y',chosen.y+height*.76);occupied.push({x:s.x+chosen.x,y:s.y+chosen.y,w:width,h:height});}
  }
}
