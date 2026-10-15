#!/usr/bin/env node
// Drives the viewer in headless Chromium against a local Worker with the
// local database, after at least two bot games have been played into it:
//
//   npm run migrate:local && npm run dev            (in one terminal)
//   node runner/run.mjs --config runner/config.bots.json --token local-dev-token --games 2
//   node scripts/verify-viewer.mjs                  (screenshots in .render-check/viewer/)
//
// It checks the live tab, the replay controls, the games list, both statistics
// pages, a live game played slowly by the bots while the page follows it, and
// the phone layout. PLAYWRIGHT_MODULE and CHROME_PATH point it at a browser
// when playwright is not installed in this repository.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.OUT || '.render-check/viewer';
mkdirSync(out, { recursive: true });
const url = (process.env.SITE || 'http://127.0.0.1:8789').replace(/\/?$/, '/');
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push('console: ' + m.text()); }); // a missing game answers 404 by design
const must = (c, msg) => { if (!c) throw new Error('FAILED: ' + msg); console.log('ok  ' + msg); };
const text = (sel) => page.evaluate((s) => (document.querySelector(s) || { innerText: '' }).innerText, sel);
const wait = (ms) => page.waitForTimeout(ms);
// 1. live tab with no running game: the latest finished game
const liveNow = await (await fetch(url + 'api/live')).json();
const L = liveNow.latest; const N = L.eventCount;
const list = await (await fetch(url + 'api/games?limit=50')).json();
await page.goto(url); await page.waitForFunction(() => /FINISHED|LIVE|RUNNING/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
must(/No game is being played right now/.test(await text('#notice')), 'live tab says the table is quiet and shows the latest game');
must(/FINISHED/.test(await text('#g-status')), 'status reads FINISHED');
must(new RegExp(`event ${N} of ${N}`).test(await text('#r-info')), 'replay sits at the end: ' + await text('#r-info'));
must(new RegExp(`round ${L.rounds} · turn ${L.turns}`).test(await text('#centre')), 'centre shows the final round and turn');
must(/GOES|Goes/.test(await text('#centre')) && new RegExp('Winner: ' + L.winnerName).test(await text('#centre')), 'match stats and the winner in the centre');
must((await page.$$('#player-cards .pcard')).length === 4, 'four player cards');
if (L.players.some((p) => p.bankrupt)) must(/BANKRUPT/i.test(await text('#player-cards')), 'bankrupt players marked');
const rect = await page.evaluate(() => { const r = document.querySelector('.board-wrap').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
must(rect, 'board fully inside the window');
await page.screenshot({ path: `${out}/live-latest.png` });
// 2. replay controls
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
await page.mouse.move(5, 5); await wait(100);
// 4. narrator panel
must(/No match report/.test(await text('#n-recap')), 'no recap for a bot game');
must(await page.evaluate(() => document.querySelector('#n-ask').classList.contains('hidden')), 'ask form hidden when the narrator is off');
const tl = await page.getAttribute('#n-transcript', 'href');
must(/\/api\/games\/.+\/transcript$/.test(tl), 'transcript link: ' + tl);
// 5. games list
await page.goto(url + '#games'); await page.waitForSelector('#games-body tr');
must((await page.$$('#games-body tr')).length === list.total, `all ${list.total} games listed`);
must(new RegExp(`${list.total} games`).test(await text('#games-count')), 'count line');
await page.screenshot({ path: `${out}/games.png` });
const second = list.games[1];
await page.click('#games-body tr:nth-child(2) a'); await page.waitForFunction((n) => new RegExp(`event ${n} of ${n}`).test(document.querySelector('#r-info').innerText), second.eventCount, { timeout: 20000 });
must((await text('#g-title')) === second.id && /FINISHED/.test(await text('#g-status')), 'opened the second game from the list: ' + await text('#g-title'));
// 6. stats
await page.goto(url + '#stats'); await page.waitForSelector('#stats .heat');
const st = await text('#stats');
const finished = list.games.filter((g) => g.status === 'finished').length;
must(new RegExp(`across ${finished} finished game`).test(st) && /ROUNDS A GAME/i.test(st) && /How the dice fell/i.test(st), 'monopoly stats tiles and dice: ' + (st.match(/across [^\n]*/) || [''])[0]);
must((await page.$$('#stats .heat .hcell')).length === 40, 'heat board has forty squares');
must(/Most landed on/i.test(st) && /by colour group/i.test(st) && /Every property/i.test(st) && /Old Kent Road/i.test(st), 'landings, rent and property table');
await page.screenshot({ path: `${out}/stats.png`, fullPage: true });
// 7. models
await page.goto(url + '#models'); await page.waitForSelector('#models table.models');
const mt = await text('#models');
must(/heuristic · rules-v1/.test(mt) && /Win rate/i.test(mt) && /Each model's dice/i.test(mt), 'model stats table and charts');
await page.screenshot({ path: `${out}/models.png`, fullPage: true });
// 8. live: start a slow bot game and watch it
const runner = spawn('node', ['runner/run.mjs', '--config', 'runner/config.bots.json', '--token', 'local-dev-token', '--games', '1', '--seed', '77', '--max-rounds', '12', '--delay', '250'], { stdio: 'inherit' });
await wait(2500);
await page.goto(url + '#live'); await page.waitForFunction(() => /LIVE|RUNNING/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
must(await page.evaluate(() => document.querySelector('#r-follow').checked), 'following live by default');
const a = Number((await text('#r-info')).match(/event (\d+)/)[1]); await wait(5000);
const b = Number((await text('#r-info')).match(/event (\d+)/)[1]);
must(b > a, `events keep arriving while live: ${a} → ${b}`);
must(/LIVE/.test(await text('#g-status')), 'status reads LIVE');
await page.screenshot({ path: `${out}/live.png` });
await new Promise((r) => runner.on('exit', r));
await page.waitForFunction(() => /FINISHED/.test(document.querySelector('#g-status').innerText), null, { timeout: 30000 });
must(/wins after 12 rounds/.test(await text('#g-sub')), 'the live game finished in view: ' + await text('#g-sub'));
const fin = await text('#r-info');
await wait(2500);
must(fin === await text('#r-info') && /GAME OVER/.test(await text('#events')), 'polling stopped at the end with the final event in the feed');
// 9. the board when there is no game, and the edition selector
await page.goto(url + '#game/does-not-exist'); await page.waitForFunction(() => /no game called/.test(document.querySelector('#notice').innerText), null, { timeout: 15000 });
must((await page.$$('#board .cell')).length === 40 && /MONOPOLY/.test(await text('#centre')) && /No such game/.test(await text('#centre')), 'the empty board shows every square');
must(/Old Kent Road/i.test(await text('#board')) && /Mayfair/i.test(await text('#board')), 'London names on the empty board');
await page.goto(url + '#live'); await page.waitForFunction(() => /FINISHED/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
await page.click('#names-btn'); await wait(100);
must(!(await page.evaluate(() => document.querySelector('#names-pop').classList.contains('hidden'))) && (await page.$$('#names-list li[data-id]')).length === 7, 'the edition list opens with seven editions');
await page.type('#names-search', 'atlantic'); await wait(100);
must((await page.$$('#names-list li[data-id]')).length === 1, 'the search narrows the list');
await page.keyboard.press('Enter'); await wait(400);
must(/Board: Atlantic City · \$/.test(await text('#names-btn')), 'Enter picks the edition: ' + await text('#names-btn'));
must(/Boardwalk/i.test(await text('#board')) && /Mediterranean/i.test(await text('#board')) && !/Mayfair/i.test(await text('#board')) && !/£/.test(await text('#board')) && /\$400/.test(await text('#board')), 'the board reads as Atlantic City, prices in dollars');
must(/\$/.test(await text('#centre')) && !/£/.test(await text('#centre')), 'the centre is in dollars');
must(/\$/.test(await text('#events')) && !/£/.test(await text('#events')) && !/Old Kent Road|Mayfair|Whitechapel|Pall Mall/.test(await text('#events')), 'the events feed reads in dollars with American names');
must(/Made \$/.test(await text('#player-cards')), 'the player cards are in dollars');
await page.screenshot({ path: `${out}/edition-us.png` });
await page.reload(); await page.waitForFunction(() => /FINISHED/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
must(/Atlantic City/.test(await text('#names-btn')) && /Boardwalk/i.test(await text('#board')), 'the choice survives a reload');
await page.goto(url + '#stats'); await page.waitForSelector('#stats .heat');
must(/Boardwalk/i.test(await text('#stats .heat')) && /read as Atlantic City/i.test(await text('#stats')), 'the statistics read as Atlantic City too');
await page.click('#names-btn'); await page.type('#names-search', 'nether'); await page.click('#names-list li[data-id]'); await wait(300);
must(/Netherlands · €/.test(await text('#names-btn')) && /Kalverstraat/i.test(await text('#stats .heat')) && / €/.test(await text('#stats')), 'a click picks the Dutch board with euros after the amount');
await page.click('#names-btn'); await page.type('#names-search', 'london'); await page.keyboard.press('Enter'); await wait(200);
must(/Board: London · £/.test(await text('#names-btn')), 'back to London');
// 10. dark mode
await page.emulateMedia({ colorScheme: 'dark' }); await page.goto(url + '#live'); await page.waitForFunction(() => /FINISHED/.test(document.querySelector('#g-status').innerText), null, { timeout: 20000 });
await page.screenshot({ path: `${out}/live-dark.png` });
await page.emulateMedia({ colorScheme: 'light' });
// 11. phone
await page.setViewportSize({ width: 390, height: 844 }); await wait(300);
await page.screenshot({ path: `${out}/live-mobile.png`, fullPage: true });
must(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll on a phone');
await browser.close();
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
console.log('viewer ok');
