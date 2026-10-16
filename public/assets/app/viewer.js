// The viewer: the live game, every stored game with a replay, the board's
// statistics and each model's. It reads the site's API only; nothing here
// calls a model or holds a key.
import { GROUPS, EDITION_INFO, makeBoard } from './board.js';
import { HOTEL, SKYSCRAPER } from './engine.js';
import { ReplayGame } from './replay.js';
import { StatsTracker, EXPECTED_ROLLS, meanRoll } from './stats.js';
import { fmtEvent, eventLine } from './transcript.js';
import { barChart } from './analytics.js';
import { NAME_SETS, nameSet, moneyIn, dressGame } from './names.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// The edition the board is read as: names by position and the currency.
const NAMES_KEY = 'monopoly-ai.names';
let namesId = 'london';
try { namesId = localStorage.getItem(NAMES_KEY) || 'london'; } catch { /* storage unavailable */ }
if (!NAME_SETS.some((x) => x.id === namesId)) namesId = 'london';
const currentSet = () => nameSet(namesId);
const money = (n) => moneyIn(currentSet(), n);
const nameAt = (edition, i, fallback) => (edition === 'standard' && currentSet().names ? currentSet().names[i] : fallback);
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const fmtDur = (ms) => { if (!ms) return '—'; if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} s`; const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`; };
const modelLabel = (p) => (p.provider === 'heuristic' ? 'rule-based bot' : `${p.model || p.provider}${p.effort ? ' @' + p.effort : ''}`);
const gid = (id) => encodeURIComponent(id);

let health = { db: true, narrator: false };
async function api(path, init) {
  const r = await fetch(`/api${path}`, init);
  if (!r.ok) {
    let body = {};
    try { body = await r.json(); } catch { /* not JSON */ }
    const err = new Error(body.error || `HTTP ${r.status}`); err.status = r.status; err.body = body; throw err;
  }
  return r.json();
}
function notice(text) { const el = $('#notice'); el.textContent = text || ''; el.classList.toggle('hidden', !text); fitBoard(); }

// ---------- routing ----------
let liveTimer = null;
function route() {
  const h = location.hash.replace(/^#/, '') || 'live';
  const [name, ...rest] = h.split('/');
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : null;
  const view = name === 'game' ? 'game' : ['live', 'games', 'stats', 'models', 'about'].includes(name) ? name : 'live';
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === (view === 'game' ? 'games' : view)));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `view-${view === 'live' ? 'game' : view}`));
  window.scrollTo(0, 0);
  notice('');
  fitBoard();
  clearInterval(liveTimer); liveTimer = null;
  if (view === 'live') openLive();
  else if (view === 'game') { stopLiveTab(); openGame(arg, { liveMode: false }); }
  else { stopLiveTab(); if (view === 'games') loadGames(true); if (view === 'stats') loadStats(); if (view === 'models') loadModels(); }
}
window.addEventListener('hashchange', route);

// ---------- the game view ----------
const V = { id: null, token: 0, meta: null, events: [], calls: [], callSeen: new Set(), cursor: 0, game: null, live: false, follow: true, liveMode: false, playing: false, timer: null, pollTimer: null, pollTick: 0 };
let hovered = null, pinned = null;
const trackers = new WeakMap();
function statsOf(game) { let t = trackers.get(game); if (!t) { t = new StatsTracker(game); trackers.set(game, t); } return t.update(); }
function metaFor() { const m = V.meta; return { id: m.id, edition: m.edition, config: m.config, seed: m.seed, startedAt: m.startedAt, players: m.players }; }

async function openGame(id, { liveMode }) {
  if (!id) { notice('No game given.'); return; }
  stopPlay(); stopPoll();
  const token = ++V.token;
  Object.assign(V, { id, meta: null, events: [], calls: [], callSeen: new Set(), cursor: 0, game: null, live: false, liveMode, pollTick: 0 });
  hovered = null; pinned = null;
  clearFeeds();
  $('#g-title').textContent = id; $('#g-sub').textContent = 'loading…'; $('#g-status').textContent = ''; $('#g-status').className = 'status';
  $('#g-link').href = `#game/${gid(id)}`;
  try {
    const meta = await api(`/games/${gid(id)}`);
    if (token !== V.token) return;
    V.meta = meta; V.live = meta.status === 'running';
    let after = 0;
    for (;;) { const r = await api(`/games/${gid(id)}/events?after=${after}&limit=2000`); if (token !== V.token) return; V.events.push(...r.events); after = r.nextAfter; if (r.done) break; }
    after = 0;
    for (;;) { const r = await api(`/games/${gid(id)}/calls?after=${after}&limit=1000`); if (token !== V.token) return; addCalls(r.calls); after = r.nextAfter; if (r.done) break; }
    V.follow = V.live; $('#r-follow').checked = V.follow;
    seek(V.events.length);
    renderNarrator();
    if (V.live) startPoll();
  } catch (e) {
    if (token !== V.token) return;
    $('#g-sub').textContent = '';
    notice(e.status === 503 ? 'The site has no database yet, so there are no games to show.' : e.status === 404 ? `There is no game called ${id}.` : `Could not load game ${id}: ${e.message}`);
    showEmptyBoard(e.status === 404 ? 'No such game' : 'No game to show');
  }
}
// The board with every square on it, and nothing on the table.
let emptyText = '';
function showEmptyBoard(text) {
  V.game = null;
  emptyText = text;
  const g = dressGame(new ReplayGame({ edition: 'standard' }), currentSet());
  renderBoard(g);
  const c = $('#centre');
  if (c) c.innerHTML = `<div class="cline">${esc(EDITION_INFO.standard.label)}${currentSet().id !== 'london' ? ` · read as ${esc(currentSet().label)}` : ''}</div>
    <div class="cmid"><div class="mlogo"><span>MONOPOLY</span></div><div class="note">${esc(text || 'No game on the table')}</div></div>
    <div class="cbox"><div class="dice">🎲</div><div class="last">The next game appears here as soon as it starts.</div></div>`;
  $('#player-cards').innerHTML = '';
  clearFeeds();
  renderBar();
}
function addCalls(list) {
  let added = false;
  for (const c of list) if (!V.callSeen.has(c.seq)) { V.callSeen.add(c.seq); V.calls.push(c); added = true; }
  if (added) V.calls.sort((a, b) => a.seq - b.seq);
  return added;
}
// Apply events up to n (0..events.length). Forward steps are incremental; a step back rebuilds from the start.
function seek(n) {
  n = Math.max(0, Math.min(V.events.length, n));
  if (!V.meta) return;
  if (!V.game || n < V.cursor) { V.game = dressGame(new ReplayGame(metaFor()), currentSet()); V.game.callSeen = new Set(); V.cursor = 0; clearFeeds(); }
  const big = n - V.cursor > 400;
  const evFeed = $('#events'), chatFeed = $('#chat'), llmFeed = $('#llm-feed');
  for (let k = V.cursor; k < n; k++) {
    const e = V.events[k];
    V.game.apply(e);
    if (!big || k >= n - 250) appendLine(evFeed, `ev-${e.type}`, eventLine(e, V.game));
    if (e.type === 'chat') appendChat(chatFeed, e);
  }
  V.cursor = n;
  absorbCalls(!big);
  if (big) { const lines = V.calls.filter((c) => V.game.callSeen.has(c.seq)).slice(-150); llmFeed.innerHTML = ''; for (const c of lines) appendLlm(llmFeed, c); }
  for (const f of [evFeed, chatFeed, llmFeed]) { while (f.childElementCount > 300) f.firstElementChild.remove(); f.scrollTop = f.scrollHeight; }
  queueRender();
}
// Calls made by the events applied so far join the game (they can arrive after their events on a live game).
function absorbCalls(show = true) {
  if (!V.game || !V.cursor) return;
  const lastSeq = V.events[V.cursor - 1].seq;
  const llmFeed = $('#llm-feed');
  for (const c of V.calls) {
    if (c.seq > lastSeq || V.game.callSeen.has(c.seq)) continue;
    V.game.callSeen.add(c.seq);
    V.game.addCall(c);
    if (show) appendLlm(llmFeed, c);
  }
}
function clearFeeds() { for (const id of ['#events', '#chat', '#llm-feed']) $(id).innerHTML = ''; }
function appendLine(feed, cls, text) { const div = document.createElement('div'); div.className = cls; div.textContent = text; feed.appendChild(div); }
function appendChat(feed, e) {
  const from = V.game.player(e.player);
  const div = document.createElement('div');
  div.innerHTML = `<span class="who" style="--c:${esc(from && from.meta.colour || '#888')}">${esc(from ? from.name : e.player)}</span>${e.to ? ` <span class="priv">(to ${esc((V.game.player(e.to) || { name: e.to }).name)})</span>` : ''}: ${esc(V.game.displayText(e.message))}`;
  feed.appendChild(div);
}
function appendLlm(feed, c) {
  const div = document.createElement('div');
  if (c.error) div.className = 'err';
  const p = V.game.player(c.player);
  const u = c.usage && c.usage.input != null ? ` ${c.usage.input}→${c.usage.output} tok${c.usage.cached ? ` (${c.usage.cached} cached)` : ''}` : '';
  div.textContent = `${p ? p.name : c.player} · ${c.decision} · ${c.servedModel || c.model || ''}${c.effort ? '@' + c.effort : ''} · ${c.latencyMs} ms${u} · ${c.error ? 'ERROR ' + c.error : JSON.stringify(c.parsed)}`;
  feed.appendChild(div);
}

