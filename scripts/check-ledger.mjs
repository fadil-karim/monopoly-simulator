#!/usr/bin/env node
// Proves the ledgers the viewer shows are whole: plays games in which the players propose trades, counter, accept,
// refuse and break the rules, a third of them answering badly now and then (forfeits, trades rejected for want of an
// answer, debts settled by the bank's forced sale), and after every event checks that each player's cash is exactly
// the starting cash plus every payment to them less every payment from them, as the payments ledger records them; at
// the end, that the rent adds up three ways and that every trade completed is a negotiation that ends so.
//   node scripts/check-ledger.mjs [games] [edition]
import { Game } from '../public/assets/app/engine.js';
import { ReplayGame } from '../public/assets/app/replay.js';
import { StatsTracker, PAYMENT_KINDS } from '../public/assets/app/stats.js';
import { traders } from './traders.mjs';

const games = Number(process.argv[2] || 30);
const edition = process.argv[3] || 'standard';
const OUTCOMES = new Set(['completed', 'rejected', 'lapsed', 'refused']);
const kinds = {}, outcomes = {}, steps = {};
let events = 0, checks = 0, forcedSales = 0, forfeitedTrades = 0;

for (let g = 0; g < games; g++) {
  let rep = null, tracker = null, seen = 0;
  const bal = {};
  const game = new Game({
    id: `l${g}`, seed: 5000 + g,
    config: { edition, maxRounds: 140, aiPreroll: 'always', freeParkingJackpot: g % 2 === 1, maxNegotiationRounds: g % 3 === 0 ? 2 : 8 },
    players: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' }, { id: 'd', name: 'Delta' }],
    decider: traders(77 + g, { flaky: g % 3 === 2 ? 1 / 8 : 0 }),
    onEvent: (e, gm) => {
      if (!rep) {
        rep = new ReplayGame({ id: gm.id, edition: gm.edition, config: gm.config, seed: gm.seed, players: gm.players.map((p) => ({ ...p.meta, id: p.id, name: p.name })) });
        tracker = new StatsTracker(rep);
        for (const p of gm.players) bal[p.id] = p.cash;
      }
      const copy = JSON.parse(JSON.stringify(e));
      // every other game reads its counter-offers in the shape logged before v1.19, the negotiation's step in the round
      if (g % 2 && copy.type === 'trade_counter') { copy.round = copy.negotiationRound; delete copy.negotiationRound; }
      rep.apply(copy);
      tracker.update();
      events++;
      if (rep.round !== gm.round) throw new Error(`game ${g} event #${e.seq} ${e.type}: the replay is in round ${rep.round}, the engine in ${gm.round}`);
      for (; seen < tracker.payments.length; seen++) {
        const x = tracker.payments[seen];
        if (!(x.amount > 0) || !PAYMENT_KINDS[x.kind]) throw new Error(`game ${g} event #${e.seq}: bad payment ${JSON.stringify(x)}`);
        if (x.from === x.to) throw new Error(`game ${g} event #${e.seq}: payment to oneself ${JSON.stringify(x)}`);
        if (x.from !== 'bank') bal[x.from] -= x.amount;
        if (x.to !== 'bank') bal[x.to] += x.amount;
        kinds[x.kind] = (kinds[x.kind] || 0) + 1;
      }
      for (const p of gm.players) {
        if (p.bankrupt) continue; // the engine empties a bankrupt's cash only after its last event
        checks++;
        if (bal[p.id] !== p.cash) throw new Error(`game ${g} (${edition}) event #${e.seq} ${e.type}: ledger says ${p.id} has ${bal[p.id]}, the engine ${p.cash}\n${JSON.stringify(e).slice(0, 300)}`);
      }
    },
  });
  await game.run();
  for (const p of game.players) if (bal[p.id] !== p.cash) throw new Error(`game ${g}: at the end the ledger says ${p.id} has ${bal[p.id]}, the engine ${p.cash}`);
  const m = tracker.match;
  const propRent = Object.values(tracker.props).reduce((a, x) => a + x.rent, 0);
  const paidRent = tracker.payments.filter((x) => x.kind === 'rent').reduce((a, x) => a + x.amount, 0);
  if (propRent !== m.rent || paidRent !== m.rent) throw new Error(`game ${g}: rent ${m.rent} by the match, ${propRent} by the properties, ${paidRent} by the payments`);
  const done = tracker.negotiations.filter((n) => n.outcome === 'completed').length;
  if (done !== m.trades) throw new Error(`game ${g}: ${m.trades} trades completed but ${done} negotiations end so`);
  if (tracker.open) throw new Error(`game ${g}: a negotiation was left open`);
  for (const n of tracker.negotiations) {
    if (!OUTCOMES.has(n.outcome) || !n.steps.length || !n.terms) throw new Error(`game ${g}: bad negotiation ${JSON.stringify(n).slice(0, 300)}`);
    outcomes[n.outcome] = (outcomes[n.outcome] || 0) + 1;
    for (const s of n.steps) steps[s.kind] = (steps[s.kind] || 0) + 1;
  }
  forcedSales += game.events.filter((e) => e.type === 'forced_sale').length;
  forfeitedTrades += game.events.filter((e) => e.type === 'trade_response' && e.source === 'forfeit').length;
  for (const e of game.events.filter((x) => x.type === 'trade_response' && x.source === 'forfeit')) {
    const n = tracker.negotiations.find((x) => x.steps.some((st) => st.seq === e.seq));
    if (!n || n.outcome !== 'rejected') throw new Error(`game ${g}: the trade rejected for want of an answer (#${e.seq}) is not a rejected negotiation`);
  }
  const trades = game.events.filter((e) => e.type === 'trade_completed').length;
  if (trades !== m.trades) throw new Error(`game ${g}: ${trades} trade events, ${m.trades} counted`);
}
for (const k of ['completed', 'rejected', 'lapsed', 'refused']) if (!outcomes[k]) throw new Error(`no negotiation ended ${k}: the check did not cover it`);
if (!forcedSales || !forfeitedTrades) throw new Error(`forced sales ${forcedSales}, trades rejected for want of an answer ${forfeitedTrades}: the check did not cover them`);
for (const k of ['offer', 'counter', 'accept', 'reject']) if (!steps[k]) throw new Error(`no ${k} step: the check did not cover it`);
console.log({ edition, games, events, checks, payments: kinds, negotiations: outcomes, steps, forcedSales, forfeitedTrades, ok: true });
