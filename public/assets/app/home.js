// The homepage: the players at the top, the pool of models the runner draws its tables from with each one's record,
// then the games, Monopoly with what is on its table now and the games to come. It reads the site's API only.
import { modelName, apiName, modelLogo, modelMaker } from './pricing.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
async function api(path) {
  const r = await fetch(`/api${path}`);
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json();
}
// A model's mark: its maker's whole logo as a sticker, as its token wears it on the boards, or its initial.
const mark = (p, cls = 'sticker') => {
  const logo = modelLogo(p.provider, p.model);
  return logo ? `<span class="${cls}" style="--logo:url(/assets/logos/${logo}.svg)" title="${esc(p.name || '')}"></span>`
    : `<span class="${cls} initial" style="--pc:${esc(p.colour || '#888')}" title="${esc(p.name || '')}">${esc((p.name || '?')[0])}</span>`;
};

// ---- the players ----
const SOURCES = {
  runner: (at) => `The pool the runner last reported${at ? `, ${fmtDate(at)}` : ''}.`,
  games: () => 'The models that have played so far.',
  default: () => 'The default table, until the runner reports its pool.',
};
function playerCard(p) {
  const bot = p.provider === 'heuristic';
  const name = bot ? 'Rule-based bot' : modelName(p.provider, p.model);
  const maker = modelMaker(p.provider, p.model);
  const m = p.monopoly || { games: 0, wins: 0, winRate: 0 };
  const record = m.games ? `${plural(m.games, 'Monopoly game')} · ${plural(m.wins, 'win')} (${pct(m.winRate)})` : 'No Monopoly game finished yet';
  return `<li class="player" style="--pc:${esc(p.colour || '#888')}">
    ${mark(p)}
    <div class="who">
      <b class="name">${esc(name)}</b>
      <span class="sub">${esc([maker, bot ? 'plays by the rules, no API' : `via ${apiName(p.provider)}`].filter(Boolean).join(' · '))}</span>
      <span class="id">${esc(bot ? 'rules-v1' : p.model)}${p.effort ? ` · effort ${esc(p.effort)}` : ''}</span>
      <span class="seat"><span class="dot" style="background:${esc(p.colour || '#888')}"></span>Plays as ${esc(p.name || name)}</span>
      <span class="rec">${esc(record)}</span>
    </div>
    ${p.playing ? '<span class="badge live">At the table</span>' : ''}
  </li>`;
}
async function loadPlayers() {
  const list = $('#players'), note = $('#players-note');
  try {
    const d = await api('/players');
    list.innerHTML = d.players.length ? d.players.map(playerCard).join('') : '<li class="muted">No players yet.</li>';
    note.textContent = (SOURCES[d.source] || SOURCES.default)(d.updatedAt);
  } catch (e) {
    list.innerHTML = `<li class="muted">${esc(e.status === 503 ? 'The site has no database yet, so it does not know its players.' : `Could not load the players: ${e.message}`)}</li>`;
    note.textContent = '';
  }
}

// ---- Monopoly: what is on its table now ----
async function loadMonopoly() {
  const line = $('#mono-status'), badge = $('#mono-badge');
  try {
    const [live, list] = await Promise.all([api('/live'), api('/games?limit=1')]);
    const g = live.running[0];
    const played = `${plural(list.total, 'game')} kept`;
    if (g) {
      badge.textContent = 'Live now'; badge.className = 'badge live';
      line.innerHTML = `<span>Round ${g.rounds} of game ${esc(g.id)}, ${plural(g.players.length, 'model')} at the table</span><span class="marks">${g.players.map((p) => mark(p, 'mini')).join('')}</span><span>${played}</span>`;
    } else if (live.latest) {
      const l = live.latest;
      badge.textContent = 'Between games'; badge.className = 'badge';
      line.innerHTML = `<span>Latest: ${esc(l.winnerName || 'no winner')} won after ${l.rounds} rounds</span><span class="marks">${l.players.map((p) => mark(p, 'mini')).join('')}</span><span>${played}</span>`;
    } else {
      line.textContent = 'No game yet: the first appears here as soon as the runner starts it.';
    }
  } catch (e) {
    line.textContent = e.status === 503 ? 'The games appear here once the site has its database.' : `Could not reach the table: ${e.message}`;
  }
}

loadPlayers();
loadMonopoly();
// the table and the players move on while the page is open
setInterval(() => { if (!document.hidden) { loadMonopoly(); loadPlayers(); } }, 30000);
