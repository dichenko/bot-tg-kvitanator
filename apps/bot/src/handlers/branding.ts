import { InlineKeyboard, InputFile, type Bot } from "grammy";
import { parseReceiptBranding, type ReceiptBranding } from "@receipt-bot/shared";
import type { EntrepreneurProfile } from "@receipt-bot/db";
import type { BotContext } from "../types";
import { getProfileByUserId, upsertTelegramUser } from "../services/userService";
import { canConfigureBranding, downloadTelegramLogo, MAX_LOGO_BYTES, removeBrandingPreview, renderBrandingPreview, saveReceiptBranding, storeLogo, validateBrandingText } from "../services/brandingService";
import { clearBrandingDraft } from "../utils/state";
import { sendMenu } from "../utils/telegram";
import { logger } from "../services/logger";
import { hasActiveSubscription } from "../services/subscriptionService";
import { cleanupBrandingDraftChange, releaseUnusedBrandingLogo, retainBrandingLogo } from "../services/brandingStorage";

const keyboard = () => new InlineKeyboard()
  .text("🖼 Загрузить логотип", "branding:logo").row()
  .text("✏️ Название", "branding:name").text("✏️ Подпись", "branding:subtitle").row()
  .text("👁 Предпросмотр", "branding:preview").row()
  .text("✅ Сохранить", "branding:save").text("Отмена", "branding:cancel").row()
  .text("Вернуть стандартное оформление", "branding:reset");

const backToSubscription = () => new InlineKeyboard().text("⬅️ Моя подписка", "menu:subscription");
const draft = (ctx: BotContext): ReceiptBranding => ctx.session.brandingDraft ?? { logoFileName: null, name: "", subtitle: "" };
const show = async (ctx: BotContext, message?: string) => {
  const value = parseReceiptBranding(ctx.session.brandingDraft);
  await sendMenu(ctx, [message, "Оформление квитанции · тестовый режим", "",
    value ? `Логотип: ${value.logoFileName ? "загружен" : "без картинки"}\nНазвание: ${value.name || "скрыто"}\nПодпись: ${value.subtitle || "скрыта"}` : "Стандартная шапка «Квитанатор».",
    "", "Изменения применятся к новым квитанциям после сохранения."].filter(line => line !== undefined).join("\n"), keyboard());
};

class SubscriptionRequiredError extends Error {
  constructor() { super("Брендированная квитанция доступна по подписке. Откройте «Моя подписка»."); }
}

const profileFor = async (ctx: BotContext): Promise<{ userId: number; profile: EntrepreneurProfile }> => {
  const user = await upsertTelegramUser(ctx.from!);
  if (!hasActiveSubscription(user.subscriptionUntil)) throw new SubscriptionRequiredError();
  const profile = await getProfileByUserId(user.id);
  if (!profile) throw new Error("Сначала заполните данные ИП через /start.");
  return { userId: user.id, profile };
};

