// Page controller: setup form, live board, saved games and analytics.
import { PROVIDERS, EFFORTS, listModels } from './providers.js';
import { GROUPS, EDITION_INFO } from './board.js';
import { HOTEL, SKYSCRAPER } from './engine.js';
import { Runner, gameRecord } from './runner.js';
import { saveGame, listGames, getGame, deleteGame, clearGames, loadSettings, saveSettings, download } from './store.js';
import { aggregate, csvSummary, barChart, lineChart } from './analytics.js';
import { StatsTracker, EXPECTED_ROLLS, meanRoll } from './stats.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PALETTE = ['#e63946', '#1d6fd1', '#2a9d8f', '#f4a261', '#8338ec', '#ff6f00', '#06a77d', '#d81b60'];
const KEYS_KEY = 'monopoly-ai-sim.keys';

// ---------- state ----------
let keys = {};
try { keys = JSON.parse(localStorage.getItem(KEYS_KEY) || '{}'); } catch { keys = {}; }
const modelLists = {};
let players = [];
let runner = null;
let batchSetup = null;
let watched = null;
let feedPaused = false;
let renderQueued = false;
const liveGames = new Map();

// ---------- tabs ----------
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  window.scrollTo(0, 0);
  if (name === 'games') renderGames();
  if (name === 'analytics') renderAnalytics();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ---------- keys ----------
function renderKeys() {
  const wrap = $('#keys');
  wrap.className = 'keys';
  wrap.innerHTML = '';
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.kind === 'none') continue;
    const row = document.createElement('div');
    row.className = 'key-row';
    row.innerHTML = `
      <div class="name">${esc(p.label)}${p.keyUrl ? ` <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">get key</a>` : ''}</div>
      <input type="password" placeholder="${id === 'custom' ? 'API key (optional)' : 'API key'}" value="${esc(keys[id] || '')}" data-key="${id}" autocomplete="off">
      <button class="btn small" data-fetch="${id}">Fetch models</button>
      ${id === 'custom' ? `<input type="url" placeholder="Base URL, e.g. http://localhost:11434/v1" value="${esc(keys.customBase || '')}" data-base="custom" style="grid-column: 1 / span 3">` : ''}
      <div class="status" data-status="${id}">${modelLists[id] ? `${modelLists[id].length} models loaded` : ''}</div>`;
    wrap.appendChild(row);
  }
  wrap.addEventListener('input', (e) => {
    if (e.target.dataset.key) keys[e.target.dataset.key] = e.target.value.trim();
    if (e.target.dataset.base) keys.customBase = e.target.value.trim();
    localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
  });
  wrap.addEventListener('click', async (e) => {
    const id = e.target.dataset.fetch;
    if (!id) return;
    const status = $(`[data-status="${id}"]`, wrap);
    status.textContent = 'Fetching…';
    try {
      const models = await listModels(id, keys[id], id === 'custom' ? keys.customBase : undefined);
      modelLists[id] = models;
      status.textContent = `${models.length} models available`;
      renderPlayers();
    } catch (err) {
      status.textContent = `Failed: ${err.message}. The browser console has details; a CORS block means this provider must be used through OpenRouter or a proxy.`;
    }
  });
}

// ---------- players ----------
function newPlayer() {
  const n = players.length + 1;
  const id = `p${Date.now().toString(36)}${n}`;
  return { id, name: `Player ${n}`, provider: 'anthropic', model: 'claude-opus-5-5', effort: '', temperature: '', instructions: '', colour: PALETTE[(n - 1) % PALETTE.length] };
}
function modelOptions(provider) {
  const p = PROVIDERS[provider] || PROVIDERS.custom;
  const list = Array.from(new Set([...(modelLists[provider] || []), ...p.models]));
  return list.map((m) => `<option value="${esc(m)}"></option>`).join('');
}
function renderPlayers() {
  const wrap = $('#players');
  wrap.innerHTML = '';
  players.forEach((pl, idx) => {
    const p = PROVIDERS[pl.provider] || PROVIDERS.custom;
    const card = document.createElement('div');
    card.className = 'player';
    card.style.setProperty('--pc', pl.colour);
    card.dataset.idx = idx;
    card.innerHTML = `
      <div class="head">
        <input type="color" value="${esc(pl.colour)}" data-f="colour" title="Token colour">
        <input type="text" value="${esc(pl.name)}" data-f="name" placeholder="Name">
        <button class="btn small danger" data-remove="${idx}" title="Remove player">✕</button>
      </div>
      <div class="two">
        <label>Provider <select data-f="provider">${Object.entries(PROVIDERS).map(([id, pr]) => `<option value="${id}" ${id === pl.provider ? 'selected' : ''}>${esc(pr.label)}</option>`).join('')}</select></label>
        <label>Model <input type="text" list="models-${esc(pl.provider)}" value="${esc(pl.model)}" data-f="model" ${p.kind === 'none' ? 'disabled' : ''}><datalist id="models-${esc(pl.provider)}">${modelOptions(pl.provider)}</datalist></label>
      </div>
      <div class="two">
        <label>Effort / reasoning <select data-f="effort" ${p.kind === 'none' ? 'disabled' : ''}><option value="">provider default</option>${EFFORTS.map((e) => `<option value="${e}" ${e === pl.effort ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
        <label>Temperature (optional) <input type="number" step="0.1" min="0" max="2" value="${esc(pl.temperature)}" data-f="temperature" placeholder="default" ${p.kind === 'none' ? 'disabled' : ''}></label>
      </div>
      <div class="note">${esc(p.effortNote)}</div>
      <textarea rows="3" data-f="instructions" placeholder="Strategic instructions for this player only, e.g. 'Be aggressive in auctions for orange and red. Never trade away a monopoly.'">${esc(pl.instructions)}</textarea>`;
    wrap.appendChild(card);
  });
}
$('#players').addEventListener('input', (e) => {
  const card = e.target.closest('.player');
  if (!card) return;
  const pl = players[Number(card.dataset.idx)];
  const f = e.target.dataset.f;
  if (!f) return;
  pl[f] = e.target.value;
  if (f === 'colour') card.style.setProperty('--pc', pl.colour);
  if (f === 'provider') {
    const p = PROVIDERS[pl.provider];
    pl.model = p.models[0];
    renderPlayers();
  }
  persist();
});
$('#players').addEventListener('click', (e) => {
  if (e.target.dataset.remove != null) { players.splice(Number(e.target.dataset.remove), 1); renderPlayers(); persist(); }
});
$('#add-player').addEventListener('click', () => {
  if (players.length >= 8) return;
  players.push(newPlayer());
  renderPlayers();
  persist();
});

