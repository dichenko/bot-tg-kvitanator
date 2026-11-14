import { GrammyError, InlineKeyboard, type Bot } from "grammy";
import { DateTime } from "luxon";
import { prisma, type User } from "@receipt-bot/db";
import { resolveTimeZone } from "@receipt-bot/shared";
import { config } from "../config";
import type { BotContext } from "../types";
import { logger } from "./logger";

// TEST MODE NOTE: the subscription is a Telegram-only pilot for a single user
// (DAILY_STATS_TELEGRAM_ID, gated by RECEIPT_BRANDING_TEST_ENABLED). Payment is simulated:
// "Buy" grants SUBSCRIPTION_DAYS at once. To roll out to everyone, replace
// `isSubscriptionTestUser`/`canUseSubscription` with a real check, connect a payment
// provider in `purchaseSubscription`, and add the same flow to MAX.
export const SUBSCRIPTION_DAYS = 365;
export const SUBSCRIPTION_PRICE_PER_MONTH_RUB = 60;
/** The renewal button appears, and reminders start, this many days before the end. */
export const RENEWAL_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export const isSubscriptionTestUser = (telegramId: number | bigint | undefined | null): boolean =>
  config.receiptBrandingTestEnabled && telegramId != null
  && (typeof telegramId === "bigint" || Number.isSafeInteger(telegramId))
  && BigInt(telegramId) === BigInt(config.dailyStatsTelegramId);

export const canUseSubscription = (ctx: { from?: { id: number }; chat?: { id: number; type: string } }): boolean =>
  isSubscriptionTestUser(ctx.from?.id) && ctx.chat?.type === "private" && ctx.chat.id === ctx.from?.id;

export const hasActiveSubscription = (until: Date | null | undefined, now = new Date()): boolean =>
  !!until && until.getTime() > now.getTime();

/** Whole days left, rounded up: (2d, 3d] -> 3, (0, 1d] -> 1; 0 when inactive. */
export const subscriptionDaysLeft = (until: Date | null | undefined, now = new Date()): number =>
  hasActiveSubscription(until, now) ? Math.ceil((until!.getTime() - now.getTime()) / DAY_MS) : 0;

export const canRenewSubscription = (until: Date | null | undefined, now = new Date()): boolean =>
  subscriptionDaysLeft(until, now) <= RENEWAL_WINDOW_DAYS;

export const formatSubscriptionDate = (until: Date, timeZone: string | null | undefined): string =>
  DateTime.fromJSDate(until).setZone(resolveTimeZone(timeZone)).toFormat("dd.MM.yyyy");

export const pluralizeDays = (count: number): string => {
  const mod100 = count % 100, mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дня";
  return "дней";
};

/**
 * Simulated purchase. A new/expired subscription starts now; a renewal (allowed only within
 * RENEWAL_WINDOW_DAYS of the end) is appended to the current end date. The compare-and-swap on the
 * previous value makes a double tap or parallel updates grant the period only once.
 * Returns the new end date, or null when buying is not allowed or someone else won the race.
 */
export const purchaseSubscription = async (userId: number, now = new Date()): Promise<Date | null> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { telegramId: true, subscriptionUntil: true } });
  if (!isSubscriptionTestUser(user.telegramId)) throw new Error("Подписка недоступна.");
  if (!canRenewSubscription(user.subscriptionUntil, now)) return null;
  const base = hasActiveSubscription(user.subscriptionUntil, now) ? user.subscriptionUntil!.getTime() : now.getTime();
  const until = new Date(base + SUBSCRIPTION_DAYS * DAY_MS);
  const updated = await prisma.user.updateMany({
    where: { id: userId, subscriptionUntil: user.subscriptionUntil },
    data: { subscriptionUntil: until, subscriptionReminderDay: null }
  });
  return updated.count ? until : null;
};

