import type { Bot } from "grammy";
import { mainMenuKeyboard } from "../keyboards";
import { logger } from "../services/logger";
import { getProfileByUserId, upsertTelegramUser } from "../services/userService";
import type { BotContext } from "../types";
import { clearRegistrationDraft, clearReceiptDraft } from "../utils/state";
import { discardBrandingDraft } from "../services/brandingStorage";
import { sendMenu } from "../utils/telegram";
import { canUseSubscription } from "../services/subscriptionService";

const registrationIntroText = [
  'Сервис "Квитанатор" помогает индивидуальным предпринимателям на патенте выписывать квитанции и вести учёт.',
  "",
  "Пожалуйста, заполните данные вашего ИП.",
  "",
  "Введите ИНН:"
].join("\n");

const startRegistration = async (ctx: BotContext): Promise<void> => {
  clearReceiptDraft(ctx.session);
  clearRegistrationDraft(ctx.session);
  ctx.session.awaitingInput = "registration_inn";
  await ctx.reply(registrationIntroText);
};

const goToMainFlow = async (ctx: BotContext): Promise<void> => {
  await discardBrandingDraft(ctx.session).catch(error => logger.warn({ err: error }, "Draft logo cleanup failed"));
  const user = await upsertTelegramUser(ctx.from!);
  const profile = await getProfileByUserId(user.id);

  if (!profile) {
    logger.info({ telegramId: ctx.from?.id }, "Starting registration flow");
    await startRegistration(ctx);
    return;
  }

  clearRegistrationDraft(ctx.session);
  await sendMenu(ctx, "Главное меню", mainMenuKeyboard(canUseSubscription(ctx)));
};

export const registerCommandHandlers = (bot: Bot<BotContext>): void => {
  bot.command("start", goToMainFlow);
  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        'Сервис "Квитанатор" помогает ИП на патенте фиксировать поступления и формировать внутренние квитанции.',
        "",
        "Доступные действия:",
        "• заполнить данные ИП;",
        "• вести список услуг;",
        "• быстро создавать квитанции;",
        "• смотреть историю операций;",
        "• выгружать операции в Excel."
      ].join("\n"),
      { reply_markup: mainMenuKeyboard(canUseSubscription(ctx)) }
    );
  });
};

export { goToMainFlow, startRegistration };