// ---------- settings ----------
function readForm() {
  const out = {};
  for (const el of $$('#settings [name]')) out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  return out;
}
function writeForm(vals) {
  if (!vals) return;
  for (const el of $$('#settings [name]')) {
    if (!(el.name in vals)) continue;
    if (el.type === 'checkbox') el.checked = !!vals[el.name]; else el.value = vals[el.name];
  }
  toggleMega();
}
function toggleMega() {
  const mega = $('#settings [name=edition]').value === 'mega';
  $$('.mega-only').forEach((el) => el.classList.toggle('hidden', !mega));
}
$('#settings').addEventListener('input', () => { toggleMega(); persist(); });
$('#universal').addEventListener('input', persist);

function persist() {
  saveSettings({ players, universal: $('#universal').value, form: readForm() });
}
function restore() {
  const s = loadSettings();
  if (s) {
    players = s.players || [];
    $('#universal').value = s.universal || '';
    writeForm(s.form);
  }
  if (!players.length) {
    players = [
      { ...newPlayer(), name: 'Claude', provider: 'anthropic', model: 'claude-opus-5-5', colour: PALETTE[0] },
      { ...newPlayer(), name: 'GPT', provider: 'openai', model: 'gpt-5', colour: PALETTE[1] },
      { ...newPlayer(), name: 'Gemini', provider: 'google', model: 'gemini-2.5-pro', colour: PALETTE[2] },
      { ...newPlayer(), name: 'Rules bot', provider: 'heuristic', model: 'rules-v1', colour: PALETTE[3] },
    ].map((p, i) => ({ ...p, id: `p${i + 1}` }));
  }
  renderPlayers();
  toggleMega();
}
$('#export-settings').addEventListener('click', () => download('monopoly-sim-settings.json', JSON.stringify({ players, universal: $('#universal').value, form: readForm() }, null, 2)));
$('#import-settings').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (Array.isArray(s.players)) players = s.players;
    if (typeof s.universal === 'string') $('#universal').value = s.universal;
    writeForm(s.form);
    renderPlayers(); persist();
    $('#setup-status').textContent = 'Settings imported.';
  } catch (err) { $('#setup-status').textContent = `Import failed: ${err.message}`; }
});

// ---------- running ----------
function buildSetup() {
  const f = readForm();
  const config = {
    edition: f.edition,
    startingCash: f.startingCash ? Number(f.startingCash) : null,
    maxRounds: f.maxRounds ? Number(f.maxRounds) : null,
    auctionOnDecline: !!f.auctionOnDecline,
    bankAuction: !!f.bankAuction,
    shuffleOrder: !!f.shuffleOrder,
    freeParkingJackpot: !!f.freeParkingJackpot,
    aiPreroll: 'always',
    aiRaiseCash: true,
  };
  return {
    batchId: `batch-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`,
    players: players.map((p) => ({ ...p, provider: p.provider, model: p.model, effort: p.effort || null })),
    universal: $('#universal').value,
    config,
    games: Number(f.games) || 1,
    concurrency: Number(f.concurrency) || 1,
    seed: f.seed,
    keys,
    baseUrls: { custom: keys.customBase },
    maxTokens: 4000,
    timeoutMs: (Number(f.timeoutMs) || 600) * 1000,
    apiConcurrency: Number(f.apiConcurrency) || 8,
    logPrompts: !!f.logPrompts,
  };
}

