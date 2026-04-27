import type { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";

export const sendMenu = async (ctx: BotContext, text: string, keyboard: InlineKeyboard): Promise<void> => {
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
      return;
    } catch {
      // Telegram can reject editing outdated messages. Fallback to reply.
    }
  }

  await ctx.reply(text, { reply_markup: keyboard });
};
