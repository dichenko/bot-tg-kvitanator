import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RENDERER_PORT: z.coerce.number().int().positive().default(3001),
  RECEIPTS_DIR: z.string().min(1),
  APP_TIMEZONE: z.string().default("Europe/Moscow")
});

const parsed = envSchema.parse(process.env);

export const config = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.RENDERER_PORT,
  receiptsDir: parsed.RECEIPTS_DIR,
  timeZone: parsed.APP_TIMEZONE
};
