import { SYSTEMS, GROUPS, NEIGHBORS } from './map-data.js';

export const VERSION = 1;
export const COLORS = ['#65c9ff', '#66e4ae', '#efa65f', '#b39aff'];
export const CARD_TYPES = ['Frigate', 'Cruiser', 'Battleship'];
const N = SYSTEMS.length;
export function random(state) {
  let x = state.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 4294967296;
}
function shuffle(array, state) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
export function owned(state, player = state.current) {
  return state.territories.flatMap((t, i) => t.owner === player ? [i] : []);
}
export function enemies(state, a, b) {
  return a !== b && (state.mode !== 'teams' || state.players[a].team !== state.players[b].team);
}
export function borders(state, index) {
  return NEIGHBORS[index].filter(i => enemies(state, state.territories[index].owner, state.territories[i].owner));
}
export function income(state, player = state.current) {
  const systems = owned(state, player).length;
  if (!systems) return { base: 0, bonus: 0, groups: [], total: 0 };
  const groups = GROUPS.filter(g => g.systems.every(i => state.territories[i].owner === player));
  const base = Math.max(3, Math.floor(systems / 3));
  const bonus = groups.reduce((sum, g) => sum + g.bonus, 0);
  return { base, bonus, groups, total: base + bonus };
}
export function log(state, text, kind = 'info') {
  state.log.push({ id: state.nextLog++, turn: state.turn, player: state.current, text, kind });
  // Bounded save size. The UI explains the retained history window.
  if (state.log.length > 1200) state.log.splice(0, state.log.length - 1200);
}
export function newGame({ seed = Date.now(), faction = 'caldari', mode = 'teams', difficulty = 'veteran', name = 'Capsuleer' } = {}) {
  const caldari = faction !== 'gallente';
  const other = caldari ? 'gallente' : 'caldari';
  const state = {
    version: VERSION, rng: (Number(seed) >>> 0) || 1, mode, difficulty, turn: 1, current: 0,
    phase: 'reinforce', reserve: 0, conquered: false, moved: false, winner: null,
    trades: 0, deck: [], discard: [], occupation: null, resumeAttack: false,
    lastBattle: null, log: [], nextLog: 1,
    players: [
      { name: String(name).trim().slice(0, 24) || 'Capsuleer', faction, team: 0, human: true, style: 'balanced', cards: [], ship: caldari ? 'caracal' : 'catalyst' },
      { name: caldari ? 'Vesper Command' : 'Kestrel Command', faction: other, team: 1, human: false, style: 'aggressive', cards: [], ship: caldari ? 'catalyst' : 'caracal' },
      { name: caldari ? 'Onyx Squadron' : 'Aster Squadron', faction, team: 0, human: false, style: 'defensive', cards: [], ship: caldari ? 'drake' : 'dominix' },
      { name: caldari ? 'Verdant Fleet' : 'Cobalt Fleet', faction: other, team: 1, human: false, style: 'balanced', cards: [], ship: caldari ? 'dominix' : 'drake' }
    ],
    territories: SYSTEMS.map(() => ({ owner: -1, troops: 1 }))
  };
  // Random dealing, with equal total starting fleets despite 90 not dividing by four.
  shuffle(Array.from({ length: N }, (_, i) => i), state).forEach((id, i) => { state.territories[id].owner = i % 4; });
  state.players.forEach((_, player) => {
    const territories = owned(state, player);
    for (let extra = 0; extra < 55 - territories.length; extra++) {
      state.territories[territories[Math.floor(random(state) * territories.length)]].troops++;
    }
  });
  state.deck = shuffle([...SYSTEMS.map((_, i) => i), N, N + 1], state);
  state.reserve = income(state).total;
  log(state, `Campaign deployed. ${mode === 'teams' ? 'Two militias. Four commanders.' : 'Four commanders. One victor.'}`);
  log(state, `${state.players[0].name} receives ${state.reserve} reinforcements.`, 'reinforce');
  return state;
}
function requireRule(condition, message) { if (!condition) throw new Error(message); }
function playable(state, phase) {
  requireRule(state.winner === null, 'This campaign has ended.');
  requireRule(state.phase === phase, `This action requires the ${phase} phase.`);
}
function territory(state, index) {
  requireRule(Number.isInteger(index) && index >= 0 && index < N, 'Choose a valid system.');
  return state.territories[index];
}
function count(value, max) {
  requireRule(Number.isSafeInteger(value) && value >= 1 && value <= max, 'Choose a valid fleet count.');
}
export function reinforce(state, index, amount) {
  playable(state, 'reinforce');
  const t = territory(state, index);
  requireRule(t.owner === state.current, 'Deploy to a system you control.');
  count(amount, state.reserve);
  t.troops += amount; state.reserve -= amount;
  log(state, `${state.players[state.current].name} deploys ${amount} to ${SYSTEMS[index].name}.`, 'reinforce');
}
export function cardType(card) { return card >= N ? 'Wild' : CARD_TYPES[card % 3]; }
export function validSet(cards) {
  if (cards.length !== 3) return false;
  const types = cards.map(cardType).filter(t => t !== 'Wild');
  return new Set(types).size === 1 || new Set(types).size === types.length;
}
export function findSet(cards) {
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) for (let k = j + 1; k < cards.length; k++) {
    if (validSet([cards[i], cards[j], cards[k]])) return [cards[i], cards[j], cards[k]];
  }
  return null;
}
export function tradeValue(trades) { return trades < 5 ? 4 + trades * 2 : 15 + (trades - 5) * 5; }
export function tradeCards(state, cards, bonusSystem = null) {
  playable(state, 'reinforce');
  const hand = state.players[state.current].cards;
  requireRule(!state.resumeAttack || hand.length >= 5, 'Elimination trades stop once fewer than five cards remain.');
  requireRule(new Set(cards).size === 3 && cards.every(c => hand.includes(c)) && validSet(cards), 'Select three matching hulls, one of each, or a valid wild set.');
  const eligible = cards.filter(c => c < N && state.territories[c].owner === state.current);
  if (bonusSystem !== null) requireRule(eligible.includes(bonusSystem), 'The bonus must go to an owned system in this set.');
  const value = tradeValue(state.trades++);
  state.reserve += value;
  state.players[state.current].cards = hand.filter(c => !cards.includes(c));
  state.discard.push(...cards);
  if (eligible.length) {
    const target = bonusSystem ?? eligible[0];
    state.territories[target].troops += 2;
    log(state, `Owned card bonus: 2 fleets arrive in ${SYSTEMS[target].name}.`, 'reinforce');
  }
  log(state, `${state.players[state.current].name} exchanges a set for ${value} fleets.`, 'card');
}
export function beginAttack(state) {
  playable(state, 'reinforce');
  requireRule(state.reserve === 0, 'Deploy all reinforcements first.');
  requireRule(state.players[state.current].cards.length < 5, 'Exchange a card set before attacking.');
  state.phase = 'attack'; state.resumeAttack = false;
}
export function compareDice(attack, defense) {
  const a = [...attack].sort((x, y) => y - x), d = [...defense].sort((x, y) => y - x);
  let lostA = 0, lostD = 0;
  for (let i = 0; i < Math.min(a.length, d.length); i++) { if (a[i] > d[i]) lostD++; else lostA++; }
  return { attack: a, defense: d, lostA, lostD };
}
export function attack(state, from, to, dice = 3) {
  playable(state, 'attack');
  const a = territory(state, from), d = territory(state, to);
  requireRule(a.owner === state.current, 'Attack from your own system.');
  requireRule(enemies(state, a.owner, d.owner), 'Choose an enemy system.');
  requireRule(NEIGHBORS[from].includes(to), 'Attacks require a direct stargate.');
  count(dice, Math.min(3, a.troops - 1));
  const roll = n => Array.from({ length: n }, () => Math.floor(random(state) * 6) + 1);
  const result = compareDice(roll(dice), roll(Math.min(2, d.troops)));
  a.troops -= result.lostA; d.troops -= result.lostD;
  state.lastBattle = { ...result, from, to, player: state.current };
  log(state, `${SYSTEMS[from].name} → ${SYSTEMS[to].name}: attacker −${result.lostA}, defender −${result.lostD}.`, 'battle');
  if (d.troops === 0) {
    const former = d.owner;
    d.owner = state.current;
    state.conquered = true;
    state.occupation = { from, to, min: dice, max: a.troops - 1, former };
    state.phase = 'occupy';
    log(state, `${state.players[state.current].name} captures ${SYSTEMS[to].name}.`, 'capture');
  }
  return result;
}
export function occupy(state, amount) {
  playable(state, 'occupy');
  const { from, to, min, max, former } = state.occupation;
  count(amount, max); requireRule(amount >= min, `Move at least ${min} fleets into the captured system.`);
  state.territories[from].troops -= amount; state.territories[to].troops = amount;
  state.occupation = null; state.phase = 'attack';
  if (!owned(state, former).length) {
    state.players[state.current].cards.push(...state.players[former].cards);
    state.players[former].cards = [];
    log(state, `${state.players[former].name} has been eliminated. Their cards transfer to the victor.`, 'capture');
    if (state.players[state.current].cards.length >= 6) {
      state.phase = 'reinforce'; state.resumeAttack = true; state.reserve = 0;
    }
  }
  const remaining = [...new Set(state.territories.map(t => t.owner))];
  if (remaining.every(p => !enemies(state, state.current, p))) {
    state.winner = state.current; state.phase = 'finished';
    log(state, `${state.mode === 'teams' ? state.players[state.current].faction.toUpperCase() : state.players[state.current].name} controls the warzone.`, 'victory');
  }
}
export function beginFortify(state) {
  playable(state, 'attack');
  state.phase = 'fortify';
  if (state.conquered) {
    if (!state.deck.length) state.deck = shuffle(state.discard.splice(0), state);
    if (state.deck.length) state.players[state.current].cards.push(state.deck.pop());
    log(state, `${state.players[state.current].name} earns one territory card.`, 'card');
  }
}
export function connectedOwned(state, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || !state.territories[from] || !state.territories[to]) return false;
  const owner = state.territories[from].owner;
  if (state.territories[to].owner !== owner) return false;
  const seen = new Set([from]), queue = [from];
  for (let q = 0; q < queue.length; q++) {
    if (queue[q] === to) return true;
    for (const next of NEIGHBORS[queue[q]]) if (!seen.has(next) && state.territories[next].owner === owner) { seen.add(next); queue.push(next); }
  }
  return false;
}
export function fortify(state, from, to, amount) {
  playable(state, 'fortify');
  requireRule(!state.moved, 'Only one fleet transfer is allowed per turn.');
  const a = territory(state, from), d = territory(state, to);
  requireRule(from !== to && a.owner === state.current && d.owner === state.current, 'Move between two of your own systems.');
  requireRule(connectedOwned(state, from, to), 'The route must pass entirely through your own systems.');
  count(amount, a.troops - 1);
  a.troops -= amount; d.troops += amount; state.moved = true;
  log(state, `${amount} fleets move from ${SYSTEMS[from].name} to ${SYSTEMS[to].name}.`, 'move');
}
export function endTurn(state) {
  playable(state, 'fortify');
  do { state.current = (state.current + 1) % state.players.length; state.turn++; } while (!owned(state).length);
  state.phase = 'reinforce'; state.reserve = income(state).total;
  state.moved = false; state.conquered = false; state.lastBattle = null;
  log(state, `${state.players[state.current].name} receives ${state.reserve} reinforcements.`, 'reinforce');
}
export function assertState(state) {
  requireRule(state && state.version === VERSION, 'Unsupported save version.');
  requireRule(['teams', 'conquest'].includes(state.mode) && ['recruit', 'veteran', 'elite'].includes(state.difficulty), 'Invalid campaign settings.');
  requireRule(Number.isInteger(state.rng) && state.rng > 0 && state.rng <= 4294967295, 'Invalid random state.');
  requireRule(Array.isArray(state.players) && state.players.length === 4, 'Invalid commanders.');
  requireRule(Number.isInteger(state.current) && state.current >= 0 && state.current < 4, 'Invalid active commander.');
  requireRule(['reinforce', 'attack', 'occupy', 'fortify', 'finished'].includes(state.phase), 'Invalid turn phase.');
  requireRule(Number.isSafeInteger(state.reserve) && state.reserve >= 0 && Number.isSafeInteger(state.turn) && state.turn > 0, 'Invalid turn counters.');
  requireRule(state.players.every((p, i) => typeof p.name === 'string' && p.name.length <= 24 && ['caldari', 'gallente'].includes(p.faction) && p.team === i % 2 && p.human === (i === 0) && ['balanced', 'aggressive', 'defensive'].includes(p.style) && ['caracal', 'catalyst', 'drake', 'dominix'].includes(p.ship) && Array.isArray(p.cards)), 'Invalid player data.');
  requireRule(Array.isArray(state.territories) && state.territories.length === N, 'Invalid board.');
  state.territories.forEach((t, i) => {
    requireRule(Number.isInteger(t.owner) && t.owner >= 0 && t.owner < 4, 'Invalid ownership.');
    requireRule(Number.isSafeInteger(t.troops) && t.troops >= (state.phase === 'occupy' && state.occupation?.to === i ? 0 : 1), 'Invalid fleet count.');
  });
  requireRule(Array.isArray(state.deck) && Array.isArray(state.discard), 'Invalid deck.');
  const cards = [...state.deck, ...state.discard, ...state.players.flatMap(p => p.cards)];
  requireRule(cards.length === N + 2 && new Set(cards).size === N + 2 && cards.every(c => Number.isInteger(c) && c >= 0 && c < N + 2), 'Invalid card accounting.');
  requireRule(Array.isArray(state.log) && state.log.length <= 1200 && state.log.every(l => typeof l.text === 'string' && Number.isInteger(l.player) && l.player >= 0 && l.player < 4), 'Invalid history.');
  requireRule(Number.isSafeInteger(state.trades) && state.trades >= 0 && Number.isSafeInteger(state.nextLog), 'Invalid counters.');
  requireRule([state.conquered, state.moved, state.resumeAttack].every(v => typeof v === 'boolean'), 'Invalid phase flags.');
  requireRule(state.phase === 'reinforce' || state.reserve === 0, 'Unexpected reinforcement reserve.');
  if (state.lastBattle !== null) {
    const b = state.lastBattle;
    const dice = (a, n) => Array.isArray(a) && a.length >= 1 && a.length <= n && a.every(v => Number.isInteger(v) && v >= 1 && v <= 6);
    requireRule(b && dice(b.attack, 3) && dice(b.defense, 2) && Number.isInteger(b.from) && Number.isInteger(b.to) && NEIGHBORS[b.from]?.includes(b.to) && Number.isInteger(b.player) && b.player >= 0 && b.player < 4 && Number.isInteger(b.lostA) && Number.isInteger(b.lostD) && b.lostA >= 0 && b.lostD >= 0 && b.lostA + b.lostD === Math.min(b.attack.length, b.defense.length), 'Invalid combat record.');
  }
  if (state.phase === 'occupy') {
    const o = state.occupation;
    requireRule(o && Number.isInteger(o.from) && Number.isInteger(o.to) && NEIGHBORS[o.from]?.includes(o.to), 'Invalid occupation.');
    requireRule(state.territories[o.from].owner === state.current && state.territories[o.to].owner === state.current && state.territories[o.to].troops === 0 && o.max === state.territories[o.from].troops - 1 && Number.isInteger(o.min) && o.min >= 1 && o.min <= 3 && o.min <= o.max && Number.isInteger(o.former) && o.former >= 0 && o.former < 4 && enemies(state, state.current, o.former), 'Invalid occupation fleets.');
  } else requireRule(state.occupation === null, 'Unexpected occupation.');
  requireRule(owned(state).length > 0, 'The active commander has no systems.');
  requireRule(state.winner === null ? state.phase !== 'finished' : state.phase === 'finished' && state.winner === state.current && state.territories.every(t => !enemies(state, state.winner, t.owner)), 'Invalid victory.');
  return true;
}

