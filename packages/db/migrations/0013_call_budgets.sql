CREATE TABLE "call_budgets" (
	"name" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"refilled_at" timestamp with time zone NOT NULL,
	"paused_until" timestamp with time zone
);
