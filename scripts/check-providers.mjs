#!/usr/bin/env node
// Drives the provider adapters against a mock on this machine: the OpenAI
// Responses shape (Perplexity's Agent API) with a preset that the server
// rejects once, and the chat-completions shape, checking the request each
// adapter sends and what it makes of the reply.
//   node scripts/check-providers.mjs
import http from 'node:http';
import { callModel, listModels } from '../public/assets/app/providers.js';

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
      return reply(200, { id: 'resp_1', model: 'openai/gpt-5.5-2026-09-01', status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"buy": true, "reason": "cheap"}' }] }], usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 12 } } });
    }
    if (req.url === '/v1/chat/completions') return reply(200, { model: 'glm-5-0601', choices: [{ message: { role: 'assistant', content: '{"accept": false}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 8 } });
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
srv.close();
console.log('providers ok');
