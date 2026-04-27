import express from "express";
import { webhookCallback } from "grammy";
import { prisma } from "@receipt-bot/db";
import { createBot } from "./bot";
import { config } from "./config";
import { logger } from "./services/logger";

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
  await bot.api.setWebhook(config.webhookUrl);
  logger.info({ webhookUrl: config.webhookUrl }, "Webhook configured");

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
};

start().catch((error) => {
  logger.error({ err: error }, "Bot startup failed");
  process.exit(1);
});
