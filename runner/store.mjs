// The simulator's own record of every game, kept apart from the site so that nothing done to the site (an update,
// an outage, a new database) can touch it, and the publisher that copies it to the site.
//
//   <data>/games/<id>/game.json        the game as registered: its seats and models, config, seed, the simulator's version,
//                                      and the site it was played for (`site`; none for a dry run), the only one it goes to
//   <data>/games/<id>/events.jsonl     every event, a line each, appended as it happens (gzipped once the game is over)
//   <data>/games/<id>/calls.jsonl      every model call with its prompts and its reply, a line each (gzipped likewise)
//   <data>/games/<id>/finish.json      the result, the summary and each player's statistics, once the game has ended
//   <data>/games/<id>/abort.json       why it stopped, when it did not end
//   <data>/games/<id>/beat             the time, every half minute while the game is in play
//   <data>/games/<id>/published.json   what the site has of it: { site, registered, events, calls, finished, aborted },
//                                      the events and the calls counted in lines, in the order they were written
//
// The store is written as the game is played, before anything is sent, so a game in progress never waits on the site:
// the publisher sends what the site has not got, a few batches at a time, and when the site cannot be reached or
// refuses, it tries again later, for as long as it takes. A copy on the site that is lost or replaced is filled again
// from here (the site ignores what it already has). A game goes only to the site it was played for, so a game played
// against a site on this machine, a test, never reaches the public one.
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync, readdirSync, renameSync, unlinkSync, statSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { netReason } from '../public/assets/app/providers.js';

const STALE = 180000; // a game in play whose heartbeat is older than this has lost its runner
const safe = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, '_');
const readJson = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
// A file replaced whole: written beside and renamed over, so a crash never leaves half a record.
const writeJson = (file, data) => { writeFileSync(`${file}.part`, JSON.stringify(data)); renameSync(`${file}.part`, file); };
const parseLine = (line) => { try { return JSON.parse(line); } catch { return null; } }; // a damaged line keeps its place, as null
const mtime = (file) => { try { return statSync(file).mtimeMs; } catch { return 0; } };
const size = (file) => { try { return statSync(file).size; } catch { return 0; } };

// The complete lines written to a file after `offset` (in bytes), and the offset after the last of them; a line still
// being written waits for the next read.
function linesFrom(file, offset) {
  const fd = openSync(file, 'r');
  try {
    const total = fstatSync(fd).size;
    if (total <= offset) return { lines: [], offset };
    const buf = Buffer.alloc(total - offset);
    readSync(fd, buf, 0, buf.length, offset);
    const end = buf.lastIndexOf(10);
    if (end < 0) return { lines: [], offset };
    return { lines: buf.subarray(0, end).toString('utf8').split('\n'), offset: offset + end + 1 };
  } finally { closeSync(fd); }
}

