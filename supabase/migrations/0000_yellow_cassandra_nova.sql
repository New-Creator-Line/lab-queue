CREATE TABLE "queue_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"queue_id" integer NOT NULL,
	"cycle" integer NOT NULL,
	"telegram_id" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "queues" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_key" text NOT NULL,
	"subject_name" text NOT NULL,
	"subject_abbrev" text NOT NULL,
	"subgroup" integer NOT NULL,
	"current_cycle" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rotations" (
	"subject_key" text NOT NULL,
	"subgroup" integer NOT NULL,
	"last_served_telegram_id" text,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "rotations_subject_key_subgroup_pk" PRIMARY KEY("subject_key","subgroup")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"telegram_id" text NOT NULL,
	"expires_at" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotations" ADD CONSTRAINT "rotations_last_served_telegram_id_users_telegram_id_fk" FOREIGN KEY ("last_served_telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "queue_entries_cycle_user_unique" ON "queue_entries" USING btree ("queue_id","cycle","telegram_id");--> statement-breakpoint
CREATE INDEX "queue_entries_current_idx" ON "queue_entries" USING btree ("queue_id","cycle");--> statement-breakpoint
CREATE UNIQUE INDEX "queues_subject_subgroup_unique" ON "queues" USING btree ("subject_key","subgroup");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_subgroup_rotation_unique" ON "users" USING btree ("subgroup","rotation_order");
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "queues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "queue_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rotations" ENABLE ROW LEVEL SECURITY;
