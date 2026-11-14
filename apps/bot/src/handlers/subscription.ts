import type { Bot } from "grammy";
import type { User } from "@receipt-bot/db";
import type { BotContext } from "../types";
import { backToSubscriptionKeyboard, mainMenuKeyboard, subscriptionKeyboard } from "../keyboards";
import { SUPPORT_FAILED, SUPPORT_PROMPT, SUPPORT_THANKS, sendSupportMessage, validateSupportText } from "../services/supportService";
import { clearSupportInput } from "../utils/state";
import { startRegistration } from "./commands";
import { getProfileByUserId, upsertTelegramUser } from "../services/userService";
import { buildSubscriptionText, canRenewSubscription, canUseSubscription, formatSubscriptionDate, hasActiveSubscription, purchaseSubscription } from "../services/subscriptionService";
import { logger } from "../services/logger";
import { sendMenu } from "../utils/telegram";

// Telegram only. Purchase is a free gift for the first users until payments are connected (see subscriptionService).
const show = async (ctx: BotContext, user: User, timeZone: string, message?: string): Promise<void> => {
  const active = hasActiveSubscription(user.subscriptionUntil);
  await sendMenu(ctx, [message, buildSubscriptionText(user, timeZone)].filter(Boolean).join("\n\n"),
    subscriptionKeyboard(active, canRenewSubscription(user.subscriptionUntil)));
};

export const registerSubscriptionHandlers = (bot: Bot<BotContext>): void => {
  // Support: the next text message of the user is forwarded to the admin (see services/supportService).
  bot.on("message:text", async (ctx, next) => {
    if (ctx.session.awaitingInput !== "support_message") return next();
    const text = ctx.message.text.trim();
    const invalid = validateSupportText(text);
    if (invalid) { await ctx.reply(invalid); return; }
    try {
      const user = await upsertTelegramUser(ctx.from);
      await sendSupportMessage(user.id, "Telegram", text);
    } catch (error) {
      logger.error({ err: error, userId: ctx.from.id }, "Support message delivery failed");
      await ctx.reply(SUPPORT_FAILED);
      return;
    }
    ctx.session.awaitingInput = null;
    await sendMenu(ctx, `${SUPPORT_THANKS}\n\nГлавное меню`, mainMenuKeyboard(canUseSubscription(ctx)));
  });
  bot.on("message", async (ctx, next) => {
    if (ctx.session.awaitingInput !== "support_message") return next();
    await ctx.reply("Отправьте сообщение текстом.");
  });

  bot.callbackQuery(/^(menu:subscription|sub:(buy|sync)|support:open)$/, async ctx => {
    if (!canUseSubscription(ctx)) {
      await ctx.answerCallbackQuery({ text: "Подписка пока недоступна.", show_alert: true }).catch(() => undefined);
      return;
    }
    const action = ctx.callbackQuery.data;
    clearSupportInput(ctx.session);
    try {
      const user = await upsertTelegramUser(ctx.from);
      const profile = await getProfileByUserId(user.id);
      if (!profile) { await ctx.answerCallbackQuery().catch(() => undefined); await startRegistration(ctx); return; }
      if (action === "support:open") {
        await ctx.answerCallbackQuery().catch(() => undefined);
        ctx.session.awaitingInput = "support_message";
        return void await sendMenu(ctx, SUPPORT_PROMPT, backToSubscriptionKeyboard());
      }
      if (action === "sub:sync") {
        // Placeholder: Max/Telegram synchronisation is not implemented yet.
        await ctx.answerCallbackQuery({ text: hasActiveSubscription(user.subscriptionUntil) ? "Функция пока недоступна." : "Функция доступна по подписке.", show_alert: true }).catch(() => undefined);
        return;
      }
      await ctx.answerCallbackQuery().catch(() => undefined);
      if (action === "sub:buy") {
        const until = await purchaseSubscription(user.id);
        const fresh = await upsertTelegramUser(ctx.from);
        const message = until ? `Подписка оформлена до ${formatSubscriptionDate(until, profile.timeZone)}. Подарок первым пользователям: подписка на год - бесплатно!`
          : "Подписка уже активна. Продлить её можно за 3 дня до окончания.";
        return void await show(ctx, fresh, profile.timeZone, message);
      }
      await show(ctx, user, profile.timeZone);
    } catch (error) {
      logger.warn({ err: error, userId: ctx.from.id }, "Subscription action failed");
      await ctx.reply("Не удалось выполнить действие. Попробуйте позже.");
    }
  });
};
