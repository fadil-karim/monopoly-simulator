#!/usr/bin/env node
// Proves the replay reducer mirrors the engine: runs heuristic games and, after
// every event, compares the state rebuilt from the log with the engine's own.
//   node scripts/check-replay.mjs [games] [edition]
import { Game } from '../public/assets/js/engine.js';
import { ReplayGame } from '../public/assets/js/replay.js';
import { transcript } from '../public/assets/js/transcript.js';

const games = Number(process.argv[2] || 30);
const edition = process.argv[3] || 'standard';
const STAT_KEYS = ['rentPaid', 'rentCollected', 'bought', 'auctionsWon', 'trades', 'jail', 'housesBuilt', 'messages'];
let compared = 0, events = 0;

function diff(game, rep, e) {
  const out = [];
  if (rep.round !== game.round) out.push(`round ${rep.round} vs ${game.round}`);
  if (rep.turn !== game.turn) out.push(`turn ${rep.turn} vs ${game.turn}`);
  if (rep.freeParkingPot !== game.freeParkingPot && e.type !== 'free_parking') out.push(`pot ${rep.freeParkingPot} vs ${game.freeParkingPot}`); // the engine empties the pot just after the event
  if (rep.players.length !== game.players.length) out.push('player count');
  for (let k = 0; k < game.players.length; k++) {
    const a = game.players[k], b = rep.players[k];
    if (!b || a.id !== b.id) { out.push(`seat ${k}: ${a.id} vs ${b && b.id}`); continue; }
    if (a.bankrupt !== b.bankrupt) out.push(`${a.id} bankrupt ${b.bankrupt} vs ${a.bankrupt}`);
    if (a.bankruptRound !== b.bankruptRound) out.push(`${a.id} bankruptRound ${b.bankruptRound} vs ${a.bankruptRound}`);
    if (a.pos !== b.pos) out.push(`${a.id} pos ${b.pos} vs ${a.pos}`);
    if (!a.bankrupt) {
      if (a.cash !== b.cash) out.push(`${a.id} cash ${b.cash} vs ${a.cash}`);
      if (a.inJail !== b.inJail) out.push(`${a.id} inJail ${b.inJail} vs ${a.inJail}`);
      if (a.jailCards !== b.jailCards) out.push(`${a.id} jailCards ${b.jailCards} vs ${a.jailCards}`);
      if (a.busTickets !== b.busTickets && !(e.type === 'bus_ticket_used' && e.player === a.id)) out.push(`${a.id} busTickets ${b.busTickets} vs ${a.busTickets}`);
    }
    // the engine adds rent to both players' stats just after it emits the payment event
    const rentLag = e.type === 'payment' && typeof e.reason === 'string' && e.reason.startsWith('rent for ') && (e.from === a.id || e.to === a.id);
    for (const s of STAT_KEYS) if (a.stats[s] !== b.stats[s] && !(rentLag && (s === 'rentPaid' || s === 'rentCollected'))) out.push(`${a.id} stats.${s} ${b.stats[s]} vs ${a.stats[s]}`);
  }
  const skipProps = e.type === 'bankrupt' ? new Set(e.properties) : new Set();
  for (const i of Object.keys(game.props)) {
    const a = game.props[i], b = rep.props[i];
    if (!b) { out.push(`prop ${i} missing`); continue; }
    if (skipProps.has(Number(i))) continue;
    if (a.owner !== b.owner) out.push(`prop ${i} owner ${b.owner} vs ${a.owner}`);
    if (a.level !== b.level) out.push(`prop ${i} level ${b.level} vs ${a.level}`);
    if (a.mortgaged !== b.mortgaged) out.push(`prop ${i} mortgaged ${b.mortgaged} vs ${a.mortgaged}`);
    if (a.depot !== b.depot) out.push(`prop ${i} depot ${b.depot} vs ${a.depot}`);
  }
  return out;
}

for (let g = 0; g < games; g++) {
  let fromMeta = null, fromLog = null;
  const game = new Game({
    id: `r${g}`, seed: 1000 + g,
    config: { edition, maxRounds: 120, aiPreroll: 'always', freeParkingJackpot: g % 2 === 1 },
    players: [{ id: 'a', name: 'Alpha', colour: '#111' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' }, { id: 'd', name: 'Delta' }],
    decider: null,
    onEvent: (e, gm) => {
      if (!fromMeta) {
        fromMeta = new ReplayGame({ id: gm.id, edition: gm.edition, config: gm.config, seed: gm.seed, players: gm.players.map((p) => ({ ...p.meta, id: p.id, name: p.name })) });
        fromLog = new ReplayGame({ id: gm.id, config: gm.config });
      }
      const copy = JSON.parse(JSON.stringify(e)); // as it would come back from the database
      fromMeta.apply(copy);
      fromLog.apply(JSON.parse(JSON.stringify(e)));
      events++;
      for (const [label, rep] of [['meta', fromMeta], ['log', fromLog]]) {
        const d = diff(gm, rep, e);
        compared++;
        if (d.length) throw new Error(`game ${g} (${edition}) event #${e.seq} ${e.type} (${label}): ${d.join('; ')}\n${JSON.stringify(e).slice(0, 300)}`);
      }
    },
  });
  const res = await game.run();
  for (const rep of [fromMeta, fromLog]) {
    if (!rep.result || rep.result.winnerId !== res.winnerId) throw new Error(`game ${g}: result not replayed`);
    for (const r of res.ranking) {
      const p = rep.player(r.id);
      const nw = p.bankrupt ? 0 : rep.netWorth(p);
      if (nw !== r.netWorth) throw new Error(`game ${g}: net worth of ${r.id} ${nw} vs ${r.netWorth}`);
    }
    if (rep.chat.length !== game.chat.length) throw new Error(`game ${g}: chat length`);
  }
  if (g === 0) {
    const t = transcript(fromMeta, { compact: true, maxChars: 4000 });
    if (!/Result: /.test(t) || !/left out/.test(t)) throw new Error('transcript shape');
    console.log(t.slice(0, 600) + '\n...');
  }
}
console.log({ edition, games, events, compared, ok: true });
