CREATE TABLE "sync_gaps" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_gaps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"after" timestamp with time zone NOT NULL,
	"before" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filled_at" timestamp with time zone,
	CONSTRAINT "sync_gaps_user_after_key" UNIQUE("user_id","after")
);
--> statement-breakpoint
ALTER TABLE "sync_gaps" ADD CONSTRAINT "sync_gaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;