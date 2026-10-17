#!/usr/bin/env node
// Drives the viewer in headless Chromium against a local Worker with the
// local database, after at least two bot games have been played into it:
//
//   npm run migrate:local && npm run dev            (in one terminal)
//   node runner/run.mjs --config runner/config.bots.json --token local-dev-token --games 2
//   node scripts/verify-viewer.mjs                  (screenshots in .render-check/viewer/)
//
// It checks the homepage (the players against the pool the site holds, the games
// and an old link to the viewer), the Monopoly page at /monopoly/: the live tab,
// the replay controls, the games list, both statistics
// pages, a live game played slowly by the bots while the page follows it, the
// ledgers under a game against the statistics worked out here from its events,
// the roll charts' label and the phone layout; with a trading game seeded by
// scripts/seed-trades.mjs, the trades ledger, the forfeits on the players' cards
// and the models' logos on the tokens too. PLAYWRIGHT_MODULE and CHROME_PATH point it at a browser when playwright
// is not installed in this repository.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReplayGame } from '../public/assets/app/replay.js';
import { StatsTracker } from '../public/assets/app/stats.js';
import { modelLogo } from '../public/assets/app/pricing.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.OUT || '.render-check/viewer';
mkdirSync(out, { recursive: true });
const url = (process.env.SITE || 'http://127.0.0.1:8789').replace(/\/?$/, '/');
const mono = url + 'monopoly/'; // the Monopoly viewer's page; the homepage of the games is the site's root
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push('console: ' + m.text()); }); // a missing game answers 404 by design
const must = (c, msg) => { if (!c) throw new Error('FAILED: ' + msg); console.log('ok  ' + msg); };
const text = (sel) => page.evaluate((s) => (document.querySelector(s) || { innerText: '' }).innerText, sel);
const hidden = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return !el || el.classList.contains('hidden') || !el.offsetParent; }, sel);
const at = () => page.evaluate(() => document.querySelector('#r-info').textContent); // kept up to date while the bar is hidden
const wait = (ms) => page.waitForTimeout(ms);
// 0. the homepage: the players at the top, the pool as the site has it, then the games, Monopoly first and the four to come
const pl = await (await fetch(url + 'api/players')).json();
await page.goto(url); await page.waitForFunction(() => document.querySelectorAll('#players .player').length > 0 && !/Looking/.test(document.querySelector('#mono-status').textContent), null, { timeout: 15000 });
must(await page.$eval('main h2', (h) => h.textContent) === 'The players', 'the homepage opens with the players');
must((await page.$$('#players .player')).length === pl.players.length, `a card for each of the ${pl.players.length} players in the pool (${pl.source})`);
const withLogo = pl.players.filter((p) => modelLogo(p.provider, p.model)).length;
must((await page.$$('#players .sticker:not(.initial)')).length === withLogo, `each of the ${withLogo} models wears its maker's logo`);
must(JSON.stringify(await page.$$eval('.game-card h3', (h) => h.map((x) => x.textContent))) === JSON.stringify(['Monopoly', 'Chess', 'Checkers', 'Battleship', 'Connect 4']) && (await page.$$('.game-card .badge.soon')).length === 4, 'Monopoly, then chess, checkers, Battleship and Connect 4 coming soon');
must((await page.getAttribute('.live-game .btn.primary', 'href')) === '/monopoly/#live' && /kept/.test(await text('#mono-status')), 'Monopoly leads to its own page and says what is on its table: ' + (await text('#mono-status')).replace(/\s+/g, ' '));
await page.screenshot({ path: `${out}/home.png`, fullPage: true });
// an old link loads the homepage, which sends it on at once (the first navigation may be cut short by the second)
await page.goto('about:blank'); await page.goto(url + '#games').catch(() => {}); await page.waitForURL(/\/monopoly\/#games$/, { timeout: 10000 });
must(true, 'a link to the viewer from before the homepage (/#games) opens on the Monopoly page');
await page.goto(url); await page.evaluate(() => { location.hash = '#stats'; }); await page.waitForURL(/\/monopoly\/#stats$/, { timeout: 10000 });
must(true, 'and so does one typed while the homepage is open (#stats)');
await page.goto(url); await page.click('.tabs a[href="#the-games"]'); await wait(300);
must(new URL(page.url()).pathname === '/' && new URL(page.url()).hash === '#the-games', "the homepage's own tabs stay on the homepage");
// 1. live tab with no running game: the latest finished game
const liveNow = await (await fetch(url + 'api/live')).json();
const L = liveNow.latest; const N = L.eventCount;
const list = await (await fetch(url + 'api/games?limit=50')).json();
await page.goto(mono); await page.waitForFunction(() => /FINISHED|LIVE|RUNNING/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
must(/No game is being played right now/.test(await text('#notice')), 'live tab says the table is quiet and shows the latest game');
must(/FINISHED/.test(await text('#g-status')), 'status reads FINISHED');
must(await hidden('#replay'), 'the Live tab shows no replay controls');
must(/Replay this game/.test(await text('#g-link')) && (await page.getAttribute('#g-link', 'href')) === `#game/${encodeURIComponent(L.id)}`, 'the finished game is offered as a replay');
must(new RegExp(`event ${N} of ${N}`).test(await at()), 'the board sits at the end: ' + await at());
must(new RegExp(`round ${L.rounds} · turn ${L.turns}`).test(await text('#centre')), 'centre shows the final round and turn');
must(/GOES|Goes/.test(await text('#centre')) && new RegExp('Winner: ' + L.winnerName).test(await text('#centre')), 'match stats and the winner in the centre');
must((await page.$$('#player-cards .pcard')).length === L.players.length, `a card for each of the ${L.players.length} players`); // the latest game sets the count: the pool draw seats any number up to eight
if (L.players.some((p) => p.bankrupt)) must(/BANKRUPT/i.test(await text('#player-cards')), 'bankrupt players marked');
const rect = await page.evaluate(() => { const r = document.querySelector('.board-wrap').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
must(rect, 'board fully inside the window');
await page.screenshot({ path: `${out}/live-latest.png` });
// 2. replay controls, on the older game's own page
await page.click('#g-link'); await page.waitForFunction(() => !document.querySelector('#replay').classList.contains('hidden') && /event \d+ of/.test(document.querySelector('#r-info').innerText), null, { timeout: 20000 });
must(new RegExp(`event ${N} of ${N}`).test(await text('#r-info')) && /Link to this game/.test(await text('#g-link')), 'opened as a replay, the controls show, at the end');
await page.click('#r-first'); await wait(200);
must(new RegExp(`event 0 of ${N}`).test(await text('#r-info')), 'first: event 0');
must(/round 0 · turn 0/.test(await text('#centre')), 'board at the start');
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await wait(200);
must(new RegExp(`event 3 of ${N}`).test(await text('#r-info')), 'three steps forward by keyboard');
const ev3 = await page.evaluate(() => document.querySelectorAll('#events div').length);
must(ev3 === 3, 'events feed shows three lines: ' + ev3);
await page.selectOption('#r-speed', '60'); await page.click('#r-play'); await wait(1500); await page.click('#r-play');
const info = await text('#r-info'); const n = Number((info.match(/event (\d+)/) || [])[1]);
must(n > 30 && n < N, 'play advanced at 60 events a second: ' + info);
const mid = Math.floor(N / 2);
await page.$eval('#r-pos', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, mid); await wait(300);
must(new RegExp(`event ${mid} of ${N}`).test(await text('#r-info')), 'slider seeks to the middle');
const cash400 = await page.evaluate(() => Array.from(document.querySelectorAll('#player-cards .pcard .n')).map((n) => n.innerText));
await page.keyboard.press('ArrowLeft'); await wait(200);
must(new RegExp(`event ${mid - 1} of ${N}`).test(await text('#r-info')), 'one step back rebuilds');
await page.$eval('#r-pos', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, mid); await wait(300);
const cash400b = await page.evaluate(() => Array.from(document.querySelectorAll('#player-cards .pcard .n')).map((n) => n.innerText));
must(JSON.stringify(cash400) === JSON.stringify(cash400b), 'the same event gives the same state either way');
await page.screenshot({ path: `${out}/replay.png` });
// 3. hover a property
const owned = await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.cell.prop')).find((c) => c.querySelector('.own')); return c ? Number(c.dataset.i) : null; });
must(owned != null, 'an owned property mid-game');
await page.hover(`.cell[data-i="${owned}"]`); await wait(150);
must(/Owner/i.test(await text('#centre .deed')) && /Ledger/i.test(await text('#centre .deed')), 'deed card on hover');
await page.hover('.cell[data-i="1"]'); await wait(120);
must(!(await page.$eval('#hover-name', (el) => el.hidden)) && /Old Kent Road/i.test(await text('#hover-name')), 'hovering a square shows its name large');
must(await page.$$eval('#board .cell:not(.corner) .name', (ns) => new Set(ns.map((n) => getComputedStyle(n).fontSize)).size === 1), 'every property name is set at the one size');
await page.click('#g-full'); await wait(250);
must(await page.$eval('.board-wrap', (el) => el.classList.contains('full')) && (await page.$eval('#board', (el) => el.getBoundingClientRect().height)) > 700, 'the full-screen viewer fills the window');
await page.screenshot({ path: `${out}/fullscreen.png` });
await page.keyboard.press('Escape'); await wait(150);
must(!(await page.$eval('.board-wrap', (el) => el.classList.contains('full'))), 'Escape leaves full screen');
await page.mouse.move(5, 5); await wait(100);
// 4. narrator panel
must(/No match report/.test(await text('#n-recap')), 'no recap for a bot game');
must(await page.evaluate(() => document.querySelector('#n-ask').classList.contains('hidden')), 'ask form hidden when the narrator is off');
const tl = await page.getAttribute('#n-transcript', 'href');
must(/\/api\/games\/.+\/transcript$/.test(tl), 'transcript link: ' + tl);
// 5. games list
await page.goto(mono + '#games'); await page.waitForSelector('#games-body tr');
must((await page.$$('#games-body tr')).length === list.total, `all ${list.total} games listed`);
must(new RegExp(`${list.total} games`).test(await text('#games-count')), 'count line');
await page.screenshot({ path: `${out}/games.png` });
const second = list.games[1];
await page.click('#games-body tr:nth-child(2) a'); await page.waitForFunction((n) => new RegExp(`event ${n} of ${n}`).test(document.querySelector('#r-info').innerText), second.eventCount, { timeout: 20000 });
must((await text('#g-title')) === second.id && /FINISHED/.test(await text('#g-status')), 'opened the second game from the list: ' + await text('#g-title'));
// 6. stats
await page.goto(mono + '#stats'); await page.waitForSelector('#stats .heat');
const st = await text('#stats');
const finished = list.games.filter((g) => g.status === 'finished').length;
// the statistics are edge-cached a minute, so a run within a minute of the last one may still show the count before its own game
must(new RegExp(`across (${finished}|${finished - 1}) finished game`).test(st) && /ROUNDS A GAME/i.test(st) && /How the dice fell/i.test(st), 'monopoly stats tiles and dice: ' + (st.match(/across [^\n]*/) || [''])[0]);
must((await page.$$('#stats .heat')).length >= 1 && (await page.$$eval('#stats .heat', (hs) => hs.every((h) => [40, 52].includes(h.querySelectorAll('.hcell').length)))), 'every heat board has its edition\'s squares');
must(/Most landed on/i.test(st) && /by colour group/i.test(st) && /Every property/i.test(st) && /Old Kent Road/i.test(st), 'landings, rent and property table');
await page.screenshot({ path: `${out}/stats.png`, fullPage: true });
// 7. models
await page.goto(mono + '#models'); await page.waitForSelector('#models table.models');
const mt = await text('#models');
must(/heuristic · rules-v1/.test(mt) && /Win rate/i.test(mt) && /Each model's dice/i.test(mt), 'model stats table and charts');
must(/Forfeits \/ game/i.test(mt) && /Time a turn/i.test(mt), 'forfeits a game and the time a turn are in the table');
await page.screenshot({ path: `${out}/models.png`, fullPage: true });
// 8. live: start a slow bot game and watch it
const runner = spawn('node', ['runner/run.mjs', '--config', 'runner/config.bots.json', '--token', 'local-dev-token', '--site', url.replace(/\/$/, ''), '--data', mkdtempSync(join(tmpdir(), 'monopoly-verify-')), '--games', '1', '--seed', '77', '--max-rounds', '12', '--delay', '250'], { stdio: 'inherit' });
await wait(2500);
await page.goto(mono + '#live'); await page.waitForFunction(() => /LIVE|RUNNING/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
must(await page.evaluate(() => document.querySelector('#r-follow').checked) && await hidden('#replay'), 'following live, with no replay controls');
must(/Link to this game/.test(await text('#g-link')) && !(await hidden('#g-full')), 'a running game keeps full screen and its link');
const a = Number((await at()).match(/event (\d+)/)[1]); await wait(5000);
const b = Number((await at()).match(/event (\d+)/)[1]);
must(b > a, `events keep arriving while live: ${a} → ${b}`);
must(/LIVE/.test(await text('#g-status')), 'status reads LIVE');
await page.screenshot({ path: `${out}/live.png` });
await new Promise((r) => runner.on('exit', r));
await page.waitForFunction(() => /FINISHED/.test(document.querySelector('#g-status').innerText), null, { timeout: 30000 });
must(/wins after 12 rounds/.test(await text('#g-sub')), 'the live game finished in view: ' + await text('#g-sub'));
const fin = await at();
await wait(2500);
must(fin === await at() && /GAME OVER/.test(await text('#events')), 'polling stopped at the end with the final event in the feed');
must(await hidden('#replay') && /Replay this game/.test(await text('#g-link')), 'the finished live game is offered as a replay, still with no controls');
// 9. the board when there is no game, and the edition selector
await page.goto(mono + '#game/does-not-exist'); await page.waitForFunction(() => /no game called/.test(document.querySelector('#notice').innerText), null, { timeout: 15000 });
must((await page.$$('#board .cell')).length === 40 && /MONOPOLY/.test(await text('#centre')) && /No such game/.test(await text('#centre')), 'the empty board shows every square');
must(await hidden('#replay') && await hidden('#g-full') && await hidden('#g-link'), 'no replay, full screen or link without a game');
must(/Old Kent Road/i.test(await text('#board')) && /Mayfair/i.test(await text('#board')), 'London names on the empty board');
await page.goto(mono + '#live'); await page.waitForFunction(() => /FINISHED/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
must((await page.$$('#names-select option')).length === 7, 'the edition dropdown lists seven editions');
await page.selectOption('#names-select', 'us'); await wait(400);
must(await page.$eval('#names-select', (el) => el.value) === 'us' && /Atlantic City · \$/.test(await page.$eval('#names-select', (el) => el.selectedOptions[0].textContent)), 'the dropdown picks Atlantic City');
must(/Boardwalk/i.test(await text('#board')) && /Mediterranean/i.test(await text('#board')) && !/Mayfair/i.test(await text('#board')) && !/£/.test(await text('#board')) && /\$400/.test(await text('#board')), 'the board reads as Atlantic City, prices in dollars');
must(/\$/.test(await text('#centre')) && !/£/.test(await text('#centre')), 'the centre is in dollars');
must(/\$/.test(await text('#events')) && !/£/.test(await text('#events')) && !/Old Kent Road|Mayfair|Whitechapel|Pall Mall/.test(await text('#events')), 'the events feed reads in dollars with American names');
must(/Made \$/.test(await text('#player-cards')), 'the player cards are in dollars');
await page.screenshot({ path: `${out}/edition-us.png` });
await page.reload(); await page.waitForFunction(() => /FINISHED/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
must(await page.$eval('#names-select', (el) => el.value) === 'us' && /Boardwalk/i.test(await text('#board')), 'the choice survives a reload');
await page.goto(mono + '#stats'); await page.waitForSelector('#stats .heat');
must(/Boardwalk/i.test(await text('#stats')) && /read as Atlantic City/i.test(await text('#stats')), 'the statistics read as Atlantic City too'); // the whole page: a Mega game adds a heat board that keeps London names
await page.selectOption('#names-select', 'netherlands'); await page.waitForSelector('#stats .heat'); await wait(300);
must(/Kalverstraat/i.test(await text('#stats')) && / €/.test(await text('#stats')), 'the Dutch board with euros after the amount');
await page.selectOption('#names-select', 'london'); await wait(200);
must(await page.$eval('#names-select', (el) => el.value) === 'london', 'back to London');
// 10. the ledgers under the game, the roll charts' label and the models' logos, against the statistics worked out
// here from the game's own events
const n$ = (x) => x.toLocaleString('en-US');
async function statsOfGame(id) {
  const meta = await (await fetch(`${url}api/games/${encodeURIComponent(id)}`)).json();
  const evs = [];
  for (let after = 0; ;) { const r = await (await fetch(`${url}api/games/${encodeURIComponent(id)}/events?after=${after}&limit=2000`)).json(); evs.push(...r.events); after = r.nextAfter; if (r.done) break; }
  const g = new ReplayGame({ id: meta.id, edition: meta.edition, config: meta.config, seed: meta.seed, players: meta.players }).applyAll(evs);
  return { meta, g, st: new StatsTracker(g).update() };
}
const toEnd = () => page.waitForFunction(() => { const m = document.querySelector('#r-info').innerText.match(/event (\d+) of (\d+)/); return m && m[1] === m[2]; }, null, { timeout: 20000 });
const latestNow = (await (await fetch(url + 'api/live')).json()).latest;
const { g: lg, st: want } = await statsOfGame(latestNow.id);
await page.goto(mono + '#live'); await page.waitForFunction(() => /FINISHED/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
await page.evaluate(() => document.querySelector('#ledgers').scrollIntoView()); await wait(900);
must(!(await hidden('#ledgers')), 'the ledgers sit under the game');
must(new RegExp(`^${n$(want.payments.length)} payments`).test(await text('#pay-sum')), 'every payment counted: ' + await text('#pay-sum'));
must((await page.$$('#pay-table tbody tr')).length === Math.min(100, want.payments.length), 'the newest hundred payments listed');
must((await page.$$('#pay-matrix tbody tr')).length === lg.players.length + 1, 'who paid whom: a row for each player and one for the bank');
const p0 = lg.players[0];
await page.selectOption('#pay-player', p0.id); await wait(250);
const involved = await page.$$eval('#pay-table tbody tr', (trs) => trs.map((tr) => `${tr.children[1].innerText}|${tr.children[2].innerText}`));
must(involved.length > 0 && involved.every((r) => r.includes(p0.name)), `the player filter keeps ${p0.name}'s payments`);
await page.selectOption('#pay-player', ''); await page.selectOption('#pay-kind', 'rent'); await wait(250);
must(await page.$$eval('#pay-table tbody tr td:last-child', (tds) => tds.length > 0 && tds.every((td) => /^Rent for /.test(td.innerText))), 'the kind filter keeps the rent');
must(new RegExp(`^${n$(want.payments.filter((x) => x.kind === 'rent').length)} payment`).test(await text('#pay-sum')), 'the rent payments counted: ' + await text('#pay-sum'));
await page.selectOption('#pay-kind', ''); await wait(250);
if (want.payments.length > 100) { await page.click('#pay-more'); await wait(250); must((await page.$$('#pay-table tbody tr')).length === Math.min(300, want.payments.length), 'show more lists two hundred more'); }
must(/Nobody has offered a trade yet/.test(await text('#trade-table')) === !want.negotiations.length, 'the trades card: ' + (await text('#trade-sum') || 'no offers, as the bots never trade'));
must((await page.$$('#prop-table tbody tr')).length === Object.keys(want.props).length, `a row for each of the ${Object.keys(want.props).length} properties`);
await page.click('#prop-table th[data-sort="rent"]'); await wait(250);
const rents = await page.$$eval('#prop-table tbody tr td:nth-child(4)', (tds) => tds.map((td) => Number(td.innerText.replace(/[^0-9]/g, ''))));
must(rents.every((v, k) => !k || rents[k - 1] >= v) && rents[0] === Math.max(...Object.values(want.props).map((x) => x.rent)), 'a click on Rent sorts the properties by rent, highest first');
must((await text('#prop-sum')).includes(n$(want.match.rent)), 'the rent adds up: ' + await text('#prop-sum'));
await page.screenshot({ path: `${out}/ledgers.png`, fullPage: true });
await page.evaluate(() => window.scrollTo(0, 0)); await wait(250);
await page.hover('.cell[data-i="39"]'); await wait(120);
const mid$ = await page.$eval('#board', (b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.move(mid$.x, mid$.y); await wait(150);
const h7 = await (await page.$('#centre .rollchart .col[data-t="7"] .hit')).boundingBox();
await page.mouse.move(h7.x + h7.width / 2, h7.y + 3); await wait(150);
const tip7 = await page.$eval('.tip', (t) => (t.hidden ? '' : t.innerText));
must(new RegExp(`^7 rolled ${n$(want.match.rolls[7])} times? out of ${n$(want.match.rollCount)} rolls`).test(tip7), 'over the centre, the roll chart says how many sevens out of all the rolls: ' + tip7.split('\n')[0]);
await page.screenshot({ path: `${out}/roll-label.png` });
await page.mouse.move(5, 5); await wait(100);
must(await page.$eval('.tip', (t) => t.hidden), 'the label goes with the pointer');
must((await page.$$('.tok.logo')).length === 0 && (await page.$$('.tok')).length > 0, "the bots' tokens keep their initials");
const seeded = (await (await fetch(url + 'api/games?limit=200')).json()).games.find((x) => x.id.startsWith('trades-'));
if (!seeded) console.log('skip the trading game: node scripts/seed-trades.mjs puts one on the local site for the trades ledger and the logos');
else {
  const { g: tg, st: tw } = await statsOfGame(seeded.id);
  await page.goto(mono + '#game/' + encodeURIComponent(seeded.id)); await toEnd();
  await page.click('#r-first'); await wait(250);
  must((await page.$$('.cell[data-i="0"] .tok.logo')).length === tg.players.length, `every model's token wears its maker's logo on ${tg.board[0].name}`);
  const logos = await page.$$eval('.tok.logo', (ts) => [...new Set(ts.map((t) => getComputedStyle(t).backgroundImage.match(/url\("?([^")]+)/)[1]))]);
  must(logos.length === new Set(tg.players.map((p) => `${p.meta.provider}/${p.meta.model}`)).size, `a logo for each model: ${logos.map((u) => u.split('/').pop()).join(', ')}`);
  for (const u of logos) { const r = await fetch(new URL(u, url)); must(r.ok && /svg/.test(r.headers.get('content-type')), `the logo ${u.split('/').pop()} is served`); }
  await page.screenshot({ path: `${out}/logos.png` });
  await page.click('#r-last'); await wait(300);
  await page.evaluate(() => document.querySelector('#trade-table').scrollIntoView()); await wait(900);
  must(new RegExp(`^${n$(tw.negotiations.length)} offers: ${tw.negotiations.filter((x) => x.outcome === 'completed').length} completed`).test(await text('#trade-sum')), 'every offer and its end counted: ' + await text('#trade-sum'));
  must((await page.$$('#trade-table tbody tr')).length === Math.min(40, tw.negotiations.length), 'the newest forty negotiations listed');
  must(/counters with/.test(await text('#trade-table')) && /accepts/.test(await text('#trade-table')) && /refused by the rules/i.test(await text('#trade-table')), 'counter-offers, answers and refused offers are in the ledger');
  await page.selectOption('#trade-outcome', 'completed'); await wait(250);
  must(await page.$$eval('#trade-table tbody tr', (trs) => trs.length > 0 && trs.every((tr) => /COMPLETED/i.test(tr.querySelector('.badge').innerText) && / gave /.test(tr.innerText))), 'the outcome filter keeps the trades done, each with what changed hands');
  await page.selectOption('#trade-outcome', ''); await page.selectOption('#pay-kind', 'trade'); await wait(250);
  must(new RegExp(`^${n$(tw.payments.filter((x) => x.kind === 'trade').length)} payment`).test(await text('#pay-sum')), 'the cash in trades is in the payments: ' + await text('#pay-sum'));
  await page.selectOption('#pay-kind', '');
  // no answer, no choice: the forfeits on each card, and an offer left without a valid answer rejected by default
  const ffShown = await page.$$eval('.pcard', (cards) => cards.map((c) => { const f = c.querySelector('.ff'); return f ? Number(f.innerText.match(/\d+/)[0]) : 0; }));
  const ffWant = tg.players.map((p) => (tw.players[p.id] || {}).forfeits || 0);
  must(ffWant.some(Boolean) && JSON.stringify(ffShown) === JSON.stringify(ffWant), `each card counts its player's forfeits: ${ffShown.join(' ')}`);
  must(await page.$$eval('.pcard .m', (ms) => ms.every((m) => / a turn/.test(m.innerText))), 'each card gives its player\'s time a turn');
  const shownRejected = tw.negotiations.filter((x) => x.outcome === 'rejected').reverse().slice(0, 40); // the newest forty, as listed
  const byDefault = shownRejected.some((x) => x.steps.some((st) => st.kind === 'reject' && st.source === 'forfeit'));
  await page.selectOption('#trade-outcome', 'rejected'); await wait(250);
  must(/rejects it by default, for want of a valid answer — no valid answer \(/.test(await text('#trade-table')) === byDefault, `an offer without a valid answer reads as rejected by default, with the reason${byDefault ? '' : ' (none in this game)'}`);
  await page.selectOption('#trade-outcome', '');
  await page.screenshot({ path: `${out}/trades.png`, fullPage: true });
}
// 11. dark mode
await page.emulateMedia({ colorScheme: 'dark' }); await page.goto(mono + '#live'); await page.waitForFunction(() => /FINISHED/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
await page.screenshot({ path: `${out}/live-dark.png` });
await page.emulateMedia({ colorScheme: 'light' });
// 12. phone
await page.setViewportSize({ width: 390, height: 844 }); await wait(300);
await page.screenshot({ path: `${out}/live-mobile.png`, fullPage: true });
must(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll on a phone');
await page.goto(url); await page.waitForFunction(() => document.querySelectorAll('#players .player').length > 0, null, { timeout: 15000 }); await wait(300);
await page.screenshot({ path: `${out}/home-mobile.png`, fullPage: true });
must(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'the homepage keeps to the phone\'s width');
await page.goto(mono + '#live'); await page.waitForFunction(() => /FINISHED|LIVE|RUNNING/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
await page.evaluate(() => document.querySelector('#ledgers').scrollIntoView()); await wait(900);
await page.screenshot({ path: `${out}/ledgers-mobile.png` });
must(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'the ledgers keep to the phone\'s width');
await browser.close();
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
console.log('viewer ok');
