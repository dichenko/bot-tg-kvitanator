import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_TOKEN: z.string().min(1),
  BOT_MODE: z.enum(["polling", "webhook"]).default("webhook"),
  WEBHOOK_URL: z.string().min(1),
  WEBHOOK_PATH: z.string().default("/webhook"),
  BOT_PORT: z.coerce.number().int().positive().default(3000),
  RENDERER_URL: z.string().url(),
  RECEIPTS_DIR: z.string().min(1),
  EXPORTS_DIR: z.string().min(1),
  APP_TIMEZONE: z.string().default("Europe/Moscow")
});

const parsed = envSchema.parse(process.env);

const normalizeWebhookUrl = (url: string, path: string): string => {
  if (url.endsWith(path)) {
    return url;
  }

  return `${url.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
};

export const config = {
  nodeEnv: parsed.NODE_ENV,
  botToken: parsed.BOT_TOKEN,
  botMode: parsed.BOT_MODE,
  webhookUrl: normalizeWebhookUrl(parsed.WEBHOOK_URL, parsed.WEBHOOK_PATH),
  webhookPath: parsed.WEBHOOK_PATH,
  botPort: parsed.BOT_PORT,
  rendererUrl: parsed.RENDERER_URL,
  receiptsDir: parsed.RECEIPTS_DIR,
  exportsDir: parsed.EXPORTS_DIR,
  timezone: parsed.APP_TIMEZONE
};
