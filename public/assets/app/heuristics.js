// Rule-based decisions. Used by the "Heuristic bot" player type and as the
// fallback whenever an AI decision is missing, invalid or times out.

const HOTEL = 5;

function reserve(game) { return game.edition === 'mega' ? 250 : 150; }

function groupValueFor(game, p, s) {
  // How much more than list price this player should value the property.
  if (s.type === 'street') {
    const n = game.groupIdx(s.group).length;
    const owned = game.ownsCountInGroup(p, s.group);
    if (owned === n - 1) return 1.6; // completes the set
    if (owned > 0) return 1.2;
    const rival = game.alive().find((o) => o.id !== p.id && game.ownsCountInGroup(o, s.group) === n - 1);
    if (rival) return 1.3; // block a rival
    return 1.0;
  }
  if (s.type === 'station') return 1.0 + 0.1 * game.ownsCountInGroup(p, 'station');
  return 0.8;
}

export function heuristicDecide(game, p, type, ctx) {
  switch (type) {
    case 'buy': {
      const s = game.board[ctx.property.i];
      const keep = p.cash - s.price;
      const v = groupValueFor(game, p, s);
      return { buy: keep >= reserve(game) / (v >= 1.5 ? 3 : 1) || (v >= 1.5 && keep >= 0), reason: 'heuristic' };
    }
    case 'bid': {
      const s = game.board[ctx.property.i];
      const v = groupValueFor(game, p, s);
      const max = Math.min(p.cash - reserve(game) / 2, Math.round(s.price * (v >= 1.5 ? 1.4 : v > 1 ? 1.0 : 0.75)));
      return { bid: Math.max(0, Math.floor(max)), reason: 'heuristic' };
    }
    case 'trade_response': {
      const o = ctx.offer;
      const val = (idxs) => idxs.reduce((a, i) => a + game.board[i].price, 0);
      let gain = val(o.give.props) + o.give.cash - val(o.get.props) - o.get.cash;
      // Penalise giving away a property that would complete the proposer's set.
      const from = game.player(o.from);
      for (const i of o.get.props) {
        const s = game.board[i];
        if (s.type === 'street' && game.ownsCountInGroup(from, s.group) === game.groupIdx(s.group).length - 1) gain -= s.price * 1.5;
      }
      for (const i of o.give.props) {
        const s = game.board[i];
        if (s.type === 'street' && game.ownsCountInGroup(p, s.group) === game.groupIdx(s.group).length - 1) gain += s.price * 1.5;
      }
      return { accept: gain > 0 && o.get.cash <= p.cash - reserve(game) / 2, reason: 'heuristic' };
    }
    case 'choose_space': {
      const opts = ctx.options;
      const unowned = opts.filter((o) => o.price && o.owner === null && p.cash - o.price >= reserve(game));
      if (unowned.length) {
        unowned.sort((a, b) => groupValueFor(game, p, game.board[b.i]) * b.price - groupValueFor(game, p, game.board[a.i]) * a.price);
        return { space: unowned[0].i, reason: 'heuristic: best unowned property' };
      }
      const go = opts.find((o) => o.i === 0);
      if (go) return { space: 0, reason: 'heuristic: collect salary' };
      const safe = opts.find((o) => o.type === 'freeparking' || o.type === 'jail') || opts[0];
      return { space: safe.i, reason: 'heuristic' };
    }
    case 'choose_property': {
      const opts = ctx.options.slice().sort((a, b) => groupValueFor(game, p, game.board[b.i]) * b.price - groupValueFor(game, p, game.board[a.i]) * a.price);
      return { property: opts[0].i, reason: 'heuristic' };
    }
    case 'jail': {
      if (ctx.jailCards > 0) return { jail: 'card' };
      const anyBuilt = Object.values(game.props).some((pr) => pr.level > 0 && pr.owner && pr.owner !== p.id);
      const unowned = Object.values(game.props).some((pr) => pr.owner === null);
      if (unowned && !anyBuilt && ctx.cash >= 100) return { jail: 'pay' };
      return { jail: 'roll' };
    }
    case 'preroll': {
      const actions = [];
      let cash = p.cash;
      const res = reserve(game);
      // Unmortgage cheap things when flush.
      for (const u of ctx.canUnmortgage) if (cash - u.cost >= res * 2) { actions.push({ type: 'unmortgage', property: u.i }); cash -= u.cost; }
      // Build: simulate the engine's rules so every proposed build is legal.
      const maxLevel = game.edition === 'mega' ? 6 : HOTEL;
      const levels = {}; for (const i of Object.keys(game.props)) levels[i] = game.props[i].level;
      const bank = { ...game.bank };
      const simCan = (i) => {
        const s = game.board[i];
        if (levels[i] >= maxLevel) return false;
        const next = levels[i] + 1;
        if (!game.ownsMajority(p, s.group)) return false;
        if (next >= HOTEL && !game.ownsFullGroup(p, s.group)) return false;
        const owned = game.groupIdx(s.group).filter((j) => game.props[j].owner === p.id);
        if (owned.some((j) => game.props[j].mortgaged)) return false;
        if (next - Math.min(...owned.map((j) => levels[j])) > 1) return false;
        if (next <= 4 && bank.houses < 1) return false;
        if (next === HOTEL && bank.hotels < 1) return false;
        if (next === 6 && bank.skyscrapers < 1) return false;
        return cash - s.houseCost >= res;
      };
      const streets = ctx.canBuild.map((b) => b.i);
      let guard = 0;
      while (guard++ < 24) {
        const cands = streets.filter(simCan).sort((a, b) => levels[a] - levels[b] || game.board[a].houseCost - game.board[b].houseCost);
        if (!cands.length) break;
        const i = cands[0];
        const s = game.board[i];
        actions.push({ type: 'build', property: i, count: 1 });
        cash -= s.houseCost;
        levels[i]++;
        if (levels[i] <= 4) bank.houses--; else if (levels[i] === HOTEL) { bank.hotels--; bank.houses += 4; } else { bank.skyscrapers--; bank.hotels++; }
      }
      for (const d of ctx.canDepot || []) if (cash - d.cost >= res) { actions.push({ type: 'build_depot', property: d.i }); cash -= d.cost; }
      let jail;
      if (ctx.inJail) jail = heuristicDecide(game, p, 'jail', { cash: p.cash, jailCards: ctx.jailCards, jailTurns: ctx.jailTurns }).jail;
      if (ctx.busTargets && ctx.busTargets.length) {
        const good = ctx.busTargets.find((i) => game.props[i] && game.props[i].owner === null && p.cash - game.board[i].price >= res);
        if (good != null) actions.push({ type: 'use_bus_ticket', target: good });
      }
      return { actions, jail, reason: 'heuristic' };
    }
    case 'raise_cash': {
      const actions = [];
      let cash = p.cash;
      // Sell buildings from the most expensive group first (highest refund), then mortgage
      // properties that are not part of a complete set, cheapest first.
      const sells = ctx.canSell.slice().sort((a, b) => b.refund - a.refund);
      const morts = ctx.canMortgage.slice().sort((a, b) => {
        const sa = game.board[a.i], sb = game.board[b.i];
        const fa = sa.type === 'street' && game.ownsFullGroup(p, sa.group) ? 1 : 0;
        const fb = sb.type === 'street' && game.ownsFullGroup(p, sb.group) ? 1 : 0;
        return fa - fb || a.value - b.value;
      });
      for (const m of morts) { if (cash >= ctx.needed) break; actions.push({ type: 'mortgage', property: m.i }); cash += m.value; }
      for (const s of sells) { if (cash >= ctx.needed) break; actions.push({ type: 'sell_house', property: s.i, count: 1 }); cash += s.refund; }
      return { actions, reason: 'heuristic' };
    }
    case 'reply':
      return { say: '' };
    default:
      return {};
  }
}
