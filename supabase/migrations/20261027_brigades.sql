CREATE TABLE IF NOT EXISTS "subject_settings" (
  "subject_key" text PRIMARY KEY NOT NULL,
  "has_brigades" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "brigades" (
  "id" serial PRIMARY KEY NOT NULL,
  "subject_key" text NOT NULL,
  "subgroup" integer NOT NULL,
  "name" text NOT NULL,
  "leader_telegram_id" text NOT NULL REFERENCES "users"("telegram_id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "brigade_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "brigade_id" integer NOT NULL REFERENCES "brigades"("id") ON DELETE cascade,
  "subject_key" text NOT NULL,
  "telegram_id" text NOT NULL REFERENCES "users"("telegram_id") ON DELETE cascade,
  "joined_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE "queue_entries" ADD COLUMN IF NOT EXISTS "brigade_id" integer REFERENCES "brigades"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "brigades_subject_subgroup_idx" ON "brigades" USING btree ("subject_key", "subgroup");
CREATE INDEX IF NOT EXISTS "brigades_leader_idx" ON "brigades" USING btree ("leader_telegram_id");
CREATE UNIQUE INDEX IF NOT EXISTS "brigade_members_subject_user_unique" ON "brigade_members" USING btree ("subject_key", "telegram_id");
CREATE INDEX IF NOT EXISTS "brigade_members_brigade_idx" ON "brigade_members" USING btree ("brigade_id");
CREATE INDEX IF NOT EXISTS "queue_entries_brigade_idx" ON "queue_entries" USING btree ("brigade_id");

ALTER TABLE "subject_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brigades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brigade_members" ENABLE ROW LEVEL SECURITY;
