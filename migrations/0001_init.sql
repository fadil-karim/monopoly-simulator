-- The match history. One row per game, one per seat, one per event and one per
-- model call. Everything the viewer and the statistics read comes from here.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',       -- running | finished | aborted
  edition TEXT NOT NULL DEFAULT 'standard',
  seed INTEGER,
  config TEXT NOT NULL DEFAULT '{}',            -- JSON, the engine config in force
  universal TEXT,                               -- the universal strategy instructions
  started_at TEXT NOT NULL,                     -- ISO 8601
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  rounds INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  last_seq INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  call_count INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT,
  winner_name TEXT,
  end_reason TEXT,
  duration_ms INTEGER,
  result TEXT,                                  -- JSON, the engine's result with the ranking
  summary TEXT,                                 -- JSON, the match statistics (see runner/run.mjs)
  recap TEXT,                                   -- the narrator's account of the game
  runner TEXT                                   -- JSON, the runner's version and host
);
CREATE INDEX IF NOT EXISTS games_started ON games(started_at);
CREATE INDEX IF NOT EXISTS games_status ON games(status, started_at);

CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  seat INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'heuristic',
  model TEXT,
  effort TEXT,
  model_key TEXT NOT NULL,                      -- provider/model@effort: the identity the model statistics group by
  colour TEXT,
  extra TEXT,                                   -- JSON: temperature, instructions, baseUrl
  rank INTEGER,
  final_cash INTEGER,
  final_net_worth INTEGER,
  bankrupt INTEGER NOT NULL DEFAULT 0,
  bankrupt_round INTEGER,
  stats TEXT,                                   -- JSON: engine stats, income by source, rolls, calls
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS game_players_key ON game_players(model_key);

CREATE TABLE IF NOT EXISTS events (
  game_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  round INTEGER NOT NULL DEFAULT 0,
  turn INTEGER NOT NULL DEFAULT 0,
  t INTEGER,
  type TEXT NOT NULL,
  player TEXT,
  data TEXT NOT NULL,                           -- JSON, the whole event as the engine logged it
  PRIMARY KEY (game_id, seq)
);

CREATE TABLE IF NOT EXISTS llm_calls (
  game_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  round INTEGER,
  turn INTEGER,
  player TEXT NOT NULL,
  decision TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  effort TEXT,
  served_model TEXT,                            -- the model id the API reported back
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  reasoning_tokens INTEGER,
  error TEXT,
  fallback INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  parsed TEXT,                                  -- JSON, the decision as parsed
  response TEXT,                                -- the reply text
  prompt TEXT,                                  -- the user prompt, when the runner logs prompts
  system TEXT,                                  -- JSON array of the system blocks, when logged
  PRIMARY KEY (game_id, seq)
);
CREATE INDEX IF NOT EXISTS llm_calls_player ON llm_calls(game_id, player);

-- the narrator's rate limit: questions per address per hour
CREATE TABLE IF NOT EXISTS asks (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
