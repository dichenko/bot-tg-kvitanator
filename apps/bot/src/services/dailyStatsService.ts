import { OperationStatus, prisma } from "@receipt-bot/db";
import { DateTime } from "luxon";
import type { Bot } from "grammy";
import type { BotContext } from "../types";
import { config } from "../config";
import { logger } from "./logger";

type PeriodStats = {
  users: { telegram: number; max: number };
  receipts: { telegram: number; max: number };
};

const countPeriodStats = async (from: Date): Promise<PeriodStats> => {
  const createdAt = { gte: from };
  const visibleReceipt = { createdAt, status: { not: OperationStatus.DELETED } };

  const [telegramUsers, maxUsers, telegramReceipts, maxReceipts] = await Promise.all([
    prisma.user.count({ where: { createdAt, telegramId: { not: null } } }),
    prisma.user.count({ where: { createdAt, maxId: { not: null } } }),
    prisma.operation.count({ where: { ...visibleReceipt, user: { telegramId: { not: null } } } }),
    prisma.operation.count({ where: { ...visibleReceipt, user: { maxId: { not: null } } } })
  ]);

  return {
    users: { telegram: telegramUsers, max: maxUsers },
    receipts: { telegram: telegramReceipts, max: maxReceipts }
  };
};

const formatTotal = (stats: { telegram: number; max: number }): string =>
  `${stats.telegram + stats.max} (TG: ${stats.telegram}, MAX: ${stats.max})`;

export const buildDailyStatsMessage = async (now = DateTime.now().setZone(config.timezone)): Promise<string> => {
  const [day, month] = await Promise.all([
    countPeriodStats(now.minus({ hours: 24 }).toUTC().toJSDate()),
    countPeriodStats(now.minus({ days: 30 }).toUTC().toJSDate())
  ]);

  return [
    "Статистика ботов",
    "",
    "За день (последние 24 часа)",
    `1. Новые пользователи: ${formatTotal(day.users)}`,
    `2. Новые квитанции: ${formatTotal(day.receipts)}`,
    "",
    "За месяц (последние 30 дней)",
    `1. Новые пользователи: ${formatTotal(month.users)}`,
    `2. Новые квитанции: ${formatTotal(month.receipts)}`
  ].join("\n");
};

const millisecondsUntilNextRun = (): number => {
  const now = DateTime.now().setZone(config.timezone);
  let next = now.startOf("day").set({ hour: config.dailyStatsHour });

  if (next <= now) {
    next = next.plus({ days: 1 });
  }

  return next.toMillis() - now.toMillis();
};

export const startDailyStatsScheduler = (bot: Bot<BotContext>): void => {
  const scheduleNextRun = (): void => {
    const delayMs = millisecondsUntilNextRun();
    const plannedAt = DateTime.now().setZone(config.timezone).plus({ milliseconds: delayMs });

    logger.info({ plannedAt: plannedAt.toISO(), timezone: config.timezone }, "Daily statistics scheduled");

    setTimeout(() => {
      void (async () => {
        try {
          const message = await buildDailyStatsMessage();
          await bot.api.sendMessage(config.dailyStatsTelegramId, message);
          logger.info({ recipientTelegramId: config.dailyStatsTelegramId }, "Daily statistics sent");
        } catch (error) {
          logger.error({ err: error, recipientTelegramId: config.dailyStatsTelegramId }, "Daily statistics delivery failed");
        } finally {
          scheduleNextRun();
        }
      })();
    }, delayMs);
  };

  scheduleNextRun();
};
