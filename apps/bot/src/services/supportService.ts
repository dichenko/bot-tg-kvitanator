import type { Bot } from "grammy";
import { DateTime } from "luxon";
import { prisma, OperationStatus } from "@receipt-bot/db";
import { config } from "../config";
import type { BotContext } from "../types";
import { formatSubscriptionDate, hasActiveSubscription } from "./subscriptionService";
import { telegramTimeout } from "./telegramWidgetApi";

export type SupportChannel = "Telegram" | "MAX";

export const SUPPORT_PROMPT = "Напишите ваше сообщение. Автор бота получит его в ближайшее время. Оставьте контактную информацию, если вам нужен ответ.";
export const SUPPORT_THANKS = "Спасибо, ваше сообщение отправлено.";
export const SUPPORT_FAILED = "Не удалось отправить сообщение. Попробуйте позже.";
/** Telegram messages are limited to 4096 chars; the admin header takes up to ~900 of them. */
export const SUPPORT_MAX_LENGTH = 3000;

// Both messengers deliver to the admin in Telegram, so the Telegram bot instance is shared with the MAX handlers.
let supportBot: Bot<BotContext> | null = null;
export const initSupport = (bot: Bot<BotContext>): void => { supportBot = bot; };

/** Returns an error text for an unusable message, or null when it can be sent. */
export const validateSupportText = (text: string): string | null => {
  if (!text.trim()) return "Отправьте текстовое сообщение.";
  if (text.length > SUPPORT_MAX_LENGTH) return `Сообщение слишком длинное: максимум ${SUPPORT_MAX_LENGTH} символов.`;
  return null;
};

const formatName = (user: { firstName: string | null; lastName: string | null; username: string | null }): string => {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return [name, user.username ? `@${user.username}` : ""].filter(Boolean).join(" ") || "не указано";
};

export const buildSupportMessage = async (userId: number, channel: SupportChannel, text: string): Promise<string> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  const receipts = await prisma.operation.count({ where: { userId, status: { not: OperationStatus.DELETED } } });
  const profile = user.profile;
  const zone = config.timezone;
  return [
    "🛟 Сообщение в поддержку", "",
    `Мессенджер: ${channel}`,
    `Пользователь: ${formatName(user)}`,
    `ID в боте: ${user.id}`,
    `Telegram ID: ${user.telegramId ?? "нет"}`,
    `MAX ID: ${user.maxId ?? "нет"}`,
    `Канал регистрации: ${user.registrationChannel}`,
    "",
    "Профиль ИП:",
    ...(profile ? [
      `ИНН: ${profile.inn}`,
      `ОГРН: ${profile.ogrn ?? "не указан"}`,
      `ИП: ${profile.ipFullName}`,
      `Адрес: ${profile.address}`,
      `Часовой пояс: ${profile.timeZone}`,
      `Брендирование: ${profile.receiptBranding ? "настроено" : "стандартное"}`
    ] : ["не заполнен"]),
    "",
    `Подписка: ${hasActiveSubscription(user.subscriptionUntil) ? `активна до ${formatSubscriptionDate(user.subscriptionUntil!, zone)}` : "нет"}`,
    `Дата первой регистрации: ${DateTime.fromJSDate(user.createdAt).setZone(zone).toFormat("dd.MM.yyyy HH:mm")} (${zone})`,
    `Квитанций всего: ${receipts}`,
    "", "Сообщение:", text
  ].join("\n");
};

/** Forwards a support message to DAILY_STATS_TELEGRAM_ID (plain text, no markup: user text is untrusted). */
export const sendSupportMessage = async (userId: number, channel: SupportChannel, text: string): Promise<void> => {
  if (!supportBot) throw new Error("Support bot is not initialised");
  await supportBot.api.sendMessage(config.dailyStatsTelegramId, await buildSupportMessage(userId, channel, text), {}, telegramTimeout(20_000));
};
