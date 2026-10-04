CREATE TABLE "queue_passes" (
	"id" serial PRIMARY KEY NOT NULL,
	"queue_id" integer NOT NULL,
	"cycle" integer NOT NULL,
	"passer_telegram_id" text NOT NULL,
	"promoted_telegram_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue_passes" ADD CONSTRAINT "queue_passes_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_passes" ADD CONSTRAINT "queue_passes_passer_telegram_id_users_telegram_id_fk" FOREIGN KEY ("passer_telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_passes" ADD CONSTRAINT "queue_passes_promoted_telegram_id_users_telegram_id_fk" FOREIGN KEY ("promoted_telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_passes_cycle_idx" ON "queue_passes" USING btree ("queue_id","cycle");
--> statement-breakpoint
ALTER TABLE "queue_passes" ENABLE ROW LEVEL SECURITY;
