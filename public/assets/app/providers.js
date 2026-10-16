// Provider adapters. Every call goes straight to the provider's API with the
// caller's own key: from the runner on the owner's machine, or from the Worker
// for the narrator. Each adapter returns { text, usage, latencyMs, raw, request,
// servedModel, reported } or throws; callModel adds the call's cost in dollars
// and its source (pricing.js). `env` names the environment variable the runner
// reads the key from.
import { callCost, reportedCost } from './pricing.js';

export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)', kind: 'anthropic', base: 'https://api.anthropic.com', env: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    effortNote: 'Maps to output_config.effort (low … max). Thinking is adaptive on Claude 5 models.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
    effortNote: 'Maps to reasoning_effort on reasoning models; ignored by non-reasoning models.',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  google: {
    label: 'Google (Gemini)', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', env: 'GEMINI_API_KEY',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    effortNote: 'Maps to a thinking budget (thinkingLevel on Gemini 3).',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  xai: {
    label: 'xAI (Grok)', kind: 'openai', base: 'https://api.x.ai/v1', env: 'XAI_API_KEY',
    models: ['grok-4', 'grok-4-fast', 'grok-3', 'grok-3-mini'],
    effortNote: 'Maps to reasoning_effort low/high where the model supports it.',
    keyUrl: 'https://console.x.ai/',
  },
  mistral: {
    label: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1', env: 'MISTRAL_API_KEY',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'magistral-medium-latest', 'magistral-small-latest'],
    effortNote: 'No effort parameter; magistral models reason by default.',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    label: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    effortNote: 'No effort parameter; deepseek-reasoner always reasons.',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  groq: {
    label: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b'],
    effortNote: 'Maps to reasoning_effort on gpt-oss and qwen models.',
    keyUrl: 'https://console.groq.com/keys',
  },
  together: {
    label: 'Together AI', kind: 'openai', base: 'https://api.together.xyz/v1', env: 'TOGETHER_API_KEY',
    models: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B-A22B-fp8-tput'],
    effortNote: 'No effort parameter.',
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  openrouter: {
    label: 'OpenRouter (any model)', kind: 'openai', base: 'https://openrouter.ai/api/v1', reasoning: 'openrouter', env: 'OPENROUTER_API_KEY',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.5-pro', 'x-ai/grok-4', 'meta-llama/llama-4-maverick', 'deepseek/deepseek-r1', 'qwen/qwen3-235b-a22b'],
    effortNote: 'Maps to the unified reasoning.effort parameter.',
    keyUrl: 'https://openrouter.ai/keys',
  },
  cohere: {
    label: 'Cohere', kind: 'openai', base: 'https://api.cohere.ai/compatibility/v1', env: 'COHERE_API_KEY',
    models: ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r7b-12-2024'],
    effortNote: 'No effort parameter.',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
  },
  // The Agent API: effort as reasoning.effort, never a preset (a preset is a whole agent, its own instructions and
  // tools); no JSON mode (it documents none, and asked for json_object GPT, Grok and Kimi answered "{}" every time);
  // and the reply streamed, since a call that has not answered within about a minute is closed ("other side closed").
  perplexity: {
    label: 'Perplexity (Agent API)', kind: 'responses', base: 'https://api.perplexity.ai/v1', env: 'PERPLEXITY_API_KEY', reasoning: 'effort', stream: true,
    models: ['openai/gpt-5.5', 'openai/gpt-5.6-sol', 'openai/gpt-6-luna', 'xai/grok-4.7', 'xai/grok-4.5', 'perplexity/kimi-k3', 'zai/glm-5.2', 'anthropic/claude-opus-5-5', 'google/gemini-3.1-pro-preview', 'perplexity/sonar'],
    effortNote: 'One key for many providers: the Agent API serves OpenAI, xAI, Moonshot, Z.ai, Anthropic and Google models under provider-prefixed ids (GET /v1/models lists them). Effort maps to reasoning.effort: minimal, low, medium, high, xhigh or max. No preset and no tools are requested, so no web search is run and a call costs only its tokens; replies are streamed, so a long think is not cut off after a minute.',
    keyUrl: 'https://www.perplexity.ai/account/api',
  },
  moonshot: {
    label: 'Moonshot (Kimi)', kind: 'openai', base: 'https://api.moonshot.ai/v1', env: 'MOONSHOT_API_KEY',
    models: ['kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview'],
    effortNote: 'No effort parameter; the thinking models reason by default. China-mainland keys use api.moonshot.cn.',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
  },
  zhipu: {
    label: 'Z.ai (GLM)', kind: 'openai', base: 'https://api.z.ai/api/paas/v4', env: 'ZAI_API_KEY',
    models: ['glm-5', 'glm-4.7', 'glm-4.6'],
    effortNote: 'Thinking is on by default; effort "none" turns it off. China-mainland keys use open.bigmodel.cn.',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
  },
  xiaomi: {
    label: 'Xiaomi (MiMo)', kind: 'openai', base: 'https://api.xiaomimimo.com/v1', env: 'XIAOMI_API_KEY',
    models: ['mimo-v2-flash'],
    effortNote: 'No effort parameter.',
    keyUrl: 'https://platform.xiaomimimo.com/',
  },
  custom: {
    label: 'Custom OpenAI-compatible endpoint', kind: 'openai', base: 'http://localhost:11434/v1', env: 'CUSTOM_API_KEY',
    models: ['llama3.1', 'qwen3', 'gpt-oss:20b'],
    effortNote: 'Sends reasoning_effort; stripped automatically if the server rejects it.',
    keyUrl: '',
  },
  heuristic: {
    label: 'Heuristic bot (no API)', kind: 'none', base: '', models: ['rules-v1'], effortNote: 'Rule-based player. Free and instant.', keyUrl: '',
  },
};

// ---------- effort mapping ----------
function mapEffort(providerId, effort) {
  if (!effort || effort === 'default') return null;
  const p = PROVIDERS[providerId] || PROVIDERS.custom;
  if (p.kind === 'anthropic') {
    if (effort === 'none' || effort === 'minimal') return 'low';
    return effort; // low|medium|high|xhigh|max
  }
  if (p.kind === 'gemini') return effort;
  if (providerId === 'perplexity') {
    if (effort === 'none' || effort === 'minimal') return 'minimal';
    return effort; // low|medium|high|xhigh|max, as reasoning.effort
  }
  if (providerId === 'openrouter') {
    if (effort === 'none') return null;
    if (effort === 'minimal') return 'low';
    if (effort === 'xhigh' || effort === 'max') return 'high';
    return effort;
  }
  if (providerId === 'xai') {
    if (effort === 'none') return null;
    return effort === 'minimal' || effort === 'low' ? 'low' : 'high';
  }
  if (providerId === 'groq') {
    if (effort === 'none') return 'none';
    if (effort === 'minimal') return 'low';
    if (effort === 'xhigh' || effort === 'max') return 'high';
    return effort;
  }
  if (providerId === 'openai' || providerId === 'custom') {
    if (effort === 'xhigh' || effort === 'max') return 'high';
    return effort; // none|minimal|low|medium|high
  }
  return null; // providers without a reasoning knob
}

function headroom(effort) {
  switch (effort) {
    case 'none': case 'minimal': return 1500;
    case 'low': return 4000;
    case 'medium': return 8000;
    case 'high': return 16000;
    case 'xhigh': case 'max': return 32000;
    default: return 4000;
  }
}

// ---------- fetch with retries ----------
// Node's fetch says only "fetch failed" and keeps the reason in `cause`: a name that does not resolve, a
// connection refused or timed out, a certificate it would not trust. This puts the reason into the message.
export function netReason(e) {
  const c = e && e.cause;
  if (!c) return (e && e.message) || String(e);
  const inner = c.errors && c.errors.length ? c.errors.map((x) => x.message || x.code).join('; ') : c.message || c.code || '';
  return inner && !String(e.message).includes(inner) ? `${e.message}: ${inner}` : e.message;
}

async function fetchJson(url, init, timeoutMs, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason || new Error('aborted'));
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, json, text, headers: res.headers };
  } catch (e) {
    if (e && e.cause) e.message = netReason(e); // still the TypeError withRetries retries
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// A streamed reply in the Responses shape (server-sent events): the text as it comes (response.output_text.delta)
// and the whole response the last event carries (response.completed, .incomplete or .failed), which has the usage
// and the cost. Bytes flowing keep a long think from being cut off as an idle call. An `error` event fails the
// call; a connection cut mid-stream throws as fetch does and is tried again; a stream that ends cleanly with
// nothing in it is answered 422, so the caller asks again without streaming. An API that answers a stream
// request with the whole reply at once is read as fetchJson reads it.
async function fetchSse(url, init, timeoutMs, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason || new Error('aborted'));
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok || !/text\/event-stream/i.test(res.headers.get('content-type') || '')) {
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { ok: res.ok, status: res.status, json, text, headers: res.headers };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', deltas = '', final = null, failure = null;
    const take = (block) => {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (!data || data.trim() === '[DONE]') return; // a comment, a keep-alive or the end
      let ev;
      try { ev = JSON.parse(data); } catch { return; }
      if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') deltas += ev.delta;
      else if (/^response\.(completed|incomplete|failed|done)$/.test(ev.type || '') && ev.response) final = ev.response;
      else if (ev.type === 'error' || ev.type === 'response.error') failure = ev.error || ev;
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (let m = buf.match(/\r?\n\r?\n/); m; m = buf.match(/\r?\n\r?\n/)) { take(buf.slice(0, m.index)); buf = buf.slice(m.index + m[0].length); }
    }
    buf += dec.decode();
    if (buf.trim()) take(buf);
    const why = (x) => (x && (x.message || (x.error && x.error.message) || x.code)) || 'the stream reported an error';
    if (failure && !(final && final.status !== 'failed')) {
      const limited = /rate.?limit/i.test(`${failure.code || ''} ${why(failure)}`);
      throw Object.assign(new ProviderError(`stream error: ${why(failure)}`, limited ? 429 : 502, failure), { retryable: true });
    }
    if (final && final.status === 'failed') throw Object.assign(new ProviderError(`the reply failed: ${why(final.error)}`, 502, final), { retryable: true });
    if (final) return { ok: true, status: res.status, json: { ...final, streamedText: deltas }, text: '', headers: res.headers };
    if (deltas) return { ok: true, status: res.status, json: { status: 'completed', output_text: deltas }, text: '', headers: res.headers };
    return { ok: false, status: 422, json: { error: { message: 'the stream carried no reply' } }, text: '', headers: res.headers };
  } catch (e) {
    if (e && e.cause) e.message = netReason(e);
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

class ProviderError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}
// An API's refusal as an error: its status, its own message and how long it asks to be left alone (Retry-After).
function httpError(label, r) {
  const msg = (r.json && r.json.error && (r.json.error.message || JSON.stringify(r.json.error))) || r.text.slice(0, 300);
  const e = new ProviderError(`${label} ${r.status}: ${msg}`, r.status, r.json);
  e.retryAfter = r.headers && r.headers.get ? r.headers.get('retry-after') : null;
  return e;
}

