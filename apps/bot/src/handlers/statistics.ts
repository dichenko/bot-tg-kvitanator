import { prisma } from "@receipt-bot/db";
import type { Bot } from "grammy";
import { config } from "../config";
import type { BotContext } from "../types";
import { logger } from "../services/logger";
import { sendManualStatistics } from "../services/dailyStatsService";
import { PERIODS, type StatisticsSnapshot, type StatsPeriod, type ChartChannel } from "../services/statisticsService";
import { encodeWidgetData } from "../services/statisticsWidget";
import { widgetApi, type WidgetQuery } from "../services/telegramWidgetApi";

export const parseStatisticsQuery = (query: WidgetQuery, adminId: number): { period: StatsPeriod; channel: ChartChannel } | null => {
  if (query.from?.id !== adminId || query.chat?.id !== adminId || query.chat.type !== "private"
    || !Number.isSafeInteger(query.message_id) || query.inline_message_id || query.type?.type !== "data" || typeof query.data !== "string"
    || Buffer.byteLength(query.data, "utf8") > 64) return null;
  const match = /^s:(day|week|month|half):(all|tg|max)$/.exec(query.data);
  return match ? { period: match[1] as StatsPeriod, channel: match[2] as ChartChannel } : null;
};

export const handleStatisticsQuery = async (bot: Bot<BotContext>, query: WidgetQuery): Promise<void> => {
  const api = widgetApi(bot.api);
  const selection = parseStatisticsQuery(query, config.dailyStatsTelegramId);
  let error: string | undefined;
  let data: string | undefined;
  const controller = new AbortController();
  let deadlineTimer: NodeJS.Timeout | undefined;
  try {
    if (!selection) throw new Error("Нет доступа или неверный запрос");
    const work = prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
      // Serialize edits across instances/devices without waiting on an old query.
      const locks = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${config.dailyStatsTelegramId}::bigint # ${query.message_id!}::bigint) AS locked`;
      if (!locks[0].locked) throw new Error("Отчёт обновляется. Повторите нажатие");
      const report = await tx.statisticsReport.findUnique({ where: { recipientId_messageId: {
        recipientId: BigInt(query.chat!.id), messageId: query.message_id!
      } } });
      if (!report || report.state !== "SENT" || !report.snapshot) throw new Error("Отчёт недоступен");
      const snapshot = report.snapshot as unknown as StatisticsSnapshot;
      if (snapshot.version !== 1 || !PERIODS.every(p => snapshot.periods[p])) throw new Error("Версия отчёта не поддерживается");
      const updated = await tx.statisticsReport.update({ where: { id: report.id }, data: { revision: { increment: 1 } } });
      data = encodeWidgetData(snapshot, selection.period, selection.channel, updated.revision);
      controller.signal.throwIfAborted();
      try {
        await api.editMessageWidgetData({ chat_id: query.chat!.id, message_id: query.message_id!,
          chat_data: data
        }, controller.signal);
      } catch (e) {
        if (!(e instanceof Error) || !e.message.includes("message is not modified")) throw e;
      }
    }, { maxWait: 1_000, timeout: 7_000 });
    // Also bound connection establishment, which can outlive maxWait while
    // PostgreSQL is unavailable. The aborted signal prevents a late API edit.
    await Promise.race([work, new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => { controller.abort(); reject(new Error("Widget query deadline exceeded")); }, 8_000);
    })]);
  } catch (e) {
    error = selection ? "Не удалось обновить. Повторите нажатие" : "Нет доступа";
    logger.warn({ err: e, messageId: query.message_id }, "Statistics widget query rejected");
  } finally {
    clearTimeout(deadlineTimer);
  }
  // DB wait + edit are bounded; reserve time for the 15-second answer deadline.
  await api.answerWidgetQuery({ widget_query_id: query.id, data: error ? JSON.stringify({ error }) : data }, AbortSignal.timeout(3_000));
};

export const registerStatisticsHandlers = (bot: Bot<BotContext>): void => {
  // Before session middleware: old grammY cannot derive a chat from widget_query.
  bot.use(async (ctx, next) => {
    const query = (ctx.update as unknown as { widget_query?: WidgetQuery }).widget_query;
    if (query) return handleStatisticsQuery(bot, query);
    await next();
  });
  bot.command("stats", async ctx => {
    if (ctx.from?.id !== config.dailyStatsTelegramId || ctx.chat.type !== "private") return;
    try {
      await sendManualStatistics(bot);
    } catch (error) {
      logger.error({ err: error }, "Manual statistics delivery failed");
    }
  });
};
