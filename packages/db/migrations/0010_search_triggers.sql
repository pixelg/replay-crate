-- Keep the search index in step with the data: every change that could alter a search document
-- records what changed in search_outbox, and the API's indexer rebuilds those documents from SQL.
-- Triggers rather than calls in app code, so nothing slips past: bulk imports (raw SQL), playlist
-- resyncs, cascades and hand edits in psql all land here. A row with no user_id is a catalog
-- change the indexer fans out to every library that holds the thing.

-- Row triggers: TG_ARGV is (kind, ref column, user column). No user column means "everyone".
CREATE OR REPLACE FUNCTION search_enqueue_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  changed jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
BEGIN
  INSERT INTO search_outbox (user_id, kind, ref)
  VALUES (CASE WHEN TG_NARGS > 2 THEN changed ->> TG_ARGV[2] END, TG_ARGV[0], changed ->> TG_ARGV[1])
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint

-- Statement triggers for the tables that change in bulk (an import inserts plays by the
-- hundred thousand; a playlist resync replaces all its items): one insert per statement.
CREATE OR REPLACE FUNCTION search_enqueue_new_plays() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_outbox (user_id, kind, ref)
  SELECT user_id, 'track', track_id FROM new_plays
  UNION SELECT user_id, 'play', id::text FROM new_plays
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION search_enqueue_old_plays() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_outbox (user_id, kind, ref)
  SELECT user_id, 'track', track_id FROM old_plays
  UNION SELECT user_id, 'play', id::text FROM old_plays
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION search_enqueue_new_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_outbox (user_id, kind, ref)
  SELECT DISTINCT NULL::text, 'playlist', playlist_id FROM new_items
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint
-- Removed tracks may leave a library (or at least a playlist), so they're rebuilt too.
CREATE OR REPLACE FUNCTION search_enqueue_old_items() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_outbox (user_id, kind, ref)
  SELECT NULL::text, 'playlist', playlist_id FROM old_items
  UNION SELECT NULL::text, 'track', track_id FROM old_items
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint

CREATE TRIGGER search_plays_insert AFTER INSERT ON plays
  REFERENCING NEW TABLE AS new_plays FOR EACH STATEMENT EXECUTE FUNCTION search_enqueue_new_plays();--> statement-breakpoint
CREATE TRIGGER search_plays_delete AFTER DELETE ON plays
  REFERENCING OLD TABLE AS old_plays FOR EACH STATEMENT EXECUTE FUNCTION search_enqueue_old_plays();--> statement-breakpoint
CREATE TRIGGER search_playlist_items_insert AFTER INSERT ON playlist_items
  REFERENCING NEW TABLE AS new_items FOR EACH STATEMENT EXECUTE FUNCTION search_enqueue_new_items();--> statement-breakpoint
CREATE TRIGGER search_playlist_items_delete AFTER DELETE ON playlist_items
  REFERENCING OLD TABLE AS old_items FOR EACH STATEMENT EXECUTE FUNCTION search_enqueue_old_items();--> statement-breakpoint

-- Per user.
CREATE TRIGGER search_track_ratings AFTER INSERT OR UPDATE OR DELETE ON track_ratings
  FOR EACH ROW EXECUTE FUNCTION search_enqueue_row('track', 'track_id', 'user_id');--> statement-breakpoint
CREATE TRIGGER search_user_playlists AFTER INSERT OR DELETE ON user_playlists
  FOR EACH ROW EXECUTE FUNCTION search_enqueue_row('playlist', 'playlist_id', 'user_id');--> statement-breakpoint

-- The shared catalog. Every sync upserts it, touching updated_at, so only real changes to what
-- a document shows count. A *-name kind means the name (or what's shown with it) changed, so
-- the documents that repeat it (tracks, plays) are rebuilt too; the plain kind rebuilds only the
-- thing's own document.
CREATE TRIGGER search_tracks AFTER UPDATE ON tracks FOR EACH ROW
  WHEN ((OLD.name, OLD.album_id) IS DISTINCT FROM (NEW.name, NEW.album_id))
  EXECUTE FUNCTION search_enqueue_row('track-name', 'id');--> statement-breakpoint
CREATE TRIGGER search_track_artists AFTER INSERT OR DELETE ON track_artists
  FOR EACH ROW EXECUTE FUNCTION search_enqueue_row('track', 'track_id');--> statement-breakpoint
CREATE TRIGGER search_artist_names AFTER UPDATE ON artists FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION search_enqueue_row('artist-name', 'id');--> statement-breakpoint
CREATE TRIGGER search_artist_images AFTER UPDATE ON artists FOR EACH ROW
  WHEN (OLD.image_url IS DISTINCT FROM NEW.image_url)
  EXECUTE FUNCTION search_enqueue_row('artist', 'id');--> statement-breakpoint
CREATE TRIGGER search_albums AFTER UPDATE ON albums FOR EACH ROW
  WHEN ((OLD.name, OLD.release_date, OLD.thumb_url) IS DISTINCT FROM (NEW.name, NEW.release_date, NEW.thumb_url))
  EXECUTE FUNCTION search_enqueue_row('album-name', 'id');--> statement-breakpoint
CREATE TRIGGER search_album_artists AFTER INSERT OR DELETE ON album_artists
  FOR EACH ROW EXECUTE FUNCTION search_enqueue_row('album', 'album_id');--> statement-breakpoint
CREATE TRIGGER search_playlists AFTER UPDATE ON playlists FOR EACH ROW
  WHEN ((OLD.name, OLD.owner_name, OLD.description, OLD.thumb_url) IS DISTINCT FROM (NEW.name, NEW.owner_name, NEW.description, NEW.thumb_url))
  EXECUTE FUNCTION search_enqueue_row('playlist', 'id');--> statement-breakpoint
CREATE TRIGGER search_contexts_insert AFTER INSERT ON contexts FOR EACH ROW
  WHEN (NEW.name IS NOT NULL)
  EXECUTE FUNCTION search_enqueue_row('context', 'uri');--> statement-breakpoint
CREATE TRIGGER search_contexts_update AFTER UPDATE ON contexts FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION search_enqueue_row('context', 'uri');--> statement-breakpoint

-- What's already there: every library entity, once.
INSERT INTO search_outbox (user_id, kind, ref)
SELECT DISTINCT user_id, 'track', track_id FROM plays
UNION SELECT user_id, 'track', track_id FROM track_ratings
UNION SELECT user_id, 'playlist', playlist_id FROM user_playlists
UNION SELECT user_id, 'play', id::text FROM plays
ON CONFLICT DO NOTHING;
