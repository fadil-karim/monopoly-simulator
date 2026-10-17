# CLAUDE.md

Standing policy for this repository. Read it before making any change here.

## What this repo is

A Cloudflare Worker site: a homepage of games and the Monopoly viewer in
`public/` served as static assets and `src/worker.js` for everything under
`/api/`. AI models play Monopoly
(London and Mega editions) against each other, up to eight at a table drawn
from a pool, with chess, checkers, Battleship and Connect 4 on the homepage
as placeholders and the plan for them in `PLAN.md`; the games are played by
the simulator (`runner/`, in its Docker container or from the repository) on
the owner's machine or a cloud instance with the owner's keys, which keeps
every game in its own store and streams it to the site; the site keeps a copy
of every game in D1 and shows them live and move by move. The two are updated
apart: a push here never touches a game in play or the simulator's store. There
is no build step - the files in `public/` are the site. The repo
is connected to Cloudflare Workers Builds, so **every push to `main` deploys
to production**.

```
public/            everything served as assets
  index.html       the homepage: the players (the pool of models, each with its record) and the games (Monopoly, then chess, checkers, Battleship and Connect 4, coming soon)
  monopoly/index.html  the Monopoly viewer: live, games, replay, Monopoly stats, model stats, about
  404.html
  assets/app|style|fonts|logos   app/ the modules (home, viewer, replay, stats, transcript, names, engine, board, heuristics, providers, pricing, ai, runner, analytics), style/site.css and home.css (the homepage's own), fonts/jost.woff2 (OFL, the only font file), logos/ the models' makers' logos on the tokens (LICENSE.txt: LobeHub's icons, MIT; Xiaomi's from Simple Icons, CC0)
  _headers         security + caching headers (fonts immutable; app and style revalidated on every load, because the modules import each other by name; logos a day)
  robots.txt
                   app/names.js the board editions (names by position, currencies) the viewer reads a game as
src/worker.js      /api/*: the public reads, the runner's uploads (bearer RUNNER_TOKEN), the optional narrator; everything else -> env.ASSETS
src/aggregate.js   the two statistics aggregations
migrations/        the D1 schema (games, game_players, events, llm_calls, asks; 0002 the cost of each call; 0003 site_meta, the pool the runner reported), applied by the Worker itself on first use
runner/            the simulator: run.mjs plays games, keeps them in the store and sends them to the site; store.mjs the store (GameStore) and the publisher (Publisher); dashboard.mjs + dashboard.html the dashboard (the table, the keys, start, stop after this game, stop now, the store, Run 8 CPU players, the table live; `npm run dashboard` or `run.mjs --dashboard`); local-site.mjs the site's pages and reads from the store, served by the dashboard (this machine's copy of the site); docker-entrypoint.sh the container's modes; config.cpu.json the CPU table (eight rule-based players, kept on this machine; `npm run cpu`); config.default.json the default table (the site, https://monopoly.basilicalabs.ai, and a pool of nine models and eight seats, drawn at random for every game, never the same model twice; Claude and Gemini direct, four through Perplexity, MiMo, Qwen and DeepSeek through OpenRouter); config.bots.json bots for tests; .env, config.json (the owner's overrides, preferred when present), games/ (the store of a simulator run from the repository) and out/ (the single-file copies before v2.0) are ignored
Dockerfile         the simulator's image: node:22-alpine with public/ (the engine and AI layer, and the pages for the dashboard's copy of the site), src/aggregate.js and runner/, nothing installed, /data a volume; .dockerignore keeps the keys and the local stores out of the build
docker-compose.yml the simulator as a service: the dashboard on the host's loopback, or MONOPOLY_MODE=play (or cpu) headless; the keys from simulator.env (ignored; simulator.env.example lists them); /data on the volume monopoly-data
scripts/           simulate.mjs (engine invariants), check-replay.mjs (reducer vs engine), check-ledger.mjs (the ledgers vs the engine's cash, with the trading players of traders.mjs), seed-trades.mjs (a scripted trading game for the local site only, its eight models given as the pool), verify-viewer.mjs (the homepage and the viewer in headless Chromium), check-local-site.mjs (the dashboard's copy of the site against the local Worker, read for read)
wrangler.jsonc     main + assets (binding ASSETS, 404-page, /api/* worker-first) + the production D1 binding DB, named monopoly-ai with no id (the deploy creates the database, or connects to the one of that name, through wrangler's automatic provisioning, and later deploys keep it) + env.local with a simulated D1
package.json       wrangler devDependency + dev/deploy/check/migrate/simulate/check:replay/check:ledger/runner/dashboard/cpu scripts
PLAN.md            the plan for building chess, checkers, Battleship and Connect 4, with the owner's open questions
AI.md              how the models are prompted: when, with what, what they answer and when the bot steps in, with Mermaid diagrams and real prompts rebuilt from a game
prompt text/       the AI-instruction archive for the version in service
```

## How it works

