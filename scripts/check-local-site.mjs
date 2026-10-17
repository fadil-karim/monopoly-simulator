#!/usr/bin/env node
// The dashboard's copy of the site (runner/local-site.mjs, over the simulator's store) against the web version (the
// Worker, over D1), for the same games: every read the viewer and the homepage make, compared field by field, so the
// two never drift apart. Only the clocks may differ, and a stopped game's end, which is when each side heard of it.
//
//   npm run migrate:local && npm run dev                                   (the local Worker, in one terminal)
//   node runner/run.mjs --config runner/config.bots.json --token local-dev-token --data /tmp/cmp --games 2
//   node runner/dashboard.mjs --data /tmp/cmp --port 8795 --no-open        (the copy, over the same store)
//   node scripts/check-local-site.mjs [web http://127.0.0.1:8789] [local http://127.0.0.1:8795]
//
// The Worker's database should hold the store's games and no others, for the statistics to agree.
const W = process.argv[2] || 'http://127.0.0.1:8789', L = process.argv[3] || 'http://127.0.0.1:8795';
const CLOCKS = new Set(['time', 'updatedAt', 'exportedAt']);
const get = async (base, path) => { const r = await fetch(base + path); const t = await r.text(); return { status: r.status, body: /json/.test(r.headers.get('content-type') || '') ? JSON.parse(t) : t }; };
let checked = 0, bad = 0;
function diff(a, b, path, out) {
  if (CLOCKS.has(path.split('.').pop())) return;
  if (a === b) return;
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array vs object`); return; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(a[k], b[k], `${path}.${k}`, out);
    return;
  }
  out.push(`${path}: web ${JSON.stringify(a)?.slice(0, 120)} vs local ${JSON.stringify(b)?.slice(0, 120)}`);
}
async function same(path, { pick = (x) => x, ignore = [] } = {}) {
  const [w, l] = await Promise.all([get(W, path), get(L, path)]);
  const out = [];
  if (w.status !== l.status) out.push(`status ${w.status} vs ${l.status}`);
  diff(pick(w.body), pick(l.body), '', out);
  const left = out.filter((d) => !ignore.some((r) => r.test(d)));
  checked++;
  if (left.length) { bad++; console.log(`✗ ${path}\n    ${left.slice(0, 8).join('\n    ')}${left.length > 8 ? `\n    … ${left.length - 8} more` : ''}`); }
  else console.log(`✓ ${path}`);
}
const list = (await get(L, '/api/games?limit=200')).body;
const ids = list.games.map((g) => g.id);
await same('/api/health', { pick: ({ ok, db, token, narrator }) => ({ ok, db, token, narrator }) });
await same('/api/games?limit=200', { ignore: [/^\.games\.\d+\.finishedAt:/] }); // a stopped game's end is when each side heard of it
await same('/api/games?limit=2&offset=1');
await same('/api/games?status=finished');
await same('/api/live');
await same('/api/stats/monopoly');
await same('/api/stats/models');
for (const id of ids) {
  // an aborted game's end time is when each side heard of it
  const ignore = [/^\.finishedAt:/];
  await same(`/api/games/${id}`, { ignore });
  await same(`/api/games/${id}/events?after=0&limit=2000`);
  await same(`/api/games/${id}/events?after=100&limit=50`);
  await same(`/api/games/${id}/calls?after=0&limit=1000`);
  await same(`/api/games/${id}/transcript`);
  await same(`/api/games/${id}/transcript?compact=1`);
  await same(`/api/games/${id}/export`, { ignore: [/^\.game\.finishedAt:/] });
}
await same('/api/games/no-such-game');
console.log(`${checked - bad} of ${checked} reads the same`);
process.exit(bad ? 1 : 0);
