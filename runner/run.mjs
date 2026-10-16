#!/usr/bin/env node
// The runner: plays games on this machine with the owner's API keys and
// streams every event and model call to the site as it happens, so viewers
// watch live and the database keeps the full history.
//
//   node runner/run.mjs [--config runner/config.json] [--games 1] [--loop] [--dry]
//
// Without --config the runner reads runner/config.json when it exists, else runner/config.default.json, the default table.
//
// Keys come from the environment (or runner/.env): ANTHROPIC_API_KEY,
// OPENAI_API_KEY, GEMINI_API_KEY, XAI_API_KEY, MOONSHOT_API_KEY, XIAOMI_API_KEY,
// ZAI_API_KEY, MISTRAL_API_KEY, ... (see PROVIDERS[*].env), plus RUNNER_TOKEN
// for the site. Nothing in the config file is secret.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runner, gameRecord } from '../public/assets/app/runner.js';
import { PROVIDERS, callModel, listModels } from '../public/assets/app/providers.js';
import { StatsTracker } from '../public/assets/app/stats.js';
import { transcript } from '../public/assets/app/transcript.js';
import { HOTEL, SKYSCRAPER } from '../public/assets/app/engine.js';

const VERSION = '1.3';
const here = dirname(fileURLToPath(import.meta.url));

// ---------- arguments and configuration ----------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
  args[k] = v;
}
if (args.help) {
  console.log(`node runner/run.mjs [options]
  --config <file>     runner/config.json when it exists, else runner/config.default.json
  --games <n>         games in this batch (config.games)
  --concurrency <n>   games at once (config.concurrency)
  --seed <n>          first seed, +1 per game (random when unset)
  --edition <e>       standard | mega
  --max-rounds <n>    round limit (play to the end when unset)
  --delay <ms>        pause before every turn (to watch a bot-only game live)
  --loop              keep starting new batches, pausing config.pauseBetweenGamesMs between them
  --site <url>        the site (config.site or SITE)
  --token <t>         the runner token (RUNNER_TOKEN)
  --dry               play without uploading (local copies only)
  --log-prompts       store every prompt and system block with the calls
  --out <dir>         local copies of every game (runner/out)
  --list-models <p>   print the models a provider serves to your key (e.g. perplexity) and exit`);
  process.exit(0);
}
loadDotEnv(join(here, '.env'));
const configPath = resolve(args.config || (existsSync(join(here, 'config.json')) ? join(here, 'config.json') : join(here, 'config.default.json')));
const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
const site = String(args.site || process.env.SITE || cfg.site || '').replace(/\/$/, '');
const token = args.token || process.env.RUNNER_TOKEN || '';
const dry = !!args.dry;
const outDir = resolve(args.out || cfg.out || join(here, 'out'));
mkdirSync(outDir, { recursive: true });
if (!dry && !site && !args['list-models']) die('no site: set "site" in the config, SITE in the environment or --site');
if (!dry && !token && !args['list-models']) die('no RUNNER_TOKEN in the environment (or --token)');

const keys = {};
for (const [id, p] of Object.entries(PROVIDERS)) if (p.env && process.env[p.env]) keys[id] = process.env[p.env];
if (!keys.google && process.env.GOOGLE_API_KEY) keys.google = process.env.GOOGLE_API_KEY;
if (!keys.xiaomi && process.env.MIMO_API_KEY) keys.xiaomi = process.env.MIMO_API_KEY;
const baseUrls = { ...(cfg.baseUrls || {}) };
for (const p of cfg.players) if (p.baseUrl) baseUrls[p.provider] = baseUrls[p.provider] || p.baseUrl;

if (args['list-models']) {
  const id = String(args['list-models']);
  if (!PROVIDERS[id]) die(`unknown provider "${id}"; one of ${Object.keys(PROVIDERS).join(', ')}`);
  listModels(id, keys[id], baseUrls[id]).then((list) => { console.log(list.join('\n')); process.exit(0); }).catch((e) => die(`could not list ${id} models: ${e.message}`));
  await new Promise(() => {});
}
const players = (cfg.players || []).map((p, i) => ({ temperature: '', instructions: '', ...p, id: p.id || `p${i + 1}`, effort: p.effort || '' }));
if (players.length < 2) die('the config needs at least two players');
for (const p of players) {
  const pr = PROVIDERS[p.provider];
  if (!pr) die(`unknown provider "${p.provider}" for ${p.name}`);
  if (pr.kind !== 'none' && !keys[p.provider]) console.warn(`! no key for ${pr.label} (${pr.env}); ${p.name} will play as the rule-based bot`);
}
const gameConfig = { ...(cfg.config || {}) };
if (args.edition) gameConfig.edition = args.edition;
if (args['max-rounds']) gameConfig.maxRounds = Number(args['max-rounds']);
if (args.delay) gameConfig.turnDelayMs = Number(args.delay);

