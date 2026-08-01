import bcrypt from "bcryptjs";
import { count } from "drizzle-orm";
import type { Db } from "../../db/client";
import { users } from "../../db/schema";
import type { Env } from "../../config/env";

/** Creates the first admin account from env vars if the users table is empty. */
export async function bootstrapAdmin(db: Db, env: Env) {
  const [{ value: userCount }] = db.select({ value: count() }).from(users).all();
  if (userCount > 0) {
    return;
  }

  // Trimmed: a trailing space in .env (easy to leave, impossible to see)
  // would otherwise be baked into the username and reject every login.
  const username = env.ADMIN_USERNAME.trim();
  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
  db.insert(users).values({ username, passwordHash, role: "admin" }).run();

  // eslint-disable-next-line no-console
  console.log(`Created initial admin user "${username}"`);
}
