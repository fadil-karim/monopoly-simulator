#!/usr/bin/env node
// The simulator: plays games with the owner's API keys, keeps every game in its own store as it is played, and
// publishes the games to the site, which shows them live and keeps a copy. It runs on the owner's machine or in its
// container (Dockerfile, docker-compose.yml), on a laptop or a cloud instance, apart from the site: the site can be
// updated, moved or emptied without touching a game in play or the record of the games played, and is filled again
// from the store.
//
//   node runner/run.mjs [--games 1] [--loop] [--dry]            play
//   node runner/run.mjs --store | --publish | --republish       the store, and what the site has of it
//   node runner/run.mjs --import-site                           the site's games, into the store
//   node runner/run.mjs --probe | --list-models <p> | --dashboard
//
// The data folder (--data, else MONOPOLY_DATA, else runner/; /data in the container) holds games/, the store, and
// config.json and .env when the dashboard has saved them. Without --config the runner reads <data>/config.json, else
// runner/config.json, else runner/config.default.json, the default table.
//
// Keys come from the environment or a .env file in the data folder (or runner/): ANTHROPIC_API_KEY, GEMINI_API_KEY,
// PERPLEXITY_API_KEY, OPENROUTER_API_KEY, ... (PROVIDERS[*].env), and RUNNER_TOKEN for the site. Nothing in the
// config file is secret.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { Runner, modelKey } from '../public/assets/app/runner.js';
import { PROVIDERS, callModel, listModels, netReason } from '../public/assets/app/providers.js';
import { AIDecider } from '../public/assets/app/ai.js';
import { StatsTracker } from '../public/assets/app/stats.js';
import { transcript } from '../public/assets/app/transcript.js';
import { Game, HOTEL, SKYSCRAPER } from '../public/assets/app/engine.js';
import { GameStore, Publisher } from './store.mjs';

// Node tries each address of an API for 250 ms before the next, and gives up when the last fails: on a machine
// whose IPv6 has no route, a moment of slow Wi-Fi then fails every call at once ("connect ETIMEDOUT …; connect
// EHOSTUNREACH …"). Each attempt now gets two and a half seconds.
if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') net.setDefaultAutoSelectFamilyAttemptTimeout(2500);

const VERSION = '2.1';
const here = dirname(fileURLToPath(import.meta.url));
// A path as the owner would type it: from the repository when it is inside it, else whole.
const show = (f) => { const r = relative(join(here, '..'), f); return r && !r.startsWith('..') ? r : f; };

// ---------- arguments and configuration ----------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
  args[k] = v;
}
if (args.dashboard) { await import('./dashboard.mjs'); await new Promise(() => {}); } // the dashboard runs the runner itself; this process only serves the page
if (args.help) {
  console.log(`node runner/run.mjs [options]
  --data <dir>        the data folder: the store (games/), and config.json and .env when saved (MONOPOLY_DATA; runner/)
  --config <file>     the table: <data>/config.json, else runner/config.json, else runner/config.default.json
  --games <n>         games in this batch (config.games)
  --seats <n>         players a game, drawn at random from the config's pool, never the same model twice (config.seats, 8; the standard board takes 8 at most)
  --concurrency <n>   games at once (config.concurrency)
  --seed <n>          first seed, +1 per game (random when unset)
  --edition <e>       standard | mega
  --max-rounds <n>    round limit (play to the end when unset)
  --delay <ms>        pause before every turn (to watch a bot-only game live)
  --loop              keep starting new batches, pausing config.pauseBetweenGamesMs between them
  --hold              once told to finish (SIGUSR2), stay up without playing until stopped (the container's play mode)
  --site <url>        the site (config.site or SITE)
  --token <t>         the runner token (RUNNER_TOKEN)
  --dry               play and keep the games in the store without sending them to the site
  --log-prompts       send every prompt and system block to the site with the calls (the store keeps them always)
  --store             say what the store holds, game by game, and what the site has of it, and exit
  --publish           send the site every game played for it that it has not wholly got, and exit
  --republish         send the site every game played for it again, after its database was replaced or emptied, and exit
  --import-site       copy into the store every game the site has and the store has not (the games played before it), and exit
  --list-models <p>   print the models a provider serves to your key (e.g. perplexity) and exit
  --probe             ask every model in the pool one real decision, say which answer and which would forfeit, and exit
  --dashboard         open the local dashboard instead: a page to fill in the site, the keys and the pool, and to start and stop the runner

While it plays: Ctrl-C (SIGINT or SIGTERM) stops the games in play after the current turn, keeping them as stopped;
SIGUSR2 plays the games in play to the end and starts no more.`);
  process.exit(0);
}
const dataDir = resolve(typeof args.data === 'string' ? args.data : process.env.MONOPOLY_DATA || here);
const tokenInEnv = process.env.RUNNER_TOKEN != null; // before the .env files fill the gaps, to say where the token came from
const envFrom = {};
for (const f of [join(dataDir, '.env'), join(here, '.env')]) for (const k of loadDotEnv(f)) envFrom[k] = envFrom[k] || f;
const configPath = resolve(typeof args.config === 'string' ? args.config : [join(dataDir, 'config.json'), join(here, 'config.json')].find((f) => existsSync(f)) || join(here, 'config.default.json'));
const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
const site = String(args.site || process.env.SITE || cfg.site || '').replace(/\/$/, '');
const token = String(args.token || process.env.RUNNER_TOKEN || '').trim();
const tokenFrom = args.token ? 'the --token option' : tokenInEnv ? (process.env.MONOPOLY_DASHBOARD ? "the dashboard's token box" : 'the RUNNER_TOKEN environment variable') : envFrom.RUNNER_TOKEN ? show(envFrom.RUNNER_TOKEN) : 'nowhere';
// What a refused token means, with which token this runner sent, so a stale or mistyped one shows.
const tokenRejected = () => `the site rejected the runner token (401): this runner sent ${token.length} characters from ${tokenFrom}, which is not the RUNNER_TOKEN secret on the Worker. Put the same value in both: the secret in Cloudflare (Workers & Pages, the Worker, Settings, Variables and Secrets, edit RUNNER_TOKEN) and ${tokenFrom}`;
const dry = !!args.dry;
const store = new GameStore(join(dataDir, 'games'));
const publisher = new Publisher({
  site: dry ? '' : site, token, store, logPrompts: !!(args['log-prompts'] || cfg.logPrompts),
  explain: (e) => (e.status === 401 ? tokenRejected() : e.network ? `the site could not be reached: ${siteWhy(e.network)}` : e.message),
});