// ---------- the site ----------
async function post(path, body, attempts = 6) {
  if (dry) return { ok: true, dry: true };
  let delay = 1000;
  for (let k = 1; ; k++) {
    try {
      const res = await fetch(`${site}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const text = await res.text();
      if (res.ok) { try { return JSON.parse(text); } catch { return { ok: true }; } }
      if (res.status === 401) die('the site rejected the runner token (401)');
      if (res.status === 503) throw new Error(`site has no database yet: ${text.slice(0, 120)}`);
      if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(`${res.status}: ${text.slice(0, 200)}`), { fatal: true });
      throw new Error(`${res.status}: ${text.slice(0, 200)}`);
    } catch (e) {
      if (e.fatal || k >= attempts) throw e;
      console.warn(`  upload ${path} failed (${e.message}); retrying in ${delay / 1000}s`);
      await sleep(delay);
      delay = Math.min(delay * 2, 30000);
    }
  }
}

// Per-game buffers, flushed on a short timer so the viewer sees moves within a second.
class Feed {
  constructor(game) { this.game = game; this.events = []; this.calls = []; this.busy = Promise.resolve(); this.timer = null; this.failed = false; }
  push(kind, item) { this[kind].push(item); if (!this.timer) this.timer = setTimeout(() => this.flush(), 700); }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    this.busy = this.busy.then(async () => {
      if (this.failed) return;
      try {
        while (this.events.length) { const batch = this.events.splice(0, 400); await post(`/api/ingest/games/${encodeURIComponent(this.game.id)}/events`, { events: batch }); }
        while (this.calls.length) { const batch = this.calls.splice(0, 100); await post(`/api/ingest/games/${encodeURIComponent(this.game.id)}/calls`, { calls: batch.map(callRecord) }); }
      } catch (e) { this.failed = true; console.error(`! uploads for ${this.game.id} stopped: ${e.message}`); }
    });
    return this.busy;
  }
}
const feeds = new Map();
function callRecord(c) {
  const { system, user, ...rest } = c;
  return { ...rest, response: c.response, system: args['log-prompts'] || cfg.logPrompts ? system : undefined, user: args['log-prompts'] || cfg.logPrompts ? user : undefined };
}

// ---------- summaries ----------
function finishPayload(game, result) {
  const tracker = new StatsTracker(game).update();
  const ranking = result.ranking || [];
  const rankOf = (id) => { const k = ranking.findIndex((r) => r.id === id); return k < 0 ? null : k + 1; };
  const illegal = {};
  for (const e of game.events) if (e.type === 'illegal_decision' && e.player) illegal[e.player] = (illegal[e.player] || 0) + 1;
  const playersOut = game.players.map((p) => {
    const ps = tracker.players[p.id] || tracker.blankPlayer();
    const mine = game.llmCalls.filter((c) => c.player === p.id);
    const served = {};
    const calls = { n: mine.length, fallbacks: 0, errors: 0, illegal: illegal[p.id] || 0, latencyMs: 0, input: 0, output: 0, cached: 0, reasoning: 0, servedModels: served };
    for (const c of mine) {
      if (c.fallback) calls.fallbacks++;
      if (c.error) calls.errors++;
      calls.latencyMs += c.latencyMs || 0;
      if (c.usage) { calls.input += c.usage.input || 0; calls.output += c.usage.output || 0; calls.cached += c.usage.cached || 0; calls.reasoning += c.usage.reasoning || 0; }
      if (c.servedModel) served[c.servedModel] = (served[c.servedModel] || 0) + 1;
    }
    return {
      id: p.id, rank: rankOf(p.id), finalCash: p.cash, finalNetWorth: p.bankrupt ? 0 : game.netWorth(p), bankrupt: p.bankrupt, bankruptRound: p.bankruptRound,
      stats: {
        engine: p.stats,
        income: { total: ps.made.total, rentTotal: ps.made.rentTotal, go: ps.made.go, bank: ps.made.bank, players: ps.made.players, rent: ps.made.rent, paidTotal: ps.paid.total, paidBank: ps.paid.bank, paidPlayers: ps.paid.players },
        rolls: ps.rolls, rollCount: ps.rollCount, turns: ps.turns, bought: ps.bought, auctions: ps.auctions, trades: ps.trades,
        properties: game.ownedBy(p), calls,
      },
    };
  });
  const props = {};
  for (const [i, ps] of Object.entries(tracker.props)) props[i] = { landings: ps.landings, rent: ps.rent, bought: null, auction: false, price: null, ownerChanges: 0, maxLevel: 0, finalOwner: game.props[i] ? game.props[i].owner : null };
  for (const e of game.events) {
    if ((e.type === 'purchase' || e.type === 'auction_won') && props[e.property]) {
      const q = props[e.property];
      if (q.bought == null) { q.bought = e.price; q.auction = e.type === 'auction_won'; q.price = e.price; }
      q.ownerChanges++;
    }
    if (e.type === 'trade_completed') for (const i of [...(e.give.props || []), ...(e.get.props || [])]) if (props[i]) props[i].ownerChanges++;
    if (e.type === 'assets_transferred') for (const i of e.properties || []) if (props[i]) props[i].ownerChanges++;
    if (e.type === 'build' && props[e.property]) props[e.property].maxLevel = Math.max(props[e.property].maxLevel, e.level);
  }
  const buildings = { houses: 0, hotels: 0, skyscrapers: 0 };
  for (const pr of Object.values(game.props)) { if (pr.level === SKYSCRAPER) buildings.skyscrapers++; else if (pr.level === HOTEL) buildings.hotels++; else buildings.houses += pr.level; }
  const winner = game.player(result.winnerId);
  const summary = {
    edition: game.edition, rounds: result.rounds, turns: result.turns, durationMs: result.durationMs, endReason: result.endReason, players: game.players.length, messages: game.chat.length,
    match: tracker.match, bankruptcies: game.players.filter((p) => p.bankrupt).length, housesBuilt: game.players.reduce((a, p) => a + p.stats.housesBuilt, 0), buildings,
    winner: winner ? { id: winner.id, name: winner.name, netWorth: winner.bankrupt ? 0 : game.netWorth(winner), cash: winner.cash } : null,
    props,
  };
  return { result, finishedAt: new Date().toISOString(), durationMs: result.durationMs, summary, players: playersOut };
}

async function writeRecap(game) {
  const n = cfg.narrator;
  if (!n || !n.provider || !keys[n.provider]) return null;
  try {
    const text = transcript(game, { compact: true, maxChars: n.maxChars || 150000 });
    const out = await callModel({
      provider: n.provider, model: n.model, effort: n.effort || 'low', apiKey: keys[n.provider], baseUrl: baseUrls[n.provider],
      system: [{ text: 'You write the match report for a Monopoly game played entirely by AI models, for readers who did not watch it. 150 to 250 words of plain British English prose, no bullet points, no headings. Name the players by their names, say how the game turned: the key purchases and trades, who went bankrupt and why, and how the winner won. Be specific about squares and sums; never invent anything the transcript does not show.', cache: false }],
      user: `THE GAME\n${text}\n\nWrite the match report.`, maxTokens: 1200, timeoutMs: 180000, plain: true, concurrency: 2,
    });
    return out.text.trim() || null;
  } catch (e) { console.warn(`  recap failed: ${e.message}`); return null; }
}

// ---------- playing ----------
let runner = null;
let stopping = false;
process.on('SIGINT', async () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\nstopping: finishing uploads and marking running games aborted');
  if (runner) runner.stop();
  for (const [id, feed] of feeds) { await feed.flush(); if (!feed.game.result) await post(`/api/ingest/games/${encodeURIComponent(id)}/abort`, { reason: 'runner stopped' }).catch(() => {}); }
  process.exit(0);
});

async function runBatch(batchNo) {
  const batchId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).slice(-4)}${batchNo ? '-' + batchNo : ''}`;
  const setup = {
    batchId, players, universal: cfg.universal || '', config: gameConfig,
    games: Number(args.games || cfg.games || 1), concurrency: Number(args.concurrency || cfg.concurrency || 1),
    seed: args.seed != null ? Number(args.seed) : cfg.seed ?? '', keys, baseUrls,
    maxTokens: cfg.maxTokens || 4000, timeoutMs: (cfg.timeoutSeconds || 600) * 1000, apiConcurrency: cfg.apiConcurrency || 8, logPrompts: true,
  };
  const stats = { calls: 0, fallbacks: 0, inTok: 0, outTok: 0 };
  runner = new Runner(setup, {
    async onGameStart(game) {
      const feed = new Feed(game);
      feeds.set(game.id, feed);
      console.log(`▶ ${game.id}: ${game.players.map((p) => p.name).join(', ')} (${game.edition}, seed ${game.seed})`);
      try {
        await post('/api/ingest/games', {
          id: game.id, batchId, edition: game.edition, seed: game.seed, config: game.config, universal: setup.universal, startedAt: new Date(game.startedAt).toISOString(),
          runner: { version: VERSION, node: process.version },
          players: game.players.map((p, seat) => ({ id: p.id, seat, name: p.name, provider: p.meta.provider, model: p.meta.model, effort: p.meta.effort || null, colour: p.meta.colour, temperature: p.meta.temperature, instructions: p.meta.instructions, baseUrl: baseUrls[p.meta.provider] || null })),
        });
      } catch (e) { feed.failed = true; console.error(`! could not register ${game.id}: ${e.message}`); }
      // events logged before the game was registered are already in the buffer
      feed.flush();
    },
    onEvent(ev, game) {
      const feed = feeds.get(game.id);
      if (feed) feed.push('events', ev);
      if (ev.type === 'turn_start' && ev.turn % 20 === 0) console.log(`  ${game.id} round ${ev.round}, turn ${ev.turn}, ${stats.calls} calls`);
      if (ev.type === 'bankrupt') console.log(`  ${game.id} r${ev.round}: ${game.player(ev.player).name} is bankrupt`);
    },
    onLlm(rec, game) {
      stats.calls++; if (rec.fallback) stats.fallbacks++;
      if (rec.usage) { stats.inTok += rec.usage.input || 0; stats.outTok += rec.usage.output || 0; }
      const feed = feeds.get(game.id);
      if (feed) feed.push('calls', rec);
    },
    async onGameEnd(game, result) {
      const feed = feeds.get(game.id);
      if (feed) await feed.flush();
      console.log(`■ ${game.id}: ${result.winnerName} wins after ${result.rounds} rounds (${result.endReason}); ${game.llmCalls.length} calls`);
      const payload = finishPayload(game, result);
      payload.recap = await writeRecap(game);
      const local = { ...gameRecord(game, setup), finish: payload };
      try { writeFileSync(join(outDir, `${game.id}.json`), JSON.stringify(local)); } catch (e) { console.warn(`  could not write the local copy: ${e.message}`); }
      try { await post(`/api/ingest/games/${encodeURIComponent(game.id)}/finish`, payload); console.log(`  ${game.id} saved to the site`); }
      catch (e) { console.error(`! could not finish ${game.id} on the site: ${e.message}`); }
      feeds.delete(game.id);
    },
    onDone(summary) {
      console.log(`batch ${batchId}: ${summary.games} games in ${(summary.durationMs / 1000).toFixed(0)}s, ${stats.calls} calls (${stats.fallbacks} fallbacks), ${stats.inTok.toLocaleString()} in / ${stats.outTok.toLocaleString()} out tokens`);
    },
  });
  await runner.run();
  runner = null;
}

(async () => {
  console.log(`Monopoly AI runner ${VERSION} · ${dry ? 'dry run (no uploads)' : site} · ${players.length} players · config ${configPath}`);
  if (!dry) {
    const h = await fetch(`${site}/api/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));
    if (!h.ok) die(`the site did not answer: ${h.error || JSON.stringify(h)}`);
    if (!h.db) die('the site has no database yet: create it and add the binding (README, "Setting up the database")');
  }
  let batchNo = 0;
  for (;;) {
    await runBatch(batchNo++);
    if (!args.loop || stopping) break;
    const pause = Number(cfg.pauseBetweenGamesMs || 60000);
    console.log(`next batch in ${Math.round(pause / 1000)}s`);
    await sleep(pause);
  }
})().catch((e) => { console.error(e); process.exit(1); });

// ---------- small helpers ----------
function die(msg) { console.error(`runner: ${msg}`); process.exit(1); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}
