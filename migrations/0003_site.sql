-- What the site keeps about itself, by key. 'pool': the pool of models the runner last said it draws its tables
-- from ({ players: [{ id, name, provider, model, effort, colour }], seats }), which the homepage lists as "The players".
CREATE TABLE IF NOT EXISTS site_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