export const buildSubscriptionText = (user: Pick<User, "subscriptionUntil">, timeZone: string | null | undefined, now = new Date()): string => {
  const until = user.subscriptionUntil;
  if (until && hasActiveSubscription(until, now)) {
    const left = subscriptionDaysLeft(until, now);
    return [
      "⭐ Моя подписка", "",
      `Подписка активна до ${formatSubscriptionDate(until, timeZone)}.`,
      `Осталось: ${left} ${pluralizeDays(left)}.`,
      ...(canRenewSubscription(until, now) ? ["", "Скоро подписка закончится. Продлите её, чтобы функции оставались доступны."] : []),
      "", "Платные функции:",
      "• Брендированная квитанция — свой логотип и подпись в шапке квитанции.",
      "• Синхронизация Max и Telegram — скоро."
    ].join("\n");
  }
  return [
    "⭐ Моя подписка", "",
    ...(until ? [`Подписка закончилась ${formatSubscriptionDate(until, timeZone)}. Квитанции создаются со стандартной шапкой; ваш логотип сохранён и вернётся после покупки подписки.`, ""] : []),
    `Подписка стоит ${SUBSCRIPTION_PRICE_PER_MONTH_RUB} рублей в месяц при оплате за год.`, "",
    "В подписку входят две платные функции:",
    "1. Брендированная квитанция — добавьте свой логотип и подпись, и они появятся в шапке ваших квитанций.",
    "2. Синхронизация Max и Telegram — работайте в любом из ботов, где вам сейчас удобно: список квитанций и услуг везде одинаковый.",
    "", "🎁 Подарок первым пользователям: подписка на год - бесплатно! Переходите к оформлению, подарок применится автоматически"
  ].join("\n");
};

export const buildReminderText = (daysLeft: number, until: Date, timeZone: string | null | undefined): string =>
  `Подписка закончится через ${daysLeft} ${pluralizeDays(daysLeft)} (${formatSubscriptionDate(until, timeZone)}). Продлить её можно в разделе «Моя подписка».`;

/**
 * Sends the 3/2/1-day reminders. `subscriptionReminderDay` is claimed with a compare-and-swap
 * before sending, so parallel replicas or repeated ticks never send the same reminder twice.
 */
export const runSubscriptionReminders = async (bot: Bot<BotContext>, now = new Date()): Promise<number> => {
  if (!config.receiptBrandingTestEnabled) return 0;
  const candidates = await prisma.user.findMany({
    where: {
      telegramId: BigInt(config.dailyStatsTelegramId),
      subscriptionUntil: { gt: now, lte: new Date(now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS) }
    },
    select: { id: true, telegramId: true, subscriptionUntil: true, subscriptionReminderDay: true, profile: { select: { timeZone: true } } }
  });
  let sent = 0;
  for (const user of candidates) {
    const days = subscriptionDaysLeft(user.subscriptionUntil, now);
    if (!days || !user.telegramId || (user.subscriptionReminderDay !== null && user.subscriptionReminderDay <= days)) continue;
    const claimed = await prisma.user.updateMany({
      where: { id: user.id, subscriptionUntil: user.subscriptionUntil, subscriptionReminderDay: user.subscriptionReminderDay },
      data: { subscriptionReminderDay: days }
    });
    if (!claimed.count) continue;
    try {
      await bot.api.sendMessage(Number(user.telegramId), buildReminderText(days, user.subscriptionUntil!, user.profile?.timeZone),
        { reply_markup: new InlineKeyboard().text("⭐ Моя подписка", "menu:subscription") });
      sent++;
    } catch (error) {
      // A blocked bot (403) is final; anything else is retried on the next tick.
      if (!(error instanceof GrammyError && error.error_code === 403)) {
        await prisma.user.updateMany({ where: { id: user.id, subscriptionReminderDay: days }, data: { subscriptionReminderDay: user.subscriptionReminderDay } });
      }
      logger.warn({ err: error, userId: user.id }, "Subscription reminder delivery failed");
    }
  }
  return sent;
};

export const startSubscriptionReminderScheduler = (bot: Bot<BotContext>, intervalMs = 10 * 60_000): NodeJS.Timeout => {
  const tick = (): void => {
    void runSubscriptionReminders(bot).catch(error => logger.error({ err: error }, "Subscription reminders failed"));
  };
  logger.info({ intervalMs }, "Subscription reminder scheduler started");
  return setInterval(tick, intervalMs);
};