export class GameStore {
  constructor(root) { this.root = root; mkdirSync(root, { recursive: true }); }
  dir(id) { return join(this.root, safe(id)); }
  file(id, name) { return join(this.dir(id), name); }
  start(id, game) { mkdirSync(this.dir(id), { recursive: true }); writeJson(this.file(id, 'game.json'), game); this.beat(id); }
  event(id, e) { appendFileSync(this.file(id, 'events.jsonl'), `${JSON.stringify(e)}\n`); }
  call(id, c) { appendFileSync(this.file(id, 'calls.jsonl'), `${JSON.stringify(c)}\n`); }
  beat(id) { try { writeFileSync(this.file(id, 'beat'), new Date().toISOString()); } catch { /* the next beat */ } }
  finish(id, payload) { writeJson(this.file(id, 'finish.json'), payload); }
  abort(id, reason) { if (!existsSync(this.file(id, 'finish.json'))) writeJson(this.file(id, 'abort.json'), { reason, at: new Date().toISOString() }); }
  // A game brought in whole, from the site or elsewhere: its record, its lines and its end, written at once.
  put(id, { game, events, calls, finish, abort }) {
    mkdirSync(this.dir(id), { recursive: true });
    for (const [kind, list] of [['events', events], ['calls', calls]]) {
      const file = this.file(id, `${kind}.jsonl.gz`);
      writeFileSync(`${file}.part`, gzipSync((list || []).map((x) => `${JSON.stringify(x)}\n`).join('')));
      renameSync(`${file}.part`, file);
    }
    if (finish) writeJson(this.file(id, 'finish.json'), finish);
    else if (abort) writeJson(this.file(id, 'abort.json'), abort);
    writeJson(this.file(id, 'game.json'), game); // last: a game is in the store once its game.json is
  }
  // An ended game's lines, gzipped: a tenth of the room, read the same way.
  compact(id) {
    for (const kind of ['events', 'calls']) {
      const plain = this.file(id, `${kind}.jsonl`), gz = `${plain}.gz`;
      if (!existsSync(plain)) continue;
      writeFileSync(`${gz}.part`, gzipSync(readFileSync(plain)));
      renameSync(`${gz}.part`, gz);
      unlinkSync(plain);
    }
    try { unlinkSync(this.file(id, 'beat')); } catch { /* none */ }
  }
  ids() { return existsSync(this.root) ? readdirSync(this.root).filter((n) => existsSync(join(this.root, n, 'game.json'))).sort() : []; }
  game(id) { return readJson(this.file(id, 'game.json')); }
  finished(id) { return readJson(this.file(id, 'finish.json')); }
  aborted(id) { return readJson(this.file(id, 'abort.json')); }
  // finished, aborted, running, or stalled: in play by its record, but its runner has not been heard from for minutes
  status(id) {
    if (existsSync(this.file(id, 'finish.json'))) return 'finished';
    if (existsSync(this.file(id, 'abort.json'))) return 'aborted';
    const seen = Math.max(...['beat', 'events.jsonl', 'calls.jsonl', 'game.json'].map((n) => mtime(this.file(id, n))));
    return Date.now() - seen > STALE ? 'stalled' : 'running';
  }
  // The lines of a game's events or calls after `cursor` ({ line, offset }), parsed, and the cursor after them. A game
  // in play is read from where the last read ended; an ended one, gzipped, whole and from the cursor's line.
  read(id, kind, cursor = { line: 0, offset: 0 }) {
    const plain = this.file(id, `${kind}.jsonl`);
    if (existsSync(plain) && Number.isFinite(cursor.offset)) {
      const r = linesFrom(plain, cursor.offset);
      return { items: r.lines.map(parseLine), cursor: { line: cursor.line + r.lines.length, offset: r.offset } };
    }
    if (existsSync(`${plain}.gz`)) {
      const lines = gunzipSync(readFileSync(`${plain}.gz`)).toString('utf8').split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      return { items: lines.slice(cursor.line).map(parseLine), cursor: { line: Math.max(cursor.line, lines.length), offset: Infinity } };
    }
    return { items: [], cursor };
  }
  // What the site at `site` has of a game: nothing, when the record names another site.
  published(id, site) {
    const s = readJson(this.file(id, 'published.json'), null);
    return s && s.site === site ? s : { site, registered: false, events: 0, calls: 0, finished: false, aborted: false };
  }
  setPublished(id, state) { writeJson(this.file(id, 'published.json'), { ...state, at: new Date().toISOString() }); }
  forget(id) { try { unlinkSync(this.file(id, 'published.json')); } catch { /* nothing to forget */ } }
  // The games whose runner stopped without ending them, marked stopped; and every ended game still in plain lines,
  // gzipped. Returns the ids marked.
  sweep(reason) {
    const marked = [];
    for (const id of this.ids()) {
      const s = this.status(id);
      if (s === 'stalled') { this.abort(id, reason); marked.push(id); }
      if (s !== 'running' && (existsSync(this.file(id, 'events.jsonl')) || existsSync(this.file(id, 'calls.jsonl')))) this.compact(id);
    }
    return marked;
  }
  // Every game's state for the dashboard and the runner's report: in play, finished or stopped, and whether the site
  // at `site` has all of it.
  summary(site) {
    return this.ids().map((id) => {
      const g = this.game(id) || {}, status = this.status(id), f = status === 'finished' ? this.finished(id) : null, a = status === 'aborted' ? this.aborted(id) : null;
      const s = this.published(id, site);
      const r = (f && f.result) || {};
      const bytes = ['game.json', 'events.jsonl', 'events.jsonl.gz', 'calls.jsonl', 'calls.jsonl.gz', 'finish.json'].reduce((n, x) => n + size(this.file(id, x)), 0);
      return {
        id, startedAt: g.startedAt || null, status, players: (g.players || []).map((p) => p.name), winner: r.winnerName || null, rounds: r.rounds ?? null, endReason: r.endReason || (a && a.reason) || null,
        site: g.site || null, mine: !!site && g.site === site, // played for this site, and so to be sent to it
        published: !!(s.registered && (status === 'finished' ? s.finished : status === 'aborted' ? s.aborted : false)), registered: !!s.registered, bytes,
      };
    });
  }
}

