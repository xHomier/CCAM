import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const cameras = sqliteTable("cameras", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  host: text("host").notNull(),
  rtspPort: integer("rtsp_port").notNull().default(554),
  httpPort: integer("http_port").notNull().default(80),
  username: text("username").notNull(),
  password: text("password").notNull(),
  channel: integer("channel").notNull().default(0),
  continuousStream: text("continuous_stream", { enum: ["sub", "main"] })
    .notNull()
    .default("sub"),
  // JSON-encoded string array, e.g. ["person","vehicle","pet"]
  aiTypesEnabled: text("ai_types_enabled").notNull().default('["person","vehicle","pet"]'),
  pollIntervalMs: integer("poll_interval_ms").notNull().default(1500),
  eventCooldownMs: integer("event_cooldown_ms").notNull().default(30000),
  retentionDays: integer("retention_days").notNull().default(14),
  eventRetentionDays: integer("event_retention_days").notNull().default(30),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cameraId: integer("camera_id")
    .notNull()
    .references(() => cameras.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["person", "vehicle", "pet", "motion"] }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  clipPath: text("clip_path"),
  thumbnailPath: text("thumbnail_path"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Camera = typeof cameras.$inferSelect;
export type NewCamera = typeof cameras.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
