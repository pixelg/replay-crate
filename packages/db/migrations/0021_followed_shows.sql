CREATE TABLE "user_shows" (
	"user_id" text NOT NULL,
	"show_id" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_shows_user_id_show_id_pk" PRIMARY KEY("user_id","show_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "shows_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "episodes_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_shows" ADD CONSTRAINT "user_shows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_shows" ADD CONSTRAINT "user_shows_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE no action ON UPDATE no action;