$('#start').addEventListener('click', async () => {
  if (runner) return;
  if (players.length < 2) { $('#setup-status').textContent = 'Add at least two players.'; return; }
  const missing = players.filter((p) => PROVIDERS[p.provider]?.kind !== 'none' && !keys[p.provider] && p.provider !== 'custom').map((p) => PROVIDERS[p.provider].label);
  if (missing.length) { $('#setup-status').textContent = `Missing API key for: ${Array.from(new Set(missing)).join(', ')}. Those players will fall back to the rule-based bot.`; }
  else $('#setup-status').textContent = '';
  batchSetup = buildSetup();
  liveGames.clear();
  watched = null;
  $('#events').innerHTML = '';
  $('#llm-feed').innerHTML = '';
  $('#chat').innerHTML = '';
  $('#watch').innerHTML = '';
  $('#stop').disabled = false;
  showTab('play');
  const stats = { done: 0, calls: 0, inTok: 0, outTok: 0, fallbacks: 0, t0: Date.now() };
  runner = new Runner(batchSetup, {
    onGameStart(game) {
      liveGames.set(game.id, game);
      const opt = document.createElement('option');
      opt.value = game.id; opt.textContent = `${game.id} (running)`;
      $('#watch').appendChild(opt);
      if (!watched) { watched = game.id; $('#watch').value = game.id; }
      queueRender();
    },
    onEvent(ev, game) {
      if (game.id === watched) { appendEvent(ev, game); if (ev.type === 'chat') appendChat(ev, game); queueRender(); }
    },
    onLlm(rec, game) {
      stats.calls++;
      if (rec.usage) { stats.inTok += rec.usage.input || 0; stats.outTok += rec.usage.output || 0; }
      if (rec.fallback) stats.fallbacks++;
      if (game.id === watched) appendLlm(rec);
      updateProgress(stats);
    },
    async onGameEnd(game, result) {
      stats.done++;
      const opt = $(`#watch option[value="${game.id}"]`);
      if (opt) opt.textContent = `${game.id} (${result.winnerName ? 'won by ' + result.winnerName : result.endReason})`;
      try { await saveGame(gameRecord(game, batchSetup)); } catch (e) { console.error('save failed', e); }
      updateProgress(stats);
      if (game.id === watched) {
        const next = Array.from(liveGames.values()).find((g) => !g.result);
        if (next) { watched = next.id; $('#watch').value = next.id; $('#events').innerHTML = ''; $('#llm-feed').innerHTML = ''; $('#chat').innerHTML = ''; queueRender(); }
      }
    },
    onDone(summary) {
      runner = null;
      $('#stop').disabled = true;
      updateProgress(stats, summary);
    },
  });
  updateProgress(stats);
  runner.run().catch((e) => { console.error(e); $('#progress').textContent = `Error: ${e.message}`; runner = null; $('#stop').disabled = true; });
});
$('#stop').addEventListener('click', () => { if (runner) runner.stop(); });
$('#watch').addEventListener('change', (e) => { watched = e.target.value; pinned = null; hovered = null; $('#events').innerHTML = ''; $('#llm-feed').innerHTML = ''; $('#chat').innerHTML = ''; const g = liveGames.get(watched); if (g) for (const c of g.chat) appendChat({ player: c.from, to: c.to, message: c.message, round: c.round }, g); queueRender(); });
$('#feed-pause').addEventListener('change', (e) => { feedPaused = e.target.checked; });

function updateProgress(stats, summary) {
  const el = $('#progress');
  const secs = ((Date.now() - stats.t0) / 1000).toFixed(0);
  const total = batchSetup ? batchSetup.games : 0;
  el.textContent = `${summary ? 'Finished' : 'Running'}: ${stats.done}/${total} games · ${secs}s · ${stats.calls} model calls (${stats.fallbacks} fallbacks) · ${stats.inTok.toLocaleString()} in / ${stats.outTok.toLocaleString()} out tokens${summary && summary.aborted ? ' · stopped' : ''}`;
}

// ---------- live rendering ----------
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; const g = liveGames.get(watched); if (g) { renderBoard(g); renderPlayerCards(g); } });
}

