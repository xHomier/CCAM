import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function createDb(dbPath: string) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const bootstrapSql = fs.readFileSync(path.join(__dirname, "bootstrap.sql"), "utf-8");
  sqlite.exec(bootstrapSql);

  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;