// When to try a call again, and how long to wait first. A rate limit (429) waits as long as the API asks
// (Retry-After, a minute at most) or 4, 8, 16 and 32 seconds; a connection that never opened (the network dropped,
// or answered too slowly) is tried four more times over about twenty seconds, so a short drop on the runner's
// machine does not hand the decision to the bot; a server error, a timeout or a connection cut mid-reply is tried
// twice more. `backoff` scales the waits (the checks run them short).
const CONNECT_CODES = /^(ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENETDOWN|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)$/;
export function connectFailed(e) {
  const c = e && e.cause;
  if (!c) return false;
  const all = c.errors && c.errors.length ? c.errors : [c];
  return all.every((x) => CONNECT_CODES.test(String((x && x.code) || '')));
}
function retryAfterMs(v) {
  if (v == null || v === '') return null;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
}
async function withRetries(fn, { backoff = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      const retryable = e.status === 429 || e.status === 408 || e.status === 409 || (e.status >= 500 && e.status < 600) || e.message === 'timeout' || e.name === 'TypeError' || e.retryable;
      let max = 2, delay = 800 * 2 ** attempt + Math.random() * 300;
      if (e.status === 429) { max = 4; delay = Math.min(60000, retryAfterMs(e.retryAfter) ?? 4000 * 2 ** attempt + Math.random() * 1000); }
      else if (connectFailed(e)) { max = 4; delay = 1500 * 2 ** attempt + Math.random() * 500; }
      if (!retryable || attempt >= max) throw e;
      await new Promise((r) => setTimeout(r, delay * backoff));
    }
  }
}

