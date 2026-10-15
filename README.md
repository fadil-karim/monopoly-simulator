# Monopoly AI Simulator

A browser-based Monopoly simulator, London edition, where every player is an AI
model called through its own API. Set up players (provider, model, reasoning
effort, personal strategy), add universal instructions for everyone, pick the
standard board or the Mega edition, and run one game or a batch of games in
parallel. Every game is stored with a complete event log and every model call
(prompt, reply, latency, token usage) for analytics.

Everything runs in the browser. There is no server: API keys stay in
localStorage and each call goes straight from the browser to the provider.

## Features

- **London edition** board (40 squares, UK street names, pounds, UK Chance and
  Community Chest cards) and the **Mega edition** (52 squares: Elephant &
  Castle, Edgware Road, Downing Street, High Holborn, Aldwych, Shaftesbury
  Avenue, Savile Row, Knightsbridge, Gas Company, Auction, Bus Ticket and
  Birthday Gift squares, speed die, triples, bus tickets, skyscrapers, train
  depots, majority-rule building, £2,500 starting cash).
- Full rules: auctions (sealed-bid), building and selling with the even-build
  rule and bank stock limits, mortgages, trades, jail, repairs cards,
  bankruptcies to a player or to the bank (with re-auction), round limit with
  net-worth ranking.
- **Live view** in Monopoly's own colours and a Kabel-style face: the board
  fills the window, the centre shows the match (goes, properties bought,
  trades, cash on the table, money from and to the bank, money between
  players, the distribution of rolls) with the dice and the last event boxed
  beneath; hover a property for its owner, the rent it has generated, how
  often it has been landed on, who earned what from it and its ledger of
  purchases, trades and mortgages, and click to keep it there. Under the
  board every player is laid out with their properties, what they have made
  in total and from rent, GO, the bank and the other players, each property's
  take, and their own roll distribution.
- **Providers**: Anthropic, OpenAI, Google Gemini, xAI, Mistral, DeepSeek,
  Groq, Together, OpenRouter, Cohere, any OpenAI-compatible endpoint (Ollama,
  vLLM, LM Studio, Azure proxies), plus a free rule-based bot.
- **Effort** per player (none → max) mapped to each provider's reasoning knob:
  `output_config.effort` for Claude, `reasoning_effort` for OpenAI / Groq /
  xAI, thinking budgets for Gemini, `reasoning.effort` for OpenRouter. If a
  model rejects the parameter the call is retried without it.
- Per-player and universal **strategy instructions** injected into the system
  prompt.
- **Table talk**: every reply can carry a public remark or a private word to
  one opponent, a player who is addressed gets to answer, trade proposals are
  negotiated with counter-offers until someone accepts or walks away, and the
  recent conversation is shown to each model with the game state. Nothing is
  rationed: players act before every roll, choose their own liquidations and
  may propose as many trades as they like; games run until one player is left
  unless you set a round limit.
- Fast where it costs nothing: sealed bids are gathered in parallel, games run
  concurrently, Anthropic calls use prompt caching, and any failed or malformed
  reply falls back instantly to the rule-based heuristics so a game never
  stalls.
- **Logs**: each game record holds config, seating, every event (dice, moves,
  rent, cards, builds, trades, bankruptcies), per-round net-worth snapshots and
  every model call. Export one game, all games as JSON or JSONL, or a per-player
  summary CSV. The Analytics tab aggregates win rate, average rank, net worth,
  latency, tokens, fallback and illegal-decision rates per player/model.

## Running it locally

```bash
npm install
npm run dev          # wrangler dev, serves public/
```

Any static file server works too (the site is plain HTML, CSS and ES modules).
`npm run simulate` runs headless rule-based games in Node to check the engine.

## Browser access to provider APIs (CORS)

Calls are made from the page, so the provider must allow browser requests.
Anthropic (with the direct-browser-access header), OpenAI, Gemini, Groq,
OpenRouter, Mistral and xAI do. If a provider refuses, the "Fetch models"
button on the Setup tab shows the error; route that model through OpenRouter or
a local OpenAI-compatible proxy instead. Players whose calls fail fall back to
the rule-based bot and the fallback is recorded in the log.

Use a dedicated, spend-limited API key: it lives in this browser only, but it
is still a key in a web page.

## Project layout

```
public/
  index.html                 the app
  404.html                   themed not-found page
  assets/css/site.css
  assets/js/board.js         boards, groups, cards
  assets/js/engine.js        game rules and event log
  assets/js/heuristics.js    rule-based decisions and fallbacks
  assets/js/providers.js     provider adapters and effort mapping
  assets/js/ai.js            prompts, JSON parsing, model-call records
  assets/js/runner.js        batch runner and game record format
  assets/js/store.js         IndexedDB + localStorage persistence
  assets/js/analytics.js     aggregations and SVG charts
  assets/js/stats.js         live match, player and property statistics from the event log
  assets/js/ui.js            page controller
  assets/fonts/jost.woff2    Jost (OFL), the Kabel-style face, self-hosted
scripts/simulate.mjs         headless engine check
wrangler.jsonc               Cloudflare Workers static-assets config
```

## Rule notes

- Mega edition rents for the eight extra streets follow the price-matched
  rent rows of the standard board; skyscraper rent is hotel rent + £500 on the
  first two sides and + £1000 on the last two.
- The Mega edition always rolls the speed die, as in the boxed game. Birthday
  Gift pays £100 from the bank. The speed die's Bus face takes a Bus Ticket. A
  bus ticket moves you to any square ahead on your current side, up to the next
  corner.
- A single negotiation lapses after eight counter-offers, and a turn allows
  ten separate trade proposals; both are guards against loops, not gameplay
  limits.
- Income Tax is a flat £200. Chance "nearest station" pays double rent and
  "nearest utility" pays ten times the dice.

## Deployment

The repository is deployed by Cloudflare Workers Builds: every push to `main`
is a production release. `npx wrangler deploy --dry-run` validates the config.
