-- Очередь 420604: полная схема для нового пустого проекта Supabase.
-- Запустите этот файл один раз через Supabase -> SQL Editor.

CREATE TABLE "users" (
  "telegram_id" text PRIMARY KEY NOT NULL,
  "username" text,
  "first_name" text NOT NULL,
  "last_name" text,
  "display_name" text NOT NULL,
  "photo_url" text,
  "subgroup" integer,
  "rotation_order" integer,
  "is_admin" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "sessions" (
  "token" text PRIMARY KEY NOT NULL,
  "telegram_id" text NOT NULL REFERENCES "users"("telegram_id") ON DELETE cascade,
  "expires_at" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

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

CREATE TABLE "queues" (
  "id" serial PRIMARY KEY NOT NULL,
  "subject_key" text NOT NULL,
  "subject_name" text NOT NULL,
  "subject_abbrev" text NOT NULL,
  "subgroup" integer NOT NULL,
  "lesson_ends_at" timestamp with time zone,
  "current_cycle" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "closed_at" timestamp with time zone
);

CREATE TABLE "queue_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "queue_id" integer NOT NULL REFERENCES "queues"("id") ON DELETE cascade,
  "cycle" integer NOT NULL,
  "telegram_id" text NOT NULL REFERENCES "users"("telegram_id") ON DELETE cascade,
  "status" text DEFAULT 'waiting' NOT NULL,
  "joined_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE TABLE "queue_passes" (
  "id" serial PRIMARY KEY NOT NULL,
  "queue_id" integer NOT NULL REFERENCES "queues"("id") ON DELETE cascade,
  "cycle" integer NOT NULL,
  "passer_telegram_id" text NOT NULL REFERENCES "users"("telegram_id") ON DELETE cascade,
  "promoted_telegram_id" text NOT NULL REFERENCES "users"("telegram_id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "rotations" (
  "subject_key" text NOT NULL,
  "subgroup" integer NOT NULL,
  "last_served_telegram_id" text REFERENCES "users"("telegram_id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "rotations_subject_key_subgroup_pk" PRIMARY KEY ("subject_key", "subgroup")
);

CREATE UNIQUE INDEX "users_subgroup_rotation_unique"
  ON "users" USING btree ("subgroup", "rotation_order");
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("telegram_id");
CREATE INDEX "telegram_auth_challenges_expires_idx"
  ON "telegram_auth_challenges" USING btree ("expires_at");
CREATE UNIQUE INDEX "queues_subject_subgroup_lesson_unique"
  ON "queues" USING btree ("subject_key", "subgroup", "lesson_ends_at");
CREATE UNIQUE INDEX "queue_entries_cycle_user_unique"
  ON "queue_entries" USING btree ("queue_id", "cycle", "telegram_id");
CREATE INDEX "queue_entries_current_idx"
  ON "queue_entries" USING btree ("queue_id", "cycle");
CREATE INDEX "queue_passes_cycle_idx"
  ON "queue_passes" USING btree ("queue_id", "cycle");

-- Приложение обращается к PostgreSQL только с сервера Vercel по DATABASE_URL.
-- RLS без публичных политик блокирует прямой доступ к таблицам через Data API.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telegram_auth_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "queues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "queue_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "queue_passes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rotations" ENABLE ROW LEVEL SECURITY;