// Per-provider concurrency gate to avoid 429 storms when many games run at once.
const gates = {};
function gate(providerId, limit) {
  if (!gates[providerId]) gates[providerId] = { active: 0, queue: [] };
  const g = gates[providerId];
  return {
    async acquire() {
      if (g.active < limit) { g.active++; return; }
      await new Promise((resolve) => g.queue.push(resolve));
      g.active++;
    },
    release() {
      g.active--;
      const next = g.queue.shift();
      if (next) next();
    },
  };
}

// ---------- main entry ----------
// opts: { provider, model, effort, apiKey, baseUrl, system: [{text, cache}], user, maxTokens, temperature, timeoutMs, signal, concurrency, price }
export async function callModel(opts) {
  const provider = PROVIDERS[opts.provider] || PROVIDERS.custom;
  const g = gate(opts.provider, opts.concurrency || 8);
  await g.acquire();
  const t0 = Date.now();
  try {
    let out;
    if (provider.kind === 'anthropic') out = await callAnthropic(opts, provider);
    else if (provider.kind === 'gemini') out = await callGemini(opts, provider);
    else if (provider.kind === 'responses') out = await callResponses(opts, provider);
    else out = await callOpenAICompat(opts, provider);
    out.latencyMs = Date.now() - t0;
    const c = callCost({ provider: opts.provider, model: opts.model, kind: provider.kind, usage: out.usage, reported: out.reported, price: opts.price });
    out.cost = c.cost; out.costSource = c.source;
    return out;
  } finally {
    g.release();
  }
}

