ALTER TABLE "search_docs" ADD COLUMN "genres" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- An artist's genres, like its name, are repeated in its tracks', albums' and plays' documents:
-- a change rebuilds them all (see `artist-name` in apps/api/src/search/docs.ts).
CREATE TRIGGER search_artist_genres AFTER INSERT OR UPDATE OR DELETE ON artist_genres
  FOR EACH ROW EXECUTE FUNCTION search_enqueue_row('artist-name', 'artist_id');--> statement-breakpoint
-- Genres found before this migration: rebuild those documents too.
INSERT INTO search_outbox (user_id, kind, ref)
SELECT DISTINCT NULL::text, 'artist-name', artist_id FROM artist_genres
ON CONFLICT DO NOTHING;
