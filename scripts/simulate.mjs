#!/usr/bin/env node
// Headless engine check: runs heuristic-only games and reports outcomes.
//   node scripts/simulate.mjs [games] [edition]
import { Game } from '../public/assets/js/engine.js';

const games = Number(process.argv[2] || 50);
const edition = process.argv[3] || 'standard';
const t0 = Date.now();
const wins = {}; const ends = {}; let rounds = 0; let illegal = 0; let events = 0;
for (let g = 0; g < games; g++) {
  const game = new Game({
    id: `t${g}`, seed: g + 1,
    config: { edition, maxRounds: 150, aiPreroll: 'always' },
    players: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' }, { id: 'd', name: 'Delta' }],
    decider: null,
  });
  const res = await game.run();
  wins[res.winnerName] = (wins[res.winnerName] || 0) + 1;
  ends[res.endReason] = (ends[res.endReason] || 0) + 1;
  rounds += res.rounds;
  events += game.events.length;
  illegal += game.events.filter((e) => e.type === 'illegal_action' || e.type === 'illegal_decision').length;
  // invariants
  const totalHouses = Object.values(game.props).reduce((a, pr) => a + (pr.level >= 5 ? 0 : pr.level), 0);
  const totalHotels = Object.values(game.props).filter((pr) => pr.level === 5).length;
  const totalSky = Object.values(game.props).filter((pr) => pr.level === 6).length;
  if (totalHouses + game.bank.houses !== game.info.houses) throw new Error(`house stock mismatch in game ${g}: ${totalHouses}+${game.bank.houses}`);
  if (totalHotels + game.bank.hotels !== game.info.hotels) throw new Error(`hotel stock mismatch in game ${g}`);
  if (totalSky + game.bank.skyscrapers !== game.info.skyscrapers) throw new Error(`skyscraper stock mismatch in game ${g}`);
  for (const p of game.players) if (p.cash < 0) throw new Error(`negative cash in game ${g}: ${p.id} ${p.cash}`);
  for (const p of game.players) if (p.bankrupt && game.ownedBy(p).length) throw new Error(`bankrupt player still owns property in game ${g}`);
  if (g === 0) {
    const types = {};
    for (const e of game.events) types[e.type] = (types[e.type] || 0) + 1;
    console.log('event types in game 0:', JSON.stringify(types));
  }
}
console.log({ edition, games, wins, ends, avgRounds: (rounds / games).toFixed(1), avgEvents: Math.round(events / games), illegal, ms: Date.now() - t0 });
