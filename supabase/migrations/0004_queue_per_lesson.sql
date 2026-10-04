DROP INDEX IF EXISTS "queues_subject_subgroup_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "queues_subject_subgroup_lesson_unique"
ON "queues" USING btree ("subject_key", "subgroup", "lesson_ends_at");