const keys = {};
for (const [id, p] of Object.entries(PROVIDERS)) if (p.env && process.env[p.env]) keys[id] = process.env[p.env];
if (!keys.google && process.env.GOOGLE_API_KEY) keys.google = process.env.GOOGLE_API_KEY;
if (!keys.xiaomi && process.env.MIMO_API_KEY) keys.xiaomi = process.env.MIMO_API_KEY;
const baseUrls = { ...(cfg.baseUrls || {}) };
for (const p of cfg.players || []) if (p.baseUrl) baseUrls[p.provider] = baseUrls[p.provider] || p.baseUrl;

if (args['list-models']) {
  const id = String(args['list-models']);
  if (!PROVIDERS[id]) die(`unknown provider "${id}"; one of ${Object.keys(PROVIDERS).join(', ')}`);
  listModels(id, keys[id], baseUrls[id]).then((list) => { console.log(list.join('\n')); process.exit(0); }).catch((e) => die(`could not list ${id} models: ${e.message}`));
  await new Promise(() => {});
}
const pool = (cfg.players || []).map((p, i) => ({ temperature: '', instructions: '', ...p, id: p.id || `p${i + 1}`, effort: p.effort || '' }));
for (const p of pool) if (!PROVIDERS[p.provider]) die(`unknown provider "${p.provider}" for ${p.name}`);