// Exhaustive 6^(a+d) dice enumeration, then dynamic programming for conquest odds.
const outcomes = new Map();
export function diceOutcomes(a, d) {
  const key = `${a},${d}`;
  if (outcomes.has(key)) return outcomes.get(key);
  const counts = new Map();
  for (let code = 0; code < 6 ** (a + d); code++) {
    let n = code; const rolls = [];
    for (let i = 0; i < a + d; i++) { rolls.push(n % 6 + 1); n = Math.floor(n / 6); }
    const r = compareDice(rolls.slice(0, a), rolls.slice(a)), k = `${r.lostA},${r.lostD}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const result = [...counts].map(([k, n]) => ({ losses: k.split(',').map(Number), probability: n / 6 ** (a + d) }));
  outcomes.set(key, result); return result;
}
// Rows include zero attacking fleets; one garrison has already been excluded.
const odds = [[1]];
export function conquestChance(attacking, defending) {
  attacking = Math.max(0, Math.floor(attacking)); defending = Math.max(0, Math.floor(defending));
  if (!defending) return 1;
  if (!attacking) return 0;
  // Large armies are uncommon. Bound UI work while keeping the exact calculation
  // for ordinary play; the caller labels extreme-army values as estimates.
  if (attacking > 500 || defending > 500) return 1 / (1 + Math.exp((defending - attacking * 1.08) / Math.sqrt(attacking + defending)));
  while (odds.length <= attacking) odds.push([1]);
  for (let a = 0; a <= attacking; a++) for (let d = odds[a].length; d <= defending; d++) {
    odds[a][d] = a === 0 ? 0 : diceOutcomes(Math.min(a, 3), Math.min(d, 2)).reduce((p, o) => p + o.probability * odds[a - o.losses[0]][d - o.losses[1]], 0);
  }
  return odds[attacking][defending];
}
