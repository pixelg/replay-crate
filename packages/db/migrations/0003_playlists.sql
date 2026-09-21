CREATE TABLE "playlist_items" (
	"playlist_id" text NOT NULL,
	"position" integer NOT NULL,
	"track_id" text NOT NULL,
	"added_at" timestamp with time zone,
	"added_by" text,
	CONSTRAINT "playlist_items_playlist_id_position_pk" PRIMARY KEY("playlist_id","position")
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"owner_name" text,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"thumb_url" text,
	"is_public" boolean,
	"collaborative" boolean DEFAULT false NOT NULL,
	"snapshot_id" text NOT NULL,
	"items_snapshot_id" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_by_app" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_playlists" (
	"user_id" text NOT NULL,
	"playlist_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "user_playlists_user_id_playlist_id_pk" PRIMARY KEY("user_id","playlist_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "playlists_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_playlists" ADD CONSTRAINT "user_playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_playlists" ADD CONSTRAINT "user_playlists_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playlist_items_track_idx" ON "playlist_items" USING btree ("track_id");