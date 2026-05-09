import express from "express";
import { Bot, webhookCallback } from "grammy";
import { prisma } from "@receipt-bot/db";
import { createBot } from "./bot";
import { config } from "./config";
import { logger } from "./services/logger";
import type { BotContext } from "./types";
import { createMaxClient, ensureMaxWebhook, registerMaxWebhook } from "./max/webhook";

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const ensureWebhook = async (bot: Bot<BotContext>): Promise<void> => {
  let attempt = 0;

  while (true) {
    try {
      attempt += 1;
      await bot.api.setWebhook(config.webhookUrl);
      logger.info({ webhookUrl: config.webhookUrl, attempt }, "Webhook configured");
      return;
    } catch (error) {
      const delayMs = Math.min(60_000, 5_000 * attempt);
      logger.error({ err: error, webhookUrl: config.webhookUrl, attempt, delayMs }, "Webhook setup failed, retry scheduled");
      await sleep(delayMs);
    }
  }
};

const start = async (): Promise<void> => {
  const bot = createBot();
  const maxClient = config.maxEnabled ? createMaxClient() : null;

  if (config.botMode === "polling") {
    void bot
      .start({
        onStart: async () => {
          logger.info("Bot started in polling mode");
        }
      })
      .catch((error) => {
        logger.error({ err: error }, "Polling bot failed");
      });

    if (!maxClient) {
      return;
    }
  } else {
    await bot.init();
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ ok: true });
    } catch (error) {
      logger.error({ err: error }, "Health check failed");
      res.status(500).json({ ok: false });
    }
  });

  if (config.botMode === "webhook") {
    app.post(config.webhookPath, webhookCallback(bot, "express"));
  }

  if (maxClient) {
    registerMaxWebhook(app, maxClient);
  }

  app.listen(config.botPort, () => {
    logger.info({ port: config.botPort, mode: config.botMode }, "Bot HTTP server started");
  });

  if (config.botMode === "webhook") {
    void ensureWebhook(bot);
  }

  if (maxClient) {
    void ensureMaxWebhook(maxClient);
  }
};

start().catch((error) => {
  logger.error({ err: error }, "Bot startup failed");
  process.exit(1);
});