The engine (`public/assets/app/engine.js`) is pure logic shared by the runner,
the Worker and the check scripts; keep it free of DOM references. It logs
every event with a sequence number and calls `onEvent` and `onLlm` as it
goes. `replay.js` rebuilds a game's state from the event log alone
(`ReplayGame`: the engine's players, props, round, turn, chat and result,
with the same `player`, `ownedBy`, `netWorth` methods the renderer uses);
`scripts/check-replay.mjs` compares it with the engine after every event of
80 games, so any new engine event that changes state needs a reducer case
and the check kept green. `stats.js` derives the match, player and property
statistics incrementally from the same log, and the game's ledgers:
`payments`, every sum that changes hands as `{ from, to, amount, kind,
property?, level?, text? }` with a player's id or `'bank'` on each side and
`PAYMENT_KINDS` naming the kinds (the bank's buy-back of a bankrupt's
buildings included, from the levels it tracks), so that every player's cash
is the starting cash plus what they received less what they paid, which
`scripts/check-ledger.mjs` proves after every event of sixty games whose
players trade, counter and break the rules (`scripts/traders.mjs`);
`negotiations`, each trade offer with its steps (offer, counter, accept,
reject, lapsed, or refused by the rules from an `illegal_action`), its
outcome and its terms; and for each property its landings, rent, sales,
buildings, mortgages, trades, owners and the deed's history as entries the
viewer words (`deedLine`). It reads the London names inside events (a rent
payment's reason, a tax) off the London board, whatever edition the game is
dressed as. A counter-offer carries the negotiation's step as
`negotiationRound`; before v1.19 it overwrote `round`, so the reducer takes
no round from a `trade_counter` and `eventLine` takes the game's round as a
third argument for one. `transcript.js` has the one
line per event (`fmtEvent`, `eventLine`) and the plain-text `transcript`
(`compact` drops dice, moves and other noise; `maxChars` trims the middle).

No model is played for, since v2.0, at the owner's request. `Game.decide` asks
the decider and, when the call fails, the reply is not the JSON asked for or is
empty (the decider's `__forfeit` and `__error`), or `validate` refuses the
answer, logs a `forfeit` event (`player`, `decision`, `kind`: `error`, `empty`,
`unparseable`, `invalid` or `none`, `reason`, `given` for a refused answer,
`call` the call's seq) and plays the choice's `FORFEIT` default, the answer that
does nothing: no actions before the roll (in Jail it rolls), no purchase, a bid
of nothing, the trade offer rejected with `source: 'forfeit'` and the reason
`no valid answer (…)`, nothing said, no square and no property on the Mega
board. The turn goes on with its obligations, and a debt the player's own plan
leaves unpaid goes to `forcedSale`, the bank's mechanical sale (a `forced_sale`
event, then mortgages and then buildings, each the first in board order that
the rules allow) before bankruptcy. The rule-based bot (`heuristicDecide`)
plays only a seat whose provider is `heuristic` and a game without a decider
(`isBot`); before v2.0 it stood in for a failed model, logged as `ai_fallback`,
`illegal_decision` and `decider_error`, which the reducer still reads. A game
being stopped asks nobody more (`halted`: the forfeit's default, no event).
The table's wait for every answer is timed, not the turn, at the owner's
request (v2.1): `decide` logs `answer_time` (`player`, `decision`, `ms`,
`call`) for every question put to a model, from the question to the answer or
its failure, before anything the answer brings (a forfeit follows it at once),
against the player who answered, so an auction's bids and a trade's answers
count for the players who gave them; a bot answers at once and is not timed.
The player's engine stats keep `forfeits`, `answerMs` and `answers`.
`replay.js` and `stats.js` total both (`forfeitsBy`, `longestAnswerMs`),
`transcript.js` words them ("takes 12 s to answer the trade offer";
`fmtDuration`, compact transcripts leaving the line out), the `turn_end` of the
first v2.0 games still reads and counts for nothing, the viewer puts a player's
average answer and its forfeits on its card and the trades ledger says "rejects it by default, for
want of a valid answer", and `check-replay` and `check-ledger` play flaky
players (`traders(seed, { flaky })`, answering at random with an error,
nothing, an empty reply or nonsense) and prove that every kind and question of
forfeit appears, that a forfeited trade response is a rejection with its
reason, that every question asked is timed once with each forfeit right after
its time, and that the books still balance through the forced sales.

`AI.md` sets out, for the owner, when a model is asked (the pre-roll once a
turn before the dice, then buy, bid, trade response, reply, raise cash and the
Mega board's two choices; never a roll or a move), what it is sent (text only,
a new conversation each time: the cached rules and board, its identity and
instructions, the state, the last 30 lines of table talk it could hear, and the
question with its legal options), what it answers and what a bad answer costs
(a forfeit, logged with its reason, nobody playing in its place, a trade offer
rejected by default), with Mermaid diagrams checked to render and real prompts and
replies rebuilt from the event log of game `20261016-e34x-1`. A change to the
decision points in `engine.js` or to the prompt in `ai.js` changes it too. The
goal line of the prompt says the game is played until everyone else is bankrupt
when there is no round limit; it once read "the round limit (null rounds)".

The simulator (`runner/run.mjs`, `VERSION` 2.0) works from its data folder
(`--data`, else `MONOPOLY_DATA`, else `runner/`; `/data` in the container): the
table from `<data>/config.json`, else `runner/config.json`, else
`runner/config.default.json` (the pool of players, `seats`, universal
instructions, engine config, narrator), and the keys from the environment or
the data folder's `.env`, then `runner/.env` (`PROVIDERS[*].env` names them).
A model whose key is missing is left out of the pool with a warning, since no
bot plays in its place, and the simulator stops when fewer than two remain.
Every game is written to the store as it is played (`GameStore` in
`runner/store.mjs`, `<data>/games/<id>/`: `game.json` the registration with
`site`, the site the game was played for and the only one it is ever sent to
(none for a dry run; `mine` in the summary), so a test against a local site
never reaches the public one,
`events.jsonl` and `calls.jsonl` a line each, every call with its prompts,
appended as they happen and gzipped by `compact` once the game has ended,
`finish.json` or `abort.json`, `beat` a heartbeat every 30 s while in play, and
`published.json`, what the site has: `{ site, registered, events, calls,
finished, aborted }`, the events and calls counted in lines, since auction
bids complete out of seq order), and the `Publisher` sends the site what it
lacks: `soon(id)` from every hook, a pass at most every 700 ms a game and three
games at once, registering at `POST /api/ingest/games`, the events 400 a batch
and the calls 100 (their prompts only with `logPrompts`), then `finish` or
`abort`; a failure is tried again after 2 s, doubling to a minute (five for a
refusal), for as long as it takes, with one warning a new reason (`explain`:
`tokenRejected` for a 401, `siteWhy` when the site was not reached), and a 404
for a game the site had taken (its database replaced) sends that game again
from its first line. So a game never waits on the site nor stops for it, and
the checks before a batch (`checkSite`: `/api/health`, its database and token,
`/api/ingest/check`, then the pool to `POST /api/ingest/pool`) only warn. The
finish carries the result, each player's rank, cash, net worth and `stats`
(engine stats, income by source, rolls, calls with the served model ids and the
forfeits, `forfeits` by kind and question, `answerTime`: the answers timed,
their total, average and longest wait) and the game `summary` (match totals,
buildings, winner, per-property landings, rent, purchase and ownership changes,
`forfeits`, `answerTime`, cost), plus the narrator's recap when a narrator is configured (cut
short by a stop, `narratorStop`; the payload without it is kept on the game,
`game.payload`, should the simulator have to go first). Ctrl-C or SIGTERM ends
the games in play after the current turn (`runner.stop()`, end reason
`stopped`, kept by `store.abort` as stopped by the owner), sends what it can and
exits, a second one at once (`endNow`); SIGUSR2 plays them to the end and starts
no more (`Runner.finishUp`), and with `--hold`, the container's play mode, the
simulator then stays up idle until stopped. At every start, and every two
minutes while playing, `sweep` marks stopped a game in play whose heartbeat is
three minutes old (its simulator died) and gzips any ended game still in plain
lines, and the backlog goes to the site in the background. `--store` lists the
store, `--publish` sends the site every ended game it has not wholly got
(`behind`, `drain`: a refusal is not tried again and a refused token stops the
lot), `--republish` forgets what was sent first, and `--import-site` copies
every game the site has and the store has not into the store from the public
API (`/api/games`, `/events`, `/calls?full=1`), marked as on that site; `--dry`
keeps the games in the store and sends nothing. When the site cannot be reached
the simulator says why (`siteWhy` over `netReason`: an address that does not
resolve, a certificate it will not trust, nothing answering, or a page that is
not the site's API, each with what to check); a refused token names the token
it sent, where from (`tokenFrom`: the dashboard's token box, which the
dashboard marks with `MONOPOLY_DASHBOARD`, the environment, the `.env` file it
came from, or `--token`) and how long (`tokenRejected`). `--delay` pauses
before each turn so a bot-only game can be watched live; `--loop` keeps playing
batches. Each game's players are drawn from the pool by `pickSeats` in
`runner.js`: `seats` of them at random (8 by default; the runner clamps it to
eight on the standard board and to the distinct models in the pool), never the
same model twice (`modelKey`, `provider/model`; the rule-based bot is not a
model and may fill any number of seats), all of them when the pool is smaller,
and a seed makes the draw repeatable. The dashboard (`runner/dashboard.mjs`,
`npm run dashboard` or `run.mjs --dashboard`, 127.0.0.1:8788, `--port` or
`DASHBOARD_PORT`, `--host` or `DASHBOARD_HOST`, `--data`, `--no-open`; with
`DASHBOARD_PASSWORD` set it asks for it, Basic auth compared in constant time)
serves `dashboard.html`, a page that reads the table (`<data>/config.json`, else
`runner/config.json`, else the default) and the data folder's `.env` into a
form (site, token, a key box per provider in the pool, the pool with a dropdown
of models per row, seats, edition, games, loop, round limit, dry run,
instructions, narrator; a row's dropdown lists every model its provider serves
to the key, asked for at `/api/models` as soon as a key is there and again with
refresh, with the models the server knows before that, `knownModels`: the
adapter's list and the priced ones with their names, grouped by the maker
before the slash, and Other for an id typed by hand; the narrator's model is the
same), writes the table to `<data>/config.json` on Save or Start, writes the
site, the token and the keys to `<data>/.env` only when "remember" is ticked,
and starts `run.mjs` as a child process with `--data` and the keys in its
environment, streaming its output to the page (polled every 1.5 s) and counting
the finished games; Stop now sends SIGINT and Stop after this game SIGUSR2
(`/api/finish`), and the dashboard passes SIGTERM and SIGUSR2 on to its child
and waits for it before it exits. Check the seats starts it with `--probe`
instead: one real decision for every model in the pool, at once (a street to
buy, asked as a game asks it, through `AIDecider` and `Game.decide`), each
answered ✓ with the decision, the time, the cost and the tokens, or ✗ with why
(no key, an empty reply, an unparseable or refused one, an error) and the reply
itself, a seat that would forfeit its decisions; the runner exits 1 when a seat
would not play, and needs neither the site nor the token for it. The store
section (`storeState`, read at most every 4 s) lists the latest twelve games,
their state and whether the site has them whole, and Send the site what it
lacks and Send everything again start the runner with `--publish` or
`--republish` (`task`: `play`, `probe` or `publish`). When the table in use
leaves the site blank, the form offers the default table's (`defaultSite`).
Run 8 CPU players (`options.table: 'cpu'`) starts the runner on
`runner/config.cpu.json`, the CPU table: eight rule-based players seated every
game, `--dry --loop`, 300 ms a turn (`turnDelayMs`; the pause box overrides it)
and 150 rounds at most, since eight bots seldom bankrupt one another and would
play to the engine's thousand; it leaves the saved table alone, and
`npm run cpu` plays it from a terminal.

The dashboard also serves this machine's copy of the site (`localSite` in
`runner/local-site.mjs`, at the owner's request, so the games played locally,
the CPU table's above all, are watched as the web version shows them): the
site's own files from `public/` (the homepage at `/home/`, the Monopoly viewer
at `/monopoly/`, the assets; the dashboard's page keeps `/`, so the viewer's
"All games" leads back to it) and the Worker's public reads answered from the
store in the Worker's shapes (`/api/health` with `local: true`, `/api/live`,
`/api/games` with each game's cost, `/api/games/:id` with its seats, `/events`,
`/calls` with `full`, `/transcript`, `/export`, `/api/stats/monopoly` and
`/api/stats/models` through `aggregate.js`, `/api/players` with the pool of the
table last played, `state.table`, else the saved one, and `ask` answering that
the narrator is off). A game whose runner stopped reads as stopped; an ended
game's counts are read from its gzipped lines and kept; the latest eight games'
lines are kept and read as they grow. The page carries the table live (an
iframe of `/monopoly/#live`, reloaded two seconds after a start) and links to
the copy's tabs. `scripts/check-local-site.mjs` asks the local Worker and the
copy every read for the same store and compares them field by field; a change
to the Worker's reads changes `local-site.mjs` with it.

The container (`Dockerfile`: node:22-alpine, `package.json` for its `"type":
"module"`, `public/assets/app/` and `runner/`, nothing installed, the user
`node`, `MONOPOLY_DATA=/data`, `MONOPOLY_CONTAINER=1` (the registration's
`runner.container`, and no browser opened), `DASHBOARD_HOST=0.0.0.0`) runs
`runner/docker-entrypoint.sh`: `dashboard` (the default), `play` (`--loop
--hold`), `cpu` (the CPU table, `--dry --loop --hold`), `once`, `probe`,
`store`, `publish`, `republish`, `import-site`, `models <provider>`, or the
runner's own options; whether the dashboard runs is that one switch,
`MONOPOLY_MODE` (on the command line, or once in a `.env` beside the compose
file, ignored by git), at the owner's request: on by default for this machine,
`play` for the cloud instance. `docker-compose.yml` runs it
with `init: true` (so the signals reach node), `restart: unless-stopped`,
`stop_grace_period: 60s`, the mode from `MONOPOLY_MODE`, the keys from
`simulator.env` (optional, ignored by git), the dashboard on
`127.0.0.1:${DASHBOARD_PORT:-8788}` only, and `/data` on the named volume
`monopoly-data`, which a rebuild and `down` leave alone. The site and the
simulator are updated apart, at the owner's request: a push to `main` never
touches a game in play, the store or the image, and the simulator is updated by
rebuilding its image, after Stop after this game (or `docker compose kill -s
SIGUSR2 simulator`) lets the game in play end. Memory for the players, when it
comes, belongs to the simulator and its data folder too.

The Worker keeps games, seats, events and calls in D1 (`migrations/`). A
model is identified by `model_key` = `provider/model@effort`, and
`llm_calls.served_model` keeps what the API reported. Public reads: `/api/live`,
`/api/games`, `/api/games/:id`, `/events?after=`, `/calls?after=&full=1`,
`/transcript?compact=1`, `/export`, `/api/stats/monopoly`,
`/api/stats/models` (aggregated in `src/aggregate.js` from `games.summary`
and `game_players.stats`, edge-cached a minute; finished games' events and
transcripts an hour); `/api/health` says whether the site has its database
(`db`) and the runner's token (`token`), which the runner checks before it
plays. `POST /api/games/:id/ask` answers questions over the
compact transcript when `NARRATOR_API_KEY` is set (`NARRATOR_PROVIDER`,
`NARRATOR_MODEL`, `NARRATOR_EFFORT`, `NARRATOR_BASE`; `ASK_LIMIT` per
address per hour via the `asks` table), otherwise 404 `{ enabled: false }`.
The deploy creates and binds the database, and the Worker lays out its own
tables: `ensureSchema`, the first time an isolate reaches the database,
applies every file in `MIGRATIONS` (the `migrations/` files imported as text)
not yet recorded in `d1_migrations`, the table and shape wrangler's `d1
migrations apply` keeps, each as one batch with its record, so a migration
lands whole or not at all, wrangler and the Worker each see what the other
has done, and an isolate that loses a race to apply the same one finds the
record written. A new migration file is added to `MIGRATIONS` too. Without
`env.DB` every data route answers 503 and the viewer says the database is
not set up yet. The owner's one step is the `RUNNER_TOKEN` secret, set once
in the Worker's settings in the Cloudflare dashboard or with `wrangler secret
put RUNNER_TOKEN`; the Worker compares it trimmed (`runnerToken`), since a
secret pasted from a terminal often carries a line break, and answers
`POST /api/ingest/check` so the runner can try its token before a game.

What a game costs (`pricing.js`, shared by the runner, the Worker and the
viewer): every model call is priced as it is made, in US dollars, and the
figure kept with it (`llm_calls.cost`, `cost_source`), so a later change of
price never rewrites an old game. `callModel` takes the cost the API reported
(`reportedCost`: OpenRouter's `usage.cost`, Perplexity's
`usage.cost.total_cost`), else prices the tokens (`callCost`, `tokenCost`)
at the price in force on the day (`priceFor`: `PRICES`, keyed by
`provider/model`, dollars per million tokens in dated `periods`, Gemini 4
Argon's introductory rate ending on 30 November 2026), counting each API's
tokens its own way (Anthropic's input apart from the cache reads and writes;
Gemini's prompt including the cached tokens and its thinking billed as
output; the OpenAI shapes including the cached tokens in the input and the
reasoning in the output), or at a player's own `price` from the config
(`narrator.price` for the narrator); a model with neither costs nothing on
record and reads "no price on file". `ai.js` puts `cost` and `costSource` on
each call record; the runner totals each player's (`stats.calls.cost`, with
`reported`, `priced` and `unpriced` counts), the game's in the summary
(`summary.cost`: `players`, `narrator`, `total`, `unpriced`; and
`summary.narrator`: the narrator's model and cost) and prints them; the
games list carries each game's `cost` (a finished game's total, a running
game's calls so far, `costUnpriced`); `aggregateModels` gives each model a
`cost` (`total`, `games`, `perGame`, `perCall`), leaving out games played
before costs were kept and giving a model with no price no cost per game
rather than a cost of nothing. The viewer names every model by name with
the API that serves it (`modelName`, `apiName`): a line on each player card,
the "What this game cost" card under the cards (`renderCost`, `seatCost`:
each seat's calls, tokens, cost and share up to the move shown, the
narrator's report at the end of a finished game; on a phone the API moves
under the model and the cost stays in view), a cost column in the games
list (a + where calls with no price were left out), and cost a game and in
all in the model statistics with a chart of lying bars (`hbarChart`, any
number of models, each label whole). A price changes by adding a period to
`PRICES`, never by editing a past one.

The homepage (`public/index.html`, `home.js`, `home.css` over `site.css`)
is the site's front page, at the owner's request, and the Monopoly viewer
is one game on it, at `/monopoly/` (`public/monopoly/index.html`; its logo
and the "← All games" tab lead back). At the top, "The players"
(`#the-players`): every model in the pool, a card each with its maker's
logo as a sticker (`modelLogo`), its name (`modelName`), its maker
(`modelMaker` in `pricing.js`, by the logo) and the API it plays through
(`apiName`), its model id and effort, its seat name, its Monopoly record
(finished games, wins, win rate) and "At the table" while it plays. The
list is `GET /api/players` (`thePlayers`, edge-cached 30 s): the pool the
runner last reported, which it posts to `POST /api/ingest/pool` (bearer)
after its token check (`ingestPool` keeps it in `site_meta` under `pool`,
migration 0003; `seed-trades.mjs` gives its eight models the same way),
else the models seen in games, else the default table (`DEFAULT_TABLE`,
`runner/config.default.json` imported into the Worker), named by
`source`; each model once by `modelKey`, its record from `aggregateModels`
at the exact key, else at every effort of the same model. Then "The
games" (`#the-games`): Monopoly's card with what is on its table now
(`/api/live` and the games count: "Live now" or "Between games", the
round or the latest winner, the players' marks) and Watch, Every game,
Statistics and Model stats, and a "Coming soon" card each for chess,
checkers, Battleship and Connect 4, each with its own small picture,
which turn live as the games are built (`PLAN.md`). The homepage reloads
the players and the table every 30 s while visible. A link from before
the move (`/#live`, `/#game/<id>`, `#games`, `#stats`, `#models`,
`#about`) is sent on to `/monopoly/` with its hash by a line in the
homepage's head, on loading and on a hash typed while the page is open
(its own tabs, `#the-players` and `#the-games`, stay); the 404 page offers the board and all the games, and the
dashboard's Live link is `/monopoly/#live`.

The viewer (`public/assets/app/viewer.js`, on `/monopoly/`) routes by hash: `#live` (the
running game, following as events arrive, or the latest finished one; polls
`/api/live` every 15 s to pick up the next game; no replay controls, at the
owner's request: `gameControls` shows the replay bar only on `#game/<id>`,
Full screen and the link only while a game is on the table, the link reading
"Replay this game" for a finished game on the Live tab, the replay keys do
nothing there, and a game already open from the list is opened again in live
mode), `#games`, `#game/<id>`
(the replay: ⏮ ◀ ▶ ▶| ⏭, speeds of 1/4/15/60 events a second or a turn a
second, a slider over every event, arrow keys and space, "follow live"),
`#stats`, `#models`, `#about`. It loads a game's events and calls in pages,
applies them through `ReplayGame` (forward steps incremental, a step back
rebuilds from the start), polls `events?after=` every 2 s on a running game
(calls every other tick, the game row every fourth), and renders the board
as before: the board sized from its position so it fills the window, the
edition line at the top of the centre, the match or the hovered property's
deed in the middle, the dice and last event boxed at the bottom, the player
cards beneath with income by source and property and the roll histogram.
At the bottom, under the narrator, `#ledgers` holds the game's three ledgers
up to the move shown (`renderLedgers`): Payments (who paid whom, a row a
payer and a column a payee with the bank last, then every payment newest
first, a hundred at a time, filtered by player and by kind), Trades and
offers (every negotiation newest first with its steps, the reasons given and
its outcome, completed ones with what changed hands, filtered by player and
outcome) and Properties (every property's owner, landings, rent, rent a
landing, first price, buildings, mortgages, trades, owners and rent less
cost, sorted by any heading); they are drawn at most every 400 ms and only
while in view (an IntersectionObserver), each part only when its signature
has changed, and on a phone a payment or a negotiation reads as a small card.
Every roll chart (`rollChart`, the centre's, the cards' and the statistics
pages') is a row of columns the pointer can rest on, whatever a bar's
height, and the label (`.tip`: `showTip`, and `refreshTip` after every
render and scroll) says the total, how many rolls of it out of all of them
and what two fair dice give; a tap shows it on a phone. Moving the pointer
into the board's centre brings the match back unless a square was clicked to
keep its deed there. A model's token is its maker's whole logo cut out like
a sticker (`modelLogo` in `pricing.js` by the model id and then the provider,
`/assets/logos/<maker>.svg`, Kimi's set on its black tile in the file itself,
`tokenHtml`; the white outline and the shadow are the `drop-shadow` filters
on `.tok.logo`), sized from the board (`--tok`, set by `sizeNames`) and
spread across its square; the rule-based bot keeps its initial on its colour.
The buildings stand on the colour band, as on the printed board (`BUILDINGS`,
drawn by `building`: a green house each, a red hotel, the Mega board's grey
skyscraper, each filling its box with a white outline drawn in the icon); the
band is a size container, up to three houses, a hotel and a skyscraper take
its whole thickness (`cqmin`) and a little more, four houses as much as the
property's width allows, and they stand upright on every side.
The board has the printed board's proportions: `boardTracks` gives the
corner squares 1.6 times a property's width, so the properties stand tall
along the top and bottom and lie wide at the sides, and the centre takes
what is left. Every square (`.cell`, with a side class `side-top`,
`side-bottom`, `side-left` or `side-right`; never the bare `top`, which is
the page header's class and once broke the top row) is a flex box with its
colour band in flow at the inner edge, carrying the buildings, and a `.txt`
block holding the name, the square's picture, the price and a Mega depot,
all centred, the name
at the inner edge and the price at the outer one (a top square lists them
in reverse order so the name still meets the band). Every name on a board
is set at one size, so the labels read alike: `renderBoard` measures each
square's longest word in ems of Jost on a canvas (`wordWidth`, measured
again once the face has loaded) and sets it as `--w`, and `sizeNames`,
run after every render and on resize, takes the largest size at which
every square's longest word still fits its own text box, under a base
that follows the board's width (1.18% of it, 12px at most, a 5px floor),
and sets it on the board as `--name`, with `--cname` for the corners (the
same among themselves, 17.5% of the square at most) and `--gname` for a
one-word corner such as GO (34%); the prices, the buildings and the
pictures take their sizes from `--name`. The stylesheet's own formula
(`min(1em, --avail / --w)`, each square its own size container) is the
fallback until the script has set them; a word that cannot fit even at
the floor breaks rather than clips, and one very long word, as on the
Dutch board, sets the size for the whole board. A corner's label sits in
the lower part of the square, with the tokens above it; GO is red with a
black outline and the red arrow of the printed board under it, pointing
the way round; Free Parking carries the car, Go To Jail the policeman
and the Jail its bars (`CORNER_PICS`), centred in the room above the
label. Chance carries its question mark, Community Chest the chest, a
station the locomotive and the utilities the bulb, the tap and, on the
Mega board, the flame (`ICONS`: inline SVG, the question mark a styled
`?`), centred in the middle of the square between the name at the inner
edge and the price at the outer one (a square with a picture, class
`pic`, gives its price no auto margin, so the picture's own take the
room); on the left and right columns too the price sits at the bottom;
the heat board of the statistics page uses the same tracks and the same
one size. Hovering any
square shows its name large, with the price, in a label (`#hover-name`,
`showHoverName`) on the square's inner side, inside the board. The
full-screen viewer (`#g-full` in the game bar, the F key, Escape or the
`#fs-exit` button to leave) gives `.board-wrap` the class `full`: fixed
over the page, the board alone at the window's smaller side, framed as
on the page, the browser's own full-screen mode asked for too where it
exists; `fitBoard` sizes it from the window then.
The palette is Monopoly's with the official group colours; the face is Jost.
The board itself has fixed colours in both themes, taken from the owner's
photograph of the classic London board: the squares and the centre in the
same pale green (`--cell` #c5d9c3, `--board` #bfd7c1), black rules
(`--board-ink`), a red edge (`--board-edge` #ed2428) on a white margin, and
cream boxes (`--paper`) for the tiles, the dice box and the deed; inside
`.board` the theme variables are overridden to those, so dark mode changes
the page around the board and never the board.
When there is no game to show (no database, no games yet, a missing id, or
while loading) `showEmptyBoard` draws the board with every square and the
logo in the centre, never a blank.

The scripts and the stylesheet live under `/assets/app/` and
`/assets/style/`, moved there in v1.6 because the first releases had served
`/assets/js/` and `/assets/css/` as immutable for a year, which left browsers
holding the old stylesheet against new pages; never move them back under
those two paths, and never serve them immutable again.

Board editions (`names.js`): `NAME_SETS` holds forty names in board order
and a currency per edition (London, Atlantic City, Paris, the German,
Italian and Dutch classics, the 2008 World Edition; a set is added by
giving all forty names, GO first). The engine always plays London;
`dressGame(game, set)` renames the squares of a standard-board game by
position and gives the game `fmtMoney`, `displayName` (a London name from an
event to the edition's) and `displayText` (London names and £ amounts
inside free text: card texts, chat, reasons); `fmtEvent` in
`transcript.js` reads those hooks when present and prefers square indexes
over the names stored in events, so a bare engine game still reads as
London in pounds (the runner and the Worker's transcript). The viewer
keeps the choice under `monopoly-ai.names`, dresses every `ReplayGame` it
builds, formats all money through the current set, and renames the
statistics pages' squares by position; the header's selector is a plain
`<select>` (`#names-select`, at the owner's request). Names apply to the
standard board only; a Mega game keeps London names and takes just the
currency.

Providers (`providers.js`): four adapter kinds, `anthropic`, `gemini`,
`openai` (chat completions) and `responses` (the OpenAI Responses shape,
which Perplexity's Agent API speaks at `https://api.perplexity.ai/v1` under
provider-prefixed ids such as `openai/gpt-5.5`, `xai/grok-4.7`,
`perplexity/kimi-k3`, `zai/glm-5.2`; effort goes as `reasoning.effort`,
minimal to max, never as a `preset`, which is a whole agent with its own
instructions and tools; no tools are requested, so no web search is run).
Perplexity is asked for no JSON mode (a provider's `jsonMode` asks for
`json_object`): it documents none, and asked for one, GPT-6.1 Sol, Grok 4.7
and Kimi K3 answered `{}` to every decision of the game of 16 October, so
the prompt asks for JSON and `parseJsonReply` finds it. Its replies are
streamed (the provider's `stream`; `fetchSse`: the text from
`response.output_text.delta`, the whole response with its usage and cost
from `response.completed`, keep-alives skipped, an `error` event a failed
call, a stream cut short tried again, an empty one answered 422), since
Perplexity closes a call that has not answered within about a minute
("other side closed", three tries making the 183 s of that game's
failures). After a 400 a Responses call is sent again without its optional
knobs, then without streaming, then plain, and the shape that worked is
used first from then on for that model (`shapes`). Every adapter returns
`servedModel`, retries once without its optional knobs on a 400 (the other
three), and takes `plain: true` to skip the JSON format for prose (the
narrator); a fetch that fails carries Node's reason in its message
(`netReason`: Node's "fetch failed" keeps it in `cause`). `withRetries`
tries again on a 429 after the API's `Retry-After` (a minute at most) or 4,
8, 16 and 32 s, on a connection that never opened (`connectFailed`) four
more times over about twenty seconds, and on a server error, a timeout or a
connection cut mid-reply twice more; `backoff` scales the waits for the
checks. The runner gives each address Node tries 2.5 s rather than 250 ms
(`setDefaultAutoSelectFamilyAttemptTimeout`), since on a machine whose IPv6
has no route a moment of slow Wi-Fi failed every call at once. A reply
that parses to an empty object is a fallback (`empty reply`), never "nothing
to do". `scripts/check-providers.mjs` drives the four shapes against a
mock: the stream with its keep-alives, a refused option, a refused stream,
an empty stream, a cut one, a rate limit in the stream and with
`Retry-After`, the empty reply, an API that cannot be reached. The default table (`runner/config.default.json`, read when
`runner/config.json` is absent) draws eight seats a game from a pool of
nine: Claude Opus 5.5 at xhigh (Anthropic, direct), Gemini 4 Argon (Google,
direct), GPT-6.1 Sol, Grok 4.7, Kimi K3 and Nemotron 3 Ultra through
Perplexity with one key under the ids its changelog lists, and
MiMo-V2.6-Pro, Qwen3.8 Max and DeepSeek V4 Pro, which Perplexity does not
serve, through OpenRouter (`openrouter`, kind `openai`, the effort as its
unified reasoning setting) under `xiaomi/mimo-v2.6-pro`, `qwen/qwen3.8-max`
and `deepseek/deepseek-v4-pro`; eight is the most the standard board takes
(the engine itself takes any number from two), and the seated players sit
in a random order; the runner's `--list-models
<provider>` prints a provider's catalogue for the owner's key, which is
where those ids are checked, and a call that fails forfeits that choice
(`forfeit`).
## Local development

```bash
npm install
npm run migrate:local   # the schema into the simulated local database (optional: the Worker applies it on first use)
npm run dev             # wrangler dev --env local (RUNNER_TOKEN=local-dev-token)
node runner/run.mjs --config runner/config.bots.json --token local-dev-token --games 2
```

## Verification - before every push to main

1. `npx wrangler deploy --dry-run`
2. `npm run simulate` - must report `illegal: 0` and no thrown invariant;
   `node scripts/check-providers.mjs` for a change to `providers.js`.
3. `npm run check:replay` - the reducer against the engine, every event,
   both editions: `ok: true`; and `npm run check:ledger`, the ledgers against
   the engine's cash with trading players, both editions: `ok: true`.
4. Serve `public/`, render it with headless Chromium, and inspect the
   screenshots: styles applied, board drawn, layout intact at desktop and
   phone widths.
5. For a change to the Worker, the runner or the viewer: apply the local
   migrations, start `npm run dev`, play two bot games with the runner
   against it and seed a trading game (`node scripts/seed-trades.mjs`, which
   refuses any site but this machine's), then `node scripts/verify-viewer.mjs` (with
   `PLAYWRIGHT_MODULE` and `CHROME_PATH` when playwright is not installed
   here) and look at its screenshots in `.render-check/viewer/`: the
   homepage and its players (desktop and phone), the live
   tab, the replay, the games list, both statistics pages, a game followed
   live, the ledgers, the roll label, the logos, the phone. For a change to
   the dashboard, drive it in headless Chromium with `/api/models` answered
   by a stand-in.
6. For a change to the simulator's store, publisher or container: play bot
   games against the local Worker with a `--delay`, take the Worker down
   mid-game and bring it back, stop one with SIGINT, finish one with SIGUSR2
   and kill one outright (its heartbeat aged), and check the site's copy
   against the store (`--store`, the site's event counts); build the image and
   run it with `--network host` against the local Worker in `once` and
   `dashboard` modes (start, Stop after this game, a `docker stop` mid-game),
   and bring `docker compose` up and down once.
7. For a change to the dashboard's copy of the site (`runner/local-site.mjs`)
   or to the Worker's reads: play bot games and a priced game against a stand-in
   model into one store, published to a freshly migrated local Worker, start the
   dashboard on that store and run `node scripts/check-local-site.mjs` (every
   read the same); then drive the dashboard in headless Chromium: Run 8 CPU
   players, the table live on the page, the copy's games, statistics and
   players, and nothing sent to the site.

Never leave pushed work unverified or half-finished. Work in small, complete
batches: implement, verify, commit, push.

## Git and release workflow

- Before committing: `git config user.name "Fid" && git config user.email "fid_kk@proton.me"`
- Develop on the working branch and push there first. Release verified work by
  fast-forwarding `main` onto it and pushing `main`.
- Every push to `main` is a release. Versions are an ascending `vMAJOR.MINOR`
  sequence starting at `v1.0`; every push bumps the minor regardless of size. A
  major bump is reserved for a ground-up overhaul.
- With every push to `main`, provide release-tag text in the reply, in exactly
  this shape. The owner creates the GitHub release manually - **never push tags**:

  ```
  Tag: v<next>  —  Title: <five to nine words, plain and evocative>
  Description: <one to three sentences of editorial prose describing what changed
  from the owner's point of view — outcomes, not implementation. No bullet lists,
  no jargon, no file names.>
  ```

- Append the release line to the ledger below as part of the same push.
- Commit messages: descriptive imperative first line (what the change does, not
  "update X"), then a short prose body; dash bullets are fine there. One commit
  per coherent piece of work; several may share a push, but each push gets
  exactly one version entry.
- Never include model names, AI attribution trailers, session links, or other
  tooling identifiers in commit messages, titles, or code.

## AI-instruction archive

`prompt text/` holds the records for the version currently in service -
nothing else. Shipping version N replaces the folder's contents wholesale, in
the same push that releases the version: remove the previous version's
folder(s) and add `prompt text/N/` containing `input.txt` (the prompt, byte for
byte), `output.txt` (the reply that shipped it, byte for byte), `ai model.txt`
(three lines: Anthropic / Claude / Fable 5 Max unless the owner directs
otherwise) and every input image and file the owner provided, each under its
own name. The files are owner-supplied records: never edit, reformat, trim or
regenerate them. N counts shipped prompts, not release tags: a push that ships
no new prompt leaves the archive untouched.

## Release ledger

| Version | Title | Description |
| --- | --- | --- |
| v1.0 | Every seat at the Monopoly table is an AI | A complete browser Monopoly simulator for the London board, with the Mega edition as an option, where each player is an AI model you choose and brief, every game is logged in full, and results are analysed across games. |
| v1.1 | The players start talking to each other | Players now behave like people at a real table: they chat publicly, whisper to one opponent, answer when addressed and haggle over trades with counter-offers. The speed-die switches and all the pacing limits are gone, so everyone acts before every roll, trades freely and plays until the last player stands. |
| v1.2 | The board fills the window, in Monopoly's own colours | The live board now fits the window whole, dressed in Monopoly's palette and lettering, with the match in its centre: the goes, purchases, trades, the cash on the table, the money moving to and from the bank and between players, and how the dice have fallen, with the dice and the last event boxed beneath. Hovering any property shows who owns it, what rent it has brought in and to whom, how often it has been landed on and its history of purchases, trades and mortgages, and a click keeps it there; beneath the board every player is laid out with their properties, their takings by source and property, and their own roll distribution. |
| v1.3 | The table goes public, with a memory | The site is now a viewer for everyone: the games are played from the owner's machine with the owner's keys and streamed in as they happen, every game is kept in a database with its full log, and visitors can watch live, open any past game and step through it, read the narrator's report or hand a transcript to an AI, and compare the board's statistics and every model's record, with each player identified by its provider, exact model and effort. Claude, ChatGPT, Gemini, Grok, Kimi, Mimo, GLM and Mistral have their seats. |
| v1.4 | The board is always on the table, in any city's names | The board now shows every square whenever there is no game to watch, instead of an empty frame. A selector in the header, with a search box, reads the same board as another edition by position: London, Atlantic City, Paris, the German, Italian and Dutch classics or the 2008 World Edition, and every name and every amount on the page follows, on the squares, in the feeds and deeds, on the player cards and across the statistics, in that edition's currency, without touching the game, even one being watched live. |
| v1.5 | The board in its own green, as on the box | The board now wears the classic board's colours, taken from the owner's photograph: the same pale green across the squares and the centre, black rules between them, a red edge on a white margin, and cream cards for the figures, the dice and the deeds. It looks the same in the dark theme, where only the page around it changes. |
| v1.6 | One Perplexity key for the seats, a plain dropdown, a fresh stylesheet | ChatGPT, Grok, Kimi and GLM now play through Perplexity's Agent API with a single key, under the ids it serves, while Claude and Gemini stay direct; a runner option prints a provider's current catalogue. The board edition is a plain dropdown in the header. The scripts and the stylesheet moved to new paths so every browser fetches the current ones, after the earliest releases had told browsers to keep the old stylesheet for a year, which is what left the page unstyled. |
| v1.7 | The corners of the board read whole | The four corner squares, GO, Jail, Free Parking and Go To Jail, no longer spill their words past the edge of the square: each corner's lettering now takes its size from the square itself and from its longest word, in every edition, with GO set larger as it is on the printed board. |
| v1.8 | The squares take the printed board's shape | The board now has the printed board's proportions, with large corner squares and property boxes that stand tall along the top and bottom and lie wide at the sides, and every name and price is centred in its box with the name kept to whole words, however the window is sized. Chance, Community Chest, the stations and the utilities carry their pictures, and GO is lettered in red with a black outline and the arrow that points the way round the board. |
| v1.9 | One lettering, names on hover, the board full screen | Every name on the board is now set at one size, a little smaller, chosen so that the longest word still fits its square, so Bow Street no longer out-sizes Marlborough Street and short names sit on one line; the prices and pictures follow it. Hovering any square shows its name and price large beside it, and a Full screen button in the game bar puts the board alone across the window, with Escape to come back. |
| v1.10 | Car, policeman and bars on the corner squares | Free Parking now carries its car, Go To Jail its policeman and the Jail its bars, as on the printed board. The pictures of Chance, Community Chest, the stations and the utilities sit in the middle of their squares, and on the left and right columns the price sits at the bottom of the square, as it does along the top and bottom. |
| v1.11 | The default table: eight frontier seats, one Perplexity key | The runner now plays a default table without any copying or editing: Claude Opus 5.5 at its highest effort and Gemini 4 Argon on their own APIs, with GPT-6.1 Sol, Grok 4.7, Kimi K3, DeepSeek V4, GLM-5.2 and Nemotron 3 Ultra through Perplexity on one key, seated in a random order every game; an edited copy of the file still takes over when a different table is wanted. |
| v1.12 | MiMo and Qwen join through OpenRouter | The two Chinese models Perplexity could not serve now have their seats: MiMo-V2.6-Pro and Qwen3.8 Max, the two ranked highest beside Kimi K3, play through OpenRouter on a second key, taking the places of the DeepSeek Flash build and GLM-5.2. |
| v1.13 | DeepSeek V4 Pro takes a ninth seat | DeepSeek V4 Pro joins the table through OpenRouter as a ninth player rather than in place of anyone, so every model asked for is seated: Claude, Gemini, ChatGPT, Grok, Kimi, MiMo, Qwen, DeepSeek and Nemotron, in a random order every game. |
| v1.14 | A pool of models, eight drawn to each table | Every game now seats up to eight models drawn at random from the pool in the config, never the same model twice, so the pool can grow past eight and no model ever plays against itself; a pool smaller than the seats plays whole. Qwen3.8 Max is back in the pool beside DeepSeek V4 Pro, so nine models take turns at the table of eight. |
| v1.15 | A dashboard on your own machine to run the table | Running the games no longer needs a config file or a terminal full of flags: one command opens a page on your machine with the site, the token, a key box for every provider in the pool, the pool itself with each provider's catalogue a click away, the seats and the rest, and Start, Stop and the runner's progress, with the keys kept only for the run unless you choose to remember them. |
| v1.16 | Each model's bill for every game, database included | Every game now shows what it cost, seat by seat: each model by name, the API that served it and the dollars its calls came to, with the game's total in the games list and each model's average cost a game in the model statistics. The site also creates its own database when it deploys and lays out its tables itself, so the only setup left is the runner's token, and the runner and its dashboard already know the site's address. |
| v1.17 | A quieter Live tab, and errors that say why | The Live tab now simply follows the game, without the replay controls: they appear only when you open an older game, which a finished game on the Live tab offers with a Replay this game button, and the full-screen and link buttons step aside when there is no game on the table. When the runner cannot reach the site, or a model's service, it now says why, whether the address does not resolve, the certificate is not trusted or nothing answers, and what to check. |
| v1.18 | The runner's token, checked before the game begins | The runner now checks its token with the site before it starts a game, so a token the site refuses no longer stops a game that has already begun calling the models, and it says which token it sent, where it came from and how long it is, so a mistyped or stale one is easy to spot. Spaces or a line break around the token, the usual souvenir of copying it from a terminal, no longer make the site refuse it. |
| v1.19 | Every payment, trade and property on the books | Under every game now sit its ledgers, following the move shown: every payment between the players and with the bank, with a table of who paid whom; every trade offered, with its counter-offers, the answers and how it ended; and every property's landings, rent, price, buildings and history. Each model's token wears its maker's logo, the roll charts say how often each total has come up out of all the rolls, and the dashboard lets you pick each model from a dropdown of everything its provider serves. |
| v1.20 | Logo stickers on the board, houses you can see | Each model's token is now its maker's whole logo, cut out like a sticker with a white outline, instead of a small logo inside a coloured ring. Houses and hotels now stand on the property's colour band as they do on the printed board, a green house each and a red hotel, much larger than the old marks and outlined in white so they read on every colour. |
| v1.21 | A homepage for every game, with its players | The site now opens on a homepage of games: the players at the top, every model in the pool with its maker's logo, the API it plays through and its Monopoly record, then Monopoly with what is on its table now, and chess, checkers, Battleship and Connect 4 waiting beside it, marked coming soon. Monopoly has a page of its own, a click from the homepage, and old links to it still land there. A plan for building the four new games now sits with the code, ending with the questions that need your answer. |
| v1.22 | Every seat really plays, and the game checks out | An audit of a live game found the board sound, with every lap past GO paid, every rent right and every player's cash accounted for, but three of the eight seats, ChatGPT, Grok and Kimi, were never really playing: Perplexity answered all their decisions with an empty reply, so the rule-based bot played for them. They are now asked the way Perplexity documents, their replies stream so a long think is no longer cut off after a minute, rate limits and brief network drops are waited out instead of handed to the bot, and a new Check the seats button asks every model one question before a batch to show which are answering. |
| v1.23 | When the models are asked, and what they see | A new guide sets out how the AI players are prompted: once every turn before the dice and otherwise only when there is a choice to make, never for a roll or a move; that each question is plain text with the rules, the board, the state of the game and the recent table talk, with no picture, file or memory of earlier turns; and what they must answer, with diagrams of a turn, a trade and the table talk and real prompts from a game. The goal the models are given now reads correctly when a game has no round limit. |
| v2.0 | The games play in a container of their own | The games are now played by a simulator that runs on its own in a Docker container, on your machine or a cloud instance, from its dashboard or unattended, keeping every game in a store of its own before it sends the site a copy, so the site can be updated, or its database replaced, without touching a game in play or the record of the games played. No model is played for any more: a model that gives no valid answer gives up that choice while its turn still pays what it owes, a trade offer left unanswered is rejected by default with the reason logged, and every turn is timed, the forfeits and the time a turn showing on the players' cards and in the model statistics. |
| v2.1 | Timing the wait for each answer, not the turn | The game now times how long the table waits for each player's answer, rather than how long a whole turn takes, and charges the wait to the player who kept everyone waiting, so an auction's bids and a trade's replies count for whoever gave them. Each player's card shows its average answer, the game's feed says how long each answer took, and the model statistics give each model's time an answer. |
| v2.2 | Eight CPU players, watched on your own copy of the site | One button on the dashboard now sets eight rule-based players playing on your own machine, with no keys and nothing sent to the site, and the dashboard shows the game live as the website does, with every game, the replays and the statistics in your own copy of the site's pages, read from the games stored on your machine. In the container the dashboard is a single switch, on for your machine and off for the cloud instance, which can also play the eight CPU players unattended. |
