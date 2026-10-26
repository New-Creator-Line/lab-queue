import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = (name = "created_at") =>
  timestamp(name, { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`);

export const users = pgTable(
  "users",
  {
    telegramId: text("telegram_id").primaryKey(),
    username: text("username"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    displayName: text("display_name").notNull(),
    photoUrl: text("photo_url"),
    subgroup: integer("subgroup"),
    rotationOrder: integer("rotation_order"),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("users_subgroup_rotation_unique").on(
      table.subgroup,
      table.rotationOrder,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    telegramId: text("telegram_id")
      .notNull()
      .references(() => users.telegramId, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("sessions_user_idx").on(table.telegramId)],
);

export const telegramAuthChallenges = pgTable(
  "telegram_auth_challenges",
  {
    token: text("token").primaryKey(),
    telegramId: text("telegram_id"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    username: text("username"),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: createdAt(),
  },
  (table) => [index("telegram_auth_challenges_expires_idx").on(table.expiresAt)],
);

export const queues = pgTable(
  "queues",
  {
    id: serial("id").primaryKey(),
    subjectKey: text("subject_key").notNull(),
    subjectName: text("subject_name").notNull(),
    subjectAbbrev: text("subject_abbrev").notNull(),
    subgroup: integer("subgroup").notNull(),
    lessonEndsAt: timestamp("lesson_ends_at", {
      withTimezone: true,
      mode: "string",
    }),
    currentCycle: integer("current_cycle").notNull().default(1),
    status: text("status").notNull().default("open"),
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("queues_subject_subgroup_lesson_unique").on(
      table.subjectKey,
      table.subgroup,
      table.lessonEndsAt,
    ),
  ],
);

export const queueEntries = pgTable(
  "queue_entries",
  {
    id: serial("id").primaryKey(),
    queueId: integer("queue_id")
      .notNull()
      .references(() => queues.id, { onDelete: "cascade" }),
    cycle: integer("cycle").notNull(),
    telegramId: text("telegram_id")
      .notNull()
      .references(() => users.telegramId, { onDelete: "cascade" }),
    brigadeId: integer("brigade_id").references(() => brigades.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("waiting"),
    joinedAt: createdAt("joined_at"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    uniqueIndex("queue_entries_cycle_user_unique").on(
      table.queueId,
      table.cycle,
      table.telegramId,
    ),
    index("queue_entries_current_idx").on(table.queueId, table.cycle),
    index("queue_entries_brigade_idx").on(table.brigadeId),
  ],
);

export const subjectSettings = pgTable(
  "subject_settings",
  {
    subjectKey: text("subject_key").primaryKey(),
    hasBrigades: boolean("has_brigades").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
);

export const brigades = pgTable(
  "brigades",
  {
    id: serial("id").primaryKey(),
    subjectKey: text("subject_key").notNull(),
    subgroup: integer("subgroup").notNull(),
    name: text("name").notNull(),
    leaderTelegramId: text("leader_telegram_id")
      .notNull()
      .references(() => users.telegramId, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("brigades_subject_subgroup_idx").on(table.subjectKey, table.subgroup),
    index("brigades_leader_idx").on(table.leaderTelegramId),
  ],
);

export const brigadeMembers = pgTable(
  "brigade_members",
  {
    id: serial("id").primaryKey(),
    brigadeId: integer("brigade_id")
      .notNull()
      .references(() => brigades.id, { onDelete: "cascade" }),
    subjectKey: text("subject_key").notNull(),
    telegramId: text("telegram_id")
      .notNull()
      .references(() => users.telegramId, { onDelete: "cascade" }),
    joinedAt: createdAt("joined_at"),
  },
  (table) => [
    uniqueIndex("brigade_members_subject_user_unique").on(
      table.subjectKey,
      table.telegramId,
    ),
    index("brigade_members_brigade_idx").on(table.brigadeId),
  ],
);

export const queuePasses = pgTable(
  "queue_passes",
  {
    id: serial("id").primaryKey(),
    queueId: integer("queue_id")
      .notNull()
      .references(() => queues.id, { onDelete: "cascade" }),
    cycle: integer("cycle").notNull(),
    passerTelegramId: text("passer_telegram_id")
      .notNull()
      .references(() => users.telegramId, { onDelete: "cascade" }),
    promotedTelegramId: text("promoted_telegram_id")
      .notNull()
      .references(() => users.telegramId, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [index("queue_passes_cycle_idx").on(table.queueId, table.cycle)],
);

export const rotations = pgTable(
  "rotations",
  {
    subjectKey: text("subject_key").notNull(),
    subgroup: integer("subgroup").notNull(),
    lastServedTelegramId: text("last_served_telegram_id").references(
      () => users.telegramId,
      { onDelete: "set null" },
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.subjectKey, table.subgroup] })],
);
