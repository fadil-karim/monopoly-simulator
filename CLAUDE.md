# CLAUDE.md

Standing policy for this repository. Read it before making any change here.

## What this repo is

A Cloudflare Worker site: the viewer in `public/` served as static assets and
`src/worker.js` for everything under `/api/`. AI models play Monopoly
(London and Mega editions) against each other, up to eight at a table drawn
from a pool; the games are played by
`runner/run.mjs` on the owner's machine with the owner's keys and streamed
to the site, which keeps every game in D1 and shows them live and move by
move. There is no build step - the files in `public/` are the site. The repo
is connected to Cloudflare Workers Builds, so **every push to `main` deploys
to production**.

```
public/            everything served as assets
  index.html       the viewer: live, games, replay, Monopoly stats, model stats, about
  404.html
  assets/app|style|fonts   app/ the modules (viewer, replay, stats, transcript, names, engine, board, heuristics, providers, ai, runner), style/site.css, fonts/jost.woff2 (OFL, the only font file)
  _headers         security + caching headers (fonts immutable; app and style revalidated on every load, because the modules import each other by name)
  robots.txt
                   app/names.js the board editions (names by position, currencies) the viewer reads a game as
src/worker.js      /api/*: the public reads, the runner's uploads (bearer RUNNER_TOKEN), the optional narrator; everything else -> env.ASSETS
src/aggregate.js   the two statistics aggregations
migrations/        the D1 schema (games, game_players, events, llm_calls, asks)
runner/            run.mjs plays games and streams them; config.default.json the default table (a pool of nine models and eight seats, drawn at random for every game, never the same model twice; Claude and Gemini direct, four through Perplexity, MiMo, Qwen and DeepSeek through OpenRouter); config.bots.json bots for tests; .env, config.json (the owner's overrides, preferred when present) and out/ are ignored
scripts/           simulate.mjs (engine invariants), check-replay.mjs (reducer vs engine), verify-viewer.mjs (the viewer in headless Chromium)
wrangler.jsonc     main + assets (binding ASSETS, 404-page, /api/* worker-first) + env.local with a simulated D1; the production d1_databases block stays commented out until the owner has created the database
package.json       wrangler devDependency + dev/deploy/check/migrate/simulate/check:replay/runner scripts
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
statistics incrementally from the same log; `transcript.js` has the one
line per event (`fmtEvent`, `eventLine`) and the plain-text `transcript`
(`compact` drops dice, moves and other noise; `maxChars` trims the middle).

The runner (`runner/run.mjs`) reads `runner/config.json` when it exists, else
`runner/config.default.json` (the pool of players, `seats`, universal
instructions, engine config, narrator) and the keys from the environment or
`runner/.env` (`PROVIDERS[*].env` names them), registers each game at
`POST /api/ingest/games`, buffers events and calls and flushes them every
700 ms, and at the end posts `finish` with the result, each player's rank,
cash, net worth and `stats` (engine stats, income by source, rolls, calls
with the served model ids) and the game `summary` (match totals, buildings,
winner, per-property landings, rent, purchase and ownership changes), plus
the narrator's recap when a narrator is configured. Uploads are idempotent
(`INSERT OR IGNORE` by sequence), retried with backoff, and every game is
also written to `runner/out/`. `--delay` pauses before each turn so a
bot-only game can be watched live; `--loop` keeps playing batches. Each
game's players are drawn from the pool by `pickSeats` in `runner.js`:
`seats` of them at random (8 by default; the runner clamps it to eight on
the standard board and to the distinct models in the pool), never the same
model twice (`modelKey`, `provider/model`; the rule-based bot is not a
model and may fill any number of seats), all of them when the pool is
smaller, and a seed makes the draw repeatable.

The Worker keeps games, seats, events and calls in D1 (`migrations/`). A
model is identified by `model_key` = `provider/model@effort`, and
`llm_calls.served_model` keeps what the API reported. Public reads: `/api/live`,
`/api/games`, `/api/games/:id`, `/events?after=`, `/calls?after=&full=1`,
`/transcript?compact=1`, `/export`, `/api/stats/monopoly`,
`/api/stats/models` (aggregated in `src/aggregate.js` from `games.summary`
and `game_players.stats`, edge-cached a minute; finished games' events and
transcripts an hour). `POST /api/games/:id/ask` answers questions over the
compact transcript when `NARRATOR_API_KEY` is set (`NARRATOR_PROVIDER`,
`NARRATOR_MODEL`, `NARRATOR_EFFORT`, `NARRATOR_BASE`; `ASK_LIMIT` per
address per hour via the `asks` table), otherwise 404 `{ enabled: false }`.
Without `env.DB` every data route answers 503 and the viewer says the
database is not set up yet; the deploy still succeeds. The owner creates the
database once (`wrangler d1 create`, paste the id, uncomment the block,
`npm run migrate`, `wrangler secret put RUNNER_TOKEN`).

The viewer (`public/assets/app/viewer.js`) routes by hash: `#live` (the
running game, following as events arrive, or the latest finished one; polls
`/api/live` every 15 s to pick up the next game), `#games`, `#game/<id>`
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
The board has the printed board's proportions: `boardTracks` gives the
corner squares 1.6 times a property's width, so the properties stand tall
along the top and bottom and lie wide at the sides, and the centre takes
what is left. Every square (`.cell`, with a side class `side-top`,
`side-bottom`, `side-left` or `side-right`; never the bare `top`, which is
the page header's class and once broke the top row) is a flex box with its
colour band in flow at the inner edge and a `.txt` block holding the name,
the square's picture, the price and the buildings, all centred, the name
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
`perplexity/kimi-k3`, `zai/glm-5.2`; effort maps to its `preset`, fast to
xhigh; no tools are requested, so no web search is run). Every adapter
returns `servedModel`, retries once without its optional knobs on a 400,
and takes `plain: true` to skip the JSON format for prose (the narrator).
`scripts/check-providers.mjs` drives the Responses and chat shapes against
a mock. The default table (`runner/config.default.json`, read when
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
where those ids are checked, and a call that fails plays that decision by
the rules-based bot (`ai_fallback`).
## Local development

```bash
npm install
npm run migrate:local   # the schema into the simulated local database
npm run dev             # wrangler dev --env local (RUNNER_TOKEN=local-dev-token)
node runner/run.mjs --config runner/config.bots.json --token local-dev-token --games 2
```

## Verification - before every push to main

1. `npx wrangler deploy --dry-run`
2. `npm run simulate` - must report `illegal: 0` and no thrown invariant;
   `node scripts/check-providers.mjs` for a change to `providers.js`.
3. `npm run check:replay` - the reducer against the engine, every event,
   both editions: `ok: true`.
4. Serve `public/`, render it with headless Chromium, and inspect the
   screenshots: styles applied, board drawn, layout intact at desktop and
   phone widths.
5. For a change to the Worker, the runner or the viewer: apply the local
   migrations, start `npm run dev`, play two bot games with the runner
   against it, then `node scripts/verify-viewer.mjs` (with
   `PLAYWRIGHT_MODULE` and `CHROME_PATH` when playwright is not installed
   here) and look at its screenshots in `.render-check/viewer/`: the live
   tab, the replay, the games list, both statistics pages, a game followed
   live, the phone.

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
