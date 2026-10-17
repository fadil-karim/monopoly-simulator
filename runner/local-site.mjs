// The site's own pages and public reads, served by the dashboard from the simulator's store: the homepage of games
// (at /home/), the Monopoly viewer (/monopoly/) with the live table, every game, the replays and both statistics
// pages. They are the very files the web version serves, and the /api reads answer in the Worker's shapes
// (src/worker.js) from the games in this data folder, so a game played on this machine, the CPU table's included, is
// watched here as it would be on the site, with no site, database or network.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ReplayGame } from '../public/assets/app/replay.js';
import { transcript } from '../public/assets/app/transcript.js';
import { aggregateMonopoly, aggregateModels } from '../src/aggregate.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const modelKey = (p) => `${p.provider || 'heuristic'}/${p.model || ''}${p.effort ? '@' + p.effort : ''}`; // a seat's identity, as the Worker keys it
const clampInt = (v, lo, hi, d) => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : d; };
const now = () => new Date().toISOString();
const round8 = (x) => Math.round(x * 1e8) / 1e8;

// store: the GameStore; publicDir: the site's files; pool(): the players of the table in use, for the homepage.
export function localSite({ store, publicDir, pool = () => [] }) {
  const root = resolve(publicDir);
  const games = new Map(); // id -> game.json, which never changes
  const ended = new Map(); // id -> { finish, abort, counts } of a game that has ended
  const logs = new Map(); // id -> { events, calls }: each { cursor, items }, the latest few games' lines, read as they grow

  const gameOf = (id) => { if (!games.has(id)) games.set(id, store.game(id)); return games.get(id); };
  // finished, aborted or running; a game whose runner has stopped reads as stopped, as its next start will mark it
  const statusOf = (id) => { const s = store.status(id); return s === 'stalled' ? 'aborted' : s; };
  function endOf(id) {
    let e = ended.get(id);
    if (!e) {
      e = { finish: store.finished(id), abort: store.aborted(id), counts: null };
      if (ended.size > 4000) ended.delete(ended.keys().next().value);
      ended.set(id, e);
    }
    return e;
  }
  // A game's events or calls, every line so far: read once, then only what has been appended.
  function lines(id, kind) {
    let l = logs.get(id);
    if (l) logs.delete(id); // the most recently used last
    else l = { events: { cursor: { line: 0, offset: 0 }, items: [] }, calls: { cursor: { line: 0, offset: 0 }, items: [] } };
    logs.set(id, l);
    if (logs.size > 8) logs.delete(logs.keys().next().value);
    const c = l[kind];
    if (c.cursor.offset !== Infinity) { const got = store.read(id, kind, c.cursor); for (const x of got.items) if (x) c.items.push(x); c.cursor = got.cursor; }
    return c.items;
  }
  // An ended game's counts, as the Worker records them at its end, read from the gzipped lines without parsing them
  // all: how many events and calls, and the last event.
  function countsOf(id) {
    const e = endOf(id);
    if (e.counts) return e.counts;
    const count = (kind) => {
      const plain = store.file(id, `${kind}.jsonl`), gz = `${plain}.gz`;
      const buf = existsSync(plain) ? readFileSync(plain) : existsSync(gz) ? gunzipSync(readFileSync(gz)) : Buffer.alloc(0);
      let n = 0;
      for (let k = 0; k < buf.length; k++) if (buf[k] === 10) n++;
      const end = buf.lastIndexOf(10), start = buf.lastIndexOf(10, end - 1) + 1;
      let last = null;
      if (end > 0) { try { last = JSON.parse(buf.subarray(start, end).toString('utf8')); } catch { /* none */ } }
      return { n, last };
    };
    const ev = count('events'), ca = count('calls');
    e.counts = { events: ev.n, calls: ca.n, last: ev.last };
    return e.counts;
  }
  // A game as the Worker's gameRow gives it.
  function row(id) {
    const g = gameOf(id) || {}, status = statusOf(id);
    const e = status === 'running' ? { finish: null, abort: null } : endOf(id);
    const f = e.finish, a = e.abort, res = (f && f.result) || null;
    let last = null, eventCount = 0, callCount = 0;
    if (status === 'running') { const ev = lines(id, 'events'); last = ev[ev.length - 1] || null; }
    else { const c = countsOf(id); last = c.last; if (status === 'finished') { eventCount = c.events; callCount = c.calls; } }
    const finishedAt = f ? f.finishedAt || null : a ? a.at || null : null;
    return {
      id, batchId: g.batchId ?? null, status, edition: g.edition === 'mega' ? 'mega' : 'standard', seed: g.seed ?? null, config: g.config || {}, universal: g.universal || '',
      startedAt: g.startedAt || null, finishedAt, updatedAt: finishedAt || now(),
      rounds: res ? res.rounds ?? 0 : last ? last.round || 0 : 0, turns: res ? res.turns ?? 0 : last ? last.turn || 0 : 0, lastSeq: last ? last.seq || 0 : 0,
      eventCount, callCount, winnerId: res ? res.winnerId || null : null, winnerName: res ? res.winnerName || null : null,
      endReason: res ? res.endReason || null : a ? a.reason || 'aborted' : status === 'aborted' ? 'the simulator stopped before the game ended' : null,
      durationMs: res ? res.durationMs ?? f.durationMs ?? null : null, result: res, summary: f ? f.summary || null : null, recap: f ? f.recap || null : null, runner: g.runner || null,
    };
  }
  // A game's seats as the Worker's playerRow gives them, with each one's result once the game is over.
  function playersOf(id) {
    const g = gameOf(id) || {}, status = statusOf(id);
    const fp = new Map((((status === 'finished' && endOf(id).finish) || {}).players || []).map((p) => [p.id, p]));
    return (g.players || []).map((p, k) => {
      const f = fp.get(p.id) || {};
      return {
        id: p.id, seat: p.seat ?? k, name: p.name || p.id, provider: p.provider || 'heuristic', model: p.model || null, effort: p.effort || null, modelKey: modelKey(p), colour: p.colour || null,
        temperature: p.temperature ?? null, instructions: p.instructions || '', baseUrl: p.baseUrl || null,
        rank: f.rank ?? null, finalCash: f.finalCash ?? null, finalNetWorth: f.finalNetWorth ?? null, bankrupt: !!f.bankrupt, bankruptRound: f.bankruptRound ?? null, stats: f.stats ?? null,
      };
    }).sort((x, y) => x.seat - y.seat);
  }
  // A call as the Worker's callRow gives it; the prompts with `full`.
  function callRow(c, full) {
    const u = c.usage || {}, cost = Number.isFinite(c.cost) ? c.cost : null;
    const out = {
      seq: c.seq, round: c.round ?? null, turn: c.turn ?? null, player: c.player, decision: c.decision || '', provider: c.provider || null, model: c.model || null, effort: c.effort || null, servedModel: c.servedModel || null,
      latencyMs: c.latencyMs ?? null, usage: { input: u.input ?? null, output: u.output ?? null, cached: u.cached ?? null, reasoning: u.reasoning ?? null },
      cost, costSource: cost == null ? null : c.costSource === 'reported' ? 'reported' : 'priced',
      error: c.error || null, fallback: !!c.fallback, stopReason: c.stopReason || null, parsed: c.parsed ?? null,
    };
    if (full) { out.response = c.response != null ? String(c.response).slice(0, 20000) : null; out.prompt = c.user ?? null; out.system = c.system ?? null; }
    return out;
  }
  // Every game, newest first.
  const byStart = () => store.ids().map((id) => ({ id, startedAt: (gameOf(id) || {}).startedAt || '' })).sort((x, y) => (x.startedAt < y.startedAt ? 1 : x.startedAt > y.startedAt ? -1 : 0)).map((x) => x.id);
  // The seats of the games, as rows of the Worker's game_players for the model statistics.
  function seatRows(ids) {
    const out = [];
    for (const id of ids) for (const p of playersOf(id)) {
      out.push({ game_id: id, player_id: p.id, seat: p.seat, name: p.name, provider: p.provider, model: p.model, effort: p.effort, model_key: p.modelKey, colour: p.colour, rank: p.rank, final_cash: p.finalCash, final_net_worth: p.finalNetWorth, bankrupt: p.bankrupt ? 1 : 0, bankrupt_round: p.bankruptRound, stats: p.stats, status: statusOf(id) });
    }
    return out;
  }
  const replayOf = (id, events) => {
    const g = row(id), r = new ReplayGame({ id, edition: g.edition, config: g.config, seed: g.seed, startedAt: g.startedAt, players: playersOf(id) });
    r.applyAll(events);
    if (g.status === 'finished' && !r.result && g.result) r.result = g.result;
    return r;
  };

  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const known = (id) => existsSync(store.file(id, 'game.json'));

  function api(req, res, url) {
    const path = url.pathname.replace(/\/+$/, '');
    let r;
    if (req.method === 'POST' && /^\/api\/games\/[^/]+\/ask$/.test(path)) return send(res, 404, { enabled: false, error: 'the narrator is not switched on' });
    if (req.method !== 'GET') return false;
    if (path === '/api/health') return send(res, 200, { ok: true, db: true, token: true, narrator: false, local: true, time: now() });
    if (path === '/api/live') {
      const ids = byStart();
      const running = ids.filter((id) => statusOf(id) === 'running').slice(0, 8).map((id) => ({ ...row(id), players: playersOf(id) }));
      const latest = ids.find((id) => statusOf(id) === 'finished');
      return send(res, 200, { running, latest: latest ? { ...row(latest), players: playersOf(latest) } : null, time: now() });
    }
    if (path === '/api/games') {
      const limit = clampInt(url.searchParams.get('limit'), 1, 200, 50), offset = clampInt(url.searchParams.get('offset'), 0, 1e9, 0), want = url.searchParams.get('status');
      const ids = byStart().filter((id) => !want || statusOf(id) === want);
      const out = ids.slice(offset, offset + limit).map((id) => {
        const g = row(id), sc = g.summary && g.summary.cost;
        let cost = null;
        if (g.status === 'running') { for (const c of lines(id, 'calls')) if (Number.isFinite(c.cost)) cost = (cost || 0) + c.cost; } else if (sc) cost = sc.total;
        delete g.summary; delete g.recap; delete g.config;
        return { ...g, cost: cost == null ? null : round8(cost), costUnpriced: (sc && sc.unpriced) || 0, players: playersOf(id) };
      });
      return send(res, 200, { games: out, total: ids.length, limit, offset });
    }
    if (path === '/api/stats/monopoly') {
      const ids = byStart();
      // as the Worker's rows of finished games, from their ends alone
      const rows = ids.filter((id) => statusOf(id) === 'finished').slice(0, 5000).map((id) => {
        const g = gameOf(id) || {}, f = endOf(id).finish || {}, res = f.result || {};
        return { id, edition: g.edition === 'mega' ? 'mega' : 'standard', rounds: res.rounds ?? 0, turns: res.turns ?? 0, duration_ms: res.durationMs ?? f.durationMs ?? null, end_reason: res.endReason || null, summary: f.summary || null, started_at: g.startedAt };
      });
      return send(res, 200, { ...aggregateMonopoly(rows), running: ids.filter((id) => statusOf(id) === 'running').length, time: now() });
    }
    if (path === '/api/stats/models') return send(res, 200, { ...aggregateModels(seatRows(store.ids().filter((id) => statusOf(id) === 'finished'))), time: now() });
    if (path === '/api/players') {
      // as the Worker's thePlayers, with the table in use here as the pool
      const seats = seatRows(store.ids());
      const models = aggregateModels(seats.filter((x) => x.status === 'finished')).models;
      const playing = new Set(seats.filter((x) => x.status === 'running').map((x) => x.model_key));
      const once = new Map();
      for (const p of pool()) { const k = modelKey(p); if (!once.has(k)) once.set(k, p); }
      const players = [...once.entries()].map(([key, p]) => {
        const mine = models.filter((x) => x.key === key);
        const all = mine.length ? mine : models.filter((x) => x.provider === p.provider && x.model === p.model);
        const n = all.reduce((s, x) => s + x.games, 0), wins = all.reduce((s, x) => s + x.wins, 0);
        return {
          key, name: p.name || '', provider: p.provider || 'heuristic', model: p.model || '', effort: p.effort || null, colour: p.colour || null,
          playing: playing.has(key) || [...playing].some((k) => k.startsWith(`${p.provider}/${p.model}@`) || k === `${p.provider}/${p.model}`),
          monopoly: { games: n, wins, winRate: n ? wins / n : 0 },
        };
      });
      return send(res, 200, { players, source: 'runner', updatedAt: null, time: now() });
    }
    if ((r = path.match(/^\/api\/games\/([^/]+)(?:\/(events|calls|transcript|export))?$/))) {
      const id = decodeURIComponent(r[1]);
      if (!known(id)) return send(res, 404, { error: 'no such game' });
      if (!r[2]) return send(res, 200, { ...row(id), players: playersOf(id) });
      if (r[2] === 'events') {
        const after = clampInt(url.searchParams.get('after'), 0, 1e12, 0), limit = clampInt(url.searchParams.get('limit'), 1, 2000, 1000);
        const events = lines(id, 'events').filter((e) => e.seq > after).slice(0, limit);
        return send(res, 200, { events, nextAfter: events.length ? events[events.length - 1].seq : after, done: events.length < limit });
      }
      if (r[2] === 'calls') {
        const after = clampInt(url.searchParams.get('after'), 0, 1e12, 0), limit = clampInt(url.searchParams.get('limit'), 1, 1000, 500), full = url.searchParams.get('full') === '1';
        const calls = lines(id, 'calls').filter((c) => c.seq > after).sort((x, y) => x.seq - y.seq).slice(0, limit).map((c) => callRow(c, full));
        return send(res, 200, { calls, nextAfter: calls.length ? calls[calls.length - 1].seq : after, done: calls.length < limit });
      }
      if (r[2] === 'transcript') return send(res, 200, transcript(replayOf(id, lines(id, 'events')), { compact: url.searchParams.get('compact') === '1' }), 'text/plain; charset=utf-8');
      const full = url.searchParams.get('full') === '1';
      const calls = [...lines(id, 'calls')].sort((x, y) => x.seq - y.seq).map((c) => callRow(c, full));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="monopoly-${id}.json"`, 'cache-control': 'no-store' });
      res.end(JSON.stringify({ version: 2, exportedAt: now(), game: { ...row(id), players: playersOf(id) }, events: lines(id, 'events'), calls }));
      return true;
    }
    return false;
  }

  // The site's files: the homepage at /home/, the Monopoly page at /monopoly/, and everything under them.
  function file(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let p = decodeURIComponent(url.pathname);
    if (p === '/monopoly' || p === '/home') { res.writeHead(301, { location: `${p}/` }); res.end(); return true; }
    if (p === '/home/') p = '/index.html';
    else if (p.endsWith('/')) p += 'index.html';
    const f = resolve(root, `.${p}`);
    if (!f.startsWith(root + sep) || !existsSync(f) || !statSync(f).isFile()) return false;
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(f));
    return true;
  }

  // Answers a request when it is the site's, and says whether it did.
  return function handle(req, res, url) {
    try {
      if (url.pathname.startsWith('/api/')) return api(req, res, url) !== false;
      return file(req, res, url);
    } catch (e) { send(res, 500, { error: `the local site failed: ${e.message}` }); return true; }
  };
}

