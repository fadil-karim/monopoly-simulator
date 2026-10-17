# Monopoly AI Simulator

Eight AI models play Monopoly against each other at one table, and anyone can
watch. The games are played by the simulator, on the owner's machine or a
cloud instance, in its Docker container, with the owner's API keys; it keeps
every game in its own store and streams it to this site move by move, where
a copy of every game is kept with its full event log and every model call,
so visitors can follow the game being played, open any past game and step
through it, read what happened, and compare the board's statistics and every
model's record. The site opens on a homepage of games: Monopoly, played
today, and chess, checkers, Battleship and Connect 4 to come, with the plan
for building them in `PLAN.md`.

The site is a Cloudflare Worker: the homepage and the Monopoly viewer in
`public/` served as static assets, `src/worker.js` for everything under
`/api/` (the site's copy of the games in D1, the simulator's uploads, the
optional narrator). The simulator is `runner/` with the engine and the AI
layer it shares with the site, run where the keys live and apart from the
site, so either can be updated without touching the other.

## What visitors get

- **The homepage** (`/`): *The players* at the top, every model in the pool
  the runner draws its tables from, each with its maker's logo as a sticker,
  its name and maker, the API it plays through, its model id and effort, its
  Monopoly record (games finished, wins and win rate) and a mark while it is
  at the table; then *The games*: Monopoly with what is on its table now and
  links to watch it, every game and both statistics pages, and a card each
  for chess, checkers, Battleship and Connect 4, coming soon. The list of
  players is the pool the runner reported when it last started; before it
  has reported one, the models that have played, and before any game, the
  default table. A link from before the homepage (`/#live`, `/#game/…`)
  still opens the Monopoly page.

The Monopoly page (`/monopoly/`, its header's "← All games" and its logo
leading back to the homepage):

- **Live**: the game being played now, following along as events arrive, or
  the latest game when the table is quiet, with no replay controls: the Live
  tab only follows, and a finished game shown there offers "Replay this
  game" to open it with them. The board fills the window; its
  centre carries the match (goes, purchases, trades, cash on the table, money
  to and from the bank and between players, how the dice have fallen) with
  the dice and the last event boxed beneath; hover a property for its owner,
  the rent it has generated and to whom, how often it was landed on and its
  ledger of purchases, trades and mortgages, and click to keep it there.
  Under the board every player is laid out with their properties, takings by
  source and by property, and their own roll distribution; resting the
  pointer on any roll chart's column (or tapping it) says how many rolls of
  that total there have been out of all of them, beside what two fair dice
  give. Each model's token is its maker's whole logo, cut out like a
  sticker with a white outline; the rule-based bot keeps its initial. Houses
  and hotels stand on the property's colour band, as on the printed board: a
  green house each and a red hotel, outlined in white and as large as the
  band allows. Table talk, the
  event feed and the model calls sit beside the board. The board has the
  printed board's proportions and pictures: large corner squares, tall
  property boxes, every name whole, centred and set at one size, Chance's
  question mark, the chest, the locomotives, the bulb and the tap in the
  middle of their squares, the car, the policeman and the jail's bars on the
  corners, GO in red over its arrow, and the classic board's colours, the
  same in the dark theme. Hovering a square shows its name large, and a Full screen button
  (or the F key) shows the board alone across the window, Escape to leave.
- **Games**: every game kept, newest first. Each opens with a replay, the
  only place the replay controls appear: step
  back and forth event by event (arrow keys), play at one, four, fifteen or
  sixty events a second or a turn a second, drag the slider to any moment,
  or jump to the end.
- **What happened**, under every game: the narrator's match report when the
  runner wrote one, a transcript of the whole game as plain text for pasting
  into any AI assistant (full or short), the full log as JSON, and, when the
  owner switches the narrator on, a box to ask the game questions.