let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; fitBoard(); if (V.game) { renderBoard(V.game); renderPlayerCards(V.game); } renderBar(); });
}
// Once the face has loaded, the words are measured again and the board drawn again, so the labels are sized to Jost and not to the fallback face.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { wordWidth.clear(); if (V.game) queueRender(); else if ($('#board .cell')) showEmptyBoard(emptyText); });
// The board takes the height left under the bars above it, so the whole of it is in view.
function fitBoard() {
  const wrap = $('.board-wrap');
  if (wrap && wrap.classList.contains('full')) wrap.style.setProperty('--board-size', `${Math.min(window.innerWidth, window.innerHeight) - 46}px`);
  else if (wrap && $('#view-game').classList.contains('active')) {
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    wrap.style.setProperty('--board-size', `${Math.max(320, window.innerHeight - top - 14)}px`);
  }
  for (const b of document.querySelectorAll('#board, .heat')) sizeNames(b);
}
// One size for every name on a board, so the labels read alike: the largest at which the longest word of every square
// (--w, measured by the renderer) still fits its own box, under a base that follows the board's width; the corners the
// same among themselves, and a one-word corner (GO) larger. Set on the board as --name, --cname and --gname.
function sizeNames(el) {
  const cells = [...el.querySelectorAll('.cell, .hcell')];
  if (!cells.length || !el.clientWidth) return;
  const heat = el.classList.contains('heat');
  const base = Math.min(heat ? 11 : 12, Math.max(6, el.clientWidth * (heat ? 0.012 : 0.0118)));
  const pads = {};
  const avail = (c) => {
    const box = c.querySelector('.txt') || c;
    const key = c.classList.contains('corner') ? 'corner' : (c.className.match(/side-\w+/) || ['x'])[0];
    if (pads[key] == null) { const cs = getComputedStyle(box); pads[key] = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); }
    return box.clientWidth - pads[key];
  };
  let name = base, cname = Infinity, gname = Infinity, cornerW = 0;
  for (const c of cells) {
    const fit = avail(c) / (parseFloat(c.style.getPropertyValue('--w')) || 6);
    if (heat || !c.classList.contains('corner')) name = Math.min(name, fit);
    else { cornerW = c.clientWidth; if (c.classList.contains('one')) gname = Math.min(gname, fit); else cname = Math.min(cname, fit); }
  }
  const px = (v, lo, hi) => `${Math.max(lo, Math.min(hi, v)).toFixed(2)}px`;
  el.style.setProperty('--name', px(name, 5, 12));
  el.style.setProperty('--cname', px(Math.min(cname, 0.175 * cornerW), 5, 20));
  el.style.setProperty('--gname', px(Math.min(gname, 0.34 * cornerW), 5, 36));
}
window.addEventListener('resize', () => { fitBoard(); });
function renderBar() {
  const n = V.events.length;
  $('#r-pos').max = String(n); $('#r-pos').value = String(V.cursor);
  const e = V.cursor ? V.events[V.cursor - 1] : null;
  $('#r-info').textContent = n ? `event ${V.cursor} of ${n}${e ? ` · round ${e.round} · turn ${e.turn}` : ''}` : (V.meta ? 'no events yet' : '');
  $('#r-play').textContent = V.playing ? '⏸' : '▶';
  $('#r-follow').parentElement.classList.toggle('hidden', !V.live);
  const st = $('#g-status');
  if (!V.meta) { st.textContent = ''; st.className = 'status'; return; }
  if (V.live) { st.textContent = V.follow && V.cursor === n ? 'LIVE' : 'RUNNING'; st.className = 'status live'; }
  else if (V.meta.status === 'finished') { st.textContent = 'FINISHED'; st.className = 'status done'; }
  else { st.textContent = V.meta.status.toUpperCase(); st.className = 'status'; }
  $('#g-title').textContent = V.meta.id;
  const m = V.meta;
  $('#g-sub').textContent = `${EDITION_INFO[m.edition] ? EDITION_INFO[m.edition].label : m.edition} · ${fmtDate(m.startedAt)}${m.winnerName ? ` · ${m.winnerName} wins after ${m.rounds} rounds (${m.endReason})` : m.status === 'running' ? ` · round ${V.game ? V.game.round : m.rounds}` : ''}`;
}
// ---- the replay controls ----
function stopPlay() { V.playing = false; clearInterval(V.timer); V.timer = null; }
function togglePlay() {
  if (V.playing) { stopPlay(); renderBar(); return; }
  if (V.cursor >= V.events.length && !V.live) seek(0);
  V.playing = true;
  const sp = $('#r-speed').value;
  const tick = () => {
    if (V.cursor >= V.events.length) { if (!V.live) { stopPlay(); renderBar(); } return; }
    if (sp === 'turn') { let k = V.cursor + 1; while (k < V.events.length && V.events[k].type !== 'turn_start') k++; seek(k); }
    else seek(V.cursor + 1);
  };
  V.timer = setInterval(tick, sp === 'turn' ? 1000 : Math.round(1000 / Number(sp)));
  renderBar();
}
function unfollow() { if (V.follow) { V.follow = false; $('#r-follow').checked = false; } }
$('#r-first').addEventListener('click', () => { stopPlay(); unfollow(); seek(0); });
$('#r-back').addEventListener('click', () => { stopPlay(); unfollow(); seek(V.cursor - 1); });
$('#r-fwd').addEventListener('click', () => { stopPlay(); unfollow(); seek(V.cursor + 1); });
$('#r-last').addEventListener('click', () => { stopPlay(); if (V.live) { V.follow = true; $('#r-follow').checked = true; } seek(V.events.length); });
$('#r-play').addEventListener('click', () => { unfollow(); togglePlay(); });
$('#r-pos').addEventListener('input', (e) => { stopPlay(); unfollow(); seek(Number(e.target.value)); });
$('#r-speed').addEventListener('change', () => { if (V.playing) { stopPlay(); togglePlay(); } });
$('#r-follow').addEventListener('change', (e) => { V.follow = e.target.checked; if (V.follow) { stopPlay(); seek(V.events.length); } else renderBar(); });
document.addEventListener('keydown', (e) => {
  if (!$('#view-game').classList.contains('active') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') { stopPlay(); unfollow(); seek(V.cursor - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { stopPlay(); unfollow(); seek(V.cursor + 1); e.preventDefault(); }
  else if (e.key === ' ') { unfollow(); togglePlay(); e.preventDefault(); }
  else if (e.key === 'Home') { stopPlay(); unfollow(); seek(0); }
  else if (e.key === 'End') { stopPlay(); seek(V.events.length); }
  else if (e.key === 'f' || e.key === 'F') toggleFull();
  else if (e.key === 'Escape' && wrapEl.classList.contains('full')) leaveFull();
});
// ---- following a running game ----
function startPoll() { stopPoll(); V.pollTimer = setInterval(pollOnce, 2000); }
function stopPoll() { clearInterval(V.pollTimer); V.pollTimer = null; }
async function pollOnce() {
  if (!V.live) return;
  const id = V.id, token = V.token;
  V.pollTick++;
  try {
    const last = V.events.length ? V.events[V.events.length - 1].seq : 0;
    const r = await api(`/games/${gid(id)}/events?after=${last}&limit=2000`);
    if (token !== V.token) return;
    if (r.events.length) { V.events.push(...r.events); if (V.follow && !V.playing) seek(V.events.length); else renderBar(); }
    if (V.pollTick % 2 === 0) {
      const from = Math.max(0, (V.calls.length ? V.calls[V.calls.length - 1].seq : 0) - 400);
      const c = await api(`/games/${gid(id)}/calls?after=${from}&limit=1000`);
      if (token !== V.token) return;
      if (addCalls(c.calls)) { absorbCalls(true); queueRender(); }
    }
    if (V.pollTick % 4 === 0) {
      const meta = await api(`/games/${gid(id)}`);
      if (token !== V.token) return;
      V.meta = meta;
      if (meta.status !== 'running') { V.live = false; stopPoll(); renderNarrator(); if (V.liveMode) scheduleLiveCheck(); }
      renderBar();
    }
  } catch { /* try again next tick */ }
}
// ---- the narrator ----
function renderNarrator() {
  const m = V.meta;
  $('#n-recap').textContent = m && m.recap ? m.recap : (m && m.status === 'running' ? 'The match report is written when the game ends.' : 'No match report for this game.');
  $('#n-recap').classList.toggle('muted', !(m && m.recap));
  $('#n-transcript').href = `/api/games/${gid(V.id)}/transcript`;
  $('#n-compact').href = `/api/games/${gid(V.id)}/transcript?compact=1`;
  $('#n-export').href = `/api/games/${gid(V.id)}/export`;
  $('#n-ask').classList.toggle('hidden', !health.narrator);
  $('#n-answer').classList.add('hidden'); $('#n-status').textContent = '';
}
$('#n-send').addEventListener('click', async () => {
  const q = $('#n-question').value.trim();
  if (!q) return;
  $('#n-send').disabled = true; $('#n-status').textContent = 'asking…';
  try {
    const r = await api(`/games/${gid(V.id)}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q }) });
    $('#n-answer').textContent = r.answer; $('#n-answer').classList.remove('hidden'); $('#n-status').textContent = r.model ? `answered by ${r.model}` : '';
  } catch (e) { $('#n-status').textContent = e.message; }
  $('#n-send').disabled = false;
});
// ---- the live tab ----
async function openLive() {
  $('#g-link').href = '#live';
  try {
    const r = await api('/live');
    const pick = $('#g-pick'), wrap = $('#g-pick-wrap');
    pick.innerHTML = r.running.map((g) => `<option value="${esc(g.id)}">${esc(g.id)} · round ${g.rounds}</option>`).join('');
    wrap.classList.toggle('hidden', r.running.length < 2);
    if (r.running.length) { if (V.id !== r.running[0].id || !V.live) openGame(r.running[0].id, { liveMode: true }); }
    else if (r.latest) { if (V.id !== r.latest.id) openGame(r.latest.id, { liveMode: true }); notice('No game is being played right now. This is the latest one; the table comes back to life here when the next game starts.'); }
    else { notice(health.db ? 'No games yet. The first one appears here as soon as the runner starts it.' : 'The site has no database yet, so there is nothing to show.'); $('#g-sub').textContent = ''; $('#g-title').textContent = ''; showEmptyBoard('No games yet'); }
  } catch (e) { notice(e.status === 503 ? 'The site has no database yet, so there is nothing to show.' : `Could not reach the site: ${e.message}`); $('#g-title').textContent = ''; $('#g-sub').textContent = ''; showEmptyBoard('No game to show'); }
  liveTimer = setInterval(() => { if (!V.live) openLive(); }, 15000);
}
function stopLiveTab() { clearInterval(liveTimer); liveTimer = null; }
function scheduleLiveCheck() { if (location.hash.replace(/^#/, '') === 'live' || !location.hash) { clearInterval(liveTimer); liveTimer = setInterval(() => { if (!V.live) openLive(); }, 15000); } }
$('#g-pick').addEventListener('change', (e) => openGame(e.target.value, { liveMode: true }));

// ---------- the board ----------
function cellPos(i, perSide) {
  const n = perSide + 1;
  if (i <= perSide) return { row: n, col: n - i };
  if (i <= 2 * perSide) return { row: n - (i - perSide), col: 1 };
  if (i <= 3 * perSide) return { row: 1, col: 1 + (i - 2 * perSide) };
  return { row: 1 + (i - 3 * perSide), col: n };
}
// The corner squares are 1.6 times a property's width, as on the printed board: the properties stand tall along the top and
// bottom and lie wide at the sides, and the centre is what is left.
const CORNER = 1.6;
const boardTracks = (per) => `${CORNER}fr repeat(${per - 1}, 1fr) ${CORNER}fr`;
// The squares' pictures: the question mark of Chance, the Community Chest, the locomotive of a station, the bulb, the tap and
// the flame of the utilities, and the arrow under GO that points the way round the board.
const ICONS = {
  chance: '<span class="qm" aria-hidden="true">?</span>',
  chest: '<svg class="ico" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 13a13 8 0 0 1 26 0v2H3z" fill="currentColor"/><rect x="3.5" y="15.5" width="25" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="2.5"/><rect x="13" y="13" width="6" height="15" fill="currentColor"/><circle cx="16" cy="21" r="1.6" fill="var(--cell)"/></svg>',
  station: '<svg class="ico" viewBox="0 0 40 28" aria-hidden="true"><g fill="currentColor"><rect x="27" y="3" width="11" height="17" rx="1"/><rect x="6" y="10" width="23" height="10" rx="2"/><rect x="8" y="2" width="5" height="9"/><rect x="17" y="6" width="5" height="5" rx="1"/><rect x="2" y="19" width="36" height="3"/><path d="M2 22L6 14v8z"/><circle cx="11" cy="23.5" r="3.5"/><circle cx="20" cy="23.5" r="3.5"/><circle cx="32" cy="23.5" r="3.5"/></g><rect x="29.5" y="6" width="6" height="5" fill="var(--cell)"/></svg>',
  utility: [
    '<svg class="ico" viewBox="0 0 24 32" aria-hidden="true" fill="currentColor"><circle cx="12" cy="10.5" r="8.5"/><path d="M7.5 17h9l-1.2 4.5h-6.6z"/><rect x="8" y="22.5" width="8" height="2.4" rx="1.2"/><rect x="8" y="26" width="8" height="2.4" rx="1.2"/><rect x="9.5" y="29.5" width="5" height="2.2" rx="1.1"/><path d="M8.3 8.2a4.6 4.6 0 0 1 3.4-3.4" fill="none" stroke="var(--cell)" stroke-width="1.6" stroke-linecap="round"/></svg>',
    '<svg class="ico" viewBox="0 0 32 32" aria-hidden="true" fill="currentColor"><rect x="11" y="2" width="10" height="3.5" rx="1"/><rect x="14.5" y="5" width="3" height="5"/><path d="M5 10h20a3 3 0 0 1 3 3v9h-6v-5H8a3 3 0 0 1-3-3z"/><path d="M28.8 26c0 2-1.5 4-2.5 5.5a1.6 1.6 0 0 1-2.6 0C22.7 30 21.2 28 21.2 26c0-1.5 1.8-3.5 3.8-5.5 2 2 3.8 4 3.8 5.5z"/></svg>',
    '<svg class="ico" viewBox="0 0 24 32" aria-hidden="true" fill="currentColor"><path d="M12 1.5c.5 6-7 9.5-7 17.5a7 7 0 0 0 14 0c0-4-2.2-6.5-3.5-9-.5 2.5-1.5 3.5-2.5 4 .3-4-.5-8-1-12.5z"/></svg>',
  ],
};
const GO_ARROW = '<svg class="goarrow" viewBox="0 0 100 26" aria-hidden="true"><path d="M98 8H27V2L2 13l25 11v-6h71z" fill="var(--accent)" stroke="var(--board-ink)" stroke-width="2.5" stroke-linejoin="round"/></svg>';
// The width of a square's longest word in ems of its face (uppercase, with the letter-spacing), measured on a canvas, so the
// stylesheet can size the label to keep the word whole; measured again once the font has loaded.
const wordWidth = (() => {
  const ctx = document.createElement('canvas').getContext('2d');
  const cache = new Map();
  const f = (word, weight, spacing) => {
    const k = `${weight}|${spacing}|${word}`;
    if (!cache.has(k)) {
      ctx.font = `${weight} 100px Jost, system-ui, sans-serif`;
      cache.set(k, (ctx.measureText(word.toUpperCase()).width / 100) * 1.015 + spacing * word.length);
    }
    return cache.get(k);
  };
  f.clear = () => cache.clear();
  return f;
})();
const longestWord = (name, weight = 600, spacing = 0.01) => Math.max(0.5, ...name.split(/\s+/).filter(Boolean).map((w) => wordWidth(w, weight, spacing))).toFixed(2);
function renderBoard(game) {
  const board = $('#board');
  const per = game.perSide, n = per + 1;
  board.style.gridTemplateColumns = boardTracks(per);
  board.style.gridTemplateRows = boardTracks(per);
  const colourOf = {};
  for (const p of game.players) colourOf[p.id] = p.meta.colour || '#888';
  const tokensAt = {};
  for (const p of game.players) if (!p.bankrupt) (tokensAt[p.pos] = tokensAt[p.pos] || []).push(p);
  const focus = pinned != null ? pinned : hovered;
  const M = (n) => (game.fmtMoney ? game.fmtMoney(n) : money(n));
  const base = makeBoard(game.edition); // the London names, whatever edition the board is read as: they pick a utility's picture
  let html = '';
  for (const s of game.board) {
    const { row, col } = cellPos(s.i, per);
    const pr = game.props[s.i];
    const corner = s.i % per === 0;
    const owner = pr && pr.owner ? colourOf[pr.owner] : null;
    let bld = '';
    if (pr && pr.level) bld = pr.level === SKYSCRAPER ? 'SKY' : pr.level === HOTEL ? 'HOTEL' : '▲'.repeat(pr.level);
    if (pr && pr.depot) bld += ' DEPOT';
    const toks = (tokensAt[s.i] || []).map((p) => `<span class="tok" style="background:${esc(colourOf[p.id])}" title="${esc(p.name)}">${esc(p.name[0] || '?')}</span>`).join('');
    const side = row === n ? 'bottom' : col === 1 ? 'left' : row === 1 ? 'top' : 'right';
    // the stylesheet sizes a label from its square and its longest word (--w letters) so the word stays whole; a one-word corner (GO) runs larger
    const oneWord = !/\s/.test(s.name.trim());
    const icon = s.type === 'chance' ? ICONS.chance : s.type === 'chest' ? ICONS.chest : s.type === 'station' ? ICONS.station : s.type === 'utility' ? ICONS.utility[/water/i.test(base[s.i].name) ? 1 : /gas/i.test(base[s.i].name) ? 2 : 0] : '';
    const cls = ['cell', `side-${side}`, corner ? 'corner' : '', corner && oneWord ? 'one' : '', s.i === 0 ? 'go' : '', pr && pr.mortgaged ? 'mort' : '', s.price ? 'prop' : '', focus === s.i ? 'focus' : '', pinned === s.i ? 'pinned' : ''].filter(Boolean).join(' ');
    const w = longestWord(s.name, s.i === 0 ? 800 : corner ? 700 : 600, s.i === 0 ? 0.04 : 0.01);
    // the band sits at the inner edge: before the text on the bottom and right sides, after it on the top and left; in a top
    // square the text runs price, picture, name so the name meets the band and the price the outer edge, as on the others
    const band = s.group && GROUPS[s.group] && s.type === 'street' ? `<div class="band" style="--gc:${GROUPS[s.group].colour}"></div>` : '';
    const parts = [`<div class="name">${esc(s.name)}</div>`, icon, s.price ? `<div class="price">${esc(M(s.price))}</div>` : '', bld ? `<div class="bld">${bld}</div>` : '', s.i === 0 ? GO_ARROW : ''];
    const txt = `<div class="txt">${(side === 'top' && !corner ? parts.reverse() : parts).join('')}</div>`;
    html += `<div class="${cls}" data-i="${s.i}" style="grid-row:${row};grid-column:${col};--w:${w};${owner ? `--owner:${esc(owner)}` : ''}" title="${esc(s.name)}${s.price ? ' ' + esc(M(s.price)) : ''}${pr && pr.owner ? ' · ' + esc((game.player(pr.owner) || { name: pr.owner }).name) : ''}">
      ${side === 'bottom' || side === 'right' ? band : ''}
      ${owner ? '<div class="own"></div>' : ''}
      <div class="tokens">${toks}</div>
      ${txt}
      ${side === 'top' || side === 'left' ? band : ''}
    </div>`;
  }
  html += '<div class="centre" id="centre"></div>';
  board.innerHTML = html;
  sizeNames(board);
  renderCentre(game);
}
function renderCentre(game) {
  const el = $('#centre');
  if (!el) return;
  const last = game.events[game.events.length - 1];
  const lastRoll = [...game.events].reverse().find((e) => e.type === 'roll');
  const cur = game.players.find((p) => p.id === (last && (last.player || last.from)));
  const focus = pinned != null ? pinned : hovered;
  const st = statsOf(game);
  const middle = focus != null && game.board[focus] && game.board[focus].price ? propertyPanel(game, st, focus) : matchPanel(game, st);
  el.innerHTML = `
    <div class="cline">${esc(EDITION_INFO[game.edition].label)} · round ${game.round} · turn ${game.turn}</div>
    <div class="cmid">${middle}</div>
    <div class="cbox">
      <div class="dice">${lastRoll ? `🎲 ${lastRoll.dice.join(' + ')}${lastRoll.speed != null ? ` + ${typeof lastRoll.speed === 'number' ? lastRoll.speed : lastRoll.speed === 'mr' ? 'Mr Monopoly' : 'Bus'}` : ''}` : '🎲'}</div>
      <div class="last">${cur ? esc(cur.name) + ': ' : ''}${last ? esc(fmtEvent(last, game)) : 'Waiting for the first roll.'}</div>
      ${game.result ? `<div class="winner">Winner: ${esc(game.result.winnerName)}</div>` : ''}
    </div>`;
}
function matchPanel(game, st) {
  const m = st.match;
  const onTable = game.players.filter((p) => !p.bankrupt).reduce((a, p) => a + p.cash, 0);
  const tiles = [
    ['Goes', m.turns.toLocaleString()],
    ['Properties bought', `${m.bought}${m.auctions ? ` (${m.auctions} at auction)` : ''}`],
    ['Trades', m.trades],
    ['Cash on the table', money(onTable)],
    ['Made from the bank', money(m.bankIn)],
    ['Paid to the bank', money(m.bankOut)],
    ['Paid between players', money(m.between)],
    ['Of which rent', money(m.rent)],
  ];
  return `<div class="mlogo"><span>MONOPOLY</span></div>
    <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><div class="v">${esc(String(v))}</div><div class="k">${esc(k)}</div></div>`).join('')}</div>
    <div class="rolls"><div class="k">Rolls · ${m.rollCount} so far${meanRoll(m.rolls) ? ` · mean ${meanRoll(m.rolls).toFixed(2)}` : ''}</div>${rollChart(m.rolls, 220, 64)}</div>`;
}
function propertyPanel(game, st, i) {
  const s = game.board[i];
  const pr = game.props[i] || {};
  const ps = st.props[i] || { landings: 0, rent: 0, rentBy: {}, ledger: [] };
  const owner = pr.owner ? game.player(pr.owner) : null;
  const colour = s.group && GROUPS[s.group] ? GROUPS[s.group].colour : '#444';
  const deedInk = ['yellow', 'lightblue', 'utility'].includes(s.group) ? '#111' : '#fff';
  const earners = Object.entries(ps.rentBy).sort((a, b) => b[1] - a[1]).map(([id, amt]) => {
    const p = game.player(id);
    return `<li><span class="dot" style="background:${esc(p && p.meta.colour || '#888')}"></span>${esc(p ? p.name : id)} <b>${money(amt)}</b></li>`;
  }).join('');
  const ledger = ps.ledger.slice().reverse().map((l) => `<li><span class="r">r${l.round}</span> ${esc(l.text)}</li>`).join('');
  let state = '';
  if (pr.level) state = pr.level === SKYSCRAPER ? 'skyscraper' : pr.level === HOTEL ? 'hotel' : `${pr.level} house${pr.level > 1 ? 's' : ''}`;
  if (pr.depot) state += (state ? ', ' : '') + 'depot';
  if (pr.mortgaged) state += (state ? ', ' : '') + 'mortgaged';
  return `<div class="deed" style="--gc:${colour};--deed-ink:${deedInk}">
    <div class="deed-head">${esc(s.name)}</div>
    <div class="deed-body">
      <div class="line"><span>Owner</span><b>${owner ? `<span class="dot" style="background:${esc(owner.meta.colour || '#888')}"></span>${esc(owner.name)}` : 'the bank'}</b></div>
      <div class="line"><span>Price</span><b>${esc(money(s.price))}</b>${state ? `<span class="state">${esc(state)}</span>` : ''}</div>
      <div class="line"><span>Rent generated</span><b>${money(ps.rent)}</b></div>
      <div class="line"><span>Landed on</span><b>${ps.landings} time${ps.landings === 1 ? '' : 's'}</b></div>
      ${earners ? `<div class="sub">Earned by</div><ul class="earners">${earners}</ul>` : ''}
      <div class="sub">Ledger</div>
      ${ledger ? `<ul class="ledger">${ledger}</ul>` : '<div class="none">Still with the bank.</div>'}
      <div class="hint">${pinned === i ? 'Click again to release' : 'Click to keep this here'}</div>
    </div>
  </div>`;
}
// A small histogram of roll totals 2–12 with the two-dice expectation drawn over it.
function rollChart(h, w, hh) {
  const total = h.reduce((a, b) => a + b, 0);
  const bw = w / 11;
  const peak = Math.max(EXPECTED_ROLLS[7], total ? Math.max(...h.slice(2)) / total : 0) || 1;
  let bars = ''; const pts = [];
  for (let t = 2; t <= 12; t++) {
    const x = (t - 2) * bw;
    const share = total ? h[t] / total : 0;
    const bh = (share / peak) * (hh - 14);
    bars += `<rect x="${(x + 1).toFixed(1)}" y="${(hh - 12 - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1"><title>${t}: ${h[t]} (${total ? (share * 100).toFixed(1) : 0}%)</title></rect>`;
    bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${hh - 2}" text-anchor="middle">${t}</text>`;
    pts.push(`${(x + bw / 2).toFixed(1)},${(hh - 12 - (EXPECTED_ROLLS[t] / peak) * (hh - 14)).toFixed(1)}`);
  }
  return `<svg class="rollchart" viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}" role="img" aria-label="Distribution of roll totals">${bars}<polyline points="${pts.join(' ')}" fill="none"/></svg>`;
}
function renderPlayerCards(game) {
  const wrap = $('#player-cards');
  const last = game.events[game.events.length - 1];
  const currentId = last ? last.player || last.from : null;
  const st = statsOf(game);
  wrap.innerHTML = game.players.map((p) => {
    const ps = st.players[p.id] || st.blankPlayer();
    const props = game.ownedBy(p).map((i) => `<span class="chip" style="--gc:${esc(GROUPS[game.board[i].group].colour)}" title="${esc(game.board[i].name)} · rent earned ${money(ps.made.rent[i] || 0)}${game.props[i].mortgaged ? ' (mortgaged)' : ''}">${esc(game.board[i].name)}${game.props[i].level ? ` <i>${game.props[i].level === SKYSCRAPER ? 'S' : game.props[i].level === HOTEL ? 'H' : game.props[i].level}</i>` : ''}</span>`).join('');
    const rentRows = Object.entries(ps.made.rent).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([i, amt]) => `<li><span class="sw" style="background:${esc(GROUPS[game.board[i].group].colour)}"></span>${esc(game.board[i].name)}<b>${money(amt)}</b></li>`).join('');
    const lastReason = [...game.llmCalls].reverse().find((c) => c.player === p.id && c.parsed && c.parsed.reason);
    const meta = p.meta || {};
    return `<div class="pcard ${p.id === currentId ? 'current' : ''} ${p.bankrupt ? 'bankrupt' : ''}" style="--pc:${esc(meta.colour || '#888')}">
      <div class="n"><span><span class="dot" style="background:${esc(meta.colour || '#888')}"></span>${esc(p.name)}</span><span>${money(p.cash)}</span></div>
      <div class="m">${esc(modelLabel(meta))} · net ${money(p.bankrupt ? 0 : game.netWorth(p))}${p.inJail ? ' · in jail' : ''}${p.jailCards ? ' · ' + p.jailCards + ' jail card' : ''}${p.busTickets ? ' · ' + p.busTickets + ' bus ticket' : ''}${p.bankrupt ? ' · BANKRUPT' : ''} · ${p.stats.llmCalls} calls</div>
      <div class="props">${props || '<span class="none">no properties</span>'}</div>
      <div class="income">
        <div class="tot">Made <b>${money(ps.made.total)}</b> · paid <b>${money(ps.paid.total)}</b></div>
        <ul class="src">
          <li>Rent<b>${money(ps.made.rentTotal)}</b></li>
          <li>GO<b>${money(ps.made.go)}</b></li>
          <li>Bank, other<b>${money(ps.made.bank)}</b></li>
          <li>Players, other<b>${money(ps.made.players)}</b></li>
        </ul>
        ${rentRows ? `<ul class="src per">${rentRows}</ul>` : ''}
      </div>
      <div class="rolls"><div class="k">${ps.rollCount} roll${ps.rollCount === 1 ? '' : 's'}${meanRoll(ps.rolls) ? ` · mean ${meanRoll(ps.rolls).toFixed(2)}` : ''}</div>${rollChart(ps.rolls, 160, 48)}</div>
      ${lastReason ? `<div class="reason">“${esc(game.displayText ? game.displayText(lastReason.parsed.reason) : lastReason.parsed.reason)}”</div>` : ''}
    </div>`;
  }).join('');
}
// Hover shows a property in the centre; a click keeps it there until clicked again.
const boardEl = $('#board');
function cellIndex(ev) { const c = ev.target.closest('.cell.prop'); return c ? Number(c.dataset.i) : null; }
function markFocus() {
  const focus = pinned != null ? pinned : hovered;
  for (const c of boardEl.querySelectorAll('.cell.focus')) if (Number(c.dataset.i) !== focus) c.classList.remove('focus');
  if (focus != null) { const c = boardEl.querySelector(`.cell[data-i="${focus}"]`); if (c) c.classList.add('focus'); }
}
// Hovering any square shows its name large, in a label on the square's inner side, so the small lettering never has to be read.
const hoverName = $('#hover-name');
function showHoverName(cell) {
  const wrap = $('.board-wrap');
  const name = cell.querySelector('.name'), price = cell.querySelector('.price');
  hoverName.innerHTML = `${esc(name ? name.textContent : cell.title)}${price ? `<span class="p">${esc(price.textContent)}</span>` : ''}`;
  hoverName.hidden = false;
  const wr = wrap.getBoundingClientRect(), cr = cell.getBoundingClientRect();
  const ox = wr.left + wrap.clientLeft, oy = wr.top + wrap.clientTop, gap = 6;
  const lw = hoverName.offsetWidth, lh = hoverName.offsetHeight;
  let left = cr.left - ox + cr.width / 2 - lw / 2, top = cr.top - oy + cr.height / 2 - lh / 2;
  if (cell.classList.contains('side-bottom')) top = cr.top - oy - lh - gap;
  else if (cell.classList.contains('side-top')) top = cr.bottom - oy + gap;
  else if (cell.classList.contains('side-left')) left = cr.right - ox + gap;
  else if (cell.classList.contains('side-right')) left = cr.left - ox - lw - gap;
  hoverName.style.left = `${Math.max(gap, Math.min(wrap.clientWidth - lw - gap, left))}px`;
  hoverName.style.top = `${Math.max(gap, Math.min(wrap.clientHeight - lh - gap, top))}px`;
}
function hideHoverName() { hoverName.hidden = true; }
boardEl.addEventListener('mouseover', (ev) => {
  const cell = ev.target.closest('.cell');
  if (cell) showHoverName(cell); else hideHoverName();
  const i = cellIndex(ev); if (i == null || i === hovered) return; hovered = i; markFocus(); if (V.game && pinned == null) renderCentre(V.game);
});
boardEl.addEventListener('mouseleave', () => { hideHoverName(); hovered = null; markFocus(); if (V.game && pinned == null) renderCentre(V.game); });
// The full-screen viewer: the board alone, as large as the window allows, left with Escape, the F key or the corner
// button; the browser's own full-screen mode is asked for too where it exists, so the page's chrome goes as well.
const wrapEl = $('.board-wrap');
function enterFull() {
  wrapEl.classList.add('full'); document.body.classList.add('board-full');
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  fitBoard(); queueRender();
}
function leaveFull() {
  wrapEl.classList.remove('full'); document.body.classList.remove('board-full');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  fitBoard(); queueRender();
}
const toggleFull = () => (wrapEl.classList.contains('full') ? leaveFull() : enterFull());
$('#g-full').addEventListener('click', toggleFull);
$('#fs-exit').addEventListener('click', leaveFull);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && wrapEl.classList.contains('full')) leaveFull(); });
boardEl.addEventListener('click', (ev) => {
  const i = cellIndex(ev);
  if (i == null) { if (ev.target.closest('.centre') && pinned != null) { pinned = null; queueRender(); } return; }
  pinned = pinned === i ? null : i;
  queueRender();
});

