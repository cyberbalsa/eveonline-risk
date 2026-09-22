import { SYSTEMS, NEIGHBORS } from './map-data.js';

export const NEUTRAL = -1;
export const FACTION_COLORS = { caldari: '#65c9ff', gallente: '#66e4ae' };
export const HOME_ANCHORS = { caldari: ['Hykanima', 'Ishomilken'], gallente: ['Eugales', 'Fliet'] };
export const MIN_HOME_SYSTEMS = 6;
export const MIN_MILITIA_FRONTLINES = 2;
export const fwEnabled = state => state.rules === 'fw';
export const controllerName = (state, owner) => owner === NEUTRAL ? 'Neutral garrison' : state.players[owner].name;
export function distances(starts, accept = () => true) {
  const result = new Map(starts.map(i => [i, 0])), queue = [...starts];
  for (const i of queue) for (const j of NEIGHBORS[i]) {
    if (!result.has(j) && accept(j)) { result.set(j, result.get(i) + 1); queue.push(j); }
  }
  return result;
}
export function operationalState(state, index) {
  const faction = state.territories[index].sovereignty;
  const frontline = i => NEIGHBORS[i].some(j => state.territories[j].sovereignty !== state.territories[i].sovereignty);
  if (frontline(index)) return 'Frontline';
  if (NEIGHBORS[index].some(i => state.territories[i].sovereignty === faction && frontline(i))) return 'Command Operations';
  return 'Rearguard';
}
export function operationBudget(state, player = state.current) {
  return fwEnabled(state) ? 4 + Math.min(4, Math.floor(state.territories.filter(t => t.owner === player && !t.pending).length / 10)) : 0;
}
export function needsHub(state, target, player = state.current) {
  return fwEnabled(state) && state.territories[target].sovereignty !== state.players[player].faction;
}
export function canLaunch(state, index) {
  return !fwEnabled(state) || !state.territories[index].pending;
}
export function victoryReady(state, player) {
  if (state.territories.some(t => t.owner === NEUTRAL)) return false;
  return !fwEnabled(state) || state.territories.every(t => !t.pending && t.sovereignty === state.players[player].faction);
}
export function initializeWarfront(state, random) {
  const homeSets = [], assignments = new Map();
  for (const faction of ['caldari', 'gallente']) {
    const players = state.players.flatMap((p, i) => p.faction === faction ? [i] : []);
    HOME_ANCHORS[faction].forEach((name, slot) => {
      const start = SYSTEMS.findIndex(s => s.name === name);
      const home = [...distances([start], i => SYSTEMS[i].faction === faction).keys()].slice(0, MIN_HOME_SYSTEMS);
      homeSets.push({ faction, commander: players[slot], anchor: start, systems: home });
      home.forEach(i => assignments.set(i, players[slot]));
    });
  }
  const originalFront = SYSTEMS.flatMap((s, i) => NEIGHBORS[i].some(j => SYSTEMS[j].faction !== s.faction) ? [i] : []);
  const depth = distances(originalFront);
  const middle = SYSTEMS.flatMap((_, i) => depth.get(i) <= 1 && !assignments.has(i) ? [i] : []);
  const distanceMaps = homeSets.map(h => ({ ...h, distance: distances([h.anchor]) }));
  const commanderFor = (index, faction) => {
    if (assignments.has(index)) return assignments.get(index);
    const candidates = distanceMaps.filter(h => h.faction === faction);
    return candidates.reduce((a, b) => a.distance.get(index) <= b.distance.get(index) ? a : b).commander;
  };
  state.territories.forEach((t, i) => {
    t.owner = middle.includes(i) ? NEUTRAL : commanderFor(i, SYSTEMS[i].faction);
    t.sovereignty = SYSTEMS[i].faction;
    t.contested = 0; t.pending = null; t.home = assignments.has(i);
    t.troops = t.owner === NEUTRAL ? 1 + Math.floor(random(state) * 3) : 1;
  });
  // Expand into the open middle only from a held neighboring militia system.
  // Systems left neutral retain their original militia sovereignty claim.
  const shuffled = [...middle]; // Fisher–Yates keeps seeded replay stable.
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const keepNeutral = new Set(shuffled.slice(0, Math.max(4, Math.floor(middle.length * .4))));
  for (let pass = 0; pass < 3; pass++) for (const i of shuffled) {
    if (keepNeutral.has(i) || state.territories[i].owner !== NEUTRAL) continue;
    const adjacent = [...new Set(NEIGHBORS[i].filter(j => state.territories[j].owner !== NEUTRAL).map(j => state.territories[j].sovereignty))];
    if (!adjacent.length) continue;
    const faction = adjacent[Math.floor(random(state) * adjacent.length)];
    state.territories[i].owner = commanderFor(i, faction);
    state.territories[i].sovereignty = faction;
    state.territories[i].troops = 1;
  }
  // Guarantee a held route into two active fronts per militia. Only neutral
  // garrisons along that militia's existing occupancy are claimed here.
  for (const faction of ['caldari', 'gallente']) {
    const held = () => state.territories.flatMap((t, i) => t.owner !== NEUTRAL && t.sovereignty === faction ? [i] : []);
    for (let attempt = 0; attempt < MIN_MILITIA_FRONTLINES; attempt++) {
      if (held().filter(i => operationalState(state, i) === 'Frontline').length >= MIN_MILITIA_FRONTLINES) break;
      const reach = distances(held(), i => state.territories[i].sovereignty === faction);
      const target = [...reach.keys()].find(i => state.territories[i].owner === NEUTRAL && operationalState(state, i) === 'Frontline');
      if (target === undefined) throw new Error(`Cannot establish ${faction} frontlines.`);
      let current = target;
      while (reach.get(current) > 0) {
        state.territories[current].owner = commanderFor(current, faction);
        state.territories[current].troops = 1;
        current = NEIGHBORS[current].find(i => reach.get(i) === reach.get(current) - 1 && state.territories[i].sovereignty === faction);
      }
    }
  }
  state.homeSystems = homeSets;
  state.operations = operationBudget(state);
}