// ---------- the site ----------
// Why the site could not be reached, with what to do about it: Node's own reason, then a hint by its kind.
function siteWhy(e) {
  const why = netReason(e);
  const c = (e && e.cause) || {};
  const kind = `${c.code || (c.errors && c.errors[0] && c.errors[0].code) || ''} ${why}`;
  if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME/.test(kind)) return `${why}. The address does not resolve: check it, and that the domain is attached to the Worker in Cloudflare (Workers & Pages, the Worker, Settings, Domains & Routes)`;
  if (/CERT|SSL|TLS|EPROTO|certificate|self.signed|issuer/i.test(kind)) return `${why}. The secure connection failed: a new domain's certificate can take a few minutes to arrive, or a VPN, proxy or antivirus on this machine is intercepting the connection`;
  if (/ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET/.test(kind)) return `${why}. Nothing answered at that address: check it, and any VPN or proxy on this machine`;
  return why;
}
// Before a batch: is the site there, with its database and the same token? Nothing here stops a game: what the site
// cannot take yet stays in the store and goes when it can, so this only says what to fix.
async function checkSite() {
  if (dry) return;
  if (!site) { console.warn('! no site given (SITE, --site or "site" in the config): the games are kept in the store only; give it, then --publish'); return; }
  if (!token) { console.warn('! no RUNNER_TOKEN (the environment, the .env file or --token): the games are kept in the store only; give it, then --publish'); return; }
  const h = await fetch(`${site}/api/health`).then(async (r) => {
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { error: `${site}/api/health answered ${r.status} with ${r.headers.get('content-type') || 'no content type'}, not the site's API: check the address` }; }
  }).catch((e) => ({ error: siteWhy(e) }));
  if (!h.ok) return console.warn(`! the site did not answer (${h.error || JSON.stringify(h)}); the games are kept in the store and go to the site when it does`);
  if (!h.db) return console.warn('! the site has no database yet (README, "Setting up the site"); the games are kept in the store and go to the site once it has one');
  if (h.token === false) return console.warn('! the site has no runner token yet: add a secret named RUNNER_TOKEN to the Worker in Cloudflare (README, "Setting up the site") and give the simulator the same value; until then the games are kept in the store');
  const check = await fetch(`${site}/api/ingest/check`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{}' }).then((r) => r.status, () => 0);
  if (check === 401) return console.warn(`! ${tokenRejected()}. Until they match, the games are kept in the store, and they go to the site once they do`);
  // The pool, for the site's homepage, which lists it as "The players": who, by which provider, model and effort.
  await publisher.post('/api/ingest/pool', { players: players.map((p) => ({ id: p.id, name: p.name, provider: p.provider, model: p.model, effort: p.effort || null, colour: p.colour || null })), seats })
    .catch((e) => console.warn(`  the site did not take the pool (${e.message}); its list of players stays as it was`));
}

