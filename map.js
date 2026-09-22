import { SYSTEMS, GROUPS, EDGES, NEIGHBORS } from './map-data.js';
import { COLORS, enemies, connectedOwned } from './engine.js';
const svg = document.querySelector('#warzone');
const viewport = document.querySelector('#map-viewport');
const NS = 'http://www.w3.org/2000/svg';
export const GROUP_COLORS = ['#a1bde9','#82bdab','#879ee1','#bbadb4','#86b9be','#b9b390','#90adca','#9cabc0','#84aba3','#a5a8db','#acbaa2','#91b9bc','#bbb3a0','#a8b7d7','#9cadc5'];
let box = { x: 0, y: 0, w: 1710, h: 1290 };
let choose, dragging = false, moved = false, pinchDistance = null;
const pointers = new Map();
const nodes = [], lines = [];
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
    const pts = g.systems.flatMap(id => { const s = SYSTEMS[id]; return [[s.x-48,s.y-30],[s.x+48,s.y-30],[s.x+48,s.y+47],[s.x-48,s.y+47]]; });
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
    group.append(el('rect',{x:-53,y:-22,width:106,height:65,rx:8,class:'hit'}),el('circle',{r:25,class:'halo'}),el('circle',{r:15,class:'ring'}),el('text',{class:'fleet',y:0}),el('text',{class:'name',y:34},s.name));
    group.addEventListener('click', e => { if (!moved) { e.stopPropagation(); choose(i); } });
    group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(i); } });
    group.addEventListener('focus', () => { const p=SYSTEMS[i]; if(p.x<box.x || p.x>box.x+box.w || p.y<box.y || p.y>box.y+box.h) focusSystem(i); });
    systems.append(group); nodes.push(group);
  });
  document.querySelector('#map-fit').addEventListener('click', fitMap);
  document.querySelector('#zoom-in').addEventListener('click',()=>zoom(.75));
  document.querySelector('#zoom-out').addEventListener('click',()=>zoom(1.33));
  document.querySelector('#map-labels').addEventListener('click', e => {
    const hidden = svg.classList.toggle('hide-labels'); e.currentTarget.setAttribute('aria-pressed',String(!hidden));
  });
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
  nodes.forEach((node,i) => {
    const t=state.territories[i];
    let eligible=false;
    if(selected!==null && state.current===0 && state.territories[selected].owner===0) {
      if(state.phase==='attack')eligible=NEIGHBORS[selected].includes(i)&&enemies(state,0,t.owner);
      if(state.phase==='fortify')eligible=selected!==i&&t.owner===0&&connectedOwned(state,selected,i);
    }
    node.style.setProperty('--owner',COLORS[t.owner]);
    node.setAttribute('class',`system${selected===i?' selected':''}${target===i?' target':''}${eligible?' eligible':''}${filter && !SYSTEMS[i].name.toLowerCase().includes(filter.toLowerCase())?' dimmed':''}`);
    node.querySelector('.fleet').textContent=t.troops;
    node.setAttribute('aria-label',`${SYSTEMS[i].name}, ${state.players[t.owner].name}, ${t.troops} fleets`);
    node.setAttribute('aria-pressed',String(selected===i));
  });
  lines.forEach((line,i) => line.classList.toggle('highlight',selected!==null && EDGES[i].includes(selected)));
}