// ---------- the games list ----------
let gamesOffset = 0;
const playersCell = (g) => g.players.map((p) => `<span class="pchip" style="--pc:${esc(p.colour || '#888')}" title="${esc(modelLabel(p))}">${esc(p.name)}</span>`).join(' ');
async function loadGames(reset) {
  const wrap = $('#games-table');
  if (reset) { gamesOffset = 0; wrap.innerHTML = '<p class="muted">Loading…</p>'; }
  try {
    const r = await api(`/games?limit=50&offset=${gamesOffset}`);
    const rows = r.games.map((g) => `<tr data-id="${esc(g.id)}">
      <td>${esc(fmtDate(g.startedAt))}</td>
      <td><a href="#game/${gid(g.id)}">${esc(g.id)}</a></td>
      <td>${esc(EDITION_INFO[g.edition] ? EDITION_INFO[g.edition].label : g.edition)}</td>
      <td class="players-cell">${playersCell(g)}</td>
      <td class="num">${g.rounds}</td>
      <td>${g.status === 'running' ? '<span class="status live">LIVE</span>' : g.status === 'finished' ? esc(g.winnerName || '') : esc(g.status)}</td>
      <td class="num">${(g.eventCount || g.lastSeq || 0).toLocaleString()}</td>
    </tr>`).join('');
    if (reset) wrap.innerHTML = `<table><thead><tr><th>Started</th><th>Game</th><th>Edition</th><th>Players</th><th class="num">Rounds</th><th>Winner</th><th class="num">Events</th></tr></thead><tbody id="games-body">${rows}</tbody></table>`;
    else $('#games-body').insertAdjacentHTML('beforeend', rows);
    gamesOffset += r.games.length;
    $('#games-count').textContent = `${r.total.toLocaleString()} game${r.total === 1 ? '' : 's'}`;
    $('#games-more').classList.toggle('hidden', gamesOffset >= r.total);
    if (!r.total) wrap.innerHTML = '<p class="muted">No games yet.</p>';
  } catch (e) { wrap.innerHTML = `<p class="muted">${esc(e.status === 503 ? 'The site has no database yet.' : e.message)}</p>`; }
}
$('#games-more').addEventListener('click', () => loadGames(false));
$('#games-table').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) location.hash = `#game/${gid(tr.dataset.id)}`; });

