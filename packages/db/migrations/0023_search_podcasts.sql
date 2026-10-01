-- Podcasts in the search index (see 0010_search_triggers): shows and episodes are documents too,
-- kept in step by the same outbox. Listens change their episode's and show's documents; ratings
-- and playlists their episode's; following a show its own; renames everything that repeats them.

-- Listens: inserted by the hundred thousand on import, so per statement; updated as a polled listen grows.
CREATE OR REPLACE FUNCTION search_enqueue_new_listens() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_outbox (user_id, kind, ref)
  SELECT DISTINCT user_id, 'episode', episode_id FROM new_listens
  UNION SELECT DISTINCT l.user_id, 'show', e.show_id FROM new_listens l JOIN episodes e ON e.id = l.episode_id
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION search_enqueue_old_listens() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_outbox (user_id, kind, ref)
  SELECT DISTINCT user_id, 'episode', episode_id FROM old_listens
  UNION SELECT DISTINCT l.user_id, 'show', e.show_id FROM old_listens l JOIN episodes e ON e.id = l.episode_id
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION search_enqueue_new_playlist_episodes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_outbox (user_id, kind, ref)
  SELECT DISTINCT NULL::text, 'playlist', playlist_id FROM new_items
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint
-- Removed episodes may leave a library, so they're rebuilt too.
CREATE OR REPLACE FUNCTION search_enqueue_old_playlist_episodes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_outbox (user_id, kind, ref)
  SELECT NULL::text, 'playlist', playlist_id FROM old_items
  UNION SELECT NULL::text, 'episode', episode_id FROM old_items
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;--> statement-breakpoint

CREATE TRIGGER search_episode_listens_insert AFTER INSERT ON episode_listens
  REFERENCING NEW TABLE AS new_listens FOR EACH STATEMENT EXECUTE FUNCTION search_enqueue_new_listens();--> statement-breakpoint
CREATE TRIGGER search_episode_listens_delete AFTER DELETE ON episode_listens
  REFERENCING OLD TABLE AS old_listens FOR EACH STATEMENT EXECUTE FUNCTION search_enqueue_old_listens();--> statement-breakpoint
CREATE TRIGGER search_episode_listens_update AFTER UPDATE ON episode_listens FOR EACH ROW
  WHEN (OLD.ended_at IS DISTINCT FROM NEW.ended_at)
  EXECUTE FUNCTION search_enqueue_row('episode', 'episode_id', 'user_id');--> statement-breakpoint
CREATE TRIGGER search_playlist_episodes_insert AFTER INSERT ON playlist_episodes
  REFERENCING NEW TABLE AS new_items FOR EACH STATEMENT EXECUTE FUNCTION search_enqueue_new_playlist_episodes();--> statement-breakpoint
CREATE TRIGGER search_playlist_episodes_delete AFTER DELETE ON playlist_episodes
  REFERENCING OLD TABLE AS old_items FOR EACH STATEMENT EXECUTE FUNCTION search_enqueue_old_playlist_episodes();--> statement-breakpoint

-- Per user.
CREATE TRIGGER search_episode_ratings AFTER INSERT OR UPDATE OR DELETE ON episode_ratings
  FOR EACH ROW EXECUTE FUNCTION search_enqueue_row('episode', 'episode_id', 'user_id');--> statement-breakpoint
CREATE TRIGGER search_user_shows AFTER INSERT OR DELETE ON user_shows
  FOR EACH ROW EXECUTE FUNCTION search_enqueue_row('show', 'show_id', 'user_id');--> statement-breakpoint

-- The shared catalog: only changes to what a document shows count (every lookup upserts it).
CREATE TRIGGER search_episodes AFTER UPDATE ON episodes FOR EACH ROW
  WHEN ((OLD.name, OLD.show_id, OLD.release_date, OLD.thumb_url) IS DISTINCT FROM (NEW.name, NEW.show_id, NEW.release_date, NEW.thumb_url))
  EXECUTE FUNCTION search_enqueue_row('episode', 'id');--> statement-breakpoint
CREATE TRIGGER search_shows AFTER UPDATE ON shows FOR EACH ROW
  WHEN ((OLD.name, OLD.thumb_url) IS DISTINCT FROM (NEW.name, NEW.thumb_url))
  EXECUTE FUNCTION search_enqueue_row('show-name', 'id');--> statement-breakpoint

-- What's already there.
INSERT INTO search_outbox (user_id, kind, ref)
SELECT DISTINCT user_id, 'episode', episode_id FROM episode_listens
UNION SELECT user_id, 'episode', episode_id FROM episode_ratings
UNION SELECT DISTINCT l.user_id, 'show', e.show_id FROM episode_listens l JOIN episodes e ON e.id = l.episode_id
UNION SELECT user_id, 'show', show_id FROM user_shows
UNION SELECT DISTINCT up.user_id, 'episode', pe.episode_id FROM playlist_episodes pe JOIN user_playlists up ON up.playlist_id = pe.playlist_id
ON CONFLICT DO NOTHING;
