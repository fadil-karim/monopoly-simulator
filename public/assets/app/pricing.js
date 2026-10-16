// What a model call costs, in US dollars. Every call is priced as it is made and the figure is kept with it
// (llm_calls.cost), so a later change of price never rewrites an old game. The figure is the cost the API
// reported when it reports one (OpenRouter's usage.cost, Perplexity's usage.cost.total_cost), else the call's
// tokens at the model's list price in force on the day of the call. A model missing from PRICES costs nothing
// on record until it is added here, or until its player in the runner's config carries its own `price`
// ({ input, output, cachedInput, cacheWrite }, dollars per million tokens). Shared by the runner (which prices
// the calls), the Worker and the viewer (which name the models and the APIs).

// Dollars per million tokens. `periods` run in date order, each from its `from` day (UTC) until the next one
// starts; `cachedInput` is a cache read, `cacheWrite` Anthropic's five-minute cache write. Taken on 2026-10-16
// from Anthropic's price list and, for the others, from price trackers quoting the providers' lists, whose own
// pages could not be reached; check them against a bill. Perplexity passes the first-party prices through with no markup and
// reports every call's cost, as OpenRouter does, so for those two the figures here only stand in when a reply
// carries no cost.
export const PRICES = {
  'anthropic/claude-opus-5-5': { name: 'Claude Opus 5.5', periods: [{ input: 4, output: 20, cachedInput: 0.2, cacheWrite: 5 }] },
  'anthropic/claude-sonnet-5-5': { name: 'Claude Sonnet 5.5', periods: [{ input: 2, output: 10, cachedInput: 0.2, cacheWrite: 2.5 }] },
  // Google's introductory rate runs to the end of November 2026, then doubles.
  'google/gemini-4-argon': { name: 'Gemini 4 Argon', periods: [{ input: 2, output: 10, cachedInput: 0.1 }, { from: '2026-12-01', input: 4, output: 20, cachedInput: 0.2 }] },
  'perplexity/openai/gpt-6.1-sol': { name: 'GPT-6.1 Sol', periods: [{ input: 2, output: 10 }] },
  'perplexity/xai/grok-4.7': { name: 'Grok 4.7', periods: [{ input: 2, output: 6, cachedInput: 0.5 }] },
  'perplexity/perplexity/kimi-k3': { name: 'Kimi K3', periods: [{ input: 3, output: 15, cachedInput: 0.3 }] },
  'perplexity/perplexity/nemotron-3-ultra-550b-a55b': { name: 'Nemotron 3 Ultra', periods: [{ input: 0.25, output: 2.5, cachedInput: 0.25 }] },
  'openrouter/xiaomi/mimo-v2.6-pro': { name: 'MiMo-V2.6-Pro', periods: [{ input: 0.435, output: 0.87 }] },
  'openrouter/qwen/qwen3.8-max': { name: 'Qwen3.8 Max', periods: [{ input: 2, output: 6, cachedInput: 0.25 }] },
  'openrouter/deepseek/deepseek-v4-pro': { name: 'DeepSeek V4 Pro', periods: [{ input: 1.74, output: 3.48, cachedInput: 0.145 }] },
};

// The API each provider entry calls, as the viewer names it beside the model.
export const API_NAMES = {
  anthropic: 'Anthropic API', google: 'Gemini API', perplexity: 'Perplexity Agent API', openrouter: 'OpenRouter', openai: 'OpenAI API',
  xai: 'xAI API', mistral: 'Mistral API', deepseek: 'DeepSeek API', groq: 'Groq', together: 'Together AI', cohere: 'Cohere API',
  moonshot: 'Moonshot API', zhipu: 'Z.ai API', xiaomi: 'Xiaomi MiMo API', custom: 'a custom endpoint', heuristic: 'no API',
};
export const apiName = (provider) => API_NAMES[provider] || provider || 'unknown API';

const stripDate = (id) => String(id || '').replace(/[-@](\d{8}|\d{4}-\d{2}-\d{2}|\d{4})$/, '');
const BY_MODEL = {};
for (const [key, p] of Object.entries(PRICES)) {
  const model = key.slice(key.indexOf('/') + 1);
  BY_MODEL[model] = p.name;
  BY_MODEL[model.slice(model.lastIndexOf('/') + 1)] = p.name;
}

// The model's name as people say it ("GPT-6.1 Sol"), whichever API serves it; the id itself when unknown.
export function modelName(provider, model) {
  if (provider === 'heuristic' || !model) return provider === 'heuristic' ? 'Rule-based bot' : model || '';
  const key = `${provider}/${model}`;
  if (PRICES[key]) return PRICES[key].name;
  const bare = stripDate(model);
  return BY_MODEL[model] || BY_MODEL[bare] || BY_MODEL[bare.slice(bare.lastIndexOf('/') + 1)] || model;
}