// ---------- Monopoly statistics ----------
const tile = (v, k) => `<div class="tile"><div class="v">${esc(String(v))}</div><div class="k">${esc(k)}</div></div>`;
function heatBoard(ed, squares, key, label) {
  const board = makeBoard(ed), per = board.length / 4, n = per + 1;
  const max = Math.max(1e-9, ...squares.map((s) => s[key] || 0));
  const cells = board.map((s) => {
    const { row, col } = cellPos(s.i, per);
    const v = squares[s.i] ? squares[s.i][key] || 0 : 0;
    const a = v / max;
    const name = nameAt(ed, s.i, s.name);
    const side = row === n ? 'side-bottom' : col === 1 ? 'side-left' : row === 1 ? 'side-top' : 'side-right';
    return `<div class="hcell ${side} ${s.i % per === 0 ? 'corner' : ''}" style="grid-row:${row};grid-column:${col};--w:${longestWord(name)};--heat:${(a * 0.85).toFixed(3)};color:${a > 0.55 ? '#fff' : 'var(--text)'}" title="${esc(name)}: ${v}"><span class="hn">${esc(name)}</span><span class="hv">${v}</span></div>`;
  }).join('');
  return `<div class="heat" style="grid-template-columns:${boardTracks(per)};grid-template-rows:${boardTracks(per)}">${cells}<div class="hcentre"><div class="mlogo"><span>MONOPOLY</span></div><div class="k">${esc(label)}</div></div></div>`;
}
async function loadStats() {
  const el = $('#stats');
  el.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
  try {
    const d = await api('/stats/monopoly');
    if (!d.games) { el.innerHTML = `<div class="card"><h2>Monopoly stats</h2><p class="muted">${d.running ? 'The first game is being played; the statistics appear when it ends.' : 'No finished games yet.'}</p></div>`; return; }
    const a = d.avg;
    let html = `<div class="card"><div class="card-head"><h2>The board, across ${d.games.toLocaleString()} finished game${d.games === 1 ? '' : 's'}</h2><span class="muted">${d.running ? `${d.running} being played now` : ''}</span></div>
      <div class="tiles wide">${tile(a.rounds, 'rounds a game')}${tile(a.turns, 'goes a game')}${tile(fmtDur(a.durationMs), 'a game lasts')}${tile(a.bought, 'properties bought')}${tile(a.auctions, 'at auction')}${tile(a.trades, 'trades a game')}${tile(a.bankruptcies, 'bankruptcies a game')}${tile(a.housesBuilt, 'buildings a game')}${tile(money(a.rent), 'rent paid a game')}${tile(money(a.bankIn), 'from the bank a game')}${tile(money(a.bankOut), 'to the bank a game')}${tile(money(a.between), 'between players a game')}${tile(money(a.winnerNetWorth), "winner's net worth")}${tile(a.messages, 'things said a game')}</div>
      <p class="muted">Games end: ${Object.entries(d.endReasons).map(([k, v]) => `${esc(k.replace(/_/g, ' '))} ${v}`).join(' · ')}. Editions: ${Object.entries(d.byEdition).map(([k, v]) => `${esc(EDITION_INFO[k] ? EDITION_INFO[k].label : k)} ${v}`).join(' · ')}.</p>
    </div>`;
    html += `<div class="card"><h2>How the dice fell</h2><p class="muted">${d.rollCount.toLocaleString()} rolls${meanRoll(d.rolls) ? `, mean ${meanRoll(d.rolls).toFixed(3)} against the 7.000 expected` : ''}. The line is what two fair dice should give.</p><div class="bigroll">${rollChart(d.rolls, 660, 180)}</div></div>`;
    const lengths = Object.entries(d.lengths).map(([b, n]) => ({ label: `${b}–${Number(b) + 9}`, value: n, colour: '#1fb25a' })).sort((x, y) => parseInt(x.label) - parseInt(y.label));
    html += `<div class="card"><h2>How long games run</h2><p class="muted">Games by rounds played.</p>${barChart(lengths, { width: 900, height: 220, valueLabel: (v) => v })}</div>`;
    for (const [ed, b] of Object.entries(d.boards)) {
      const sq = b.squares.map((s) => ({ ...s, name: nameAt(ed, s.i, s.name) }));
      const top = sq.slice().sort((x, y) => y.landingsPerGame - x.landingsPerGame).slice(0, 14).map((s) => ({ label: s.name, value: s.landingsPerGame, colour: s.group && GROUPS[s.group] ? GROUPS[s.group].colour : '#8c8c8c' }));
      const rentTop = sq.filter((s) => s.price).sort((x, y) => y.rentPerGame - x.rentPerGame).slice(0, 14).map((s) => ({ label: s.name, value: s.rentPerGame, colour: s.group && GROUPS[s.group] ? GROUPS[s.group].colour : '#8c8c8c' }));
      const groups = b.groups.map((g) => ({ label: g.name, value: g.rentPerGame, colour: g.colour }));
      html += `<div class="card"><h2>${esc(b.label)}${ed === 'standard' && currentSet().id !== 'london' ? `, read as ${esc(currentSet().label)}` : ''}: where the tokens land</h2><p class="muted">Landings per game on each square, over ${b.games} game${b.games === 1 ? '' : 's'}. The darker, the more often.</p>
        <div class="heat-wrap">${heatBoard(ed, sq, 'landingsPerGame', 'landings a game')}</div>
        <h3>Most landed on</h3>${barChart(top, { width: 900, height: 240, valueLabel: (v) => v })}
        <h3>Rent earned a game, by square</h3>${barChart(rentTop, { width: 900, height: 240, valueLabel: money })}
        <h3>Rent earned a game, by colour group</h3>${barChart(groups, { width: 900, height: 220, valueLabel: money })}
        <h3>Every property</h3>
        <div class="table-wrap"><table><thead><tr><th>Square</th><th class="num">Price</th><th class="num">Landings / game</th><th class="num">Rent / game</th><th class="num">Bought in</th><th class="num">At auction</th><th class="num">Auction price</th><th class="num">Changes hands</th><th class="num">Top building</th></tr></thead><tbody>
        ${sq.filter((s) => s.price).map((s) => `<tr><td><span class="sw" style="background:${esc(s.group && GROUPS[s.group] ? GROUPS[s.group].colour : '#8c8c8c')}"></span>${esc(s.name)}</td><td class="num">£${s.price}</td><td class="num">${s.landingsPerGame}</td><td class="num">${money(s.rentPerGame)}</td><td class="num">${pct(s.boughtShare)}</td><td class="num">${pct(s.auctionShare)}</td><td class="num">${s.avgAuctionPrice != null ? money(s.avgAuctionPrice) : '—'}</td><td class="num">${s.ownerChangesPerGame}</td><td class="num">${s.avgMaxLevel != null ? s.avgMaxLevel : '—'}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    }
    el.innerHTML = html;
    for (const h of el.querySelectorAll('.heat')) sizeNames(h);
  } catch (e) { el.innerHTML = `<div class="card"><p class="muted">${esc(e.status === 503 ? 'The site has no database yet.' : e.message)}</p></div>`; }
}