// Copies the store to the site. `soon(id)` is called as a game plays and never waits; every pass sends what the site
// has not got of one game, three games at most at once; a failure is tried again after 2, 4, 8 ... seconds, a minute
// at most (five minutes when the site refuses what it is sent, which takes a fix on one side or the other), for as
// long as it takes.
export class Publisher {
  // explain(e): the words for a failure, given the error a post threw (its status, 0 when the site was not reached)
  constructor({ site, token, store, logPrompts = false, log = console.log, warn = console.warn, explain = (e) => e.message, slots = 3 }) {
    Object.assign(this, { site: String(site || '').replace(/\/$/, ''), token, store, logPrompts, log, warn, explain, slots });
    this.on = !!(this.site && this.token);
    this.games = new Map();
    this.active = 0; this.waiting = [];
  }
  slot(id) {
    if (!this.games.has(id)) this.games.set(id, { cursor: { events: { line: 0, offset: 0 }, calls: { line: 0, offset: 0 } }, queue: { events: [], calls: [] }, busy: null, dirty: false, timer: null, retryAt: 0, backoff: 0, warned: '', status: null });
    return this.games.get(id);
  }
  soon(id, delay = 700) {
    if (!this.on) return;
    const g = this.slot(id);
    if (g.timer) return;
    g.timer = setTimeout(() => { g.timer = null; this.run(id); }, Math.max(delay, g.retryAt - Date.now()));
  }
  acquire() { if (this.active < this.slots) { this.active++; return Promise.resolve(); } return new Promise((r) => this.waiting.push(r)); }
  release() { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  // One pass over a game now (or the one under way); resolves true when the site has everything written so far.
  run(id) {
    const g = this.slot(id);
    if (g.busy) { g.dirty = true; return g.busy; }
    g.busy = (async () => {
      await this.acquire();
      try {
        await this.pass(id);
        if (g.warned) this.log(`  ${id}: the site is taking it again`);
        Object.assign(g, { backoff: 0, retryAt: 0, warned: '', status: null });
        return true;
      } catch (e) { this.failed(id, e); return false; } finally { this.release(); }
    })().finally(() => { g.busy = null; if (g.dirty) { g.dirty = false; this.soon(id); } });
    return g.busy;
  }
  failed(id, e) {
    const g = this.slot(id);
    g.status = e.status ?? 0;
    const refused = g.status >= 400 && g.status < 500 && g.status !== 408 && g.status !== 429;
    g.backoff = Math.min(refused ? 300000 : 60000, g.backoff ? g.backoff * 2 : 2000);
    g.retryAt = Date.now() + g.backoff;
    const why = this.explain(e);
    if (why !== g.warned) { this.warn(`! ${id} is not yet on the site: ${why}. It is kept in the store and sent when the site takes it; next try in ${Math.round(g.backoff / 1000)} s`); g.warned = why; }
    this.soon(id, g.backoff);
  }
  async post(path, body) {
    let res;
    try {
      res = await fetch(`${this.site}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify(body) });
    } catch (e) { throw Object.assign(new Error(`the site could not be reached: ${netReason(e)}`), { status: 0, network: e }); }
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`the site answered ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
    try { return JSON.parse(text); } catch { return { ok: true }; }
  }
  // A post about a game the site has lost (its database replaced or emptied) starts the game over from its first line.
  async send(id, path, body) {
    try { return await this.post(path, body); } catch (e) {
      if (e.status !== 404) throw e;
      this.store.forget(id);
      Object.assign(this.slot(id), { cursor: { events: { line: 0, offset: 0 }, calls: { line: 0, offset: 0 } }, queue: { events: [], calls: [] } });
      throw Object.assign(new Error('the site does not have this game, though it had taken some of it (its database replaced or emptied?); sending it again from the start'), { status: 0 });
    }
  }
  // One pass over a game: register it, send the events and the calls the site has not got, then its end.
  async pass(id) {
    const g = this.slot(id), st = this.store, state = st.published(id, this.site);
    const base = `/api/ingest/games/${encodeURIComponent(id)}`;
    if (!state.registered) {
      const { site, ...registration } = st.game(id);
      await this.post('/api/ingest/games', registration);
      state.registered = true; st.setPublished(id, state);
    }
    for (const kind of ['events', 'calls']) {
      const got = st.read(id, kind, g.cursor[kind]);
      g.cursor[kind] = got.cursor;
      const q = g.queue[kind];
      q.push(...got.items);
      let first = g.cursor[kind].line - q.length; // the line the queue starts at; the ones before it the site has
      if (state[kind] > first) { q.splice(0, state[kind] - first); first = state[kind]; }
      const batchSize = kind === 'events' ? 400 : 100;
      while (q.length) {
        const batch = q.slice(0, batchSize), items = batch.filter(Boolean);
        if (items.length) await this.send(id, `${base}/${kind}`, kind === 'events' ? { events: items } : { calls: items.map((c) => this.callRecord(c)) });
        q.splice(0, batch.length);
        first += batch.length;
        state[kind] = first;
        st.setPublished(id, state);
      }
    }
    const f = st.finished(id);
    if (f && !state.finished) { await this.send(id, `${base}/finish`, f); state.finished = true; st.setPublished(id, state); g.warned = ''; this.log(`  ${id} is on the site`); }
    const a = !f && st.aborted(id);
    if (a && !state.aborted) { await this.send(id, `${base}/abort`, { reason: a.reason }); state.aborted = true; st.setPublished(id, state); g.warned = ''; this.log(`  ${id} is on the site, as stopped`); }
  }
  // The prompts stay in the store and go to the site only when asked for.
  callRecord(c) {
    if (this.logPrompts) return c;
    const { system, user, ...rest } = c;
    return rest;
  }
  // The ended games played for this site that it has not wholly got, oldest first.
  behind() { return this.store.summary(this.site).filter((g) => g.mine && !g.published && (g.status === 'finished' || g.status === 'aborted')); }
  // Sends the given games one after another, trying each up to `tries` times while the site cannot be reached; a
  // refusal is not tried again, and a refused token stops the lot. Returns the ids the site still lacks.
  async drain(ids, { tries = 3 } = {}) {
    const left = [];
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k], g = this.slot(id);
      let ok = false;
      for (let t = 0; t < tries && !ok; t++) {
        ok = await this.run(id);
        clearTimeout(g.timer); g.timer = null; // drain does its own trying again
        if (ok || (g.status >= 400 && g.status < 500 && g.status !== 408 && g.status !== 429)) break;
        if (t + 1 < tries) await new Promise((r) => setTimeout(r, Math.min(g.backoff, 15000)));
      }
      if (ok) continue;
      left.push(id);
      if (g.status === 401) { left.push(...ids.slice(k + 1)); break; }
    }
    return left;
  }
}
