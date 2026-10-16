-- The cost of each model call, in US dollars: the figure the API reported when
-- it reports one (OpenRouter, Perplexity), else the call's tokens priced at the
-- model's list price at the time of the call (public/assets/app/pricing.js, or
-- a price in the runner's config); null when the model has no price on file.
-- cost_source says which: reported or priced.
ALTER TABLE llm_calls ADD COLUMN cost REAL;
ALTER TABLE llm_calls ADD COLUMN cost_source TEXT;
