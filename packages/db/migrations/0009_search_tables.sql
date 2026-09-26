CREATE TABLE "search_docs" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"artists" text[] DEFAULT '{}' NOT NULL,
	"album" text,
	"playlists" text[] DEFAULT '{}' NOT NULL,
	"contexts" text[] DEFAULT '{}' NOT NULL,
	"year" smallint,
	"play_count" integer DEFAULT 0 NOT NULL,
	"rating" smallint,
	"last_played_at" timestamp with time zone,
	"played_at" timestamp with time zone,
	"image_url" text,
	"track_id" text,
	"search_text" text NOT NULL,
	CONSTRAINT "search_docs_user_id_type_id_pk" PRIMARY KEY("user_id","type","id")
);
--> statement-breakpoint
CREATE TABLE "search_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "search_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_outbox_key" UNIQUE NULLS NOT DISTINCT("user_id","kind","ref")
);
--> statement-breakpoint
CREATE INDEX "search_docs_text_idx" ON "search_docs" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_outbox_due_idx" ON "search_outbox" USING btree ("run_after");