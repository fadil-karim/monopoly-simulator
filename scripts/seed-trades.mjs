#!/usr/bin/env node
// For checking the viewer on this machine: plays one game in which the players trade (scripts/traders.mjs), now and
// then giving no valid answer so that forfeits show, and uploads it to the local site as an aborted game, its seats labelled with the first eight models of the default
// table so the board wears their logos, and gives those eight to the site as the pool, for the homepage's players.
// No model is called, and only a site on this machine is accepted, so a scripted game can never reach the public
// site. scripts/verify-viewer.mjs looks for it by its id, trades-…
//   node scripts/seed-trades.mjs [--site http://127.0.0.1:8789] [--token local-dev-token] [--seed 7]
import { readFileSync } from 'node:fs';
import { Game } from '../public/assets/app/engine.js';
import { traders } from './traders.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
const site = String(args.site || 'http://127.0.0.1:8789').replace(/\/$/, '');
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(site)) { console.error(`seed-trades: ${site} is not a site on this machine; a scripted game goes only to the local one`); process.exit(1); }
const token = args.token || 'local-dev-token';
const seed = Number(args.seed || 7);
const pool = JSON.parse(readFileSync(new URL('../runner/config.default.json', import.meta.url), 'utf8')).players.slice(0, 8)
  .map((p, i) => ({ id: p.id || `p${i + 1}`, name: p.name, provider: p.provider, model: p.model, effort: p.effort || null, colour: p.colour }));
const id = `trades-${Date.now().toString(36)}`;
async function post(path, body) {
  const r = await fetch(site + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const game = new Game({ id, seed, config: { edition: 'standard', maxRounds: 60, aiPreroll: 'always' }, players: pool, decider: traders(seed, { flaky: 1 / 12 }) });
// its eight models stand as the pool, so the homepage's players can be checked with their logos
await post('/api/ingest/pool', { players: pool, seats: pool.length });
await post('/api/ingest/games', {
  id, batchId: 'trades', edition: 'standard', seed, config: game.config, universal: '', startedAt: new Date().toISOString(),
  runner: { version: 'seed-trades', node: process.version }, players: pool.map((p, seat) => ({ ...p, seat })),
});
const res = await game.run();
for (let k = 0; k < game.events.length; k += 400) await post(`/api/ingest/games/${encodeURIComponent(id)}/events`, { events: game.events.slice(k, k + 400) });
await post(`/api/ingest/games/${encodeURIComponent(id)}/abort`, { reason: 'a scripted game for checking the viewer' });
const count = (t) => game.events.filter((e) => e.type === t).length;
console.log(`${id}: ${game.events.length} events, ${count('trade_proposed')} offers, ${count('trade_counter')} counters, ${count('trade_completed')} trades, ${count('forfeit')} forfeits; ${res.winnerName} ahead after ${res.rounds} rounds. Open ${site}/monopoly/#game/${id}`);
