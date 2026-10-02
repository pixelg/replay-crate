ALTER TABLE "tracks" ADD COLUMN "recording_of" text;--> statement-breakpoint
ALTER TABLE "plays" ADD COLUMN "played_track_id" text;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_recording_of_tracks_id_fk" FOREIGN KEY ("recording_of") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plays" ADD CONSTRAINT "plays_played_track_id_tracks_id_fk" FOREIGN KEY ("played_track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracks_isrc_idx" ON "tracks" USING btree ("isrc");--> statement-breakpoint
CREATE INDEX "tracks_recording_of_idx" ON "tracks" USING btree ("recording_of");--> statement-breakpoint

-- Copies of one recording (the same ISRC on another release: single, album, deluxe, remaster)
-- count as one track. The canonical copy keeps the plays and ratings; the others point to it with
-- recording_of. Spotify reports whichever copy played, so new plays and ratings of a copy are
-- moved onto the canonical track as they arrive (triggers below), and upsertCatalog() calls
-- merge_recordings() for the ISRCs of the tracks it adds.

-- The track that stands for `id`'s recording: its canonical copy, or itself.
CREATE OR REPLACE FUNCTION track_recording(id text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT recording_of FROM tracks WHERE tracks.id = track_recording.id), track_recording.id)
$$;--> statement-breakpoint

-- Groups the copies of each recording in `isrcs`: picks the canonical copy (the one that already
-- is, else the most played, else the first seen), points the others at it, and moves their plays
-- (keeping the copy Spotify reported in played_track_id) and ratings (the latest wins) onto it.
CREATE OR REPLACE FUNCTION merge_recordings(isrcs text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  WITH copies AS (
    SELECT * FROM tracks WHERE isrc IN (SELECT isrc FROM tracks WHERE isrc = ANY(isrcs) GROUP BY isrc HAVING count(*) > 1)
  ), played AS (
    SELECT track_id, count(*) AS n FROM plays WHERE track_id IN (SELECT id FROM copies) GROUP BY track_id
  ), ranked AS (
    SELECT t.isrc, t.id, row_number() OVER (
      PARTITION BY t.isrc
      ORDER BY (t.recording_of IS NULL AND EXISTS (SELECT 1 FROM copies c WHERE c.recording_of = t.id)) DESC,
        coalesce(played.n, 0) DESC,
        t.created_at, t.id
    ) AS rank
    FROM copies t LEFT JOIN played ON played.track_id = t.id
  ), canonical AS (
    SELECT isrc, id FROM ranked WHERE rank = 1
      AND EXISTS (SELECT 1 FROM ranked other WHERE other.isrc = ranked.isrc AND other.rank > 1)
  )
  UPDATE tracks t
  SET recording_of = CASE WHEN t.id = canonical.id THEN NULL ELSE canonical.id END
  FROM canonical
  WHERE t.isrc = canonical.isrc
    AND t.recording_of IS DISTINCT FROM (CASE WHEN t.id = canonical.id THEN NULL ELSE canonical.id END);

  -- Plays: the search documents of both tracks change, and each play's own.
  WITH moved AS (
    UPDATE plays p
    SET played_track_id = coalesce(p.played_track_id, p.track_id), track_id = t.recording_of
    FROM tracks t
    WHERE t.id = p.track_id AND t.recording_of IS NOT NULL AND t.isrc = ANY(isrcs)
    RETURNING p.id, p.user_id, p.track_id, p.played_track_id
  )
  INSERT INTO search_outbox (user_id, kind, ref)
  SELECT user_id, 'track', track_id FROM moved
  UNION SELECT user_id, 'track', played_track_id FROM moved
  UNION SELECT user_id, 'play', id::text FROM moved
  ON CONFLICT DO NOTHING;

  -- Ratings: each user's latest rating of the recording, on the canonical copy.
  INSERT INTO track_ratings (user_id, track_id, rating, created_at, updated_at)
  SELECT DISTINCT ON (r.user_id, t.recording_of) r.user_id, t.recording_of, r.rating, r.created_at, r.updated_at
  FROM track_ratings r JOIN tracks t ON t.id = r.track_id
  WHERE t.recording_of IS NOT NULL AND t.isrc = ANY(isrcs)
  ORDER BY r.user_id, t.recording_of, r.updated_at DESC
  ON CONFLICT (user_id, track_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at
  WHERE excluded.updated_at > track_ratings.updated_at;
  DELETE FROM track_ratings r USING tracks t
  WHERE t.id = r.track_id AND t.recording_of IS NOT NULL AND t.isrc = ANY(isrcs);
END $$;--> statement-breakpoint

-- New plays and ratings of a copy land on the canonical track.
CREATE OR REPLACE FUNCTION plays_to_recording() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  canonical text := (SELECT recording_of FROM tracks WHERE id = NEW.track_id);
BEGIN
  IF canonical IS NOT NULL THEN
    NEW.played_track_id := coalesce(NEW.played_track_id, NEW.track_id);
    NEW.track_id := canonical;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER plays_to_recording BEFORE INSERT ON plays FOR EACH ROW EXECUTE FUNCTION plays_to_recording();--> statement-breakpoint
CREATE OR REPLACE FUNCTION track_ratings_to_recording() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.track_id := track_recording(NEW.track_id);
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER track_ratings_to_recording BEFORE INSERT ON track_ratings FOR EACH ROW EXECUTE FUNCTION track_ratings_to_recording();--> statement-breakpoint

-- Merge what's already there.
SELECT merge_recordings(array_agg(DISTINCT isrc)) FROM tracks WHERE isrc IS NOT NULL;
