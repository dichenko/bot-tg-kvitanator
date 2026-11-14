import type { Bot } from "grammy";
import type { User } from "@receipt-bot/db";
import type { BotContext } from "../types";
import { subscriptionKeyboard } from "../keyboards";
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
  bot.callbackQuery(/^(menu:subscription|sub:(buy|sync))$/, async ctx => {
    if (!canUseSubscription(ctx)) {
      await ctx.answerCallbackQuery({ text: "Подписка пока недоступна.", show_alert: true }).catch(() => undefined);
      return;
    }
    const action = ctx.callbackQuery.data;
    try {
      const user = await upsertTelegramUser(ctx.from);
      const profile = await getProfileByUserId(user.id);
      if (!profile) { await ctx.answerCallbackQuery().catch(() => undefined); await startRegistration(ctx); return; }
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
