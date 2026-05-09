import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_TOKEN: z.string().min(1),
  BOT_MODE: z.enum(["polling", "webhook"]).default("webhook"),
  WEBHOOK_URL: z.string().min(1),
  WEBHOOK_PATH: z.string().default("/webhook"),
  BOT_PORT: z.coerce.number().int().positive().default(3000),
  ENABLE_MAX: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MAX_BOT_TOKEN: z.string().optional(),
  MAX_WEBHOOK_URL: z.string().optional(),
  MAX_WEBHOOK_PATH: z.string().default("/webhook/max"),
  MAX_WEBHOOK_SECRET: z.string().optional(),
  RENDERER_URL: z.string().url(),
  RECEIPTS_DIR: z.string().min(1),
  EXPORTS_DIR: z.string().min(1),
  APP_TIMEZONE: z.string().default("Europe/Moscow")
}).superRefine((value, ctx) => {
  if (!value.ENABLE_MAX) {
    return;
  }

  if (!value.MAX_BOT_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MAX_BOT_TOKEN is required when ENABLE_MAX=true",
      path: ["MAX_BOT_TOKEN"]
    });
  }

  if (!value.MAX_WEBHOOK_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MAX_WEBHOOK_URL is required when ENABLE_MAX=true",
      path: ["MAX_WEBHOOK_URL"]
    });
  }

  if (value.MAX_WEBHOOK_SECRET && !/^[a-zA-Z0-9_-]{5,256}$/.test(value.MAX_WEBHOOK_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MAX_WEBHOOK_SECRET must contain only A-Z, a-z, 0-9, _ and - and be 5-256 characters long",
      path: ["MAX_WEBHOOK_SECRET"]
    });
  }
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
  maxEnabled: parsed.ENABLE_MAX,
  maxBotToken: parsed.MAX_BOT_TOKEN ?? "",
  maxWebhookUrl: parsed.MAX_WEBHOOK_URL ? normalizeWebhookUrl(parsed.MAX_WEBHOOK_URL, parsed.MAX_WEBHOOK_PATH) : "",
  maxWebhookPath: parsed.MAX_WEBHOOK_PATH,
  maxWebhookSecret: parsed.MAX_WEBHOOK_SECRET,
  rendererUrl: parsed.RENDERER_URL,
  receiptsDir: parsed.RECEIPTS_DIR,
  exportsDir: parsed.EXPORTS_DIR,
  timezone: parsed.APP_TIMEZONE
};
