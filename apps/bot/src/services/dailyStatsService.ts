import { Prisma, prisma, type StatisticsReport } from "@receipt-bot/db";
import { DateTime } from "luxon";
import { GrammyError, type Bot } from "grammy";
import type { BotContext } from "../types";
import { config } from "../config";
import { logger } from "./logger";
import { buildStatisticsSnapshot, formatStatsText, type StatisticsSnapshot } from "./statisticsService";
import { encodeWidgetData, STATISTICS_WIDGET_HTML, validateWidgetHtml } from "./statisticsWidget";
import { telegramTimeout, widgetApi } from "./telegramWidgetApi";

const snapshotJson = (snapshot: StatisticsSnapshot): Prisma.InputJsonValue => snapshot as unknown as Prisma.InputJsonValue;

export const buildDailyStatsMessage = async (now = DateTime.now().setZone(config.timezone)): Promise<string> =>
  formatStatsText(await buildStatisticsSnapshot(now));

// A unique key and compare-and-swap lease coordinate replicas and recover a
// crash during preparation without sending duplicates.
const claimDailyReport = async (cutoff: DateTime): Promise<StatisticsReport | null> => {
  const deliveryKey = `${config.dailyStatsTelegramId}:${config.timezone}:${cutoff.toISODate()}`;
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 120_000);
  let report = await prisma.statisticsReport.findUnique({ where: { deliveryKey } });
  if (!report) {
    try {
      return await prisma.statisticsReport.create({ data: {
        deliveryKey, recipientId: BigInt(config.dailyStatsTelegramId), cutoffAt: cutoff.toUTC().toJSDate(),
        timezone: config.timezone, leaseUntil
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
    report = await prisma.statisticsReport.findUniqueOrThrow({ where: { deliveryKey } });
  }
  if (report.state === "SENDING" && report.leaseUntil <= now) {
    const marked = await prisma.statisticsReport.updateMany({ where: { id: report.id, state: "SENDING" }, data: { state: "UNCERTAIN" } });
    if (marked.count) logger.error({ reportId: report.id, deliveryKey }, "Statistics delivery interrupted; verify Telegram before retrying manually");
  }
  if (report.state !== "PREPARING") return null;
  const won = await prisma.statisticsReport.updateMany({
    where: { id: report.id, state: "PREPARING", leaseUntil: { lte: now } }, data: { leaseUntil }
  });
  return won.count ? { ...report, leaseUntil } : null;
};

export const deliverStatisticsReport = async (bot: Bot<BotContext>, report: StatisticsReport): Promise<void> => {
  const snapshot = report.snapshot ? report.snapshot as unknown as StatisticsSnapshot
    : await buildStatisticsSnapshot(DateTime.fromJSDate(report.cutoffAt).setZone(report.timezone));
  const caption = formatStatsText(snapshot);
  // Persist exact aggregates before any external side effect. SENDING is never
  // auto-retried: Telegram provides no idempotency key for sendWidget.
  const claimed = await prisma.statisticsReport.updateMany({
    where: { id: report.id, state: "PREPARING", leaseUntil: report.leaseUntil },
    data: { snapshot: snapshotJson(snapshot), state: "SENDING" }
  });
  if (!claimed.count) return;

  let result: { message_id: number };
  let state = "SENT";
  try {
    const size = validateWidgetHtml();
    logger.info({ reportId: report.id, ...size }, "Sending statistics widget");
    result = await widgetApi(bot.api).sendWidget({
      chat_id: Number(report.recipientId), html: STATISTICS_WIDGET_HTML,
      chat_data: encodeWidgetData(snapshot), caption, allow_queries: true
    }, AbortSignal.timeout(20_000));
  } catch (error) {
    // A transport failure is ambiguous: Telegram may have accepted the widget.
    logger.warn({ err: error, reportId: report.id, ambiguous: !(error instanceof GrammyError) }, "Widget delivery failed; sending text fallback");
    state = "FALLBACK";
    try {
      result = await bot.api.sendMessage(Number(report.recipientId), caption, {}, telegramTimeout(20_000));
    } catch (fallbackError) {
      await prisma.statisticsReport.update({ where: { id: report.id }, data: { state: "UNCERTAIN" } });
      throw fallbackError;
    }
  }
  // A database error after successful send must not generate another message.
  await prisma.statisticsReport.update({ where: { id: report.id }, data: { state, messageId: result.message_id } });
  logger.info({ reportId: report.id, messageId: result.message_id, state }, "Daily statistics delivered");
};

export const sendManualStatistics = async (bot: Bot<BotContext>): Promise<void> => {
  const report = await prisma.statisticsReport.create({ data: {
    recipientId: BigInt(config.dailyStatsTelegramId), cutoffAt: new Date(), timezone: config.timezone,
    leaseUntil: new Date(Date.now() + 120_000)
  } });
  await deliverStatisticsReport(bot, report);
};

export const scheduledCutoff = (now: DateTime, hour: number): DateTime | null => {
  const due = now.startOf("day").set({ hour });
  return now >= due ? due : null;
};

export const runDueDailyStatistics = async (bot: Bot<BotContext>, now = DateTime.now().setZone(config.timezone)): Promise<void> => {
  const cutoff = scheduledCutoff(now, config.dailyStatsHour);
  if (!cutoff) return;
  const report = await claimDailyReport(cutoff);
  if (report) await deliverStatisticsReport(bot, report);
};

export const startDailyStatsScheduler = (bot: Bot<BotContext>): void => {
  // First tick at the next minute, never a test report on application startup.
  // Each tick also catches today's missed delivery after a container restart.
  const scheduleNextRun = (): void => {
    const now = DateTime.now().setZone(config.timezone);
    const plannedAt = now.plus({ minutes: 1 }).startOf("minute");
    setTimeout(() => {
      void runDueDailyStatistics(bot).catch(error => {
        logger.error({ err: error, recipientTelegramId: config.dailyStatsTelegramId }, "Daily statistics delivery failed");
      }).finally(scheduleNextRun);
    }, plannedAt.toMillis() - now.toMillis());
  };
  logger.info({ hour: config.dailyStatsHour, timezone: config.timezone }, "Daily statistics scheduler started");
  scheduleNextRun();
};
