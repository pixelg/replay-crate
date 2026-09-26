CREATE TABLE "track_ratings" (
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"rating" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_ratings_user_id_track_id_pk" PRIMARY KEY("user_id","track_id"),
	CONSTRAINT "track_ratings_rating_range" CHECK ("track_ratings"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "track_ratings" ADD CONSTRAINT "track_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_ratings" ADD CONSTRAINT "track_ratings_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_ratings_user_rating_idx" ON "track_ratings" USING btree ("user_id","rating");