// The logo of the model's maker, a file under /assets/logos/ (the board's tokens wear it), found from the model id
// and then the provider; null for the rule-based bot and a model whose maker has none here.
const LOGOS = [[/claude|anthropic/, 'claude'], [/gemini|google/, 'gemini'], [/grok|xai|x-ai/, 'grok'], [/gpt|openai|chatgpt|\bo\d/, 'openai'], [/kimi|moonshot/, 'kimi'], [/nemotron|nvidia/, 'nvidia'], [/mimo|xiaomi/, 'mimo'], [/qwen/, 'qwen'], [/deepseek/, 'deepseek'], [/glm|zai|z-ai|zhipu/, 'glm'], [/mistral|magistral/, 'mistral']];
export function modelLogo(provider, model) {
  if (provider === 'heuristic') return null;
  for (const text of [String(model || '').toLowerCase(), String(provider || '').toLowerCase()]) {
    for (const [re, logo] of LOGOS) if (re.test(text)) return logo;
  }
  return null;
}

// Who makes the model, by its logo: the homepage's players say it beside the model's name.
const MAKERS = { claude: 'Anthropic', gemini: 'Google', openai: 'OpenAI', grok: 'xAI', kimi: 'Moonshot AI', mimo: 'Xiaomi', qwen: 'Alibaba', deepseek: 'DeepSeek', nvidia: 'NVIDIA', glm: 'Zhipu AI', mistral: 'Mistral AI' };
export const modelMaker = (provider, model) => MAKERS[modelLogo(provider, model)] || null;

// The price in force for a model on a day: the player's own price when given, else the list.
export function priceFor(provider, model, at = new Date(), override = null) {
  if (override && Number.isFinite(Number(override.input)) && Number.isFinite(Number(override.output))) return override;
  const entry = PRICES[`${provider}/${model}`] || PRICES[`${provider}/${stripDate(model)}`];
  if (!entry) return null;
  const day = (at instanceof Date ? at : new Date(at)).toISOString().slice(0, 10);
  let price = null;
  for (const p of entry.periods) if (!p.from || p.from <= day) price = p;
  return price;
}

// The dollars a call's tokens cost at a price. The APIs count differently: Anthropic's input excludes the cache
// reads and writes, which it reports apart; Gemini's prompt count includes the cached tokens and its thinking
// tokens come apart from the answer, billed as output; the OpenAI shapes include the cached tokens in the input
// and the reasoning in the output. A cache read costs the input price when no cached price is given, and an
// Anthropic cache write 1.25 times the input price.
export function tokenCost(usage, price, kind) {
  if (!usage || !price) return null;
  const n = (v) => Math.max(0, Number(v) || 0);
  const pin = Number(price.input), pout = Number(price.output);
  const pcache = price.cachedInput != null ? Number(price.cachedInput) : pin;
  const input = n(usage.input), cached = n(usage.cached), output = n(usage.output), reasoning = n(usage.reasoning), write = n(usage.cacheWrite);
  let dollars;
  if (kind === 'anthropic') dollars = input * pin + cached * pcache + write * (price.cacheWrite != null ? Number(price.cacheWrite) : pin * 1.25) + output * pout;
  else if (kind === 'gemini') dollars = Math.max(0, input - cached) * pin + cached * pcache + (output + reasoning) * pout;
  else dollars = Math.max(0, input - cached) * pin + cached * pcache + output * pout;
  return round(dollars / 1e6);
}

// The cost the API reported in its reply, in dollars, or null.
export function reportedCost(json) {
  const u = json && json.usage;
  if (!u) return null;
  if (typeof u.cost === 'number' && Number.isFinite(u.cost)) return round(u.cost); // OpenRouter
  const c = u.cost;
  if (c && typeof c === 'object' && typeof c.total_cost === 'number' && (!c.currency || /^usd$/i.test(c.currency))) return round(c.total_cost); // Perplexity
  return null;
}

// A call's cost and where it came from: { cost, source: 'reported' | 'priced' }, or { cost: null, source: null }.
export function callCost({ provider, model, kind, usage, reported, price, at }) {
  if (Number.isFinite(reported)) return { cost: reported, source: 'reported' };
  const cost = tokenCost(usage, priceFor(provider, model, at || new Date(), price), kind);
  return cost == null ? { cost: null, source: null } : { cost, source: 'priced' };
}

const round = (x) => Math.round(x * 1e8) / 1e8;

// Dollars for people: four decimals under a cent, three under a dollar, two above.
export function fmtUsd(x) {
  if (x == null || !Number.isFinite(x)) return '–';
  if (x === 0) return '$0';
  const a = Math.abs(x);
  return `${x < 0 ? '−' : ''}$${a < 0.01 ? a.toFixed(4) : a < 1 ? a.toFixed(3) : a.toFixed(2)}`;
}
