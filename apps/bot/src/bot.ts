import { Bot, session } from "grammy";
import type { BotContext } from "./types";
import { config } from "./config";
import { logger } from "./services/logger";
import { registerCommandHandlers } from "./handlers/commands";
import { registerMessageHandlers } from "./handlers/messages";
import { registerCallbackHandlers } from "./handlers/callbacks";
import { createInitialSession } from "./utils/state";
import { registerStatisticsHandlers } from "./handlers/statistics";
import { registerBrandingHandlers } from "./handlers/branding";
import { registerSubscriptionHandlers } from "./handlers/subscription";

export const createBot = (): Bot<BotContext> => {
  const bot = new Bot<BotContext>(config.botToken);

  registerStatisticsHandlers(bot);
  bot.use(session({ initial: createInitialSession }));

  registerCommandHandlers(bot);
  registerBrandingHandlers(bot);
  registerSubscriptionHandlers(bot);
  registerMessageHandlers(bot);
  registerCallbackHandlers(bot);

  bot.catch((error) => {
    logger.error({ err: error.error, updateId: error.ctx.update.update_id }, "Unhandled bot error");
  });

  return bot;
};
