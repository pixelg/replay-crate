CREATE TABLE "import_listens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_listens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"ms_played" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "listen_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "listens_unavailable" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_listens" ADD CONSTRAINT "import_listens_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_listens" ADD CONSTRAINT "import_listens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_listens_episode_idx" ON "import_listens" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "import_listens_import_idx" ON "import_listens" USING btree ("import_id");