function cellPos(i, perSide) {
  const n = perSide + 1;
  if (i <= perSide) return { row: n, col: n - i };
  if (i <= 2 * perSide) return { row: n - (i - perSide), col: 1 };
  if (i <= 3 * perSide) return { row: 1, col: 1 + (i - 2 * perSide) };
  return { row: 1 + (i - 3 * perSide), col: n };
}

let hovered = null;   // square index under the pointer
let pinned = null;    // square index fixed by a click
const trackers = new WeakMap();
function statsOf(game) {
  let t = trackers.get(game);
  if (!t) { t = new StatsTracker(game); trackers.set(game, t); }
  return t.update();
}
const money = (n) => '£' + Math.round(n).toLocaleString();

function renderBoard(game) {
  const board = $('#board');
  const per = game.perSide;
  const n = per + 1;
  board.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  const colourOf = {};
  for (const p of game.players) colourOf[p.id] = p.meta.colour || '#888';
  const tokensAt = {};
  for (const p of game.players) if (!p.bankrupt) (tokensAt[p.pos] = tokensAt[p.pos] || []).push(p);
  const focus = pinned != null ? pinned : hovered;
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
    html += `<div class="cell ${corner ? 'corner' : ''} ${side} ${pr && pr.mortgaged ? 'mort' : ''} ${s.price ? 'prop' : ''} ${focus === s.i ? 'focus' : ''} ${pinned === s.i ? 'pinned' : ''}" data-i="${s.i}" style="grid-row:${row};grid-column:${col};${owner ? `--owner:${esc(owner)}` : ''}" title="${esc(s.name)}${s.price ? ' £' + s.price : ''}${pr && pr.owner ? ' · ' + esc(game.player(pr.owner).name) : ''}">
      ${s.group && GROUPS[s.group] && s.type === 'street' ? `<div class="band" style="--gc:${GROUPS[s.group].colour}"></div>` : ''}
      ${owner ? '<div class="own"></div>' : ''}
      <div class="tokens">${toks}</div>
      <div class="name">${esc(s.name)}</div>
      ${s.price ? `<div class="price">£${s.price}</div>` : ''}
      ${bld ? `<div class="bld">${bld}</div>` : ''}
    </div>`;
  }
  html += '<div class="centre" id="centre"></div>';
  board.innerHTML = html;
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
      <div class="line"><span>Price</span><b>£${s.price}</b>${state ? `<span class="state">${esc(state)}</span>` : ''}</div>
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
  let bars = '', pts = [];
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
    return `<div class="pcard ${p.id === currentId ? 'current' : ''} ${p.bankrupt ? 'bankrupt' : ''}" style="--pc:${esc(p.meta.colour || '#888')}">
      <div class="n"><span><span class="dot" style="background:${esc(p.meta.colour || '#888')}"></span>${esc(p.name)}</span><span>${money(p.cash)}</span></div>
      <div class="m">${esc(p.meta.provider === 'heuristic' ? 'rule-based bot' : (p.meta.model || p.meta.provider) + (p.meta.effort ? ' @' + p.meta.effort : ''))} · net ${money(p.bankrupt ? 0 : game.netWorth(p))}${p.inJail ? ' · in jail' : ''}${p.jailCards ? ' · ' + p.jailCards + ' jail card' : ''}${p.busTickets ? ' · ' + p.busTickets + ' bus ticket' : ''}${p.bankrupt ? ' · BANKRUPT' : ''} · ${p.stats.llmCalls} calls</div>
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
      ${lastReason ? `<div class="reason">“${esc(lastReason.parsed.reason)}”</div>` : ''}
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
boardEl.addEventListener('mouseover', (ev) => { const i = cellIndex(ev); if (i == null || i === hovered) return; hovered = i; markFocus(); const g = liveGames.get(watched); if (g && pinned == null) renderCentre(g); });
boardEl.addEventListener('mouseleave', () => { hovered = null; markFocus(); const g = liveGames.get(watched); if (g && pinned == null) renderCentre(g); });
boardEl.addEventListener('click', (ev) => {
  const i = cellIndex(ev);
  if (i == null) { if (ev.target.closest('.centre') && pinned != null) { pinned = null; queueRender(); } return; }
  pinned = pinned === i ? null : i;
  queueRender();
});

function nm(game, id) { const p = game.player(id); return p ? p.name : id; }
function fmtEvent(e, game) {
  const P = (id) => nm(game, id);
  switch (e.type) {
    case 'game_start': return `Game ${game.id} starts (${e.edition}, seed ${e.seed}).`;
    case 'turn_start': return `— ${P(e.player)}'s turn (£${e.cash}) —`;
    case 'roll': return `rolls ${e.dice.join('+')}${e.speed != null ? ' + ' + (e.speed === 'mr' ? 'Mr Monopoly' : e.speed === 'bus' ? 'Bus' : e.speed) : ''}${e.triples ? ' TRIPLES!' : e.doubles ? ' (doubles)' : ''}${e.purpose ? ' [' + e.purpose + ']' : ''}`;
    case 'move': return `moves to ${e.to} ${e.square}${e.via && e.via !== 'direct' ? ' (' + e.via + ')' : ''}`;
    case 'pass_go': return `passes GO, collects £${e.amount}`;
    case 'buy_decision': return `${e.buy ? 'buys' : 'declines'} ${e.name}${e.reason ? ' — ' + e.reason : ''}`;
    case 'purchase': return `buys ${e.name} for £${e.price} (cash £${e.cash})`;
    case 'auction_start': return `AUCTION for ${e.name} (list £${e.price})`;
    case 'auction_bids': return `bids: ${e.bids.map((b) => `${P(b.player)} £${b.bid}`).join(', ')}`;
    case 'auction_won': return `${P(e.player)} wins ${e.name} at auction for £${e.price}`;
    case 'auction_unsold': return `${e.name} unsold`;
    case 'rent_due': return `owes £${e.amount} rent to ${P(e.to)} for ${e.name}`;
    case 'rent_skipped': return `no rent (mortgaged)`;
    case 'payment': return `${P(e.from)} pays £${e.amount} to ${e.to === 'bank' ? 'the bank' : P(e.to)} (${e.reason})`;
    case 'tax': return `${e.name}: £${e.amount}`;
    case 'card': return `draws ${e.deck === 'chance' ? 'Chance' : 'Community Chest'}: ${e.text}`;
    case 'collect': return `collects £${e.amount}`;
    case 'go_to_jail': return `goes to Jail`;
    case 'jail_stay': return `stays in jail (turn ${e.jailTurns})`;
    case 'jail_escape': return `rolls doubles and leaves jail`;
    case 'jail_fine_paid': return `pays £${e.amount} to leave jail`;
    case 'jail_forced_fine': return `must pay £${e.amount} after three turns in jail`;
    case 'jail_card_used': return `uses a Get Out of Jail Free card`;
    case 'jail_card_received': return `keeps a Get Out of Jail Free card`;
    case 'build': return `builds on ${e.name} → level ${e.level} (£${e.cost})`;
    case 'sell_building': return `sells a building on ${e.name} → level ${e.level} (+£${e.refund})`;
    case 'mortgage': return `mortgages ${e.name} (+£${e.value})`;
    case 'unmortgage': return `unmortgages ${e.name} (−£${e.cost})`;
    case 'build_depot': return `builds a depot on ${e.name}`;
    case 'raise_cash': return `must raise £${e.needed} (has £${e.cash}) for ${e.reason}`;
    case 'bankrupt': return `${P(e.player)} is BANKRUPT (owed £${e.owed} to ${e.creditor === 'bank' ? 'the bank' : P(e.creditor)})`;
    case 'assets_transferred': return `assets go to ${P(e.to)}`;
    case 'trade_proposed': return `${P(e.from)} proposes to ${P(e.to)}: gives ${e.give.props.map((i) => game.sqName(i)).join(', ') || '—'}${e.give.cash ? ' + £' + e.give.cash : ''} for ${e.get.props.map((i) => game.sqName(i)).join(', ') || '—'}${e.get.cash ? ' + £' + e.get.cash : ''}${e.message ? ' — "' + e.message + '"' : ''}`;
    case 'trade_response': return `${P(e.to)} ${e.accept ? 'ACCEPTS' : 'rejects'}${e.reason ? ' — ' + e.reason : ''}`;
    case 'trade_counter': return `${P(e.from)} counters: gives ${e.give.props.map((i) => game.sqName(i)).join(', ') || '—'}${e.give.cash ? ' + £' + e.give.cash : ''} for ${e.get.props.map((i) => game.sqName(i)).join(', ') || '—'}${e.get.cash ? ' + £' + e.get.cash : ''}${e.reason ? ' — ' + e.reason : ''}`;
    case 'trade_lapsed': return `negotiation between ${P(e.from)} and ${P(e.to)} ends without a deal`;
    case 'trade_completed': return `trade completed`;
    case 'chat': return e.to ? `whispers to ${P(e.to)}: “${e.message}”` : `says: “${e.message}”`;
    case 'repairs': return `repairs: ${e.houses} houses, ${e.hotels} hotels → £${e.amount}`;
    case 'mr_monopoly': return e.kind === 'nothing' ? 'Mr Monopoly: nothing to move to' : `Mr Monopoly sends ${P(e.player)} to ${e.name}`;
    case 'bus_ticket_taken': return `takes a bus ticket (${e.via})`;
    case 'bus_ticket_used': return `uses a bus ticket to move to ${game.sqName(e.to)}`;
    case 'bus_ticket_none': return 'no bus tickets left';
    case 'triples': return `TRIPLES: chooses ${e.name}${e.reason ? ' — ' + e.reason : ''}`;
    case 'auction_square': return e.result ? 'Auction square: nothing to auction' : `Auction square: puts ${e.name} up for auction`;
    case 'birthday_gift': return `Birthday Gift: £${e.amount}`;
    case 'three_doubles': return `three doubles in a row!`;
    case 'illegal_decision': return `(model gave an illegal ${e.decision} decision: ${e.reason}; using fallback)`;
    case 'illegal_action': return `(illegal action ignored: ${e.reason})`;
    case 'ai_fallback': return `(model call failed for ${e.decision}: ${e.reason}; heuristic used)`;
    case 'game_end': return `GAME OVER after ${e.rounds} rounds: ${e.winnerName} wins (${e.endReason}).`;
    default: return `${e.type} ${JSON.stringify(e).slice(0, 120)}`;
  }
}
function appendEvent(e, game) {
  if (feedPaused) return;
  const feed = $('#events');
  const div = document.createElement('div');
  div.className = `ev-${e.type}`;
  const who = e.player && e.type !== 'turn_start' && !['payment', 'bankrupt', 'auction_won', 'trade_proposed', 'trade_response', 'mr_monopoly'].includes(e.type) ? nm(game, e.player) + ' ' : '';
  div.textContent = `[r${e.round}] ${who}${fmtEvent(e, game)}`;
  feed.appendChild(div);
  while (feed.childElementCount > 400) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
}
function appendChat(e, game) {
  const feed = $('#chat');
  const div = document.createElement('div');
  const from = game.player(e.player);
  const colour = from && from.meta ? from.meta.colour : '#888';
  div.innerHTML = `<span class="who" style="--c:${esc(colour)}">${esc(nm(game, e.player))}</span>${e.to ? ` <span class="priv">(to ${esc(nm(game, e.to))})</span>` : ''}: ${esc(e.message)}`;
  feed.appendChild(div);
  while (feed.childElementCount > 300) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
}
function appendLlm(rec) {
  if (feedPaused) return;
  const feed = $('#llm-feed');
  const div = document.createElement('div');
  if (rec.error) div.className = 'err';
  const u = rec.usage ? ` ${rec.usage.input}→${rec.usage.output} tok${rec.usage.cached ? ` (${rec.usage.cached} cached)` : ''}` : '';
  div.textContent = `${rec.playerName} · ${rec.decision} · ${rec.model}${rec.effort ? '@' + rec.effort : ''} · ${rec.latencyMs} ms${u} · ${rec.error ? 'ERROR ' + rec.error : JSON.stringify(rec.parsed)}`;
  feed.appendChild(div);
  while (feed.childElementCount > 300) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
}

