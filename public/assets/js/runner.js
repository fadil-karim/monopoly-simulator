// Runs a batch of games, several at once, and reports progress.
import { Game } from './engine.js';
import { AIDecider } from './ai.js';

export class Runner {
  // setup: { players: [{id,name,provider,model,effort,instructions,temperature,colour}], universal, config, games, concurrency, keys, baseUrls, maxTokens, timeoutMs, apiConcurrency, logPrompts }
  constructor(setup, hooks = {}) {
    this.setup = setup;
    this.hooks = hooks; // onGameStart(game), onEvent(ev, game), onLlm(rec, game), onGameEnd(game, result), onDone(summary)
    this.abort = new AbortController();
    this.games = [];
    this.results = [];
  }
  stop() { this.abort.abort(new Error('stopped by user')); for (const g of this.games) g.stop(); }

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
      while (next < total && !this.abort.signal.aborted) {
        const n = next++;
        const game = new Game({
          id: `${s.batchId || 'b'}-${n + 1}`,
          config: s.config,
          players: s.players.map((p) => ({ id: p.id, name: p.name, provider: p.provider, model: p.model, effort: p.effort, colour: p.colour, instructions: p.instructions })),
          decider,
          seed: s.seed != null && s.seed !== '' ? Number(s.seed) + n : undefined,
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

// Serialise a finished game into a self-contained log record.
export function gameRecord(game, setup) {
  return {
    version: 1,
    id: game.id,
    batchId: setup.batchId,
    createdAt: new Date(game.startedAt).toISOString(),
    edition: game.edition,
    seed: game.seed,
    config: game.config,
    universal: setup.universal || '',
    players: game.players.map((p) => ({ id: p.id, name: p.name, provider: p.meta.provider, model: p.meta.model, effort: p.meta.effort, instructions: p.meta.instructions, colour: p.meta.colour, stats: p.stats, finalCash: p.cash, finalNetWorth: p.bankrupt ? 0 : game.netWorth(p), bankrupt: p.bankrupt, bankruptRound: p.bankruptRound })),
    result: game.result,
    snapshots: game.snapshots,
    finalProperties: game.props,
    events: game.events,
    llmCalls: game.llmCalls,
  };
}
