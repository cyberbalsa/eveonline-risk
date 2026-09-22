import { GROUPS, NEIGHBORS, SYSTEMS } from './map-data.js';
import { owned, borders, income, enemies, conquestChance, findSet, reinforce, tradeCards, beginAttack, attack, occupy, beginFortify, connectedOwned, fortify, endTurn } from './engine.js';

function targetValue(s, target) {
  const g = GROUPS[SYSTEMS[target].group], current = s.current;
  const held = g.systems.filter(i => s.territories[i].owner === current).length;
  const remaining = owned(s, s.territories[target].owner).length;
  const breaksBonus = g.systems.every(i => s.territories[i].owner === s.territories[target].owner);
  return 1 + (held / g.systems.length) * 3 + (held === g.systems.length - 1 ? g.bonus * 2 : 0) + (breaksBonus ? g.bonus : 0) + (remaining === 1 ? 5 + s.players[s.territories[target].owner].cards.length : 0);
}
function borderScore(s, i) {
  const enemy = borders(s, i);
  if (!enemy.length) {
    // An ally may separate this stack from the enemy. Still build where future
    // connected fortification can reach one of our own active border systems.
    return -5;
  }
  const threat = Math.max(...enemy.map(j => s.territories[j].troops));
  const opportunity = Math.max(...enemy.map(j => targetValue(s, j) - s.territories[j].troops * .35));
  const group = GROUPS[SYSTEMS[i].group];
  const protects = group.systems.every(j => s.territories[j].owner === s.current) ? group.bonus : 0;
  return opportunity + Math.min(8, threat - s.territories[i].troops) * .3 + protects * .7;
}
export function bestAttack(s, style = s.players[s.current].style) {
  const modifier = { recruit: -.12, veteran: 0, elite: .07 }[s.difficulty];
  const threshold = { aggressive: .62, balanced: .73, defensive: .82 }[style] + modifier;
  let best = null;
  for (const from of owned(s)) {
    const fleet = s.territories[from].troops;
    if (fleet < 2) continue;
    for (const to of borders(s, from)) {
      const chance = conquestChance(fleet - 1, s.territories[to].troops);
      if (chance < threshold) continue;
      const exposure = borders(s, from).filter(i => i !== to).length;
      const value = targetValue(s, to);
      const score = chance * (value + (s.conquered ? 0 : 2.5)) - (1 - chance) * 4 - s.territories[to].troops * .09 - exposure * (style === 'defensive' ? .35 : .08);
      if (!best || score > best.score) best = { from, to, chance, score };
    }
  }
  return best;
}
// This projection intentionally omits RNG state, shuffled deck order, and enemy
// card identities. Planning can inspect only the board and its own hand.
export function observation(state) {
  const { mode, difficulty, current, phase, reserve, conquered, moved, resumeAttack, occupation } = state;
  return { mode, difficulty, current, phase, reserve, conquered, moved, resumeAttack, occupation,
    territories: state.territories.map(t => ({ ...t })),
    players: state.players.map((p, i) => ({ ...p, cards: i === current ? [...p.cards] : Array(p.cards.length).fill(null) })) };
}
export function chooseAction(s) {
  const mine = owned(s), style = s.players[s.current].style;
  if (s.phase === 'reinforce') {
    const hand = s.players[s.current].cards, set = findSet(hand);
    if (set && (hand.length >= 5 || !s.resumeAttack && (style === 'aggressive' || hand.length >= 4))) return { type: 'trade', cards: set };
    if (!s.reserve) return { type: 'attackPhase' };
    const front = mine.filter(i => borders(s, i).length);
    const candidates = front.length ? front : mine;
    // Concentrate a strike group; spread a modest defensive reserve to exposed
    // holdings. Re-evaluate after every deployment using current public data.
    let target = candidates.reduce((a, b) => borderScore(s, a) > borderScore(s, b) ? a : b);
    if (style !== 'defensive') {
      target = candidates.reduce((a, b) => borderScore(s, a) + Math.min(s.territories[a].troops, 20) * .32 > borderScore(s, b) + Math.min(s.territories[b].troops, 20) * .32 ? a : b);
    }
    return { type: 'reinforce', target, amount: style === 'defensive' ? Math.min(3, s.reserve) : s.reserve };
  }
  if (s.phase === 'occupy') {
    const o = s.occupation;
    const nextFront = borders(s, o.to).length;
    const leave = nextFront ? 0 : Math.min(o.max - o.min, Math.max(0, s.territories[o.from].troops - o.min - 1));
    return { type: 'occupy', amount: Math.max(o.min, o.max - leave) };
  }
  if (s.phase === 'attack') {
    const next = bestAttack(s);
    return next ? { type: 'attack', from: next.from, to: next.to, dice: Math.min(3, s.territories[next.from].troops - 1) } : { type: 'fortifyPhase' };
  }
  if (s.phase === 'fortify') {
    if (!s.moved) {
      const fronts = mine.filter(i => borders(s, i).length);
      let best = null;
      for (const from of mine) {
        const t = s.territories[from];
        if (t.troops <= 1) continue;
        const threat = borders(s, from).reduce((n, i) => Math.max(n, s.territories[i].troops), 0);
        const spare = t.troops - Math.max(1, threat + 1);
        if (spare < 1) continue;
        for (const to of fronts) if (from !== to && connectedOwned(s, from, to)) {
          const score = spare * 2 + borderScore(s, to);
          if (!best || score > best.score) best = { type: 'fortify', from, to, amount: spare, score };
        }
      }
      if (best) return best;
    }
    return { type: 'end' };
  }
  return null;
}
export function applyAction(state, action) {
  switch (action.type) {
    case 'trade': return tradeCards(state, action.cards);
    case 'reinforce': return reinforce(state, action.target, action.amount);
    case 'attackPhase': return beginAttack(state);
    case 'attack': return attack(state, action.from, action.to, action.dice);
    case 'occupy': return occupy(state, action.amount);
    case 'fortifyPhase': return beginFortify(state);
    case 'fortify': return fortify(state, action.from, action.to, action.amount);
    case 'end': return endTurn(state);
    default: throw new Error('Unknown bot action.');
  }
}
export function stepBot(state) {
  if (state.winner !== null) return null;
  const action = chooseAction(observation(state));
  if (action) applyAction(state, action);
  return action;
}
