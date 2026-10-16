// The site's Worker: serves the viewer from public/, keeps the match history
// in D1, takes the runner's uploads (bearer token), and answers the viewer's
// reads. The deploy creates and binds the database (wrangler.jsonc) and the
// Worker lays out its own tables the first time it reaches it (ensureSchema);
// without a database bound every data route answers 503 and the viewer says so.
import { ReplayGame } from '../public/assets/app/replay.js';
import { transcript } from '../public/assets/app/transcript.js';
import { callModel } from '../public/assets/app/providers.js';
import { aggregateMonopoly, aggregateModels } from './aggregate.js';
import schema0001 from '../migrations/0001_init.sql';
import schema0002 from '../migrations/0002_cost.sql';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, authorization' };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers } });
const fail = (message, status = 400) => json({ error: message }, status);
const now = () => new Date().toISOString();
const parse = (s, d = null) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };
const clampInt = (v, lo, hi, d) => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : d; };
const modelKey = (p) => `${p.provider || 'heuristic'}/${p.model || ''}${p.effort ? '@' + p.effort : ''}`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(request, env, ctx, url);
    } catch (e) {
      console.error(e);
      return fail(`server error: ${e.message}`, 500);
    }
  },
};

async function route(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;
  if (path === '/api/health') return json({ ok: true, db: !!env.DB, token: !!env.RUNNER_TOKEN, narrator: !!env.NARRATOR_API_KEY, time: now() });
  if (!env.DB) return json({ error: 'no database bound', help: 'The deploy binds the database named in wrangler.jsonc (see README, "Setting up the site").' }, 503);
  await ensureSchema(env.DB);
  let r;
  if (m === 'GET') {
    if (path === '/api/live') return live(env);
    if (path === '/api/games') return listGames(env, url);
    if (path === '/api/stats/monopoly') return cached(request, ctx, 60, () => statsMonopoly(env));
    if (path === '/api/stats/models') return cached(request, ctx, 60, () => statsModels(env));
    if ((r = path.match(/^\/api\/games\/([^/]+)$/))) return getGame(env, r[1]);
    if ((r = path.match(/^\/api\/games\/([^/]+)\/events$/))) return getEvents(request, ctx, env, r[1], url);
    if ((r = path.match(/^\/api\/games\/([^/]+)\/calls$/))) return getCalls(request, ctx, env, r[1], url);
    if ((r = path.match(/^\/api\/games\/([^/]+)\/transcript$/))) return getTranscript(request, ctx, env, r[1], url);
    if ((r = path.match(/^\/api\/games\/([^/]+)\/export$/))) return getExport(env, r[1], url);
  }
  if (m === 'POST') {
    if ((r = path.match(/^\/api\/games\/([^/]+)\/ask$/))) return ask(request, env, r[1]);
    if (path.startsWith('/api/ingest/')) {
      if (!authorised(request, env)) return fail('unauthorised', 401);
      const body = await request.json().catch(() => null);
      if (!body) return fail('invalid JSON');
      if (path === '/api/ingest/games') return ingestGame(env, body);
      if ((r = path.match(/^\/api\/ingest\/games\/([^/]+)\/events$/))) return ingestEvents(env, r[1], body);
      if ((r = path.match(/^\/api\/ingest\/games\/([^/]+)\/calls$/))) return ingestCalls(env, r[1], body);
      if ((r = path.match(/^\/api\/ingest\/games\/([^/]+)\/finish$/))) return ingestFinish(env, r[1], body);
      if ((r = path.match(/^\/api\/ingest\/games\/([^/]+)\/abort$/))) return ingestAbort(env, r[1], body);
    }
  }
  if (m === 'DELETE' && (r = path.match(/^\/api\/ingest\/games\/([^/]+)$/))) {
    if (!authorised(request, env)) return fail('unauthorised', 401);
    return deleteGame(env, r[1]);
  }
  return fail('not found', 404);
}