// ---------- model statistics ----------
async function loadModels() {
  const el = $('#models');
  el.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
  try {
    const d = await api('/stats/models');
    if (!d.models.length) { el.innerHTML = '<div class="card"><h2>Model stats</h2><p class="muted">No finished games yet.</p></div>'; return; }
    const ms = d.models;
    const colour = (m) => m.colour || '#8c8c8c';
    const name = (m) => m.name || m.model || m.provider;
    let html = `<div class="card"><div class="card-head"><h2>Every model's record</h2><span class="muted">over ${d.games.toLocaleString()} finished game${d.games === 1 ? '' : 's'}</span></div>
      <div class="table-wrap"><table class="models"><thead><tr><th>Player</th><th>Provider · model · effort</th><th class="num">Games</th><th class="num">Wins</th><th class="num">Win rate</th><th class="num">Avg rank</th><th class="num">Avg net worth</th><th class="num">Bankrupt</th><th class="num">Avg bankrupt round</th><th class="num">Rent in / game</th><th class="num">Rent out / game</th><th class="num">Bought</th><th class="num">Auctions</th><th class="num">Trades</th><th class="num">Buildings</th><th class="num">Jail</th><th class="num">Said</th><th class="num">Calls / game</th><th class="num">Fallbacks</th><th class="num">Illegal</th><th class="num">Latency</th><th class="num">Tokens in / out per call</th><th class="num">Mean roll</th></tr></thead><tbody>
      ${ms.map((m) => `<tr><td><span class="dot" style="background:${esc(colour(m))}"></span><b>${esc(name(m))}</b></td><td class="mk">${esc(m.provider)} · ${esc(m.model || '')}${m.effort ? ' @' + esc(m.effort) : ''}${Object.keys(m.servedModels).length ? `<div class="muted">served as ${esc(Object.keys(m.servedModels).join(', '))}</div>` : ''}</td><td class="num">${m.games}</td><td class="num">${m.wins}</td><td class="num">${pct(m.winRate)}</td><td class="num">${m.avgRank}</td><td class="num">${money(m.avgNetWorth)}</td><td class="num">${pct(m.bankruptRate)}</td><td class="num">${m.bankruptcies ? m.avgBankruptRound : '—'}</td><td class="num">${money(m.perGame.rentCollected)}</td><td class="num">${money(m.perGame.rentPaid)}</td><td class="num">${m.perGame.bought}</td><td class="num">${m.perGame.auctionsWon}</td><td class="num">${m.perGame.trades}</td><td class="num">${m.perGame.housesBuilt}</td><td class="num">${m.perGame.jail}</td><td class="num">${m.perGame.messages}</td><td class="num">${m.perGame.calls}</td><td class="num">${m.calls.fallbacks}</td><td class="num">${m.calls.illegal}</td><td class="num">${m.calls.n ? (m.calls.avgLatencyMs / 1000).toFixed(1) + ' s' : '—'}</td><td class="num">${m.calls.n ? `${m.calls.avgInput.toLocaleString()} / ${m.calls.avgOutput.toLocaleString()}` : '—'}</td><td class="num">${m.rollMean != null ? m.rollMean : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted">A model is identified by its provider, its exact model id and the effort it played with; "served as" is the model id the API itself reported back. Fallbacks are calls that failed or returned no usable JSON, so the rule-based player moved for that decision; illegal counts decisions the rules rejected.</p>
    </div>`;
    html += `<div class="card"><h2>Win rate</h2>${barChart(ms.map((m) => ({ label: name(m), value: Math.round(m.winRate * 1000) / 10, colour: colour(m) })), { width: 900, height: 240, valueLabel: (v) => v + '%' })}</div>`;
    html += `<div class="card"><h2>Average final net worth</h2>${barChart(ms.map((m) => ({ label: name(m), value: m.avgNetWorth, colour: colour(m) })), { width: 900, height: 240, valueLabel: money })}</div>`;
    html += `<div class="card"><h2>Rent collected a game</h2>${barChart(ms.map((m) => ({ label: name(m), value: m.perGame.rentCollected, colour: colour(m) })), { width: 900, height: 240, valueLabel: money })}</div>`;
    if (ms.some((m) => m.calls.n)) html += `<div class="card"><h2>Seconds a decision</h2>${barChart(ms.filter((m) => m.calls.n).map((m) => ({ label: name(m), value: Math.round(m.calls.avgLatencyMs / 100) / 10, colour: colour(m) })), { width: 900, height: 240, valueLabel: (v) => v + ' s' })}</div>`;
    html += `<div class="card"><h2>Each model's dice</h2><div class="mini-rolls">${ms.map((m) => `<div class="mini" style="--pc:${esc(colour(m))}"><div class="k"><span class="dot" style="background:${esc(colour(m))}"></span>${esc(name(m))} · ${m.rollCount.toLocaleString()} rolls${m.rollMean != null ? ` · mean ${m.rollMean}` : ''}</div>${rollChart(m.rolls, 200, 60)}</div>`).join('')}</div></div>`;
    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<div class="card"><p class="muted">${esc(e.status === 503 ? 'The site has no database yet.' : e.message)}</p></div>`; }
}

// ---------- the edition selector ----------
function renderNamesSelect() {
  $('#names-select').innerHTML = NAME_SETS.map((set) => `<option value="${esc(set.id)}" ${set.id === namesId ? 'selected' : ''}>${esc(set.label)} · ${esc(set.currency.symbol)}</option>`).join('');
}
function selectNames(id) {
  if (!NAME_SETS.some((x) => x.id === id)) return;
  namesId = id;
  try { localStorage.setItem(NAMES_KEY, id); } catch { /* storage unavailable */ }
  renderNamesSelect();
  if (V.game) { const at = V.cursor; V.game = null; seek(at); } else if ($('#view-game').classList.contains('active')) showEmptyBoard();
  if ($('#view-stats').classList.contains('active')) loadStats();
}
$('#names-select').addEventListener('change', (e) => selectNames(e.target.value));
renderNamesSelect();

// ---------- boot ----------
(async () => {
  try { health = await api('/health'); } catch { health = { db: false, narrator: false }; }
  if (!health.db) notice('The site has no database yet: the owner creates it once and the games appear here.');
  showEmptyBoard(health.db ? 'Loading…' : 'No database yet');
  route();
})();
