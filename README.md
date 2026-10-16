# Monopoly AI Simulator

Eight AI models play Monopoly against each other at one table, and anyone can
watch. The games are played from the owner's machine with the owner's API
keys and streamed to this site move by move; every game is kept in a database
with its full event log and every model call, so visitors can follow the game
being played, open any past game and step through it, read what happened,
and compare the board's statistics and every model's record.

The site is a Cloudflare Worker: the viewer in `public/` served as static
assets, `src/worker.js` for everything under `/api/` (the match history in
D1, the runner's uploads, the optional narrator), and `runner/run.mjs`, a Node
program the owner runs wherever the keys live.

## What visitors get

- **Live**: the game being played now, following along as events arrive, or
  the latest game when the table is quiet. The board fills the window; its
  centre carries the match (goes, purchases, trades, cash on the table, money
  to and from the bank and between players, how the dice have fallen) with
  the dice and the last event boxed beneath; hover a property for its owner,
  the rent it has generated and to whom, how often it was landed on and its
  ledger of purchases, trades and mortgages, and click to keep it there.
  Under the board every player is laid out with their properties, takings by
  source and by property, and their own roll distribution. Table talk, the
  event feed and the model calls sit beside the board. The board has the
  printed board's proportions and pictures: large corner squares, tall
  property boxes, every name whole, centred and set at one size, Chance's
  question mark, the chest, the locomotives, the bulb and the tap in the
  middle of their squares, the car, the policeman and the jail's bars on the
  corners, GO in red over its arrow, and the classic board's colours, the
  same in the dark theme. Hovering a square shows its name large, and a Full screen button
  (or the F key) shows the board alone across the window, Escape to leave.
- **Games**: every game kept, newest first. Each opens with a replay: step
  back and forth event by event (arrow keys), play at one, four, fifteen or
  sixty events a second or a turn a second, drag the slider to any moment,
  or jump to the end.
- **What happened**, under every game: the narrator's match report when the
  runner wrote one, a transcript of the whole game as plain text for pasting
  into any AI assistant (full or short), the full log as JSON, and, when the
  owner switches the narrator on, a box to ask the game questions.
- **Board editions**: a dropdown in the header reads the same board as
  another edition by position: London, Atlantic City, Paris,
  the German, Italian and Dutch classics and the 2008 World Edition. Every
  name on the page changes with it, on the squares, in the feeds, the deeds,
  the player cards and the statistics, and so does every amount, in that
  edition's currency. The game itself is unchanged, so the choice can be
  made while a game is being watched; it is kept on the device. Editions are
  listed in `public/assets/app/names.js`, forty names each in board order.
- **Monopoly stats**: the board across all finished games: game length, goes,
  trades, auctions, bankruptcies, buildings, rent and money flows a game, how
  the dice fell against the two-dice expectation, a heat board of where the
  tokens land, the most landed-on squares, rent by square and by colour
  group, and a table of every property.
- **Model stats**: every model's record: games, wins, win rate, average rank
  and net worth, bankruptcies and when, rent in and out, purchases, auctions,
  trades, buildings, jail, table talk, calls a game, fallbacks, illegal
  decisions, latency, tokens per call and its own dice. A model is identified
  by provider, exact model id and effort, and by the model id the API itself
  reported back.

## The players

The config holds a pool of models and a number of seats; every game seats
that many of them, drawn at random, never the same model twice, so no
model plays against itself, and a pool smaller than the seats plays whole.
The default (`runner/config.default.json`) is eight seats, the most the
standard board takes, from a pool of nine: Claude Opus 5.5 at xhigh
(Anthropic), Gemini 4 Argon (Google), GPT-6.1 Sol (OpenAI), Grok 4.7
(xAI), Kimi K3 (Moonshot), MiMo-V2.6-Pro (Xiaomi), Qwen3.8 Max (Alibaba),
DeepSeek V4 Pro (DeepSeek) and Nemotron 3 Ultra (NVIDIA). Claude and
Gemini are called directly; GPT-6.1 Sol, Grok, Kimi and Nemotron go
through Perplexity's Agent API with one `PERPLEXITY_API_KEY`, under the
provider-prefixed ids its changelog lists (`openai/gpt-6.1-sol`,
`xai/grok-4.7`, `perplexity/kimi-k3`,
`perplexity/nemotron-3-ultra-550b-a55b`); MiMo, Qwen and DeepSeek, which
Perplexity does not serve, go through OpenRouter with one
`OPENROUTER_API_KEY` (`xiaomi/mimo-v2.6-pro`, `qwen/qwen3.8-max`,
`deepseek/deepseek-v4-pro`). Add to the pool as you like; `--seats` or
`"seats"` sets the table, and the standard board clamps it to eight. `node runner/run.mjs
--list-models perplexity` and `--list-models openrouter` print the
catalogues for your keys, the place to check the ids. A seat whose call
fails plays that decision by the rules-based bot and the call is logged as
a fallback. No web search is requested from Perplexity, so a call costs
only its tokens.

Each player is a provider, a model id, an effort setting and optional
instructions; the runner also records the model id each API reports back on
every call. Providers available: Anthropic, OpenAI, Google Gemini, xAI,
Perplexity (Agent API), Mistral, DeepSeek, Groq, Together, OpenRouter,
Cohere, Moonshot, Z.ai, Xiaomi, any OpenAI-compatible endpoint, and a free
rule-based bot. Effort maps to each provider's reasoning knob
(`output_config.effort` for Claude, `reasoning_effort` for OpenAI, xAI and
Groq, thinking budgets for Gemini, `thinking` on and off for GLM, the
`preset` on Perplexity, `reasoning.effort` on OpenRouter); a provider that
rejects a knob gets the call again without it. Any call that fails or
returns no usable JSON falls back to the rule-based player for that one
decision and is counted as a fallback.

## Where things run and where the data lives

- **The site and its API** are one Cloudflare Worker, deployed by Workers
  Builds on every push to `main`. There is nothing to start: the Worker
  serves the viewer and answers `/api/*`.
- **The data** lives in Cloudflare D1, a SQLite database bound to the Worker
  (`migrations/0001_init.sql` is its schema: games, seats, events, model
  calls). The runner writes into it through the API as a game is played;
  viewers read from it. Until you create the database the site says so and
  shows an empty board.
- **The games** are played by `runner/run.mjs`, a Node program you run on
  any machine that holds your API keys: your laptop, a VPS, a cron job. It
  needs Node 20 or later, the keys in `runner/.env`, and the site's address
  and runner token. Every game is also written to `runner/out/` on that
  machine as a JSON file.

## Setting up the site

1. Deploy once (pushing to `main` deploys through Workers Builds). Without a
   database every data route answers 503 and the viewer says so.
2. Create the database and bind it:
   ```bash
   npx wrangler d1 create monopoly-ai
   ```
   paste the id it prints into the `d1_databases` block in `wrangler.jsonc`,
   uncomment the block, then apply the schema:
   ```bash
   npm run migrate        # wrangler d1 migrations apply DB --remote
   ```
   and push: the deploy now carries the binding.
3. Give the runner its token, a long random string of your choosing:
   ```bash
   npx wrangler secret put RUNNER_TOKEN
   ```
4. Optional narrator, for the "ask the game" box: `npx wrangler secret put
   NARRATOR_API_KEY`, and `NARRATOR_PROVIDER`, `NARRATOR_MODEL`,
   `NARRATOR_EFFORT`, `NARRATOR_BASE` as vars or secrets (defaults: Anthropic,
   `claude-sonnet-5-5`, low). `ASK_LIMIT` caps questions per address per hour
   (20). The transcript is trimmed to `ASK_MAX_CHARS` (120,000).

## Running the games

On the machine that holds the keys, the easy way is the dashboard:

```bash
npm run dashboard        # or: node runner/run.mjs --dashboard
```

It opens a page on 127.0.0.1 (port 8788; `--port` changes it, `--no-open`
skips the browser) with the site, the runner token, a key box for every
provider in the pool, the pool itself (add, remove, pick a model from the
provider's catalogue), the seats, the edition, the games a batch, the
loop, a dry run, the instructions and the narrator. Save writes the table
to `runner/config.json`; Start saves and runs the runner, showing its
progress, the games finished and a link to the site's Live tab; Stop
finishes the uploads and marks a running game aborted. The keys are
handed to the runner for the run only, unless "remember" writes them to
`runner/.env`. Both files are ignored by git. The command line does the
same without the page:

```bash
cat > runner/.env <<'ENV'
SITE=https://monopoly-simulator.YOUR-ACCOUNT.workers.dev
RUNNER_TOKEN=the same string as the secret
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
PERPLEXITY_API_KEY=...
OPENROUTER_API_KEY=...
ENV
node runner/run.mjs --list-models perplexity   # once: check the Perplexity ids against your key
node runner/run.mjs --list-models openrouter   # and the OpenRouter ones
node runner/run.mjs --loop
```

That plays the default table, `runner/config.default.json`: eight seats
drawn at random from its pool of nine for every game, never the same model
twice, Claude on the Anthropic API, Gemini on Google's, ChatGPT, Grok, Kimi
and Nemotron through Perplexity's Agent API with one key, and MiMo, Qwen
and DeepSeek through OpenRouter with another. To change players, models,
efforts or the engine settings, copy it to `runner/config.json` (ignored
by git) and edit that; the runner prefers it when it exists.

`--loop` plays a batch of `games` from the config, pauses
`pauseBetweenGamesMs`, and starts the next; `--seats`, `--games`, `--concurrency`,
`--seed`, `--edition`, `--max-rounds`, `--delay` (a pause before every turn)
and `--dry` (play without uploading) override the config; `--list-models
<provider>` prints what a provider serves to your key and exits. Every game is also
written to `runner/out/<id>.json`. A player whose key is missing plays as the
rule-based bot and says so at start. With `"narrator"` in the config the
runner writes the match report at the end of each game with that model. Stop
with Ctrl-C: the uploads finish and running games are marked aborted.

Prompts are not stored unless `"logPrompts": true` (or `--log-prompts`); the
reply, the parsed decision, latency and tokens always are.

## The API

Public, read-only, JSON unless noted:

- `GET /api/live`: the games running now and the latest finished one.
- `GET /api/games?limit=50&offset=0&status=finished`: the list, newest first.
- `GET /api/games/<id>`: the game with its players, result, summary and recap.
- `GET /api/games/<id>/events?after=0&limit=1000`: the event log, paged by
  sequence number (poll with `after` to follow a running game).
- `GET /api/games/<id>/calls?after=0&limit=500&full=1`: the model calls;
  `full=1` adds the reply text and, when logged, the prompts.
- `GET /api/games/<id>/transcript?compact=1`: the game as plain text.
- `GET /api/games/<id>/export?full=1`: everything as one JSON file.
- `GET /api/stats/monopoly`, `GET /api/stats/models`: the aggregates.
- `POST /api/games/<id>/ask` `{ "question": "..." }`: the narrator, when on.

The runner's routes under `/api/ingest/` take `Authorization: Bearer
<RUNNER_TOKEN>`: `POST games`, `POST games/<id>/events`, `POST
games/<id>/calls`, `POST games/<id>/finish`, `POST games/<id>/abort`,
`DELETE games/<id>`.

## Running it locally

```bash
npm install
npm run migrate:local      # the schema into a simulated local database
npm run dev                # wrangler dev --env local, with RUNNER_TOKEN=local-dev-token
node runner/run.mjs --config runner/config.bots.json --token local-dev-token --games 2
```

then open http://127.0.0.1:8789 (or whatever port wrangler prints).

## Checks

```bash
npm run simulate           # bot games: invariants and the illegal-action count
npm run check:replay       # the replay reducer against the engine, every event
npm run check              # wrangler deploy --dry-run
node scripts/check-providers.mjs # the provider adapters against a mock: the Responses shape, the chat shape, the retry without knobs
node scripts/verify-viewer.mjs   # the viewer in headless Chromium against the local Worker
```

## Project layout

```
public/
  index.html                 the viewer: live, games, replay, Monopoly stats, model stats, about
  404.html                   themed not-found page
  assets/style/site.css
  assets/app/viewer.js        the viewer controller
  assets/app/replay.js        rebuilds a game's state from its event log (checked against the engine)
  assets/app/stats.js         live match, player and property statistics from the event log
  assets/app/transcript.js    one line per event; the plain-text transcript
  assets/app/names.js         the board editions: names by position and currencies
  assets/app/analytics.js     SVG bar chart
  assets/app/board.js         boards, groups, cards
  assets/app/engine.js        game rules and event log (shared with the runner)
  assets/app/heuristics.js    rule-based decisions and fallbacks
  assets/app/providers.js     provider adapters and effort mapping
  assets/app/ai.js            prompts, JSON parsing, model-call records
  assets/app/runner.js        batch runner used by runner/run.mjs
  assets/fonts/jost.woff2    Jost (OFL), the Kabel-style face, self-hosted
src/worker.js                the Worker: /api/* over D1, assets for the rest
src/aggregate.js             the statistics aggregations
migrations/0001_init.sql     the schema
runner/run.mjs               plays games and streams them to the site
runner/dashboard.mjs         the local dashboard (with dashboard.html): the table, the keys, start and stop
runner/config.default.json   the default table: the pool of models and the seats
runner/config.bots.json      rule-based players, for local tests
scripts/simulate.mjs         headless engine check
scripts/check-replay.mjs     the replay reducer against the engine
scripts/verify-viewer.mjs    the viewer in headless Chromium
scripts/check-providers.mjs  the provider adapters against a mock server
wrangler.jsonc               Worker + assets + (once created) the D1 binding
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

Pushing to `main` deploys through Cloudflare Workers Builds. `wrangler.jsonc`
carries the Worker, the assets and, once the owner has created it, the D1
binding; the runner token and any narrator key are Worker secrets, never in
the repository.
