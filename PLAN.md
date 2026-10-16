# The plan for the next games

The homepage now lists five games: Monopoly, which is played and watched today, and chess, checkers, Battleship
and Connect 4, which are placeholders. This is how the four get built. It is a plan to agree before the work
starts, and it ends with the questions that need the owner's answer.

## What carries over from Monopoly

Monopoly proved one way of working, and every new game follows it:

- **An engine that is pure logic** (`engine.js`): the rules, a seeded random source, every move logged as a
  numbered event, decisions asked of a `decider`, and a result with a ranking. The runner, the Worker and the
  checks share it.
- **A reducer that rebuilds the game from its events** (`replay.js`), proved against the engine after every event
  by a check script, so the viewer can show any moment of any game, live or replayed.
- **The AI layer and the providers** as they are: the same nine models, the same APIs, effort, prices and cost
  per call, the same fallback when a call fails or an answer breaks the rules, recorded as such.
- **The runner and the dashboard**, which draw the players from the pool and stream every game to the site.
- **The site**: D1 keeps every game, the viewer follows it live and replays it, and the statistics pages read
  across games.

## Step 1: one platform for several games

Before any new game, the platform learns that there is more than one:

- **The database**: a migration adds `game_type` to `games` (every existing game is `monopoly`); the API
  takes `?type=` on the games list, the live game and the statistics, and the ingest takes the type with the
  game.
- **The engines**: each game gets its folder, `public/assets/app/<game>/`, with `engine.js`, `replay.js` and its
  `prompts.js` (the rules text, the position as the model sees it, the decision asked and the answer's shape,
  the validation and the fallback). `ai.js` keeps the calls, the costs and the records and takes the game's
  prompts instead of Monopoly's.
- **The runner**: `--game chess` (and a game box in the dashboard) picks the engine. Two-player games seat two
  models: either drawn at random for every game, or, better for fair ratings, a round robin in which every pair
  in the pool meets twice, each side once (36 pairs, 72 games for the nine models).
- **Ratings**: for the two-player games, an Elo rating per model per game, worked out in `aggregate.js` from the
  finished games, with wins, draws and losses beside it.
- **The viewer**: each game gets its page, `/chess/`, `/checkers/`, `/battleship/`, `/connect-4/`, built from the
  Monopoly page's parts, which move into shared modules: the live and replay bar, the polling, the games list,
  the model statistics table, the cost card, the table talk and the roll-style hover labels. Each page draws
  only its own board.
- **The homepage**: a game's card turns live with a Watch button when its first game is played, and each player's
  card on the homepage adds its record and rating in that game.

## The four games

### Connect 4 (first: the smallest game, and the one that proves the platform)

- **Rules**: seven columns, six rows, red moves first, four in a row wins, a full board draws.
- **What the model sees**: the grid drawn in text, whose turn it is, the columns still open; it answers with a
  column and may say something to the other player.
- **Measured against perfect play**: Connect 4 was solved in 1988, and the first player wins with perfect play.
  A solver (bitboard search with alpha-beta and a transposition table, the standard approach) runs on the
  runner's machine after each move, with a book for the opening moves where a search is slow, and marks every
  move as best, holding the result, or throwing it away. That gives each model an accuracy, which no other game
  here can offer so cleanly.
- **The page**: the frame with falling discs, the moves listed with their verdicts, and each model's accuracy.
- **Size and cost**: at most 21 moves a side; roughly $0.30 to $1 a game for the dearest models at high effort,
  cents for the cheapest.

### Chess (second: the one most people will want to watch)

- **Rules**: the full game: castling, en passant, promotion, check, checkmate and stalemate, and the draws by
  threefold repetition, the fifty-move rule and insufficient material. chess.js (BSD-2-Clause) does the move
  generation and the rules; a perft test against the published node counts guards it either way. A game longer
  than 300 plies is adjudicated a draw.
- **What the model sees**: the position as a FEN and as a drawn board, the moves so far in algebraic notation and
  the legal moves; it answers with a move, and may offer a draw, accept one, resign or talk. An illegal move gets
  one more try with the reason; after that the fallback plays and is counted.
- **The page**: the board, the move list, the captured pieces, the table talk, a PGN download, and the opening's
  name (Lichess's opening list, CC0).
- **Optional later**: Stockfish on the runner's machine to grade every move (accuracy, blunders, missed mates).
  It is GPL, so it stays a separate program on that machine and never ships with the site.
- **Size and cost**: 40 to 80 moves a side; roughly $1 to $4 a game for the dearest models at high effort, more
  at the highest effort, cents for the cheapest.

### Checkers (third: it reuses chess's board)

- **Rules**: English draughts on the 8×8 board: men move forward, captures are compulsory, jumps chain, a man that
  reaches the far row is crowned and his move ends there; a draw after forty moves a side without a capture or a
  man's move, or by threefold repetition. Checkers was solved in 2007 as a draw with perfect play.
- **What the model sees**: the board drawn with the squares numbered 1 to 32, as checkers notation numbers them,
  and the legal moves in that notation (`11-15`, `22x15x8`); it answers with one.
- **Engine**: written here, about the size of Monopoly's money code, with tests from known positions for the
  compulsory captures, the chained jumps and the crowning.
- **The page**: the board, the men and kings, the moves, the captures.
- **Size and cost**: 30 to 60 moves a side; roughly $1 to $3 a game for the dearest models.

### Battleship (fourth: hidden information and a phase of its own)

- **Rules**: a 10×10 sea each, five ships (5, 4, 3, 3 and 2 squares) placed in secret, shots in turn, a hit, a
  miss or a sinking announced, and the first to sink the whole other fleet wins.
- **What the model sees**: first, its empty sea and the ships to place; it answers with each ship's square and
  direction, and a placement the rules refuse is replaced by a random one, counted. Then, every turn, its own
  sea with the other side's shots, and its record of shots at the other: hits, misses and the ships sunk. It
  never sees the other fleet; a test reads every prompt of a game to prove it.
- **A yardstick**: a probability bot (hunt, then target) plays the same games, so each model's shots to win and
  hit rate read against something sensible.
- **The page**: both seas for the spectators, the shots as they land, heat maps of where each model aims and
  where it hides its ships.
- **Size and cost**: one placement and 40 to 70 shots a side; roughly $1 to $3 a game for the dearest models.

## The order, a release each

1. The platform and Connect 4, with ratings and the first live card beside Monopoly's.
2. Chess.
3. Checkers.
4. Battleship.

Each release is verified as Monopoly is today: the engine's checks, the reducer against the engine after every
event, games played by bots and by scripted players into a local site, and the page driven in a headless browser.

## What the costs rest on

The estimates above take about 2,000 tokens in and 1,500 out for every move at high effort, at the prices in
`pricing.js` today; the highest effort can think three times as long. The runner already prices every call, so
the real figures show on each game's cost card from its first game, and a spending cap per batch can join the
dashboard before the dearer games run.

## The questions for the owner

1. **Pairings**: a round robin (every pair twice, sides swapped) or two models drawn at random for every game?
   The round robin gives fairer ratings.
2. **The legal moves in the prompt**: list them (fewer illegal answers, a fairer test of play) or leave the
   models to know the rules (a test of rules as well)? Listing them is recommended, and illegal answers are
   counted either way.
3. **Chess grading**: Stockfish on your machine for accuracy and blunders, later, or not at all?
4. **The address**: the homepage of every game now lives at monopoly.basilicalabs.ai; a name such as
   games.basilicalabs.ai could point at the same site.
5. **A budget**: a spending cap per batch or per day in the dashboard?
