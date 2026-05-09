import type { Express, Request, Response } from "express";
import { config } from "../config";
import { logger } from "../services/logger";
import { MaxApiClient } from "./client";
import { handleMaxUpdate } from "./handlers";
import type { MaxUpdate } from "./types";

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export const createMaxClient = (): MaxApiClient => new MaxApiClient(config.maxBotToken);

export const registerMaxWebhook = (app: Express, client: MaxApiClient): void => {
  app.post(config.maxWebhookPath, async (req: Request, res: Response) => {
    if (config.maxWebhookSecret && req.header("X-Max-Bot-Api-Secret") !== config.maxWebhookSecret) {
      res.status(401).json({ ok: false });
      return;
    }

    res.status(200).json({ ok: true });

    try {
      await handleMaxUpdate(client, req.body as MaxUpdate);
    } catch (error) {
      logger.error({ err: error, updateType: req.body?.update_type }, "MAX webhook handling failed");
    }
  });
};

export const ensureMaxWebhook = async (client: MaxApiClient): Promise<void> => {
  let attempt = 0;

  while (true) {
    try {
      attempt += 1;
      await client.createSubscription({
        url: config.maxWebhookUrl,
        updateTypes: ["bot_started", "message_created", "message_callback"],
        secret: config.maxWebhookSecret
      });
      logger.info({ webhookUrl: config.maxWebhookUrl, attempt }, "MAX webhook configured");
      return;
    } catch (error) {
      const delayMs = Math.min(60_000, 5_000 * attempt);
      logger.error({ err: error, webhookUrl: config.maxWebhookUrl, attempt, delayMs }, "MAX webhook setup failed, retry scheduled");
      await sleep(delayMs);
    }
  }
};