// ---------- saved games ----------
async function renderGames() {
  const recs = await listGames();
  const wrap = $('#games-table');
  if (!recs.length) { wrap.innerHTML = '<p class="muted">No games saved yet.</p>'; return; }
  wrap.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Game</th><th>When</th><th>Edition</th><th>Players</th><th>Winner</th><th class="num">Rounds</th><th>End</th><th class="num">Calls</th><th class="num">Tokens</th><th></th></tr></thead><tbody>
    ${recs.map((r) => {
      const calls = (r.llmCalls || []).length;
      const tok = (r.llmCalls || []).reduce((a, c) => a + ((c.usage && (c.usage.input + c.usage.output)) || 0), 0);
      return `<tr><td>${esc(r.id)}</td><td>${esc(new Date(r.createdAt).toLocaleString())}</td><td>${esc(r.edition)}</td><td>${r.players.map((p) => `${esc(p.name)} <span class="muted">(${esc(p.provider === 'heuristic' ? 'rules' : p.model)})</span>`).join('<br>')}</td><td>${esc(r.result?.winnerName || '—')}</td><td class="num">${r.result?.rounds ?? ''}</td><td>${esc(r.result?.endReason || '')}</td><td class="num">${calls}</td><td class="num">${tok.toLocaleString()}</td>
      <td><button class="btn small" data-view="${esc(r.id)}">View</button> <button class="btn small" data-export="${esc(r.id)}">JSON</button> <button class="btn small danger" data-del="${esc(r.id)}">Delete</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  const batches = Array.from(new Set(recs.map((r) => r.batchId).filter(Boolean)));
  const sel = $('#batch-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">all games</option>' + batches.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  sel.value = cur;
}
$('#games-table').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.view) showGameDetail(await getGame(t.dataset.view));
  if (t.dataset.export) { const r = await getGame(t.dataset.export); download(`${r.id}.json`, JSON.stringify(r, null, 2)); }
  if (t.dataset.del) { await deleteGame(t.dataset.del); renderGames(); }
});
$('#export-all').addEventListener('click', async () => download(`monopoly-games-${Date.now()}.json`, JSON.stringify(await listGames())));
$('#export-jsonl').addEventListener('click', async () => download(`monopoly-games-${Date.now()}.jsonl`, (await listGames()).map((r) => JSON.stringify(r)).join('\n'), 'application/x-ndjson'));
$('#export-csv').addEventListener('click', async () => download(`monopoly-summary-${Date.now()}.csv`, csvSummary(await listGames()), 'text/csv'));
$('#clear-games').addEventListener('click', async () => { if (confirm('Delete every saved game from this browser?')) { await clearGames(); renderGames(); $('#game-detail').classList.add('hidden'); } });

function showGameDetail(r) {
  if (!r) return;
  const el = $('#game-detail');
  el.classList.remove('hidden');
  const colours = {}; for (const p of r.players) colours[p.id] = p.colour || '#888';
  const series = r.players.map((p) => ({ label: p.name, colour: colours[p.id], points: r.snapshots.map((s) => ({ x: s.round, y: (s.players.find((x) => x.id === p.id) || {}).netWorth || 0 })) }));
  const calls = r.llmCalls || [];
  el.innerHTML = `<div class="card-head"><h2>${esc(r.id)}</h2><button class="btn small" id="close-detail">Close</button></div>
    <p class="muted">${esc(r.edition)} · ${r.result?.rounds} rounds · ${r.result?.turns} turns · ${((r.result?.durationMs || 0) / 1000).toFixed(1)} s · ${esc(r.result?.endReason)} · seed ${r.seed}</p>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Player</th><th>Model</th><th class="num">Net worth</th><th class="num">Cash</th><th class="num">Calls</th><th class="num">Fallbacks</th><th class="num">Avg latency</th><th class="num">Tokens in/out</th><th class="num">Trades</th><th class="num">Messages</th><th class="num">Rent +/−</th></tr></thead><tbody>
    ${(r.result?.ranking || []).map((rk, i) => { const p = r.players.find((x) => x.id === rk.id); const cs = calls.filter((c) => c.player === p.id); const lat = cs.length ? Math.round(cs.reduce((a, c) => a + (c.latencyMs || 0), 0) / cs.length) : 0; const tin = cs.reduce((a, c) => a + ((c.usage && c.usage.input) || 0), 0), tout = cs.reduce((a, c) => a + ((c.usage && c.usage.output) || 0), 0);
      return `<tr><td>${i + 1}</td><td><span style="color:${esc(colours[p.id])}">●</span> ${esc(p.name)}${rk.bankrupt ? ' (bankrupt r' + rk.bankruptRound + ')' : ''}</td><td>${esc(p.provider === 'heuristic' ? 'rules' : p.model)}${p.effort ? ' @' + esc(p.effort) : ''}</td><td class="num">£${rk.netWorth.toLocaleString()}</td><td class="num">£${rk.cash.toLocaleString()}</td><td class="num">${cs.length}</td><td class="num">${p.stats.fallbacks}</td><td class="num">${lat} ms</td><td class="num">${tin.toLocaleString()} / ${tout.toLocaleString()}</td><td class="num">${p.stats.trades}</td><td class="num">${p.stats.messages || 0}</td><td class="num">${p.stats.rentCollected} / ${p.stats.rentPaid}</td></tr>`; }).join('')}
    </tbody></table></div>
    <h3>Net worth by round</h3>
    <div class="legend">${series.map((s) => `<span style="--c:${esc(s.colour)}">${esc(s.label)}</span>`).join('')}</div>
    ${lineChart(series, { yLabel: (v) => '£' + v })}
    <h3>Table talk (${(r.chat || []).length})</h3>
    <div class="feed chat" style="height:260px">${(r.chat || []).map((c) => { const f = r.players.find((p) => p.id === c.from) || {}; const t = c.to ? (r.players.find((p) => p.id === c.to) || {}).name : null; return `<div><span class="muted">[r${c.round}]</span> <span class="who" style="--c:${esc(f.colour || '#888')}">${esc(f.name || c.from)}</span>${t ? ` <span class="priv">(to ${esc(t)})</span>` : ''}: ${esc(c.message)}</div>`; }).join('')}</div>
    <h3>Model calls (${calls.length})</h3>
    <div class="feed llm" style="height:300px">${calls.map((c) => `<div class="${c.error ? 'err' : ''}">[r${c.round}] ${esc(c.playerName)} · ${esc(c.decision)} · ${esc(c.model)} · ${c.latencyMs} ms · ${c.error ? 'ERROR ' + esc(c.error) : esc(JSON.stringify(c.parsed))}</div>`).join('')}</div>
    <h3>Event log (${r.events.length})</h3>
    <div class="feed" style="height:300px">${r.events.map((e) => `<div>[r${e.round}] ${esc(e.player && e.type !== 'turn_start' ? (r.players.find((p) => p.id === e.player) || {}).name + ' ' : '')}${esc(fmtEventRecord(e, r))}</div>`).join('')}</div>`;
  $('#close-detail').addEventListener('click', () => el.classList.add('hidden'));
  el.scrollIntoView({ behavior: 'smooth' });
}
function fmtEventRecord(e, r) {
  // Minimal game-like shim so fmtEvent can be reused for saved records.
  const shim = { id: r.id, player: (id) => r.players.find((p) => p.id === id), sqName: (i) => (e.name && e.property === i ? e.name : `#${i}`) };
  return fmtEvent(e, shim);
}

// ---------- analytics ----------
$('#batch-filter').addEventListener('change', renderAnalytics);
async function renderAnalytics() {
  const all = await listGames();
  const batch = $('#batch-filter').value;
  const recs = batch ? all.filter((r) => r.batchId === batch) : all;
  const el = $('#analytics');
  if (!recs.length) { el.innerHTML = '<p class="muted">No games to analyse yet.</p>'; return; }
  const agg = aggregate(recs);
  const colourFor = {}; for (const r of recs) for (const p of r.players) colourFor[p.name] = p.colour;
  const rounds = recs.map((r) => r.result?.rounds || 0);
  const ends = {}; for (const r of recs) ends[r.result?.endReason] = (ends[r.result?.endReason] || 0) + 1;
  el.innerHTML = `<p class="muted">${recs.length} games · average ${(rounds.reduce((a, b) => a + b, 0) / recs.length).toFixed(1)} rounds · endings: ${Object.entries(ends).map(([k, v]) => `${k} ${v}`).join(', ')} · total model calls ${recs.reduce((a, r) => a + (r.llmCalls || []).length, 0).toLocaleString()}</p>
    <div class="table-wrap"><table><thead><tr><th>Player · model</th><th class="num">Games</th><th class="num">Wins</th><th class="num">Win %</th><th class="num">Avg rank</th><th class="num">Bankrupt</th><th class="num">Avg net worth</th><th class="num">Calls/game</th><th class="num">Fallback %</th><th class="num">Illegal</th><th class="num">Avg latency</th><th class="num">Tokens/call in/out</th><th class="num">Cached %</th><th class="num">Trades</th><th class="num">Messages</th><th class="num">Auctions won</th><th class="num">Rent +/−</th></tr></thead><tbody>
    ${agg.map((a) => `<tr><td><span style="color:${esc(colourFor[a.name] || '#888')}">●</span> ${esc(a.key)}</td><td class="num">${a.games}</td><td class="num">${a.wins}</td><td class="num">${(100 * a.wins / a.games).toFixed(0)}%</td><td class="num">${(a.rankSum / a.games).toFixed(2)}</td><td class="num">${a.bankrupt}</td><td class="num">£${Math.round(a.netWorth / a.games).toLocaleString()}</td><td class="num">${(a.calls / a.games).toFixed(1)}</td><td class="num">${a.calls ? (100 * a.fallbacks / a.calls).toFixed(1) : '0'}%</td><td class="num">${a.illegal}</td><td class="num">${a.calls ? Math.round(a.latency / a.calls) : 0} ms</td><td class="num">${a.calls ? Math.round(a.inTok / a.calls) : 0} / ${a.calls ? Math.round(a.outTok / a.calls) : 0}</td><td class="num">${a.inTok ? (100 * a.cached / a.inTok).toFixed(0) : 0}%</td><td class="num">${a.trades}</td><td class="num">${a.messages}</td><td class="num">${a.auctions}</td><td class="num">${Math.round(a.rentCollected / a.games)} / ${Math.round(a.rentPaid / a.games)}</td></tr>`).join('')}
    </tbody></table></div>
    <h3>Win rate</h3>
    ${barChart(agg.map((a) => ({ label: a.name, value: Math.round(1000 * a.wins / a.games) / 10, colour: colourFor[a.name] })), { valueLabel: (v) => v + '%' })}
    ${agg.some((a) => a.calls) ? `<h3>Average model latency (ms)</h3>${barChart(agg.filter((a) => a.calls).map((a) => ({ label: a.name, value: Math.round(a.latency / a.calls), colour: colourFor[a.name] })))}` : ''}
    <h3>Average net worth at game end</h3>
    ${barChart(agg.map((a) => ({ label: a.name, value: Math.round(a.netWorth / a.games), colour: colourFor[a.name] })), { valueLabel: (v) => '£' + v })}`;
}

// ---------- init ----------
renderKeys();
restore();
