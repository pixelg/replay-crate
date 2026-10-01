CREATE TABLE "episode_ratings" (
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"rating" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_ratings_user_id_episode_id_pk" PRIMARY KEY("user_id","episode_id"),
	CONSTRAINT "episode_ratings_rating_range" CHECK ("episode_ratings"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "episode_ratings" ADD CONSTRAINT "episode_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_ratings" ADD CONSTRAINT "episode_ratings_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_ratings_user_rating_idx" ON "episode_ratings" USING btree ("user_id","rating");