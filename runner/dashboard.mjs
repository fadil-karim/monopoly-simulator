#!/usr/bin/env node
// The local dashboard: a page on this machine to fill in the site, the runner token, the keys and the pool of models,
// and to start, watch and stop the runner. It binds to 127.0.0.1 only. The keys stay in memory for the runner it
// starts unless "remember" writes them to runner/.env; the table is written to runner/config.json, which the runner
// prefers from then on. Both files are ignored by git.
//
//   node runner/dashboard.mjs [--port 8788] [--no-open]
//   node runner/run.mjs --dashboard
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, EFFORTS, listModels } from '../public/assets/app/providers.js';
import { PRICES, modelName } from '../public/assets/app/pricing.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
  args[a.slice(2)] = v;
}
const PORT = Number(args.port || 8788);
const CONFIG = join(here, 'config.json'), DEFAULT = join(here, 'config.default.json'), ENV = join(here, '.env');
const KEY_NAMES = [...new Set(Object.values(PROVIDERS).map((p) => p.env).filter(Boolean))];

function readEnvFile() {
  const out = {};
  if (!existsSync(ENV)) return out;
  for (const line of readFileSync(ENV, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}
// Writes the given names into runner/.env, keeping every other line as it is.
function writeEnvFile(vars) {
  const lines = existsSync(ENV) ? readFileSync(ENV, 'utf8').replace(/\n$/, '').split('\n') : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/i);
    if (m && vars[m[1]] != null) { seen.add(m[1]); return `${m[1]}=${vars[m[1]]}`; }
    return line;
  }).filter((l) => l !== '' || lines.length);
  for (const [k, v] of Object.entries(vars)) if (!seen.has(k) && v) out.push(`${k}=${v}`);
  writeFileSync(ENV, out.filter((l, i, a) => !(l === '' && i === a.length - 1)).join('\n') + '\n');
}
const readConfig = () => JSON.parse(readFileSync(existsSync(CONFIG) ? CONFIG : DEFAULT, 'utf8'));
// The models a provider is known to serve before its catalogue is asked for: the adapter's list and the priced ones,
// with the names people know them by; the page adds the provider's own catalogue once it has a key.
function knownModels(id, p) {
  const ids = new Set(p.models || []);
  for (const key of Object.keys(PRICES)) if (key.startsWith(`${id}/`)) ids.add(key.slice(id.length + 1));
  const names = {};
  for (const m of ids) { const n = modelName(id, m); if (n && n !== m) names[m] = n; }
  return { known: [...ids].sort(), names };
}
// The site of the default table, offered when the table in use leaves it blank.
const defaultSite = () => { try { return JSON.parse(readFileSync(DEFAULT, 'utf8')).site || ''; } catch { return ''; } };

// ---------- the runner as a child process ----------
const state = { child: null, log: [], startedAt: null, games: 0, exit: null };
function push(line) {
  if (!line) return;
  state.log.push(line);
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
  if (/^■ /.test(line)) state.games++;
}
function start(body) {
  if (state.child) return { error: 'the runner is already running' };
  const cfg = body.config || readConfig();
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  if (body.remember) writeEnvFile(body.env || {});
  const o = body.options || {};
  const flags = ['--config', CONFIG];
  if (o.loop) flags.push('--loop');
  if (o.dry) flags.push('--dry');
  if (o.games) flags.push('--games', String(o.games));
  if (o.seats) flags.push('--seats', String(o.seats));
  if (o.edition) flags.push('--edition', String(o.edition));
  if (o.maxRounds) flags.push('--max-rounds', String(o.maxRounds));
  if (o.delay) flags.push('--delay', String(o.delay));
  const env = { ...process.env, MONOPOLY_DASHBOARD: '1' }; // so the runner can say a token came from the token box
  for (const [k, v] of Object.entries(body.env || {})) if (v) env[k] = String(v);
  const child = spawn(process.execPath, [join(here, 'run.mjs'), ...flags], { env, cwd: join(here, '..') });
  Object.assign(state, { child, log: [], startedAt: Date.now(), games: 0, exit: null });
  push(`started: node runner/run.mjs ${flags.join(' ')}`);
  const buf = { out: '', err: '' };
  const feed = (which, chunk) => {
    buf[which] += chunk;
    const parts = buf[which].split(/\r?\n|\r/);
    buf[which] = parts.pop();
    for (const p of parts) push(p);
  };
  child.stdout.on('data', (c) => feed('out', c.toString()));
  child.stderr.on('data', (c) => feed('err', c.toString()));
  child.on('exit', (code, signal) => {
    push(buf.out); push(buf.err);
    state.exit = { code, signal, at: Date.now() };
    state.child = null;
    push(`runner stopped${signal ? ` (${signal})` : code ? ` with code ${code}` : ''}`);
  });
  return { ok: true };
}
function stop() {
  if (state.child) state.child.kill('SIGINT');
  return { ok: true };
}

// ---------- the server ----------
const page = readFileSync(join(here, 'dashboard.html'), 'utf8');
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 2e6) reject(new Error('body too large')); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); req.on('error', reject); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(page); }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const env = readEnvFile();
      const keys = {}; for (const k of KEY_NAMES) if (env[k]) keys[k] = env[k];
      return json(res, 200, {
        running: !!state.child, startedAt: state.startedAt, games: state.games, exit: state.exit, log: state.log.slice(-250),
        config: readConfig(), configFile: existsSync(CONFIG) ? 'runner/config.json' : 'runner/config.default.json', defaultSite: defaultSite(),
        env: { SITE: env.SITE || '', RUNNER_TOKEN: env.RUNNER_TOKEN || '', keys },
        providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, env: p.env || null, kind: p.kind, models: p.models || [], keyUrl: p.keyUrl || null, ...knownModels(id, p) })),
        efforts: EFFORTS,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
      const body = await readBody(req);
      if (body.config) writeFileSync(CONFIG, JSON.stringify(body.config, null, 2) + '\n');
      if (body.remember) writeEnvFile(body.env || {});
      return json(res, 200, { ok: true, configFile: 'runner/config.json', envWritten: !!body.remember });
    }
    if (req.method === 'POST' && url.pathname === '/api/start') { const r = start(await readBody(req)); return json(res, r.error ? 409 : 200, r); }
    if (req.method === 'POST' && url.pathname === '/api/stop') return json(res, 200, stop());
    if (req.method === 'POST' && url.pathname === '/api/models') {
      const body = await readBody(req);
      try { return json(res, 200, { models: await listModels(body.provider, body.key || '', body.baseUrl || undefined) }); }
      catch (e) { return json(res, 502, { error: e.message }); }
    }
    json(res, 404, { error: 'no such route' });
  } catch (e) { json(res, 500, { error: e.message }); }
});
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Monopoly AI runner dashboard at ${url} (Ctrl-C stops it; a running runner is stopped with it)`);
  if (!args['no-open']) {
    const [cmd, ...rest] = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
    try { spawn(cmd, rest, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
  }
});
process.on('SIGINT', () => { stop(); setTimeout(() => process.exit(0), state.child ? 1500 : 0); });
