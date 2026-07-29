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

  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
  db.insert(users)
    .values({ username: env.ADMIN_USERNAME, passwordHash, role: "admin" })
    .run();

  // eslint-disable-next-line no-console
  console.log(`Created initial admin user "${env.ADMIN_USERNAME}"`);
}