- **The ledgers**, at the bottom of every game, up to the move shown:
  *Payments*, every sum that changed hands, between the players and with the
  bank (rent, passing GO, taxes, cards, purchases, auctions, buildings,
  mortgages, fines, cash in trades, bankruptcies), with a table of who paid
  whom and filters by player and by kind; *Trades and offers*, every trade
  offered with its counter-offers and answers, the reasons given and how it
  ended, completed with what changed hands, rejected, lapsed or refused by the
  rules; and *Properties*, every property's owner, landings, rent, rent a
  landing, what it first fetched, what its buildings cost, how often it was
  mortgaged and traded, and its rent less its cost, sortable by any column.
  A player's cash is always where they started plus what they received less
  what they paid in the payments ledger.
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
  trades, buildings, jail, table talk, calls a game, forfeits a game,
  fallbacks, illegal decisions, the time an answer, latency, tokens per call and
  its own dice. A model is identified
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
fails, or whose answer cannot be used, forfeits that choice (see "No answer,
no choice" below). No web search is requested from Perplexity, so a call costs
only its tokens; its models get the effort as `reasoning.effort`, are asked
for no JSON mode (asked for one, GPT, Grok and Kimi answered `{}` to every
decision) and stream their replies, since Perplexity closes a call that has
not answered within about a minute. When the runner starts it gives the
site its pool, which the homepage lists as the players.

How the models are prompted, when and with what, is set out with diagrams and
real prompts in `AI.md`. Each player is a provider, a model id, an effort setting and optional
instructions; the runner also records the model id each API reports back on
every call. Providers available: Anthropic, OpenAI, Google Gemini, xAI,
Perplexity (Agent API), Mistral, DeepSeek, Groq, Together, OpenRouter,
Cohere, Moonshot, Z.ai, Xiaomi, any OpenAI-compatible endpoint, and a free
rule-based bot. Effort maps to each provider's reasoning knob
(`output_config.effort` for Claude, `reasoning_effort` for OpenAI, xAI and
Groq, thinking budgets for Gemini, `thinking` on and off for GLM,
`reasoning.effort` on Perplexity and OpenRouter); a provider that
rejects a knob gets the call again without it. Any call that fails or
returns no usable JSON, an empty `{}` included, forfeits that one choice,
logged with the reason; no bot plays in the model's place.

## Where things run and where the data lives

- **The site and its API** are one Cloudflare Worker, deployed by Workers
  Builds on every push to `main`. There is nothing to start: the Worker
  serves the viewer and answers `/api/*`.
- **The site's copy of the games** lives in Cloudflare D1, a SQLite database
  bound to the Worker (`migrations/` holds its schema: games, seats, events,
  model calls and what each call cost). The deploy creates the database and
  binds it, and the Worker lays out its tables the first time it reaches it.
  The simulator writes into it through the API as a game is played; viewers
  read from it.
- **The games** are played by the simulator, `runner/`, on any machine that
  holds your API keys: your laptop or a cloud instance, in its Docker
  container (`Dockerfile`, `docker-compose.yml`) or with Node 20 or later. It
  keeps every game in its own store as it is played, in its data folder
  (`/data` in the container, a volume of its own; `runner/` otherwise), and
  sends the site a copy: the store is the record, the site's copy can be
  filled again from it, and neither an update to the site nor one to the
  simulator touches the other's data.

## Setting up the site

1. Deploy (pushing to `main` deploys through Workers Builds). The deploy
   creates a D1 database named `monopoly-ai` in your Cloudflare account, or
   connects to the one of that name already there, and binds it; there is no
   id to paste, and later deploys keep the same database. The Worker applies
   the schema itself the first time it reaches the database, recording each
   migration in `d1_migrations` as wrangler does, so `npm run migrate` still
   works and finds nothing left to do.
2. Give the runner its token, a long random string of your choosing, once: in
   the Cloudflare dashboard open the `monopoly-simulator` Worker, then
   Settings, then Variables and Secrets, and add a secret named
   `RUNNER_TOKEN`; or from the repo:
   ```bash
   npx wrangler secret put RUNNER_TOKEN
   ```
   The simulator checks the site before it plays and says what is missing,
   then tries the token itself. Spaces or a line break around the token, on
   either side, are ignored; when the site refuses it, the simulator says
   which token it sent, where from and how long, so a mistyped or stale one
   shows, and keeps the games in its store until the two match.
3. Optional narrator, for the "ask the game" box: `npx wrangler secret put
   NARRATOR_API_KEY`, and `NARRATOR_PROVIDER`, `NARRATOR_MODEL`,
   `NARRATOR_EFFORT`, `NARRATOR_BASE` as vars or secrets (defaults: Anthropic,
   `claude-sonnet-5-5`, low). `ASK_LIMIT` caps questions per address per hour
   (20). The transcript is trimmed to `ASK_MAX_CHARS` (120,000).

## Running the simulator

The simulator is the engine, the AI players and the runner: it plays the
games with your keys, keeps every game in its own store as it is played, and
sends the site a copy. It runs apart from the site, on your machine or on a
cloud instance, in its Docker container or straight from the repository with
Node 20 or later, so the site can be updated, redeployed or even emptied
without touching a game in play or the record of the games played.

### With the dashboard

```bash
npm run dashboard        # or: node runner/run.mjs --dashboard
```

It opens a page on 127.0.0.1 (port 8788; `--port` changes it, `--no-open`
skips the browser) with the site, the runner token, a key box for every
provider in the pool, the pool itself (add, remove, and choose each model
from a dropdown of every model its provider serves to your key, the ones known
here before a key is in, grouped by maker, with Other for any id), the seats,
the edition, the games a batch, the loop, a dry run, the instructions and the
narrator. Save writes the table to `config.json` in the data folder; Start
saves and runs the simulator, showing its progress, the games finished and a
link to the site's Live tab; Check the seats asks every model in the pool one
real decision, as a game would, and says which answer (with the decision, the
time and the cost) and which would forfeit their decisions, and why, for a few
cents and without touching the site; Stop after this game plays the games in
play to the end and starts no more; Stop now ends them after the current turn
and keeps them in the store as stopped. Under it is the store: the latest
games, whether each finished or stopped and whether the site has it whole,
with a button to send the site what it lacks and another to send everything
again after its database was replaced. The keys are handed to the runner for
the run only, unless "remember" writes them to the data folder's `.env`.
Both files are ignored by git. With `DASHBOARD_PASSWORD` set, the page asks
for it.

### In Docker, on your machine or a cloud instance

```bash
docker compose up -d --build            # the dashboard, at http://127.0.0.1:8788/
```

The image (`Dockerfile`) holds the simulator alone, the engine and the AI
layer from `public/assets/app/` with `runner/`, on Node 22, with nothing to
install; the site is not in it. Everything it keeps is in `/data`, the volume
`monopoly-data`: the store of games, and the table and the keys when the
dashboard saves them. Rebuilding or updating the image, or `docker compose
down`, leaves the volume alone (`docker compose down -v` deletes it). The
dashboard is published on this machine's loopback only.

On a cloud instance, headless, the keys go in `simulator.env` (copy
`simulator.env.example`; it is ignored by git):

```bash
MONOPOLY_MODE=play docker compose up -d --build   # batch after batch, from the table in /data or the default one
docker compose logs -f                            # what it is doing
docker compose run --rm simulator probe           # does every seat answer?
docker compose run --rm simulator store           # what the store holds, and what the site has of it
```

The dashboard works there too: start it as above without `MONOPOLY_MODE`,
reach it through an SSH tunnel (`ssh -L 8788:127.0.0.1:8788 you@the-instance`,
then http://127.0.0.1:8788/), and set `DASHBOARD_PASSWORD` in `simulator.env`
as a second lock. The container's other modes are `once` (one batch),
`publish`, `republish`, `import-site`, `models <provider>`, or any of the
runner's options (`docker compose run --rm simulator --games 3 --dry`). To
update the simulator without cutting a game short, finish the game first, with
the dashboard's Stop after this game or, headless, `docker compose kill -s
SIGUSR2 simulator`, which plays it to the end and then holds; then `git pull
&& docker compose up -d --build`. Stopping the container (`docker compose
stop`, a reboot) ends a game in play after its current turn and keeps it as
stopped; a container killed outright leaves its game for the next start to mark
stopped. `docker compose cp simulator:/data ./monopoly-data-backup` copies the
whole store out.

### From the command line

```bash
cat > runner/.env <<'ENV'
RUNNER_TOKEN=the same string as the secret
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
PERPLEXITY_API_KEY=...
OPENROUTER_API_KEY=...
ENV
node runner/run.mjs --list-models perplexity   # once: check the Perplexity ids against your key
node runner/run.mjs --list-models openrouter   # and the OpenRouter ones
node runner/run.mjs --probe                    # before a batch: does every seat answer?
node runner/run.mjs --loop
```

That plays the default table, `runner/config.default.json`, on the site it
names, https://monopoly.basilicalabs.ai (`SITE` or `--site` points it
elsewhere; the dashboard offers it whenever the table in use leaves the site
blank): eight seats
drawn at random from its pool of nine for every game, never the same model
twice, Claude on the Anthropic API, Gemini on Google's, ChatGPT, Grok, Kimi
and Nemotron through Perplexity's Agent API with one key, and MiMo, Qwen
and DeepSeek through OpenRouter with another. To change players, models,
efforts or the engine settings, copy it to `config.json` in the data folder
(`runner/config.json` here, `/data/config.json` in the container; ignored by
git) and edit that, or save the table from the dashboard; the simulator
prefers it when it exists.

`--loop` plays a batch of `games` from the config, pauses
`pauseBetweenGamesMs`, and starts the next; `--seats`, `--games`,
`--concurrency`, `--seed`, `--edition`, `--max-rounds`, `--delay` (a pause
before every turn) and `--dry` (keep the games in the store and send the site
nothing) override the config; `--data <dir>` names the data folder
(`MONOPOLY_DATA`, else `runner/`); `--list-models <provider>` prints what a
provider serves to your key and exits; `--probe` asks every model in the pool
one decision and says which seats answer; `--store`, `--publish`,
`--republish` and `--import-site` look after the store (below). A model whose
key is missing is left out of the pool, and the simulator says so at start:
nobody plays in its place. With `"narrator"` in the config the simulator
writes the match report at the end of each game with that model. Ctrl-C (or
SIGTERM) ends the games in play after the current turn, keeps them in the
store as stopped and sends the site what it can; SIGUSR2 plays them to the
end and starts no more.

The store keeps every call's prompts; the site gets them only with
`"logPrompts": true` (or `--log-prompts`), and always gets the reply, the
parsed decision, the time, the tokens and the cost.

When the site cannot be reached the simulator says why, and plays on: an
address that does not resolve (the domain not attached to the Worker yet, or
an old answer cached on the machine), a certificate it will not trust (a new
domain's still on its way, or a VPN, proxy or antivirus in between), nothing
answering, or a page that is not the site's API. The games wait in the store
and go to the site once it answers, tried again after a few seconds and then
every minute for as long as it takes. A model call that cannot reach its API
carries the same reason in its error, and is tried again before the choice is
forfeited: a rate limit after as long as the API asks (or 4 to 32 seconds), a
connection that never opened four more times over about twenty seconds, a
server error or a cut connection twice more.

### The store

Every game is written to the store as it is played, before anything is sent.
`games/<id>/` in the data folder holds `game.json` (the seats, the models, the
config and the seed, with the simulator's version), `events.jsonl` (every
event, a line each, the wait for every answer among them), `calls.jsonl` (every
model call with its prompts and its reply), `finish.json` (the result, the
summary and each player's statistics) or `abort.json` (why it stopped), and
`published.json` (what the site has of it); once a game is over its two logs
are gzipped, a tenth of the room. The site's copy is filled from the store as
the game plays, a few batches at a time; when the site cannot take them (an
update, an outage, a refused token, a new database) the games wait and go when
it can, so a game in play never waits on the site and nothing done to the site
touches the record. A game goes only to the site it was played for, which
`game.json` names: a game played against a site on your own machine, a test,
never reaches the public one, and a dry run's games stay in the store.
`--publish` (or the dashboard's button) sends the site whatever it lacks, `--republish` everything again after its database was
replaced or emptied (the site ignores what it already has), and `--store`
lists what the store holds. `--import-site` copies into the store every game
the site has and the store has not, the games played before v2.0 among them,
with their events, calls and results, so that the store holds them all. A
game whose simulator stopped without ending it (a crash, a container killed)
is marked stopped by the next start and sent to the site so. The runner no
longer writes the single-file copies of `runner/out/`.

### No answer, no choice

A model plays on its own answers or not at all. A call that still fails after
its retries, a reply with no JSON or only an empty `{}`, or an answer that
breaks the rules forfeits that one choice: the engine takes the answer that
does nothing (nothing before the roll, no purchase, a bid of nothing, the trade
offer rejected), logs the forfeit with what went wrong and why, and the turn
goes on with its obligations: rent, tax and cards, and debts, which the bank's
forced sale settles when the player's own plan does not (mortgages, then
buildings, in board order, then bankruptcy). A trade offer left without a
valid answer is logged as rejected by default, with the reason, and the trades
ledger shows it so. Forfeits appear in the game's feed, on each player's card
and in the model statistics; the rule-based bot plays only the seats a table
gives it by name (`config.bots.json`, for tests). `AI.md` has the details.

Every wait for a model's answer is timed, from the question to the answer (or
to its failure), and logged with the game against the player who kept the table
waiting, so an auction's bids and a trade's answers count for whoever gave
them; the turn itself is not timed. Each player's card shows its average answer,
and the model statistics each model's average over its games.

### What a game costs

Every model call is priced as it is made, in US dollars, and the figure is
kept with the call: the cost the API reported with the reply where it reports
one (OpenRouter and Perplexity do), otherwise the call's tokens at the
model's list price on the day, from `public/assets/app/pricing.js` (Claude
Opus 5.5 and Sonnet 5.5 on the Anthropic API, Gemini 4 Argon on Google's,
with its introductory rate to the end of November 2026, and stand-in prices
for the models Perplexity and OpenRouter serve). The runner prints each
game's cost and the batch's; each player's total goes into its statistics
and the game's, with the narrator's report, into the summary; the site shows
each seat's model, the API that served it and its cost under every game,
following the replay, a cost column in the games list, and each model's cost
a game in the model statistics. A model the price list lacks costs nothing
on record and reads "no price on file" until it is added to `pricing.js` or
its player in the config carries a price, in dollars per million tokens:

```json
{ "id": "glm", "name": "GLM", "provider": "zhipu", "model": "glm-5", "price": { "input": 1.2, "output": 4.8, "cachedInput": 0.12 } }
```

A price change is a new period in `pricing.js`; a game keeps the cost its
calls were recorded with.

## The API

Public, read-only, JSON unless noted:

- `GET /api/live`: the games running now and the latest finished one.
- `GET /api/health`: whether the site has its database and the runner's token.
- `GET /api/games?limit=50&offset=0&status=finished`: the list, newest first,
  with each game's `cost` in dollars (a running game's calls so far).
- `GET /api/games/<id>`: the game with its players, result, summary and recap.
- `GET /api/games/<id>/events?after=0&limit=1000`: the event log, paged by
  sequence number (poll with `after` to follow a running game).
- `GET /api/games/<id>/calls?after=0&limit=500&full=1`: the model calls,
  each with its `cost` and `costSource` (`reported` or `priced`); `full=1`
  adds the reply text and, when logged, the prompts.
- `GET /api/games/<id>/transcript?compact=1`: the game as plain text.
- `GET /api/games/<id>/export?full=1`: everything as one JSON file.
- `GET /api/stats/monopoly`, `GET /api/stats/models`: the aggregates.
- `GET /api/players`: the players for the homepage, each model once with its
  provider, model id, effort, colour, whether it is at a table now and its
  Monopoly record, and where the list came from (`source`: `runner`, the pool
  the runner last reported; `games`, the models seen in games; `default`, the
  default table).
- `POST /api/games/<id>/ask` `{ "question": "..." }`: the narrator, when on.

The runner's routes under `/api/ingest/` take `Authorization: Bearer
<RUNNER_TOKEN>`: `POST games`, `POST games/<id>/events`, `POST
games/<id>/calls`, `POST games/<id>/finish`, `POST games/<id>/abort`,
`DELETE games/<id>`, `POST check` (the token, before a game) and `POST pool`
(the pool, as the runner starts).

## Running it locally

```bash
npm install
npm run migrate:local      # the schema into a simulated local database (optional: the Worker applies it on first use)
npm run dev                # wrangler dev --env local, with RUNNER_TOKEN=local-dev-token
node runner/run.mjs --config runner/config.bots.json --token local-dev-token --games 2
```

The bot games go to `runner/games/`, the store of a simulator run from the
repository (`--data` puts them elsewhere).

then open http://127.0.0.1:8789 (or whatever port wrangler prints) for the
homepage, and http://127.0.0.1:8789/monopoly/ for the Monopoly page.

## Checks

```bash
npm run simulate           # bot games: invariants and the illegal-action count
npm run check:replay       # the replay reducer against the engine, every event
npm run check:ledger       # the ledgers whole: every player's cash from the payments, every event, trading players
npm run check              # wrangler deploy --dry-run
node scripts/check-providers.mjs # the provider adapters against a mock: the four API shapes, Perplexity's stream, the retries, the empty reply, what each call costs
node scripts/seed-trades.mjs     # a scripted trading game for the local site only, for the trades ledger, the logos and the homepage's players
node scripts/verify-viewer.mjs   # the homepage and the viewer in headless Chromium against the local Worker
```

## Project layout

```
PLAN.md                      the plan for chess, checkers, Battleship and Connect 4
AI.md                        how the models are prompted: when, with what, and what they answer, with diagrams
public/
  index.html                 the homepage: the players and the games
  monopoly/index.html        the Monopoly viewer: live, games, replay, Monopoly stats, model stats, about
  404.html                   themed not-found page
  assets/style/site.css
  assets/style/home.css       the homepage's own styles
  assets/app/home.js          the homepage: the players and what is on Monopoly's table
  assets/app/viewer.js        the viewer controller
  assets/app/replay.js        rebuilds a game's state from its event log (checked against the engine)
  assets/app/stats.js         from the event log: the match, each player and each property, every payment and every trade offer
  assets/app/transcript.js    one line per event; the plain-text transcript
  assets/app/names.js         the board editions: names by position and currencies
  assets/app/analytics.js     SVG bar charts, upright and lying
  assets/app/pricing.js       what a call costs: the price list, the APIs' names, the reported cost
  assets/app/board.js         boards, groups, cards
  assets/app/engine.js        game rules and event log (shared with the runner)
  assets/app/heuristics.js    the rule-based player, for seats given to it by name
  assets/app/providers.js     provider adapters and effort mapping
  assets/app/ai.js            prompts, JSON parsing, model-call records
  assets/app/runner.js        batch runner used by runner/run.mjs
  assets/fonts/jost.woff2    Jost (OFL), the Kabel-style face, self-hosted
  assets/logos/              the models' makers' logos on the tokens (LICENSE.txt: LobeHub's icons, MIT; Simple Icons, CC0)
src/worker.js                the Worker: /api/* over D1, assets for the rest
src/aggregate.js             the statistics aggregations
migrations/0001_init.sql     the schema
migrations/0002_cost.sql     the cost of each call
migrations/0003_site.sql     the site's own records: the pool the runner reported (the Worker applies all three itself)
runner/run.mjs               the simulator: plays games, keeps them in its store and sends them to the site
runner/store.mjs             the store of games and the publisher that copies it to the site
runner/dashboard.mjs         the dashboard (with dashboard.html): the table, the keys, start and stop, the store
runner/docker-entrypoint.sh  the container's modes: dashboard, play, once, probe, store, publish, import-site
Dockerfile                   the simulator's image, apart from the site
docker-compose.yml           the simulator as a service, its data in the volume monopoly-data
simulator.env.example        the keys and the token for the container (copied to simulator.env, ignored by git)
runner/config.default.json   the default table: the pool of models and the seats
runner/config.bots.json      rule-based players, for local tests
scripts/simulate.mjs         headless engine check
scripts/check-replay.mjs     the replay reducer against the engine
scripts/check-ledger.mjs     the ledgers against the engine's cash, with trading players (scripts/traders.mjs)
scripts/seed-trades.mjs      a scripted trading game for the local site, never the public one
scripts/verify-viewer.mjs    the viewer in headless Chromium
scripts/check-providers.mjs  the provider adapters against a mock server
wrangler.jsonc               Worker + assets + the D1 binding (the deploy creates the database)
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
the repository. The simulator is not deployed with the site: it runs where the
keys are, from its container or the repository, a push to `main` never touches
it, and it is updated by rebuilding its image.
