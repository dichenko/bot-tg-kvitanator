import type { InlineKeyboard } from "grammy";
import type { BotContext } from "../types";

type MenuOptions = {
  parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
};

export const escapeTelegramHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const sendMenu = async (
  ctx: BotContext,
  text: string,
  keyboard: InlineKeyboard,
  options?: MenuOptions
): Promise<void> => {
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard, ...options });
      return;
    } catch {
      // Telegram can reject editing outdated messages. Fallback to reply.
    }
  }

  await ctx.reply(text, { reply_markup: keyboard, ...options });
};
