import express from "express";
import { Bot, webhookCallback } from "grammy";
import { prisma } from "@receipt-bot/db";
import { createBot } from "./bot";
import { config } from "./config";
import { logger } from "./services/logger";
import type { BotContext } from "./types";

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

  if (config.botMode === "polling") {
    await bot.start({
      onStart: async () => {
        logger.info("Bot started in polling mode");
      }
    });
    return;
  }

  await bot.init();

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

  app.post(config.webhookPath, webhookCallback(bot, "express"));

  app.listen(config.botPort, () => {
    logger.info({ port: config.botPort, mode: config.botMode }, "Bot HTTP server started");
  });

  void ensureWebhook(bot);
};

start().catch((error) => {
  logger.error({ err: error }, "Bot startup failed");
  process.exit(1);
});
