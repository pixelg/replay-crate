-- Search: trigram matching (typo-tolerant, as-you-type) and accent folding ("beyonce" finds Beyoncé).
-- Both ship with Postgres (and Neon, and PGlite as extensions).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
-- unaccent() is only STABLE (its dictionary could change under it), so it can't back an index;
-- this wrapper pins the dictionary and says IMMUTABLE.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
