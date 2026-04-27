import type { Bot } from "grammy";
import { mainMenuKeyboard } from "../keyboards";
import { logger } from "../services/logger";
import { clearRegistrationDraft, clearReceiptDraft } from "../utils/state";
import { sendMenu } from "../utils/telegram";
import { getProfileByUserId, upsertTelegramUser } from "../services/userService";
import type { BotContext } from "../types";

const startRegistration = async (ctx: BotContext): Promise<void> => {
  clearReceiptDraft(ctx.session);
  clearRegistrationDraft(ctx.session);
  ctx.session.awaitingInput = "registration_inn";
  await ctx.reply("Здравствуйте! Сначала нужно заполнить данные ИП.\n\nВведите ИНН:");
};

const goToMainFlow = async (ctx: BotContext): Promise<void> => {
  const user = await upsertTelegramUser(ctx.from!);
  const profile = await getProfileByUserId(user.id);

  if (!profile) {
    logger.info({ telegramId: ctx.from?.id }, "Starting registration flow");
    await startRegistration(ctx);
    return;
  }

  clearRegistrationDraft(ctx.session);
  await sendMenu(ctx, "Главное меню", mainMenuKeyboard());
};

export const registerCommandHandlers = (bot: Bot<BotContext>): void => {
  bot.command("start", goToMainFlow);
  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Бот помогает оформить внутреннюю квитанцию по оплате услуги.",
        "",
        "Доступные действия:",
        "• зарегистрировать данные ИП;",
        "• вести список услуг;",
        "• формировать квитанции в JPEG;",
        "• смотреть историю операций;",
        "• выгружать операции в Excel."
      ].join("\n"),
      { reply_markup: mainMenuKeyboard() }
    );
  });
};

export { goToMainFlow, startRegistration };
