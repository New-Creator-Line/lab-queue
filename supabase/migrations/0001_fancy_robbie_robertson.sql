CREATE TABLE "telegram_auth_challenges" (
	"token" text PRIMARY KEY NOT NULL,
	"telegram_id" text,
	"first_name" text,
	"last_name" text,
	"username" text,
	"expires_at" integer NOT NULL,
	"consumed_at" integer,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telegram_auth_challenges_expires_idx" ON "telegram_auth_challenges" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "telegram_auth_challenges" ENABLE ROW LEVEL SECURITY;