// ---------- the schema ----------
// The Worker applies the migrations itself, the first time an isolate reaches the database: every file in
// MIGRATIONS not yet recorded in d1_migrations, the table wrangler's `d1 migrations apply` keeps, in its shape
// and under the file's name, so either can run them and each sees what the other has done. A migration runs as
// one batch with its record, so it lands whole or not at all; when two isolates race on the same one, the
// loser's batch rolls back and it finds the record written. A new file in migrations/ is added here too.
const MIGRATIONS = [['0001_init.sql', schema0001], ['0002_cost.sql', schema0002]];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
  const { results } = await db.prepare('SELECT name FROM d1_migrations').all();
  const done = new Set(results.map((r) => r.name));
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    const statements = sql.replace(/--[^\n]*/g, '').split(';').map((x) => x.trim()).filter(Boolean);
    try {
      await db.batch([...statements.map((x) => db.prepare(x)), db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name)]);
    } catch (e) {
      if (!(await db.prepare('SELECT 1 AS x FROM d1_migrations WHERE name = ?').bind(name).first())) throw e;
    }
  }
  schemaReady = true;
}

// ---------- helpers ----------
function authorised(request, env) {
  if (!env.RUNNER_TOKEN) return false;
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const want = env.RUNNER_TOKEN;
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// Edge-cache a GET response for `ttl` seconds.
async function cached(request, ctx, ttl, make) {
  const cache = caches.default;
  const key = new Request(request.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await make();
  if (res.status === 200) {
    const copy = new Response(res.body, res);
    copy.headers.set('cache-control', `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(key, copy.clone()));
    return copy;
  }
  return res;
}

function gameRow(g) {
  if (!g) return null;
  return {
    id: g.id, batchId: g.batch_id, status: g.status, edition: g.edition, seed: g.seed, config: parse(g.config, {}), universal: g.universal || '',
    startedAt: g.started_at, finishedAt: g.finished_at, updatedAt: g.updated_at, rounds: g.rounds, turns: g.turns, lastSeq: g.last_seq,
    eventCount: g.event_count, callCount: g.call_count, winnerId: g.winner_id, winnerName: g.winner_name, endReason: g.end_reason, durationMs: g.duration_ms,
    result: parse(g.result), summary: parse(g.summary), recap: g.recap || null, runner: parse(g.runner),
  };
}
function playerRow(p) {
  return {
    id: p.player_id, seat: p.seat, name: p.name, provider: p.provider, model: p.model, effort: p.effort || null, modelKey: p.model_key, colour: p.colour,
    ...(parse(p.extra, {}) || {}), rank: p.rank, finalCash: p.final_cash, finalNetWorth: p.final_net_worth, bankrupt: !!p.bankrupt, bankruptRound: p.bankrupt_round, stats: parse(p.stats),
  };
}
async function playersFor(env, ids) {
  if (!ids.length) return {};
  const out = {};
  for (let k = 0; k < ids.length; k += 50) {
    const chunk = ids.slice(k, k + 50);
    const { results } = await env.DB.prepare(`SELECT * FROM game_players WHERE game_id IN (${chunk.map(() => '?').join(',')}) ORDER BY game_id, seat`).bind(...chunk).all();
    for (const p of results) (out[p.game_id] = out[p.game_id] || []).push(playerRow(p));
  }
  return out;
}
async function loadGame(env, id) {
  const g = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(id).first();
  if (!g) return null;
  const game = gameRow(g);
  game.players = (await playersFor(env, [id]))[id] || [];
  return game;
}
async function allEvents(env, id) {
  const out = [];
  let after = 0;
  for (;;) {
    const { results } = await env.DB.prepare('SELECT seq, data FROM events WHERE game_id = ? AND seq > ? ORDER BY seq LIMIT 2000').bind(id, after).all();
    for (const r of results) out.push(parse(r.data));
    if (results.length < 2000) break;
    after = results[results.length - 1].seq;
  }
  return out;
}
function replayOf(game, events) {
  const g = new ReplayGame({ id: game.id, edition: game.edition, config: game.config, seed: game.seed, startedAt: game.startedAt, players: game.players });
  g.applyAll(events);
  if (game.status === 'finished' && !g.result && game.result) g.result = game.result;
  return g;
}

// ---------- public reads ----------
async function live(env) {
  const { results } = await env.DB.prepare("SELECT * FROM games WHERE status = 'running' ORDER BY started_at DESC LIMIT 8").all();
  const latest = await env.DB.prepare("SELECT * FROM games WHERE status = 'finished' ORDER BY started_at DESC LIMIT 1").first();
  const ids = results.map((g) => g.id).concat(latest ? [latest.id] : []);
  const players = await playersFor(env, ids);
  const running = results.map((g) => ({ ...gameRow(g), players: players[g.id] || [] }));
  return json({ running, latest: latest ? { ...gameRow(latest), players: players[latest.id] || [] } : null, time: now() }, 200, { 'cache-control': 'no-store' });
}
async function listGames(env, url) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 200, 50);
  const offset = clampInt(url.searchParams.get('offset'), 0, 1e9, 0);
  const status = url.searchParams.get('status');
  const where = status ? 'WHERE status = ?' : '';
  const args = status ? [status] : [];
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM games ${where}`).bind(...args).first();
  const { results } = await env.DB.prepare(`SELECT * FROM games ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`).bind(...args, limit, offset).all();
  const players = await playersFor(env, results.map((g) => g.id));
  // What each game cost: a finished game's total from its summary, a running one's calls so far.
  const running = results.filter((g) => g.status === 'running').map((g) => g.id);
  const sofar = {};
  if (running.length) {
    const { results: sums } = await env.DB.prepare(`SELECT game_id, SUM(cost) AS cost FROM llm_calls WHERE game_id IN (${running.map(() => '?').join(',')}) GROUP BY game_id`).bind(...running).all();
    for (const r of sums) sofar[r.game_id] = r.cost;
  }
  const games = results.map((g) => {
    const row = gameRow(g);
    const sc = row.summary && row.summary.cost;
    const cost = g.status === 'running' ? sofar[g.id] ?? null : sc ? sc.total : null;
    delete row.summary; delete row.recap; delete row.config;
    return { ...row, cost: cost == null ? null : Math.round(cost * 1e8) / 1e8, costUnpriced: (sc && sc.unpriced) || 0, players: players[g.id] || [] };
  });
  return json({ games, total: total ? total.n : games.length, limit, offset }, 200, { 'cache-control': 'public, max-age=10' });
}
async function getGame(env, id) {
  const game = await loadGame(env, id);
  if (!game) return fail('no such game', 404);
  return json(game, 200, { 'cache-control': game.status === 'running' ? 'no-store' : 'public, max-age=60' });
}
async function getEvents(request, ctx, env, id, url) {
  const after = clampInt(url.searchParams.get('after'), 0, 1e12, 0);
  const limit = clampInt(url.searchParams.get('limit'), 1, 2000, 1000);
  const make = async () => {
    const { results } = await env.DB.prepare('SELECT data FROM events WHERE game_id = ? AND seq > ? ORDER BY seq LIMIT ?').bind(id, after, limit).all();
    const events = results.map((r) => parse(r.data));
    return json({ events, nextAfter: events.length ? events[events.length - 1].seq : after, done: events.length < limit }, 200, { 'cache-control': 'no-store' });
  };
  const g = await env.DB.prepare('SELECT status FROM games WHERE id = ?').bind(id).first();
  if (!g) return fail('no such game', 404);
  return g.status === 'running' ? make() : cached(request, ctx, 3600, make);
}
function callRow(c, full) {
  const out = {
    seq: c.seq, round: c.round, turn: c.turn, player: c.player, decision: c.decision, provider: c.provider, model: c.model, effort: c.effort, servedModel: c.served_model,
    latencyMs: c.latency_ms, usage: { input: c.input_tokens, output: c.output_tokens, cached: c.cached_tokens, reasoning: c.reasoning_tokens },
    cost: c.cost ?? null, costSource: c.cost_source || null,
    error: c.error, fallback: !!c.fallback, stopReason: c.stop_reason, parsed: parse(c.parsed),
  };
  if (full) { out.response = c.response; out.prompt = c.prompt; out.system = parse(c.system); }
  return out;
}
async function getCalls(request, ctx, env, id, url) {
  const after = clampInt(url.searchParams.get('after'), 0, 1e12, 0);
  const limit = clampInt(url.searchParams.get('limit'), 1, 1000, 500);
  const full = url.searchParams.get('full') === '1';
  const make = async () => {
    const { results } = await env.DB.prepare('SELECT * FROM llm_calls WHERE game_id = ? AND seq > ? ORDER BY seq LIMIT ?').bind(id, after, limit).all();
    const calls = results.map((c) => callRow(c, full));
    return json({ calls, nextAfter: calls.length ? calls[calls.length - 1].seq : after, done: calls.length < limit }, 200, { 'cache-control': 'no-store' });
  };
  const g = await env.DB.prepare('SELECT status FROM games WHERE id = ?').bind(id).first();
  if (!g) return fail('no such game', 404);
  return g.status === 'running' ? make() : cached(request, ctx, 3600, make);
}
async function getTranscript(request, ctx, env, id, url) {
  const make = async () => {
    const game = await loadGame(env, id);
    if (!game) return fail('no such game', 404);
    const events = await allEvents(env, id);
    const text = transcript(replayOf(game, events), { compact: url.searchParams.get('compact') === '1' });
    return new Response(text, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `inline; filename="monopoly-${id}.txt"`, 'cache-control': game.status === 'running' ? 'no-store' : 'public, max-age=3600', ...CORS } });
  };
  const g = await env.DB.prepare('SELECT status FROM games WHERE id = ?').bind(id).first();
  if (!g) return fail('no such game', 404);
  return g.status === 'running' ? make() : cached(request, ctx, 3600, make);
}
async function getExport(env, id, url) {
  const game = await loadGame(env, id);
  if (!game) return fail('no such game', 404);
  const events = await allEvents(env, id);
  const full = url.searchParams.get('full') === '1';
  const calls = [];
  let after = 0;
  for (;;) {
    const { results } = await env.DB.prepare('SELECT * FROM llm_calls WHERE game_id = ? AND seq > ? ORDER BY seq LIMIT 1000').bind(id, after).all();
    for (const c of results) calls.push(callRow(c, full));
    if (results.length < 1000) break;
    after = results[results.length - 1].seq;
  }
  return json({ version: 2, exportedAt: now(), game, events, calls }, 200, { 'content-disposition': `attachment; filename="monopoly-${id}.json"`, 'cache-control': 'no-store' });
}
async function statsMonopoly(env) {
  const { results } = await env.DB.prepare("SELECT id, edition, rounds, turns, duration_ms, end_reason, summary, started_at FROM games WHERE status = 'finished' ORDER BY started_at DESC LIMIT 5000").all();
  const running = await env.DB.prepare("SELECT COUNT(*) AS n FROM games WHERE status = 'running'").first();
  return json({ ...aggregateMonopoly(results), running: running ? running.n : 0, time: now() });
}
async function statsModels(env) {
  const { results } = await env.DB.prepare("SELECT gp.* FROM game_players gp JOIN games g ON g.id = gp.game_id WHERE g.status = 'finished'").all();
  return json({ ...aggregateModels(results), time: now() });
}

// ---------- the narrator (optional) ----------
async function ask(request, env, id) {
  if (!env.NARRATOR_API_KEY) return json({ enabled: false, error: 'the narrator is not switched on' }, 404);
  const body = await request.json().catch(() => null);
  const question = body && typeof body.question === 'string' ? body.question.trim().slice(0, 1000) : '';
  if (!question) return fail('ask a question');
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `${ip}:${new Date().toISOString().slice(0, 13)}`;
  const limit = clampInt(env.ASK_LIMIT, 1, 1000, 20);
  const row = await env.DB.prepare('INSERT INTO asks (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n').bind(key).first();
  if (row && row.n > limit) return json({ error: `that is ${limit} questions this hour; try again later` }, 429);
  const game = await loadGame(env, id);
  if (!game) return fail('no such game', 404);
  const events = await allEvents(env, id);
  const text = transcript(replayOf(game, events), { compact: true, maxChars: clampInt(env.ASK_MAX_CHARS, 10000, 400000, 120000) });
  const system = [{ text: 'You are the commentator for a Monopoly game played entirely by AI models. You are given the game as a transcript. Answer the question from the transcript alone, plainly and specifically, naming players, squares and sums; say when the transcript does not show something. British English. Keep it under 250 words unless the question needs more.', cache: true }];
  const user = `TRANSCRIPT\n${text}\n\nQUESTION\n${question}`;
  const out = await callModel({
    provider: env.NARRATOR_PROVIDER || 'anthropic', model: env.NARRATOR_MODEL || 'claude-sonnet-5-5', effort: env.NARRATOR_EFFORT || 'low',
    apiKey: env.NARRATOR_API_KEY, baseUrl: env.NARRATOR_BASE || undefined, system, user, maxTokens: 1200, timeoutMs: 90000, plain: true, concurrency: 4,
  });
  return json({ answer: out.text, model: out.servedModel || env.NARRATOR_MODEL || null, usage: out.usage }, 200, { 'cache-control': 'no-store' });
}

// ---------- the runner's uploads ----------
async function ingestGame(env, b) {
  if (!b.id || !Array.isArray(b.players)) return fail('id and players required');
  const t = now();
  const stmts = [
    env.DB.prepare(`INSERT INTO games (id, batch_id, status, edition, seed, config, universal, started_at, updated_at, runner)
      VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET batch_id = excluded.batch_id, edition = excluded.edition, seed = excluded.seed, config = excluded.config, universal = excluded.universal, updated_at = excluded.updated_at, runner = excluded.runner`)
      .bind(b.id, b.batchId || null, b.edition === 'mega' ? 'mega' : 'standard', b.seed ?? null, JSON.stringify(b.config || {}), b.universal || '', b.startedAt || t, t, b.runner ? JSON.stringify(b.runner) : null),
  ];
  b.players.forEach((p, seat) => {
    stmts.push(env.DB.prepare(`INSERT INTO game_players (game_id, player_id, seat, name, provider, model, effort, model_key, colour, extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, player_id) DO UPDATE SET seat = excluded.seat, name = excluded.name, provider = excluded.provider, model = excluded.model, effort = excluded.effort, model_key = excluded.model_key, colour = excluded.colour, extra = excluded.extra`)
      .bind(b.id, p.id, p.seat ?? seat, p.name || p.id, p.provider || 'heuristic', p.model || null, p.effort || null, modelKey(p), p.colour || null, JSON.stringify({ temperature: p.temperature ?? null, instructions: p.instructions || '', baseUrl: p.baseUrl || null })));
  });
  await env.DB.batch(stmts);
  return json({ ok: true, id: b.id });
}
async function ingestEvents(env, id, b) {
  const events = Array.isArray(b.events) ? b.events : [];
  if (!events.length) return json({ ok: true, inserted: 0 });
  const g = await env.DB.prepare('SELECT id FROM games WHERE id = ?').bind(id).first();
  if (!g) return fail('no such game', 404);
  let maxSeq = 0, maxRound = 0, maxTurn = 0;
  for (let k = 0; k < events.length; k += 80) {
    const stmts = events.slice(k, k + 80).map((e) => {
      maxSeq = Math.max(maxSeq, e.seq || 0); maxRound = Math.max(maxRound, e.round || 0); maxTurn = Math.max(maxTurn, e.turn || 0);
      return env.DB.prepare('INSERT OR IGNORE INTO events (game_id, seq, round, turn, t, type, player, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, e.seq, e.round || 0, e.turn || 0, e.t ?? null, e.type || 'unknown', e.player || e.from || null, JSON.stringify(e));
    });
    await env.DB.batch(stmts);
  }
  await env.DB.prepare('UPDATE games SET rounds = MAX(rounds, ?), turns = MAX(turns, ?), last_seq = MAX(last_seq, ?), updated_at = ? WHERE id = ?').bind(maxRound, maxTurn, maxSeq, now(), id).run();
  return json({ ok: true, inserted: events.length, lastSeq: maxSeq });
}
async function ingestCalls(env, id, b) {
  const calls = Array.isArray(b.calls) ? b.calls : [];
  if (!calls.length) return json({ ok: true, inserted: 0 });
  const g = await env.DB.prepare('SELECT id FROM games WHERE id = ?').bind(id).first();
  if (!g) return fail('no such game', 404);
  for (let k = 0; k < calls.length; k += 40) {
    const stmts = calls.slice(k, k + 40).map((c) => {
      const u = c.usage || {};
      const cost = Number.isFinite(c.cost) ? c.cost : null;
      return env.DB.prepare(`INSERT OR IGNORE INTO llm_calls (game_id, seq, round, turn, player, decision, provider, model, effort, served_model, latency_ms, input_tokens, output_tokens, cached_tokens, reasoning_tokens, error, fallback, stop_reason, parsed, response, prompt, system, cost, cost_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, c.seq, c.round ?? null, c.turn ?? null, c.player, c.decision || '', c.provider || null, c.model || null, c.effort || null, c.servedModel || null,
          c.latencyMs ?? null, u.input ?? null, u.output ?? null, u.cached ?? null, u.reasoning ?? null, c.error || null, c.fallback ? 1 : 0, c.stopReason || null,
          c.parsed != null ? JSON.stringify(c.parsed) : null, c.response != null ? String(c.response).slice(0, 20000) : null, c.user != null ? String(c.user) : null, c.system != null ? JSON.stringify(c.system) : null,
          cost, cost == null ? null : (c.costSource === 'reported' ? 'reported' : 'priced'));
    });
    await env.DB.batch(stmts);
  }
  await env.DB.prepare('UPDATE games SET updated_at = ? WHERE id = ?').bind(now(), id).run();
  return json({ ok: true, inserted: calls.length });
}
async function ingestFinish(env, id, b) {
  const g = await env.DB.prepare('SELECT id FROM games WHERE id = ?').bind(id).first();
  if (!g) return fail('no such game', 404);
  const res = b.result || {};
  const t = now();
  const counts = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM events WHERE game_id = ?) AS e, (SELECT COUNT(*) FROM llm_calls WHERE game_id = ?) AS c, (SELECT MAX(seq) FROM events WHERE game_id = ?) AS s').bind(id, id, id).first();
  const stmts = [
    env.DB.prepare(`UPDATE games SET status = 'finished', finished_at = ?, updated_at = ?, rounds = ?, turns = ?, winner_id = ?, winner_name = ?, end_reason = ?, duration_ms = ?, result = ?, summary = ?, recap = ?, event_count = ?, call_count = ?, last_seq = MAX(last_seq, ?) WHERE id = ?`)
      .bind(b.finishedAt || t, t, res.rounds ?? 0, res.turns ?? 0, res.winnerId || null, res.winnerName || null, res.endReason || null, res.durationMs ?? b.durationMs ?? null, JSON.stringify(res), b.summary ? JSON.stringify(b.summary) : null, b.recap || null, counts.e || 0, counts.c || 0, counts.s || 0, id),
  ];
  for (const p of b.players || []) {
    stmts.push(env.DB.prepare('UPDATE game_players SET rank = ?, final_cash = ?, final_net_worth = ?, bankrupt = ?, bankrupt_round = ?, stats = ? WHERE game_id = ? AND player_id = ?')
      .bind(p.rank ?? null, p.finalCash ?? null, p.finalNetWorth ?? null, p.bankrupt ? 1 : 0, p.bankruptRound ?? null, p.stats ? JSON.stringify(p.stats) : null, id, p.id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, id, events: counts.e, calls: counts.c });
}
async function ingestAbort(env, id, b) {
  const t = now();
  await env.DB.prepare("UPDATE games SET status = 'aborted', finished_at = ?, updated_at = ?, end_reason = ? WHERE id = ? AND status = 'running'").bind(t, t, (b && b.reason) || 'aborted', id).run();
  return json({ ok: true, id });
}
async function deleteGame(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM llm_calls WHERE game_id = ?').bind(id),
    env.DB.prepare('DELETE FROM events WHERE game_id = ?').bind(id),
    env.DB.prepare('DELETE FROM game_players WHERE game_id = ?').bind(id),
    env.DB.prepare('DELETE FROM games WHERE id = ?').bind(id),
  ]);
  return json({ ok: true, id });
}
