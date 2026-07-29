import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  TZ: z.string().default("UTC"),
  DB_PATH: z.string().default("./data/ccam.sqlite"),
  RECORDINGS_PATH: z.string().default("./data/recordings"),
  GO2RTC_API_URL: z.string().default("http://localhost:1984"),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 characters"),
  SESSION_KEY: z
    .string()
    .min(64, "SESSION_KEY must be a 32-byte hex string (openssl rand -hex 32)"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
