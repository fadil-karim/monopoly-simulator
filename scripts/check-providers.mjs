#!/usr/bin/env node
// Drives the provider adapters against a mock on this machine: the OpenAI
// Responses shape (Perplexity's Agent API) streamed, with keep-alives, an option
// or the stream refused, a stream with nothing in it, one cut short, one that
// reports a rate limit, and a reply of "{}"; the chat-completions shape with a
// rate limit that asks to be left alone a moment (Retry-After); Anthropic's
// messages and Gemini's generateContent; checking the request each adapter
// sends, what it makes of the reply, and what each call costs: as reported
// (Perplexity, OpenRouter), priced from the tokens (Anthropic with its cache,
// Gemini with its thinking), unpriced, or at a price the config gives.
//   node scripts/check-providers.mjs
import http from 'node:http';
import { callModel, listModels, connectFailed } from '../public/assets/app/providers.js';
import { priceFor, tokenCost } from '../public/assets/app/pricing.js';
import { AIDecider } from '../public/assets/app/ai.js';
import { Game } from '../public/assets/app/engine.js';

const seen = [];
const once = new Set(); // the mock's one-off failures, by name
const RESPONSE = (text, model = 'openai/gpt-5.5-2026-09-01') => ({ id: 'resp_1', model, status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 12 }, cost: { currency: 'USD', input_cost: 0.0002, output_cost: 0.0003, tool_calls_cost: 0, total_cost: 0.0005 } } });
const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = body ? JSON.parse(body) : null;
    seen.push({ path: req.url, auth: req.headers.authorization, accept: req.headers.accept, body: json });
    const reply = (status, data, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };
    const sse = (events, { cut = false } = {}) => {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
      for (const ev of events) res.write(typeof ev === 'string' ? ev : `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      if (cut) return res.socket.destroy(); // the connection dropped mid-reply
      res.end('data: [DONE]\n\n');
    };
    const first = (name) => { if (once.has(name)) return false; once.add(name); return true; };
    if (req.url === '/v1/responses') {
      const m = json.model;
      const text = m === 'empty/model' ? '{}' : '{"buy": true, "reason": "cheap"}';
      if (m === 'reject/reasoning' && json.reasoning) return reply(400, { error: { message: 'unknown parameter: reasoning' } });
      if (m === 'reject/stream' && json.stream) return reply(400, { error: { message: 'stream is not supported for this model' } });
      if (!json.stream) return reply(200, RESPONSE(text, m));
      if (m === 'sse/empty') return sse([{ type: 'response.created', response: { id: 'r', status: 'in_progress' } }]);
      if (m === 'sse/deltas') return sse([{ type: 'response.output_text.delta', delta: '{"buy": ' }, { type: 'response.output_text.delta', delta: 'false}' }]);
      if (m === 'sse/ratelimit' && first('ratelimit')) return sse([{ type: 'error', code: 'rate_limit_exceeded', message: 'Request rate limit exceeded, please try again later.' }], { cut: false });
      if (m === 'sse/cut' && first('cut')) return sse([{ type: 'response.created', response: { id: 'r', status: 'in_progress' } }, { type: 'response.output_text.delta', delta: '{"bu' }], { cut: true });
      return sse([
        { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } },
        ': keep-alive\n\n',
        { type: 'response.reasoning_summary_text.delta', delta: 'thinking' },
        { type: 'response.output_text.delta', delta: text.slice(0, 5) },
        { type: 'response.output_text.delta', delta: text.slice(5) },
        { type: 'response.completed', response: RESPONSE(text, m === 'openai/gpt-5.5' ? 'openai/gpt-5.5-2026-09-01' : m) },
      ]);
    }
    if (req.url === '/v1/chat/completions' && json.model === 'limited/model' && first('limited')) return reply(429, { error: { message: 'slow down' } }, { 'retry-after': '0.3' });
    if (req.url === '/v1/chat/completions' && /^qwen\//.test(json.model)) return reply(200, { model: 'qwen/qwen3.8-max-20260803', choices: [{ message: { role: 'assistant', content: '{"bid": 120}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.00042 } });
    if (req.url === '/v1/chat/completions') return reply(200, { model: 'glm-5-0601', choices: [{ message: { role: 'assistant', content: '{"accept": false}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 8 } });
    if (req.url === '/v1/messages') return reply(200, { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"build": []}' }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 400 } });
    if (req.url === '/v1/models/gemini-4-argon:generateContent') return reply(200, { modelVersion: 'gemini-4-argon-001', candidates: [{ content: { parts: [{ text: '{"pay": true}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3000, cachedContentTokenCount: 2000, candidatesTokenCount: 100, thoughtsTokenCount: 400 } });
    if (req.url === '/v1/models') return reply(200, { data: [{ id: 'openai/gpt-5.5' }, { id: 'xai/grok-4.7' }, { id: 'perplexity/kimi-k3' }] });
    reply(404, { error: { message: 'no such route' } });
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/v1`;
const must = (c, msg) => { if (!c) throw new Error('FAILED: ' + msg); console.log('ok  ' + msg); };
const system = [{ text: 'You are a Monopoly player.', cache: true }, { text: 'You are Grok.', cache: false }];
const pplx = (model, extra = {}) => callModel({ provider: 'perplexity', model, effort: 'high', apiKey: 'pplx-test', baseUrl: base, system, user: 'Buy?', maxTokens: 500, timeoutMs: 5000, concurrency: 4, backoff: 0.01, ...extra });

// Perplexity: one streamed request, effort as reasoning.effort, no preset and no JSON mode.
const out = await pplx('openai/gpt-5.5');
must(seen.length === 1 && seen[0].path === '/v1/responses', 'Perplexity: one request');
must(seen[0].body.stream === true && /text\/event-stream/.test(seen[0].accept || ''), 'the reply is asked for as a stream');
must(seen[0].body.reasoning && seen[0].body.reasoning.effort === 'high' && seen[0].body.preset === undefined && seen[0].body.text === undefined, 'effort goes as reasoning.effort, with no preset and no JSON mode (the "{}" replies)');
must(seen[0].auth === 'Bearer pplx-test', 'bearer key sent');
must(seen[0].body.input.length === 2 && seen[0].body.input[0].role === 'system' && /Monopoly player/.test(seen[0].body.input[0].content) && /Grok/.test(seen[0].body.input[0].content) && seen[0].body.input[1].content === 'Buy?', 'system blocks and the user turn go in input');
must(seen[0].body.max_output_tokens === 500 + 16000, 'max_output_tokens with the effort headroom: ' + seen[0].body.max_output_tokens);
must(out.text === '{"buy": true, "reason": "cheap"}' && out.servedModel === 'openai/gpt-5.5-2026-09-01' && out.usage.input === 120 && out.usage.output === 30 && out.usage.cached === 100 && out.usage.reasoning === 12 && out.stopReason === 'completed', 'through keep-alives and reasoning events, the reply, served model and usage come from the completed event');

seen.length = 0;
const out2 = await callModel({ provider: 'perplexity', model: 'xai/grok-4.7', effort: 'none', apiKey: 'k', baseUrl: base, system, user: 'Trade?', maxTokens: 100, timeoutMs: 5000, plain: true });
must(seen[0].body.reasoning.effort === 'minimal' && seen[0].body.text === undefined && out2.text.length > 0, 'effort none asks for minimal reasoning; plain mode asks for no format either');

seen.length = 0;
const r1 = await pplx('reject/reasoning');
must(seen.length === 2 && seen[0].body.reasoning && seen[1].body.reasoning === undefined && seen[1].body.stream === true && r1.text.includes('"buy"'), 'an option the API refuses (400) is dropped and the stream kept');
seen.length = 0;
await pplx('reject/reasoning');
must(seen.length === 1 && seen[0].body.reasoning === undefined, 'the next call for that model starts from the shape that worked');

seen.length = 0;
const r2 = await pplx('reject/stream');
must(seen.length === 3 && seen[2].body.stream === undefined && seen[2].body.reasoning.effort === 'high' && r2.text.includes('"buy"'), 'a stream the API refuses falls back to the whole reply at once, with the effort kept');

seen.length = 0;
const r3 = await pplx('sse/empty');
must(seen.length === 3 && seen[2].body.stream === undefined && r3.text.includes('"buy"'), 'a stream with no reply in it is asked again without streaming');

const r4 = await pplx('sse/deltas');
must(r4.text === '{"buy": false}', 'a stream with the text but no completed event gives the text: ' + r4.text);

seen.length = 0;
const r5 = await pplx('sse/ratelimit');
must(seen.length === 2 && r5.text.includes('"buy"'), 'a rate limit reported inside the stream is waited out and asked again');

seen.length = 0;
const r6 = await pplx('sse/cut');
must(seen.length === 2 && r6.text.includes('"buy"') && r6.cost === 0.0005, 'a stream cut mid-reply is asked again, and the whole reply kept with its cost');

// A reply of "{}" is no answer: the choice is forfeited and the forfeit says why, rather than passing as "nothing to
// do" or being played by the bot.
seen.length = 0;
const decider = new AIDecider({ grok: { provider: 'perplexity', model: 'empty/model', effort: 'high' } }, { keys: { perplexity: 'k' }, baseUrls: { perplexity: base }, timeoutMs: 5000 });
const game = new Game({ id: 'empty', seed: 1, config: { shuffleOrder: false }, players: [{ id: 'grok', name: 'Grok', provider: 'perplexity', model: 'empty/model' }, { id: 'bot', name: 'Bot', provider: 'heuristic' }], decider });
const pre = await game.decide(game.players[0], 'preroll', game.prerollContext(game.players[0]));
const fell = game.events.find((e) => e.type === 'forfeit');
must(pre.__source === 'forfeit' && Array.isArray(pre.actions) && !pre.actions.length && fell && fell.kind === 'empty' && fell.reason === 'empty reply' && fell.call === game.llmCalls[0].seq && game.llmCalls[0].error === 'empty reply' && game.players[0].stats.forfeits === 1, 'an empty reply "{}" before a roll forfeits the choice: nothing done, the forfeit logged with its reason and its call');

// A rate limit that says how long to wait (Retry-After) is waited out for that long, not the default.
seen.length = 0;
const t0 = Date.now();
const lim = await callModel({ provider: 'zhipu', model: 'limited/model', apiKey: 'z', baseUrl: base, system, user: 'Respond', maxTokens: 100, timeoutMs: 5000 });
const waited = Date.now() - t0;
must(seen.length === 2 && lim.text === '{"accept": false}' && waited >= 280 && waited < 3000, `a 429 with Retry-After 0.3 s is asked again after ${waited} ms`);

seen.length = 0;
const out3 = await callModel({ provider: 'zhipu', model: 'glm-5', effort: 'medium', apiKey: 'z', baseUrl: base, system, user: 'Respond', maxTokens: 100, timeoutMs: 5000 });
must(seen[0].path === '/v1/chat/completions' && seen[0].body.thinking && seen[0].body.thinking.type === 'enabled' && out3.servedModel === 'glm-5-0601' && out3.text === '{"accept": false}', 'chat completions: GLM thinking on, served model read');

const models = await listModels('perplexity', 'k', base);
must(models.length === 3 && models.includes('perplexity/kimi-k3'), 'the catalogue lists through /v1/models');

// What each call costs.
const near = (a, b) => Math.abs(a - b) < 1e-9;
must(out.cost === 0.0005 && out.costSource === 'reported', `Perplexity's reported cost is kept: ${out.cost} (${out.costSource})`);
must(out3.cost === null && out3.costSource === null, 'a model with no price on file and no reported cost costs nothing on record');
const q = await callModel({ provider: 'openrouter', model: 'qwen/qwen3.8-max', effort: 'high', apiKey: 'or', baseUrl: base, system, user: 'Bid?', maxTokens: 100, timeoutMs: 5000 });
must(q.cost === 0.00042 && q.costSource === 'reported', `OpenRouter's reported cost is kept: ${q.cost}`);
const c = await callModel({ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'xhigh', apiKey: 'a', baseUrl: base.replace(/\/v1$/, ''), system, user: 'Build?', maxTokens: 100, timeoutMs: 5000 });
must(c.costSource === 'priced' && near(c.cost, (1000 * 4 + 5000 * 0.2 + 400 * 5 + 200 * 20) / 1e6), `Claude Opus 5.5 priced from tokens with its cache reads and writes: ${c.cost}`);
const g = await callModel({ provider: 'google', model: 'gemini-4-argon', effort: 'high', apiKey: 'g', baseUrl: base, system, user: 'Pay?', maxTokens: 100, timeoutMs: 5000 });
const gp = priceFor('google', 'gemini-4-argon', new Date());
must(g.costSource === 'priced' && near(g.cost, (1000 * gp.input + 2000 * gp.cachedInput + (100 + 400) * gp.output) / 1e6) && near(g.cost, tokenCost(g.usage, gp, 'gemini')), `Gemini 4 Argon priced at today's rate, thinking billed as output: ${g.cost} at $${gp.input}/$${gp.output}`);
must(priceFor('google', 'gemini-4-argon', new Date('2026-11-30T23:00:00Z')).input === 2 && priceFor('google', 'gemini-4-argon', new Date('2026-12-01T00:00:00Z')).input === 4, 'the Gemini price doubles on 1 December 2026');
const o = await callModel({ provider: 'zhipu', model: 'glm-5', effort: 'medium', apiKey: 'z', baseUrl: base, system, user: 'Respond', maxTokens: 100, timeoutMs: 5000, price: { input: 1, output: 2 } });
must(o.costSource === 'priced' && near(o.cost, (50 * 1 + 8 * 2) / 1e6), `a price from the config prices a model the list lacks: ${o.cost}`);

// An API that cannot be reached: the reason Node keeps out of "fetch failed" is in the message, and the call is retried.
const closed = await new Promise((r) => { const t = http.createServer(); t.listen(0, '127.0.0.1', () => { const port = t.address().port; t.close(() => r(port)); }); });
const t1 = Date.now();
const failed = await callModel({ provider: 'openrouter', model: 'qwen/qwen3.8-max', apiKey: 'or', baseUrl: `http://127.0.0.1:${closed}/v1`, system, user: 'Bid?', maxTokens: 10, timeoutMs: 3000, backoff: 0.02 }).then(() => null, (e) => e);
must(failed && failed.name === 'TypeError' && /ECONNREFUSED/.test(failed.message) && connectFailed(failed), `an unreachable API names the reason: ${failed && failed.message}`);
must(Date.now() - t1 >= 0.02 * (1500 + 3000 + 6000 + 12000) - 50, `a connection that never opened is tried four more times, with longer waits (${Date.now() - t1} ms at a fiftieth of the real waits)`);
srv.close();
console.log('providers ok');
