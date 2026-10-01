CREATE TABLE "playlist_episodes" (
	"playlist_id" text NOT NULL,
	"position" integer NOT NULL,
	"episode_id" text NOT NULL,
	"added_at" timestamp with time zone,
	"added_by" text,
	CONSTRAINT "playlist_episodes_playlist_id_position_pk" PRIMARY KEY("playlist_id","position")
);
--> statement-breakpoint
ALTER TABLE "playlist_episodes" ADD CONSTRAINT "playlist_episodes_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_episodes" ADD CONSTRAINT "playlist_episodes_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playlist_episodes_episode_idx" ON "playlist_episodes" USING btree ("episode_id");--> statement-breakpoint
-- Playlists synced before episodes were kept hold fewer items than Spotify lists: fetch them again.
UPDATE "playlists" SET "items_snapshot_id" = NULL
WHERE "item_count" > (SELECT count(*) FROM "playlist_items" WHERE "playlist_items"."playlist_id" = "playlists"."id");
