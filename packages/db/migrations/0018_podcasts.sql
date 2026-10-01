CREATE TABLE "episode_listens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "episode_listens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"start_position_ms" integer,
	"end_position_ms" integer,
	"listened_ms" integer NOT NULL,
	"context_uri" text,
	"source" "play_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_listens_user_episode_started_key" UNIQUE("user_id","episode_id","started_at")
);
--> statement-breakpoint
CREATE TABLE "episode_progress" (
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"fully_played" boolean DEFAULT false NOT NULL,
	"resume_position_ms" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_progress_user_id_episode_id_pk" PRIMARY KEY("user_id","episode_id")
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"show_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_ms" integer NOT NULL,
	"release_date" text,
	"explicit" boolean DEFAULT false NOT NULL,
	"image_url" text,
	"thumb_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_watch" (
	"user_id" text PRIMARY KEY NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"episode_id" text
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"thumb_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_listens" ADD CONSTRAINT "episode_listens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_listens" ADD CONSTRAINT "episode_listens_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_progress" ADD CONSTRAINT "episode_progress_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_watch" ADD CONSTRAINT "player_watch_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_listens_user_ended_idx" ON "episode_listens" USING btree ("user_id","ended_at");--> statement-breakpoint
CREATE INDEX "episode_listens_user_episode_idx" ON "episode_listens" USING btree ("user_id","episode_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "episodes_show_release_idx" ON "episodes" USING btree ("show_id","release_date");