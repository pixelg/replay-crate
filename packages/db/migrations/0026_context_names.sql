-- `contexts` caches a play context's name and image, looked up once per URI. Playlists, albums
-- and artists are also kept in their own tables, which syncs refresh: when one of those changes
-- (a playlist renamed on Spotify), its context follows, and search documents with it (the
-- search_contexts_update trigger). An image only replaces one: artists rarely carry their own.

-- TG_ARGV[0] is the URI prefix, e.g. 'spotify:playlist:'.
CREATE OR REPLACE FUNCTION contexts_follow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE contexts
  SET name = NEW.name, image_url = coalesce(NEW.image_url, contexts.image_url), resolved_at = now()
  WHERE uri = TG_ARGV[0] || NEW.id
    AND (contexts.name IS DISTINCT FROM NEW.name
      OR (NEW.image_url IS NOT NULL AND contexts.image_url IS DISTINCT FROM NEW.image_url));
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER contexts_follow_playlists AFTER INSERT OR UPDATE OF name, image_url ON playlists
  FOR EACH ROW EXECUTE FUNCTION contexts_follow('spotify:playlist:');--> statement-breakpoint
CREATE TRIGGER contexts_follow_albums AFTER INSERT OR UPDATE OF name, image_url ON albums
  FOR EACH ROW EXECUTE FUNCTION contexts_follow('spotify:album:');--> statement-breakpoint
CREATE TRIGGER contexts_follow_artists AFTER INSERT OR UPDATE OF name, image_url ON artists
  FOR EACH ROW EXECUTE FUNCTION contexts_follow('spotify:artist:');--> statement-breakpoint

-- Bring what's cached up to date.
UPDATE contexts c
SET name = src.name, image_url = coalesce(src.image_url, c.image_url), resolved_at = now()
FROM (
  SELECT 'spotify:playlist:' || id AS uri, name, image_url FROM playlists
  UNION ALL SELECT 'spotify:album:' || id, name, image_url FROM albums
  UNION ALL SELECT 'spotify:artist:' || id, name, image_url FROM artists
) src
WHERE c.uri = src.uri
  AND (c.name IS DISTINCT FROM src.name OR (src.image_url IS NOT NULL AND c.image_url IS DISTINCT FROM src.image_url));