export const registerBrandingHandlers = (bot: Bot<BotContext>): void => {
  // Leaving this editor discards the draft, including via an old menu button.
  bot.use(async (ctx, next) => {
    const previous = ctx.session.brandingDraft?.logoFileName;
    retainBrandingLogo(previous);
    try {
      if (ctx.callbackQuery?.data && !ctx.callbackQuery.data.startsWith("branding:")) clearBrandingDraft(ctx.session);
      await next();
    } finally {
      await cleanupBrandingDraftChange(previous, ctx.session).catch(error => logger.warn({ err: error }, "Draft logo cleanup failed"));
    }
  });

  bot.callbackQuery(/^branding:/, async ctx => {
    if (!canConfigureBranding(ctx)) {
      clearBrandingDraft(ctx.session);
      await ctx.answerCallbackQuery({ text: "Тестовое оформление недоступно.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery().catch(() => undefined);
    try {
      const { userId, profile } = await profileFor(ctx);
      const action = ctx.callbackQuery.data.slice("branding:".length);
      if (action === "open") {
        ctx.session.awaitingInput = null;
        ctx.session.brandingDraft = parseReceiptBranding(profile.receiptBranding);
        await show(ctx);
        return;
      }
      if (action === "cancel") {
        clearBrandingDraft(ctx.session);
        await sendMenu(ctx, "Изменения оформления отменены.", backToSubscription());
        return;
      }
      if (ctx.session.brandingDraft === undefined) {
        await ctx.reply("Откройте настройки оформления заново через «Моя подписка».");
        return;
      }
      ctx.session.awaitingInput = null;
      if (action === "logo" || action === "name" || action === "subtitle") {
        ctx.session.awaitingInput = `branding_${action}`;
        await ctx.reply(action === "logo" ? "Отправьте логотип как PNG или JPEG до 5 МБ. Лучше отправить как файл: PNG с прозрачным фоном, 512 × 512 или горизонтальный логотип. Картинка заменит логотип в шапке."
          : `Введите ${action === "name" ? "название (до 60 символов)" : "подпись (до 120 символов)"} одной строкой. Отправьте «-», чтобы скрыть текст.`,
        { reply_markup: new InlineKeyboard().text("⬅️ К оформлению", "branding:menu") });
      } else if (action === "reset") {
        ctx.session.brandingDraft = null;
        await show(ctx, "Выбрана стандартная шапка. Нажмите «Сохранить», чтобы применить.");
      } else if (action === "save") {
        await saveReceiptBranding(userId, parseReceiptBranding(ctx.session.brandingDraft));
        clearBrandingDraft(ctx.session);
        await sendMenu(ctx, "Оформление сохранено. Оно будет применяться к новым квитанциям.", backToSubscription());
      } else if (action === "preview") {
        await ctx.reply("Готовлю образец квитанции…");
        const filePath = await renderBrandingPreview(userId, profile, ctx.session.brandingDraft ?? null);
        try { await ctx.replyWithPhoto(new InputFile(filePath), { caption: "Образец. Операция и номер квитанции не создаются." }); }
        finally { await removeBrandingPreview(filePath); }
        await ctx.reply("Проверьте оформление и сохраните изменения.", { reply_markup: keyboard() });
      } else if (action === "menu") await show(ctx);
      else await ctx.reply("Неизвестное действие оформления.");
    } catch (error) {
      if (error instanceof SubscriptionRequiredError) {
        clearBrandingDraft(ctx.session);
        await ctx.reply(error.message, { reply_markup: backToSubscription() });
        return;
      }
      logger.warn({ userId: ctx.from.id, errorName: error instanceof Error ? error.name : "Error" }, "Branding action failed");
      await ctx.reply("Не удалось выполнить действие. Попробуйте снова или откройте оформление заново.", { reply_markup: new InlineKeyboard().text("К оформлению", "branding:open") });
    }
  });

  bot.on(["message:photo", "message:document"], async (ctx, next) => {
    if (ctx.session.awaitingInput !== "branding_logo") return next();
    if (!canConfigureBranding(ctx)) { clearBrandingDraft(ctx.session); return; }
    try {
      if (ctx.session.brandingDraft === undefined) throw new Error("Откройте настройки оформления заново.");
      const expectedDraft = draft(ctx);
      ctx.session.brandingDraft = expectedDraft;
      await profileFor(ctx);
      const photos = ctx.message.photo;
      const file = ctx.message.document ?? photos?.reduce((largest, photo) => photo.width * photo.height > largest.width * largest.height ? photo : largest);
      if (!file) throw new Error("Отправьте PNG или JPEG.");
      if ((file.file_size ?? 0) > MAX_LOGO_BYTES) throw new Error("Размер логотипа — не больше 5 МБ.");
      const info = await ctx.api.getFile(file.file_id).catch(() => { throw new Error("Не удалось получить файл. Отправьте его ещё раз."); });
      if (!info.file_path) throw new Error("Файл недоступен. Отправьте его ещё раз.");
      const logoFileName = await storeLogo(await downloadTelegramLogo(info.file_path));
      // A late download must not restore a draft after cancellation or navigation.
      if (ctx.session.awaitingInput !== "branding_logo" || ctx.session.brandingDraft !== expectedDraft) {
        await releaseUnusedBrandingLogo(logoFileName);
        return;
      }
      ctx.session.brandingDraft = { ...draft(ctx), logoFileName };
      ctx.session.awaitingInput = null;
      await show(ctx, "Логотип загружен. Можно добавить название и подпись или сразу посмотреть образец.");
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Не удалось загрузить логотип.");
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const awaiting = ctx.session.awaitingInput;
    if (!awaiting?.startsWith("branding_")) return next();
    if (!canConfigureBranding(ctx)) { clearBrandingDraft(ctx.session); return; }
    if (awaiting === "branding_logo") return void await ctx.reply("Отправьте картинку PNG или JPEG либо вернитесь к настройкам кнопкой выше.");
    try {
      if (!hasActiveSubscription((await upsertTelegramUser(ctx.from)).subscriptionUntil)) { clearBrandingDraft(ctx.session); throw new SubscriptionRequiredError(); }
      if (ctx.session.brandingDraft === undefined) throw new Error("Откройте настройки оформления заново.");
      const field = awaiting === "branding_name" ? "name" : "subtitle";
      ctx.session.brandingDraft = { ...draft(ctx), [field]: validateBrandingText(ctx.message.text, field) };
      ctx.session.awaitingInput = null;
      await show(ctx, "Текст обновлён в черновике.");
    } catch (error) { await ctx.reply(error instanceof Error ? error.message : "Не удалось сохранить текст."); }
  });
};
