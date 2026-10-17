// Runs a batch of games, several at once, and reports progress.
import { Game } from './engine.js';
import { AIDecider } from './ai.js';

// The seats of one game, drawn from the pool: `seats` of them at random (all of them when the pool is smaller), never
// the same model twice, so no model plays against itself (the rule-based bot is not a model and may fill any number
// of seats); a seed makes the draw repeatable.
export const modelKey = (p) => (p.provider === 'heuristic' ? `heuristic#${p.id}` : `${p.provider}/${p.model}`);
export function pickSeats(pool, seats, seed) {
  let x = (Number(seed) || Date.now()) >>> 0;
  const rnd = () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rest = pool.slice(), out = [], seen = new Set();
  while (rest.length && out.length < seats) {
    const p = rest.splice(Math.floor(rnd() * rest.length), 1)[0];
    const key = modelKey(p);
    if (seen.has(key)) continue;
    seen.add(key); out.push(p);
  }
  return out;
}
export class Runner {
  // setup: { players: [{id,name,provider,model,effort,instructions,temperature,colour}] (the pool), seats (a game's players, drawn from the pool; all of them when unset), universal, config, games, concurrency, keys, baseUrls, maxTokens, timeoutMs, apiConcurrency, logPrompts }
  constructor(setup, hooks = {}) {
    this.setup = setup;
    this.hooks = hooks; // onGameStart(game), onEvent(ev, game), onLlm(rec, game), onGameEnd(game, result), onDone(summary)
    this.abort = new AbortController();
    this.games = [];
    this.results = [];
  }
  stop() { this.abort.abort(new Error('stopped by user')); for (const g of this.games) g.stop(); }
  // No new game starts; the ones in play are played to the end.
  finishUp() { this.ending = true; }

  async run() {
    const s = this.setup;
    const playerConfigs = {};
    for (const p of s.players) playerConfigs[p.id] = p;
    const decider = new AIDecider(playerConfigs, {
      keys: s.keys || {}, baseUrls: s.baseUrls || {}, universal: s.universal || '', maxTokens: s.maxTokens, timeoutMs: s.timeoutMs,
      concurrency: s.apiConcurrency, logPrompts: s.logPrompts !== false, signal: this.abort.signal,
    });
    const total = Math.max(1, Number(s.games) || 1);
    const conc = Math.max(1, Math.min(total, Number(s.concurrency) || 1));
    let next = 0;
    const startedAt = Date.now();
    const worker = async () => {
      while (next < total && !this.abort.signal.aborted && !this.ending) {
        const n = next++;
        const seed = s.seed != null && s.seed !== '' ? Number(s.seed) + n : undefined;
        const seated = pickSeats(s.players, Number(s.seats) || s.players.length, seed != null ? seed * 7919 + 17 : undefined);
        const game = new Game({
          id: `${s.batchId || 'b'}-${n + 1}`,
          config: s.config,
          players: seated.map((p) => ({ id: p.id, name: p.name, provider: p.provider, model: p.model, effort: p.effort, colour: p.colour, instructions: p.instructions })),
          decider,
          seed,
          onEvent: (ev, g) => this.hooks.onEvent && this.hooks.onEvent(ev, g),
          onLlm: (rec, g) => this.hooks.onLlm && this.hooks.onLlm(rec, g),
        });
        game.index = n;
        this.games.push(game);
        if (this.hooks.onGameStart) this.hooks.onGameStart(game);
        let result;
        try { result = await game.run(); } catch (e) { result = { error: String(e && e.stack || e), endReason: 'error' }; game.log('engine_error', { error: result.error }); }
        this.results.push({ game, result });
        if (this.hooks.onGameEnd) await this.hooks.onGameEnd(game, result);
      }
    };
    await Promise.all(Array.from({ length: conc }, worker));
    const summary = { games: this.results.length, durationMs: Date.now() - startedAt, aborted: this.abort.signal.aborted };
    if (this.hooks.onDone) this.hooks.onDone(summary);
    return summary;
  }
}

