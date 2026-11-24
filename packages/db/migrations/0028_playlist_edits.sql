CREATE TABLE "playlist_edits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "playlist_edits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"playlist_id" text NOT NULL,
	"from_position" integer NOT NULL,
	"to_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "playlist_edits" ADD CONSTRAINT "playlist_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_edits" ADD CONSTRAINT "playlist_edits_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playlist_edits_playlist_idx" ON "playlist_edits" USING btree ("playlist_id","id");--> statement-breakpoint
-- Moves the item at `from_pos` so it ends up at `to_pos`, as Spotify's reorder does, across a
-- playlist's tracks and episodes (one list of positions in two tables). Positions are the primary
-- key, so the moved range goes negative first and is flipped back after.
CREATE FUNCTION move_playlist_item(pid text, from_pos integer, to_pos integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  lo integer := least(from_pos, to_pos);
  hi integer := greatest(from_pos, to_pos);
  step integer := CASE WHEN from_pos < to_pos THEN -1 ELSE 1 END;
BEGIN
  UPDATE playlist_items SET position = -1 - (CASE WHEN position = from_pos THEN to_pos ELSE position + step END)
    WHERE playlist_id = pid AND position BETWEEN lo AND hi;
  UPDATE playlist_episodes SET position = -1 - (CASE WHEN position = from_pos THEN to_pos ELSE position + step END)
    WHERE playlist_id = pid AND position BETWEEN lo AND hi;
  UPDATE playlist_items SET position = -1 - position WHERE playlist_id = pid AND position < 0;
  UPDATE playlist_episodes SET position = -1 - position WHERE playlist_id = pid AND position < 0;
END;
$$;
