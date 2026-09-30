CREATE TABLE "artist_genres" (
	"artist_id" text NOT NULL,
	"genre_id" integer NOT NULL,
	"weight" integer NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "artist_genres_artist_id_genre_id_pk" PRIMARY KEY("artist_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "genres_name_unique" UNIQUE("name"),
	CONSTRAINT "genres_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "mbid" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "genres_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artist_genres" ADD CONSTRAINT "artist_genres_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_genres" ADD CONSTRAINT "artist_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artist_genres_genre_idx" ON "artist_genres" USING btree ("genre_id");