#!/usr/bin/env node
// Drives the provider adapters against a mock on this machine: the OpenAI
// Responses shape (Perplexity's Agent API) with a preset that the server
// rejects once, the chat-completions shape, Anthropic's messages and Gemini's
// generateContent, checking the request each adapter sends, what it makes of
// the reply, and what each call costs: as reported (Perplexity, OpenRouter),
// priced from the tokens (Anthropic with its cache, Gemini with its thinking),
// unpriced, or at a price the config gives.
//   node scripts/check-providers.mjs
import http from 'node:http';
import { callModel, listModels } from '../public/assets/app/providers.js';
import { priceFor, tokenCost } from '../public/assets/app/pricing.js';

const seen = [];
let rejectPresetOnce = true;
const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = body ? JSON.parse(body) : null;
    seen.push({ path: req.url, auth: req.headers.authorization, body: json });
    const reply = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/v1/responses') {
      if (json.preset && rejectPresetOnce) { rejectPresetOnce = false; return reply(400, { error: { message: 'unknown parameter: preset' } }); }
      return reply(200, { id: 'resp_1', model: 'openai/gpt-5.5-2026-09-01', status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"buy": true, "reason": "cheap"}' }] }], usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 12 }, cost: { currency: 'USD', input_cost: 0.0002, output_cost: 0.0003, tool_calls_cost: 0, total_cost: 0.0005 } } });
    }
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

const out = await callModel({ provider: 'perplexity', model: 'openai/gpt-5.5', effort: 'high', apiKey: 'pplx-test', baseUrl: base, system, user: 'Buy?', maxTokens: 500, timeoutMs: 5000, concurrency: 2 });
must(seen.length === 2 && seen[0].path === '/v1/responses' && seen[1].path === '/v1/responses', 'the preset is dropped and the call sent again after a 400');
must(seen[0].body.preset === 'high' && seen[0].body.text && seen[0].body.text.format.type === 'json_object' && seen[1].body.preset === undefined && seen[1].body.text === undefined, 'first request carried preset high and the JSON format, the retry carried neither');
must(seen[0].auth === 'Bearer pplx-test', 'bearer key sent');
must(seen[0].body.input.length === 2 && seen[0].body.input[0].role === 'system' && /Monopoly player/.test(seen[0].body.input[0].content) && /Grok/.test(seen[0].body.input[0].content) && seen[0].body.input[1].content === 'Buy?', 'system blocks and the user turn go in input');
must(seen[0].body.max_output_tokens === 500 + 16000, 'max_output_tokens with the effort headroom: ' + seen[0].body.max_output_tokens);
must(out.text === '{"buy": true, "reason": "cheap"}' && out.servedModel === 'openai/gpt-5.5-2026-09-01' && out.usage.input === 120 && out.usage.output === 30 && out.usage.cached === 100 && out.usage.reasoning === 12 && out.stopReason === 'completed', 'the reply text, served model and usage are read from the output items');

seen.length = 0;
const out2 = await callModel({ provider: 'perplexity', model: 'xai/grok-4.7', effort: 'none', apiKey: 'k', baseUrl: base, system, user: 'Trade?', maxTokens: 100, timeoutMs: 5000, plain: true });
must(seen[0].body.preset === 'fast' && seen[0].body.text === undefined && out2.text.length > 0, 'effort none maps to the fast preset; plain mode asks for no JSON format');

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
const failed = await callModel({ provider: 'openrouter', model: 'qwen/qwen3.8-max', apiKey: 'or', baseUrl: `http://127.0.0.1:${closed}/v1`, system, user: 'Bid?', maxTokens: 10, timeoutMs: 3000 }).then(() => null, (e) => e);
must(failed && failed.name === 'TypeError' && /ECONNREFUSED/.test(failed.message), `an unreachable API names the reason: ${failed && failed.message}`);
srv.close();
console.log('providers ok');