// ---------- summaries ----------
// The game as the site registers it, and as the store keeps it in game.json.
function registration(game, setup) {
  return {
    id: game.id, batchId: setup.batchId, edition: game.edition, seed: game.seed, config: game.config, universal: setup.universal, startedAt: new Date(game.startedAt).toISOString(),
    runner: { version: VERSION, node: process.version, ...(process.env.MONOPOLY_CONTAINER ? { container: true } : {}) },
    players: game.players.map((p, seat) => ({ id: p.id, seat, name: p.name, provider: p.meta.provider, model: p.meta.model, effort: p.meta.effort || null, colour: p.meta.colour, temperature: p.meta.temperature, instructions: p.meta.instructions, baseUrl: baseUrls[p.meta.provider] || null })),
  };
}
function finishPayload(game, result) {
  const tracker = new StatsTracker(game).update();
  const ranking = result.ranking || [];
  const rankOf = (id) => { const k = ranking.findIndex((r) => r.id === id); return k < 0 ? null : k + 1; };
  // The choices each player gave up for want of a valid answer, by what went wrong and by question.
  const forfeits = {};
  for (const e of game.events) {
    if (e.type !== 'forfeit' || !e.player) continue;
    const f = forfeits[e.player] || (forfeits[e.player] = { n: 0, kinds: {}, decisions: {} });
    f.n++; f.kinds[e.kind] = (f.kinds[e.kind] || 0) + 1; f.decisions[e.decision] = (f.decisions[e.decision] || 0) + 1;
  }
  const playersOut = game.players.map((p) => {
    const ps = tracker.players[p.id] || tracker.blankPlayer();
    const mine = game.llmCalls.filter((c) => c.player === p.id);
    const served = {};
    const ff = forfeits[p.id] || { n: 0, kinds: {}, decisions: {} };
    // cost: dollars over the calls that have one; reported and priced count the calls by where the figure came
    // from; unpriced counts the calls that used tokens but whose model has no price on file. fallbacks counts the
    // calls whose answer could not be used, illegal the answers the engine refused.
    const calls = { n: mine.length, fallbacks: 0, errors: 0, illegal: ff.kinds.invalid || 0, forfeits: ff.n, latencyMs: 0, input: 0, output: 0, cached: 0, reasoning: 0, servedModels: served, cost: 0, reported: 0, priced: 0, unpriced: 0 };
    for (const c of mine) {
      if (c.fallback) calls.fallbacks++;
      if (c.error) calls.errors++;
      calls.latencyMs += c.latencyMs || 0;
      if (c.usage) { calls.input += c.usage.input || 0; calls.output += c.usage.output || 0; calls.cached += c.usage.cached || 0; calls.reasoning += c.usage.reasoning || 0; }
      if (c.servedModel) served[c.servedModel] = (served[c.servedModel] || 0) + 1;
      if (Number.isFinite(c.cost)) { calls.cost += c.cost; calls[c.costSource === 'reported' ? 'reported' : 'priced']++; } else if (c.usage) calls.unpriced++;
    }
    calls.cost = Math.round(calls.cost * 1e8) / 1e8;
    return {
      id: p.id, rank: rankOf(p.id), finalCash: p.cash, finalNetWorth: p.bankrupt ? 0 : game.netWorth(p), bankrupt: p.bankrupt, bankruptRound: p.bankruptRound,
      stats: {
        engine: p.stats,
        income: { total: ps.made.total, rentTotal: ps.made.rentTotal, go: ps.made.go, bank: ps.made.bank, players: ps.made.players, rent: ps.made.rent, paidTotal: ps.paid.total, paidBank: ps.paid.bank, paidPlayers: ps.paid.players },
        rolls: ps.rolls, rollCount: ps.rollCount, turns: ps.turns, bought: ps.bought, auctions: ps.auctions, trades: ps.trades,
        properties: game.ownedBy(p), calls, forfeits: ff,
        // how long the table waited for its answers: how many, in all, on average and the longest
        answerTime: { answers: ps.answers, ms: ps.answerMs, avgMs: ps.answers ? Math.round(ps.answerMs / ps.answers) : null, longestMs: ps.longestAnswerMs },
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
  const m = tracker.match;
  const summary = {
    edition: game.edition, rounds: result.rounds, turns: result.turns, durationMs: result.durationMs, endReason: result.endReason, players: game.players.length, messages: game.chat.length,
    match: m, bankruptcies: game.players.filter((p) => p.bankrupt).length, housesBuilt: game.players.reduce((a, p) => a + p.stats.housesBuilt, 0), buildings,
    winner: winner ? { id: winner.id, name: winner.name, netWorth: winner.bankrupt ? 0 : game.netWorth(winner), cash: winner.cash } : null,
    props,
    forfeits: m.forfeits,
    answerTime: { answers: m.answers, ms: m.answerMs, avgMs: m.answers ? Math.round(m.answerMs / m.answers) : null, longestMs: Math.max(0, ...playersOut.map((q) => q.stats.answerTime.longestMs || 0)) },
    cost: { players: Math.round(playersOut.reduce((a, q) => a + q.stats.calls.cost, 0) * 1e8) / 1e8, narrator: null, total: null, unpriced: playersOut.reduce((a, q) => a + q.stats.calls.unpriced, 0) },
  };
  summary.cost.total = summary.cost.players;
  return { result, finishedAt: new Date().toISOString(), durationMs: result.durationMs, summary, players: playersOut };
}

// The narrator's report, with what it cost: { text, cost, costSource, provider, model }, or null. A stop cuts it short.
const narratorStop = new AbortController();
async function writeRecap(game) {
  const n = cfg.narrator;
  if (!n || !n.provider || !keys[n.provider]) return null;
  try {
    const text = transcript(game, { compact: true, maxChars: n.maxChars || 150000 });
    const out = await callModel({
      provider: n.provider, model: n.model, effort: n.effort || 'low', apiKey: keys[n.provider], baseUrl: baseUrls[n.provider], price: n.price || null,
      system: [{ text: 'You write the match report for a Monopoly game played entirely by AI models, for readers who did not watch it. 150 to 250 words of plain British English prose, no bullet points, no headings. Name the players by their names, say how the game turned: the key purchases and trades, who went bankrupt and why, and how the winner won. Be specific about squares and sums; never invent anything the transcript does not show.', cache: false }],
      user: `THE GAME\n${text}\n\nWrite the match report.`, maxTokens: 1200, timeoutMs: 180000, plain: true, concurrency: 2, signal: narratorStop.signal,
    });
    return { text: out.text.trim() || null, cost: out.cost, costSource: out.costSource, provider: n.provider, model: n.model };
  } catch (e) { console.warn(`  recap failed: ${e.message}`); return null; }
}
const usd = (x) => (!Number.isFinite(x) ? 'no price on file' : x === 0 ? '$0' : `$${x < 1 ? x.toFixed(4) : x.toFixed(2)}`);
const secs = (ms) => (ms == null ? '–' : ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- the store and the site ----------
// The games whose runner stopped before they ended are marked stopped; then, while playing, everything the site
// lacks is sent in the background.
function sweep(publish = false) {
  for (const id of store.sweep('the simulator stopped before the game ended')) console.log(`□ ${id}: its runner stopped before the game ended; kept in the store as stopped`);
  if (publish) for (const g of publisher.behind()) publisher.soon(g.id, 0);
}
function report() {
  const games = store.summary(site);
  const n = (s) => games.filter((g) => g.status === s).length;
  const behind = games.filter((g) => g.mine && !g.published && g.status !== 'running');
  const mb = games.reduce((a, g) => a + g.bytes, 0) / 1048576;
  console.log(`${plural(games.length, 'game')} in ${show(store.root)} (${mb.toFixed(1)} MB): ${n('finished')} finished, ${n('aborted')} stopped, ${n('running')} in play${n('stalled') ? `, ${n('stalled')} whose runner stopped` : ''}${site ? `; ${behind.length} not yet wholly on ${site}` : ''}`);
  const word = { finished: 'finished', aborted: 'stopped', running: 'in play', stalled: 'no runner' };
  for (const g of games.slice(-50)) {
    const what = g.status === 'finished' ? `${g.winner} won in ${g.rounds} rounds` : g.status === 'aborted' ? g.endReason || '' : g.players.join(', ');
    const where = !g.site ? 'kept only     ' : !g.mine ? 'another site  ' : g.published ? 'on the site   ' : g.registered ? 'partly on site' : 'not yet sent  ';
    console.log(`  ${g.id.padEnd(24)} ${word[g.status].padEnd(9)} ${where}  ${what}${g.site && !g.mine ? ` (played for ${g.site})` : ''}`);
  }
}
async function publishAll(again) {
  if (!site) die('no site: set "site" in the config, SITE in the environment or --site');
  if (!token) die('no RUNNER_TOKEN in the environment, the .env file or --token');
  sweep();
  if (again) for (const g of store.summary(site)) if (g.mine && (g.status === 'finished' || g.status === 'aborted')) store.forget(g.id);
  const ids = publisher.behind().map((g) => g.id);
  if (!ids.length) { console.log(`${site} has every game in the store played for it`); return 0; }
  console.log(`sending ${plural(ids.length, 'game')} to ${site}…`);
  const left = await publisher.drain(ids);
  console.log(left.length ? `${plural(left.length, 'game')} not sent (see above); they stay in the store for the next try` : `${site} has every game in the store played for it`);
  return left.length ? 1 : 0;
}
// The site's games, into the store: the games played before the store existed, so that it holds every game. Each is
// read from the site's public API, events and calls (with the prompts when the site kept them), and is marked as
// already on that site.
async function importSite() {
  if (!site) die('no site to copy from: set "site" in the config, SITE in the environment or --site');
  const get = async (path) => {
    let r;
    try { r = await fetch(`${site}${path}`); } catch (e) { throw new Error(`the site could not be reached: ${siteWhy(e)}`); }
    const text = await r.text();
    if (!r.ok) throw new Error(`${path} answered ${r.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  };
  const pages = async (path, key) => {
    const out = [];
    for (let after = 0; ;) {
      const r = await get(`${path}&after=${after}`);
      out.push(...r[key]);
      if (r.done || !r[key].length) return out;
      after = r.nextAfter;
    }
  };
  const list = [];
  for (let offset = 0; ;) {
    const r = await get(`/api/games?limit=200&offset=${offset}`);
    list.push(...r.games); offset += r.games.length;
    if (!r.games.length || offset >= r.total) break;
  }
  const have = new Set(store.ids());
  const todo = list.filter((g) => !have.has(g.id) && g.status !== 'running').reverse();
  console.log(`${site} has ${plural(list.length, 'game')}; ${todo.length} to copy into ${show(store.root)}${list.some((g) => g.status === 'running') ? ' (games in play are left to the runner playing them)' : ''}`);
  let done = 0;
  for (const row of todo) {
    const id = row.id, path = `/api/games/${encodeURIComponent(id)}`;
    try {
      const g = await get(path);
      const events = await pages(`${path}/events?limit=2000`, 'events');
      const calls = (await pages(`${path}/calls?limit=1000&full=1`, 'calls')).map(({ prompt, system, ...c }) => ({ ...c, game: id, ...(prompt != null ? { user: prompt } : {}), ...(system != null ? { system } : {}) }));
      const players = g.players || [];
      store.put(id, {
        game: { id, batchId: g.batchId, edition: g.edition, seed: g.seed, config: g.config, universal: g.universal, startedAt: g.startedAt, runner: g.runner, players: players.map((p) => ({ id: p.id, seat: p.seat, name: p.name, provider: p.provider, model: p.model, effort: p.effort || null, colour: p.colour, temperature: p.temperature ?? null, instructions: p.instructions || '', baseUrl: p.baseUrl || null })), site, copied: true },
        events, calls,
        finish: g.status === 'finished' ? { result: g.result, finishedAt: g.finishedAt, durationMs: g.durationMs, summary: g.summary, recap: g.recap, players: players.map((p) => ({ id: p.id, rank: p.rank, finalCash: p.finalCash, finalNetWorth: p.finalNetWorth, bankrupt: p.bankrupt, bankruptRound: p.bankruptRound, stats: p.stats })) } : null,
        abort: g.status === 'aborted' ? { reason: g.endReason || 'aborted', at: g.finishedAt || g.updatedAt } : null,
      });
      store.setPublished(id, { site, registered: true, events: events.length, calls: calls.length, finished: g.status === 'finished', aborted: g.status === 'aborted' });
      done++;
      console.log(`  ${id}: ${plural(events.length, 'event')}, ${plural(calls.length, 'call')}${g.status === 'aborted' ? ', stopped' : ''}`);
    } catch (e) { console.warn(`! ${id} not copied: ${e.message}`); }
  }
  console.log(`${plural(done, 'game')} copied; the store holds ${plural(store.ids().length, 'game')}`);
  return done < todo.length ? 1 : 0;
}

// ---------- --probe: does every seat answer? ----------
// One real decision for every model in the pool, asked as a game asks it (the rules, the board, the table, a square
// to buy), all at once: the reply, how long it took, what it cost and whether the engine takes it, so a seat that
// would forfeit its decisions shows before a batch rather than in the statistics after it.
const FORFEIT_WHY = { empty: 'an empty reply, {}', unparseable: 'a reply that is not the JSON asked for', none: 'no reply' };
async function probe() {
  const models = pool.filter((p) => PROVIDERS[p.provider].kind !== 'none');
  if (!models.length) die('no model in the pool to check: every seat is the rule-based bot');
  console.log(`asking each of the ${models.length} models in the pool one decision, as a game would…`);
  let bad = 0;
  await Promise.all(models.map(async (p) => {
    const label = `${p.name} (${PROVIDERS[p.provider].label}, ${p.model}${p.effort ? ` at ${p.effort}` : ''})`;
    if (!keys[p.provider]) { bad++; console.log(`✗ ${label}: no key (${PROVIDERS[p.provider].env}), so it is left out of the pool`); return; }
    const decider = new AIDecider({ [p.id]: p }, {
      keys, baseUrls, universal: cfg.universal || '', maxTokens: cfg.maxTokens || 4000, timeoutMs: (cfg.timeoutSeconds || 600) * 1000, concurrency: cfg.apiConcurrency || 8, logPrompts: false,
    });
    const game = new Game({ id: `probe-${p.id}`, seed: 7, config: { ...gameConfig, shuffleOrder: false }, players: [{ ...p }, { id: 'bot', name: 'Bot', provider: 'heuristic' }], decider });
    const me = game.players[0];
    const sq = game.board.find((s) => s.type === 'street' && s.price >= 100);
    me.pos = sq.i;
    const r = await game.decide(me, 'buy', { property: { i: sq.i, name: sq.name, type: sq.type, group: sq.group, price: sq.price }, cash: me.cash, canAfford: true });
    const rec = game.llmCalls[0] || {};
    const forfeit = game.events.find((e) => e.type === 'forfeit');
    const spent = Number.isFinite(rec.cost) ? `, ${usd(rec.cost)}` : '';
    const tokens = rec.usage ? `, ${rec.usage.input} in / ${rec.usage.output} out tokens` : '';
    if (r.__source === 'ai') {
      console.log(`✓ ${label}: ${r.buy ? 'buys' : 'passes on'} ${sq.name} in ${secs(rec.latencyMs || 0)}${spent}${tokens}${r.reason ? `: "${String(r.reason).slice(0, 140)}"` : ''}`);
      return;
    }
    bad++;
    const why = !forfeit ? 'no reply' : forfeit.kind === 'invalid' ? `a reply the engine refused (${forfeit.reason})` : FORFEIT_WHY[forfeit.kind] || forfeit.reason;
    console.log(`✗ ${label}: ${why}, after ${secs(rec.latencyMs || 0)}${spent}; this seat would forfeit its decisions`);
    if (rec.response != null) console.log(`    reply: ${JSON.stringify(String(rec.response).slice(0, 300))}`);
  }));
  console.log(bad ? `${bad} of ${models.length} seats would not play; see above` : `all ${models.length} seats answered`);
  return bad;
}

// ---------- the table ----------
const gameConfig = { ...(cfg.config || {}) };
if (args.edition) gameConfig.edition = args.edition;
if (args['max-rounds']) gameConfig.maxRounds = Number(args['max-rounds']);
if (args.delay) gameConfig.turnDelayMs = Number(args.delay);

if (args.probe) process.exit(await probe() ? 1 : 0);
if (args.store) { report(); process.exit(0); }
if (args['import-site']) process.exit(await importSite());
if (args.publish || args.republish) process.exit(await publishAll(!!args.republish));

// A model plays on its own key or not at all: there is no bot to stand in for it, so a model whose key is missing
// is left out of the pool. The rule-based bot plays only where the table seats it by name.
const keyless = pool.filter((p) => PROVIDERS[p.provider].kind !== 'none' && !keys[p.provider]);
for (const provider of new Set(keyless.map((p) => p.provider))) {
  const names = keyless.filter((p) => p.provider === provider).map((p) => p.name);
  console.warn(`! no key for ${PROVIDERS[provider].label} (${PROVIDERS[provider].env}): ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} left out of the pool`);
}
const players = pool.filter((p) => !keyless.includes(p));
if (players.length < 2) die(`the pool needs at least two players with their keys; ${players.length ? `only ${players[0].name} has one` : 'none has one'}`);
// a game seats `seats` of the pool, drawn at random, never the same model twice; the standard board takes eight at most
let seats = Math.max(2, Number(args.seats || cfg.seats || 8));
if ((gameConfig.edition || 'standard') === 'standard' && seats > 8) { console.warn(`! the standard board seats eight at most; ${seats} asked, 8 seated`); seats = 8; }
const distinct = new Set(players.map(modelKey)).size;
if (distinct < players.length) console.warn('! the pool lists the same model more than once; it will be seated once a game');
seats = Math.min(seats, distinct);

// ---------- playing ----------
let runner = null;
const live = new Map(); // the games in play, by id
let stopping = false, finishing = false, wake = () => {};
// The games still in play when the simulator must go at once: one already over is kept with its result, the rest as
// stopped.
function endNow() { for (const [id, game] of live) { if (game.payload) store.finish(id, game.payload); else store.abort(id, 'stopped by the owner'); } }
function stop() {
  if (stopping) { endNow(); console.log('stopped at once; the games in play are kept in the store as stopped'); process.exit(1); }
  stopping = true;
  console.log(`\nstopping: ${live.size ? 'the games in play end after the current turn and are kept in the store as stopped; then ' : ''}what the site has not got is sent (again to stop at once)`);
  if (runner) runner.stop();
  narratorStop.abort(new Error('stopped by the owner'));
  wake();
  setTimeout(() => { endNow(); console.log('stopped; what the site has not got goes with the next run'); process.exit(1); }, 50000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  process.on('SIGUSR2', () => {
    if (finishing || stopping) return;
    finishing = true;
    console.log(`finishing: ${live.size ? `the ${plural(live.size, 'game')} in play ${live.size === 1 ? 'is' : 'are'} played to the end, and ` : ''}no new game starts`);
    if (runner) runner.finishUp();
    wake();
  });
} catch { /* a system without the signal */ }

async function runBatch(batchNo) {
  const batchId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).slice(-4)}${batchNo ? '-' + batchNo : ''}`;
  const setup = {
    batchId, players, seats, universal: cfg.universal || '', config: gameConfig,
    games: Number(args.games || cfg.games || 1), concurrency: Number(args.concurrency || cfg.concurrency || 1),
    seed: args.seed != null ? Number(args.seed) : cfg.seed ?? '', keys, baseUrls,
    maxTokens: cfg.maxTokens || 4000, timeoutMs: (cfg.timeoutSeconds || 600) * 1000, apiConcurrency: cfg.apiConcurrency || 8, logPrompts: true,
  };
  const tally = { calls: 0, failed: 0, forfeits: 0, inTok: 0, outTok: 0, cost: 0 };
  runner = new Runner(setup, {
    onGameStart(game) {
      store.start(game.id, { ...registration(game, setup), site: dry ? null : site || null }); // the site it goes to, and no other
      live.set(game.id, game);
      console.log(`▶ ${game.id}: ${game.players.map((p) => p.name).join(', ')} (${game.edition}, seed ${game.seed})`);
      publisher.soon(game.id, 0);
    },
    onEvent(ev, game) {
      store.event(game.id, ev);
      publisher.soon(game.id);
      if (ev.type === 'turn_start' && ev.turn % 20 === 0) console.log(`  ${game.id} round ${ev.round}, turn ${ev.turn}, ${tally.calls} calls`);
      if (ev.type === 'bankrupt') console.log(`  ${game.id} r${ev.round}: ${game.player(ev.player).name} is bankrupt`);
      if (ev.type === 'forfeit') { tally.forfeits++; console.log(`  ${game.id} r${ev.round}: ${game.player(ev.player).name} forfeits ${String(ev.decision).replace(/_/g, ' ')} (${ev.reason.slice(0, 140)})`); }
    },
    onLlm(rec, game) {
      tally.calls++; if (rec.fallback) tally.failed++;
      if (rec.usage) { tally.inTok += rec.usage.input || 0; tally.outTok += rec.usage.output || 0; }
      if (Number.isFinite(rec.cost)) tally.cost += rec.cost;
      store.call(game.id, rec);
      publisher.soon(game.id);
    },
    async onGameEnd(game, result) {
      if (result.endReason === 'stopped' || result.endReason === 'error') {
        const why = result.endReason === 'stopped' ? 'stopped by the owner' : `the engine failed: ${String(result.error).split('\n')[0]}`;
        store.abort(game.id, why);
        console.log(`□ ${game.id}: ${why}, in round ${game.round}; kept in the store as stopped`);
      } else {
        const payload = finishPayload(game, result);
        game.payload = payload; // kept as it is, without the report, should the simulator have to go before the narrator answers
        console.log(`■ ${game.id}: ${result.winnerName} wins after ${result.rounds} rounds (${result.endReason}); ${game.llmCalls.length} calls, ${plural(payload.summary.forfeits, 'forfeit')}, ${usd(payload.summary.cost.players)}${payload.summary.answerTime.answers ? `, ${secs(payload.summary.answerTime.avgMs)} an answer` : ''}`);
        const recap = await writeRecap(game);
        payload.recap = recap ? recap.text : null;
        if (recap) {
          payload.summary.narrator = { provider: recap.provider, model: recap.model, cost: Number.isFinite(recap.cost) ? recap.cost : null, costSource: recap.costSource };
          if (Number.isFinite(recap.cost)) { payload.summary.cost.narrator = recap.cost; payload.summary.cost.total = Math.round((payload.summary.cost.players + recap.cost) * 1e8) / 1e8; tally.cost += recap.cost; }
        }
        store.finish(game.id, payload);
      }
      live.delete(game.id);
      store.compact(game.id);
      publisher.soon(game.id, 0);
    },
    onDone(summary) {
      console.log(`batch ${batchId}: ${plural(summary.games, 'game')} in ${(summary.durationMs / 1000).toFixed(0)}s, ${tally.calls} calls (${tally.failed} unusable), ${plural(tally.forfeits, 'forfeit')}, ${tally.inTok.toLocaleString()} in / ${tally.outTok.toLocaleString()} out tokens, ${usd(tally.cost)}`);
    },
  });
  await runner.run();
  runner = null;
}

(async () => {
  console.log(`Monopoly AI simulator ${VERSION} · ${dry ? 'dry run: the games stay in the store' : site || 'no site'} · a pool of ${players.length} models, ${seats} seats a game · config ${show(configPath)} · store ${show(store.root)}`);
  sweep(true);
  await checkSite();
  // a heartbeat for every game in play, so that a later runner can tell a game in play from one whose runner died
  setInterval(() => { for (const id of live.keys()) store.beat(id); }, 30000).unref();
  setInterval(() => sweep(true), 120000).unref();
  for (let batchNo = 0; !stopping && !finishing; batchNo++) {
    await runBatch(batchNo);
    if (!args.loop || stopping || finishing) break;
    const pause = Number(cfg.pauseBetweenGamesMs ?? 60000);
    console.log(`next batch in ${Math.round(pause / 1000)}s`);
    await new Promise((r) => { wake = r; setTimeout(r, pause); });
    if (stopping || finishing) break;
    await checkSite();
  }
  // the end: what the site has not got, a few tries (one when stopping)
  const ids = publisher.on ? publisher.behind().map((g) => g.id) : [];
  if (ids.length) {
    console.log(`sending the site what it has not got of ${plural(ids.length, 'game')}…`);
    const left = await publisher.drain(ids, { tries: stopping ? 1 : 3 });
    if (left.length) console.log(`${plural(left.length, 'game')} ${left.length === 1 ? 'is' : 'are'} kept in the store and go${left.length === 1 ? 'es' : ''} to the site with the next run, or with --publish`);
  }
  // Told to finish, in the container: stay up, playing nothing, so that the container is not started again into a
  // new game before it is updated or stopped.
  if (finishing && !stopping && args.hold) {
    console.log('the games are over and no new one starts; holding until the simulator is stopped or restarted');
    await new Promise((r) => { const keep = setInterval(() => {}, 3600000); wake = () => { clearInterval(keep); r(); }; });
  }
  process.exit(0);
})().catch((e) => { console.error(e); endNow(); process.exit(1); });

// ---------- small helpers ----------
function die(msg) { console.error(`runner: ${msg}`); process.exit(1); }
// Fills the environment from a .env file without overriding it; returns the names it set.
function loadDotEnv(file) {
  const set = [];
  if (!existsSync(file)) return set;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] == null) { process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'); set.push(m[1]); }
  }
  return set;
}
