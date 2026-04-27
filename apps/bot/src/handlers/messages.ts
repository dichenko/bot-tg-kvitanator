import type { Bot } from "grammy";
import { mainMenuKeyboard, paymentMethodKeyboard, receiptPreviewKeyboard, servicesKeyboard } from "../keyboards";
import { buildReceiptPreviewText } from "../services/operationService";
import { logger } from "../services/logger";
import {
  createService,
  getActiveService,
  getProfileByUserId,
  updateProfileField,
  upsertProfile,
  upsertTelegramUser
} from "../services/userService";
import type { BotContext } from "../types";
import { clearRegistrationDraft } from "../utils/state";
import { formatAmount } from "../utils/formatters";
import { sendMenu } from "../utils/telegram";
import { parseAmountInput, validateInn, validateRequiredText, validateServiceTitle } from "../utils/validation";

const ensureText = (ctx: BotContext): string | null => {
  const text = ctx.message?.text?.trim();
  return text ? text : null;
};

const handleRegistrationInn = async (ctx: BotContext, text: string): Promise<void> => {
  const result = validateInn(text);

  if (!result.valid || !result.normalized) {
    await ctx.reply(result.message ?? "Некорректный ИНН. Попробуйте ещё раз.");
    return;
  }

  ctx.session.registrationDraft.inn = result.normalized;
  ctx.session.awaitingInput = "registration_full_name";

  if (result.warning) {
    await ctx.reply(result.warning);
  }

  await ctx.reply("Введите ФИО ИП:");
};

const handleRegistrationFullName = async (ctx: BotContext, text: string): Promise<void> => {
  try {
    ctx.session.registrationDraft.ipFullName = validateRequiredText(text, "ФИО ИП");
    ctx.session.awaitingInput = "registration_address";
    await ctx.reply("Введите адрес оказания услуги:");
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Не удалось сохранить ФИО ИП.");
  }
};

const handleRegistrationAddress = async (ctx: BotContext, text: string): Promise<void> => {
  try {
    const address = validateRequiredText(text, "Адрес оказания услуги");
    const user = await upsertTelegramUser(ctx.from!);
    const profile = await upsertProfile(user.id, {
      inn: ctx.session.registrationDraft.inn ?? "",
      ipFullName: ctx.session.registrationDraft.ipFullName ?? "",
      address
    });

    clearRegistrationDraft(ctx.session);
    logger.info({ userId: user.id, profileId: profile.id }, "User registration completed");
    await sendMenu(ctx, "Данные ИП сохранены. Главное меню:", mainMenuKeyboard());
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Не удалось сохранить адрес оказания услуги.");
  }
};

const handleProfileEdit = async (
  ctx: BotContext,
  field: "inn" | "ipFullName" | "address",
  text: string
): Promise<void> => {
  const user = await upsertTelegramUser(ctx.from!);

  try {
    const normalized =
      field === "inn"
        ? (() => {
            const result = validateInn(text);
            if (!result.valid || !result.normalized) {
              throw new Error(result.message ?? "Некорректный ИНН.");
            }
            return result.normalized;
          })()
        : validateRequiredText(text, field === "ipFullName" ? "ФИО ИП" : "Адрес оказания услуги");

    await updateProfileField(user.id, field, normalized);
    ctx.session.awaitingInput = null;
    await sendMenu(ctx, "Данные ИП обновлены.", mainMenuKeyboard());
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Не удалось обновить профиль.");
  }
};

const handleAddService = async (ctx: BotContext, text: string): Promise<void> => {
  const user = await upsertTelegramUser(ctx.from!);

  try {
    const title = validateServiceTitle(text);
    await createService(user.id, title);
    ctx.session.awaitingInput = null;
    await sendMenu(ctx, `Услуга «${title}» добавлена.`, servicesKeyboard());
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Не удалось добавить услугу.");
  }
};

const handleReceiptAmount = async (ctx: BotContext, text: string): Promise<void> => {
  const user = await upsertTelegramUser(ctx.from!);
  const profile = await getProfileByUserId(user.id);

  if (!profile || !ctx.session.receiptDraft?.serviceId) {
    ctx.session.awaitingInput = null;
    await sendMenu(ctx, "Сначала выберите услугу для квитанции.", mainMenuKeyboard());
    return;
  }

  try {
    const amount = parseAmountInput(text);
    ctx.session.receiptDraft.amount = amount;
    ctx.session.awaitingInput = null;

    if (!ctx.session.receiptDraft.paymentMethod) {
      await ctx.reply(`Сумма сохранена: ${formatAmount(amount)} ₽\n\nВыберите форму оплаты:`, {
        reply_markup: paymentMethodKeyboard()
      });
      return;
    }

    const service = await getActiveService(user.id, ctx.session.receiptDraft.serviceId);

    if (!service) {
      await sendMenu(ctx, "Услуга больше недоступна. Начните создание квитанции заново.", mainMenuKeyboard());
      return;
    }

    await sendMenu(
      ctx,
      buildReceiptPreviewText(
        service,
        {
          amount,
          paymentMethod: ctx.session.receiptDraft.paymentMethod
        }
      ),
      receiptPreviewKeyboard(),
      { parse_mode: "HTML" }
    );
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Некорректная сумма.");
  }
};

export const registerMessageHandlers = (bot: Bot<BotContext>): void => {
  bot.on("message:text", async (ctx) => {
    const text = ensureText(ctx);

    if (!text) {
      return;
    }

    switch (ctx.session.awaitingInput) {
      case "registration_inn":
        await handleRegistrationInn(ctx, text);
        return;
      case "registration_full_name":
        await handleRegistrationFullName(ctx, text);
        return;
      case "registration_address":
        await handleRegistrationAddress(ctx, text);
        return;
      case "profile_edit_inn":
        await handleProfileEdit(ctx, "inn", text);
        return;
      case "profile_edit_full_name":
        await handleProfileEdit(ctx, "ipFullName", text);
        return;
      case "profile_edit_address":
        await handleProfileEdit(ctx, "address", text);
        return;
      case "service_add":
        await handleAddService(ctx, text);
        return;
      case "receipt_amount":
        await handleReceiptAmount(ctx, text);
        return;
      default:
        await ctx.reply("Используйте кнопки меню ниже.", { reply_markup: mainMenuKeyboard() });
    }
  });
};