function is400(e) { return e && (e.status === 400 || e.status === 422); }

async function callAnthropic(o, provider) {
  const base = (o.baseUrl || provider.base).replace(/\/$/, '');
  const effort = mapEffort('anthropic', o.effort);
  const system = o.system.map((b, i) => (b.cache ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } } : { type: 'text', text: b.text }));
  const body = {
    model: o.model,
    max_tokens: (o.maxTokens || 1500) + headroom(o.effort),
    system,
    messages: [{ role: 'user', content: o.user }],
  };
  if (effort) body.output_config = { effort };
  if (o.temperature != null && !effort) body.temperature = o.temperature;
  const headers = {
    'content-type': 'application/json',
    'x-api-key': o.apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (typeof window !== 'undefined') headers['anthropic-dangerous-direct-browser-access'] = 'true';
  const send = async (b) => {
    const r = await fetchJson(`${base}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(b) }, o.timeoutMs || 60000, o.signal);
    if (!r.ok) throw httpError('Anthropic', r);
    return r.json;
  };
  let json;
  let request = body;
  try {
    json = await withRetries(() => send(body), o);
  } catch (e) {
    if (is400(e) && (body.output_config || body.temperature != null)) {
      // Older models reject effort; retry without the optional knobs.
      const b2 = { ...body }; delete b2.output_config; delete b2.temperature;
      request = b2;
      json = await withRetries(() => send(b2), o);
    } else throw e;
  }
  if (json.stop_reason === 'refusal') throw new ProviderError('Anthropic refusal', 200, json);
  const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const u = json.usage || {};
  return {
    text, raw: json, request, servedModel: json.model || null,
    usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cached: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, reasoning: null },
    stopReason: json.stop_reason,
  };
}

async function callGemini(o, provider) {
  const base = (o.baseUrl || provider.base).replace(/\/$/, '');
  const url = `${base}/models/${encodeURIComponent(o.model)}:generateContent`;
  const generationConfig = { maxOutputTokens: (o.maxTokens || 1500) + headroom(o.effort) };
  if (!o.plain) generationConfig.responseMimeType = 'application/json';
  if (o.temperature != null) generationConfig.temperature = o.temperature;
  const eff = mapEffort('google', o.effort);
  if (eff) {
    if (/gemini-3/i.test(o.model)) generationConfig.thinkingConfig = { thinkingLevel: eff === 'none' || eff === 'minimal' || eff === 'low' ? 'low' : eff === 'medium' ? 'medium' : 'high' };
    else generationConfig.thinkingConfig = { thinkingBudget: { none: 0, minimal: 512, low: 1024, medium: 4096, high: 12288, xhigh: 24576, max: -1 }[eff] };
  }
  const body = {
    systemInstruction: { parts: [{ text: o.system.map((b) => b.text).join('\n\n') }] },
    contents: [{ role: 'user', parts: [{ text: o.user }] }],
    generationConfig,
  };
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey };
  const send = async (b) => {
    const r = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify(b) }, o.timeoutMs || 60000, o.signal);
    if (!r.ok) throw httpError('Gemini', r);
    return r.json;
  };
  let json; let request = body;
  try {
    json = await withRetries(() => send(body), o);
  } catch (e) {
    if (is400(e) && body.generationConfig.thinkingConfig) {
      const b2 = { ...body, generationConfig: { ...body.generationConfig } }; delete b2.generationConfig.thinkingConfig;
      request = b2;
      json = await withRetries(() => send(b2), o);
    } else throw e;
  }
  const cand = (json.candidates || [])[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.filter((p) => !p.thought).map((p) => p.text || '').join('') : '';
  const u = json.usageMetadata || {};
  return {
    text, raw: json, request, servedModel: json.modelVersion || null,
    usage: { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, cached: u.cachedContentTokenCount || 0, reasoning: u.thoughtsTokenCount || 0 },
    stopReason: cand ? cand.finishReason : null,
  };
}

async function callOpenAICompat(o, provider) {
  const base = (o.baseUrl || provider.base).replace(/\/$/, '');
  const eff = mapEffort(o.provider, o.effort);
  const body = {
    model: o.model,
    messages: [
      { role: 'system', content: o.system.map((b) => b.text).join('\n\n') },
      { role: 'user', content: o.user },
    ],
  };
  const limit = (o.maxTokens || 1500) + headroom(o.effort);
  if (o.provider === 'openai') body.max_completion_tokens = limit; else body.max_tokens = limit;
  const optional = {};
  if (eff) {
    if (provider.reasoning === 'openrouter') optional.reasoning = { effort: eff };
    else optional.reasoning_effort = eff;
  }
  if (o.temperature != null) optional.temperature = o.temperature;
  if (!o.plain && o.provider !== 'together' && o.provider !== 'cohere' && o.provider !== 'custom') optional.response_format = { type: 'json_object' };
  if (o.provider === 'zhipu' && o.effort) optional.thinking = { type: o.effort === 'none' ? 'disabled' : 'enabled' };
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey || 'none'}` };
  if (o.provider === 'openrouter') { headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://monopoly-simulator'; headers['X-Title'] = 'Monopoly AI Simulator'; }
  const send = async (b) => {
    const r = await fetchJson(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(b) }, o.timeoutMs || 60000, o.signal);
    if (!r.ok) throw httpError(provider.label, r);
    return r.json;
  };
  let json; let request = { ...body, ...optional };
  try {
    json = await withRetries(() => send({ ...body, ...optional }), o);
  } catch (e) {
    if (is400(e) && Object.keys(optional).length) {
      request = body;
      json = await withRetries(() => send(body), o);
    } else throw e;
  }
  const choice = (json.choices || [])[0];
  const msg = choice && choice.message ? choice.message : {};
  let text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : '';
  if (!text && msg.reasoning_content && /\{/.test(msg.reasoning_content)) text = msg.reasoning_content; // some servers put the answer here when truncated
  const u = json.usage || {};
  return {
    text, raw: json, request, servedModel: json.model || null,
    usage: {
      input: u.prompt_tokens || 0, output: u.completion_tokens || 0,
      cached: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0,
      reasoning: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || null,
    },
    reported: reportedCost(json),
    stopReason: choice ? choice.finish_reason : null,
  };
}

// The OpenAI Responses shape, which Perplexity's Agent API speaks: the system
// text and the user turn go in `input`, the reply comes back as output items,
// streamed when the provider says so (`stream`). Asked for JSON only where the
// API has a JSON mode (`jsonMode`); otherwise the prompt asks for it and
// parseJsonReply finds it. After a 400 the call is sent again without its
// optional knobs, then without streaming, then plain, and the shape that worked
// is used first from then on for that model.
const shapes = new Map();
async function callResponses(o, provider) {
  const base = (o.baseUrl || provider.base).replace(/\/$/, '');
  const eff = mapEffort(o.provider, o.effort);
  const body = {
    model: o.model,
    input: [
      { role: 'system', content: o.system.map((b) => b.text).join('\n\n') },
      { role: 'user', content: o.user },
    ],
    max_output_tokens: (o.maxTokens || 1500) + headroom(o.effort),
  };
  const optional = {};
  if (eff) optional.reasoning = { effort: eff };
  if (o.temperature != null) optional.temperature = o.temperature;
  if (!o.plain && provider.jsonMode) optional.text = { format: { type: 'json_object' } };
  const ladder = [];
  const rung = (b) => { if (!ladder.some((x) => JSON.stringify(x) === JSON.stringify(b))) ladder.push(b); };
  if (provider.stream) { rung({ ...body, ...optional, stream: true }); rung({ ...body, stream: true }); }
  rung({ ...body, ...optional });
  rung(body);
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey || 'none'}` };
  const send = async (b) => {
    const init = { method: 'POST', headers: b.stream ? { ...headers, accept: 'text/event-stream' } : headers, body: JSON.stringify(b) };
    const r = b.stream ? await fetchSse(`${base}/responses`, init, o.timeoutMs || 60000, o.signal) : await fetchJson(`${base}/responses`, init, o.timeoutMs || 60000, o.signal);
    if (!r.ok) throw httpError(provider.label, r);
    return r.json;
  };
  const key = `${o.provider}|${base}|${o.model}`;
  let json, request;
  for (let k = Math.min(shapes.get(key) || 0, ladder.length - 1); ; k++) {
    request = ladder[k];
    try {
      json = await withRetries(() => send(request), o);
      shapes.set(key, k);
      break;
    } catch (e) {
      if (!is400(e) || k === ladder.length - 1) throw e;
    }
  }
  let text = typeof json.output_text === 'string' ? json.output_text : '';
  if (!text) for (const item of json.output || []) if (item.type === 'message') for (const c of item.content || []) if ((c.type === 'output_text' || c.type === 'text') && c.text) text += c.text;
  if (!text && json.streamedText) text = json.streamedText;
  const u = json.usage || {};
  return {
    text, raw: json, request, servedModel: json.model || null,
    usage: {
      input: u.input_tokens || 0, output: u.output_tokens || 0,
      cached: (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0,
      reasoning: (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || null,
    },
    reported: reportedCost(json),
    stopReason: json.status || null,
  };
}

// ---------- model listing ----------
export async function listModels(providerId, apiKey, baseUrl) {
  const provider = PROVIDERS[providerId];
  if (!provider || provider.kind === 'none') return provider ? provider.models : [];
  const base = (baseUrl || provider.base).replace(/\/$/, '');
  if (provider.kind === 'anthropic') {
    const r = await fetchJson(`${base}/v1/models?limit=100`, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }, 20000);
    if (!r.ok) throw new Error(`Anthropic ${r.status}`);
    return (r.json.data || []).map((m) => m.id);
  }
  if (provider.kind === 'gemini') {
    const r = await fetchJson(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } }, 20000);
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    return (r.json.models || []).filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  }
  const r = await fetchJson(`${base}/models`, { headers: { authorization: `Bearer ${apiKey || 'none'}` } }, 20000);
  if (!r.ok) throw new Error(`${provider.label} ${r.status}`);
  const arr = Array.isArray(r.json) ? r.json : r.json.data || r.json.models || [];
  return arr.map((m) => m.id || m.name).filter(Boolean).sort();
}
