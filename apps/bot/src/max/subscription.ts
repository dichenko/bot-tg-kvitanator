import { parseReceiptBranding, type ReceiptBranding } from "@receipt-bot/shared";
import type { EntrepreneurProfile, User } from "@receipt-bot/db";
import { downloadMaxLogo, isBrandingAvailable, MAX_LOGO_BYTES, removeBrandingPreview, renderBrandingPreview, saveReceiptBranding, storeLogo, validateBrandingText } from "../services/brandingService";
import { buildSubscriptionText, canRenewSubscription, formatSubscriptionDate, hasActiveSubscription, purchaseSubscription } from "../services/subscriptionService";
import { getProfileByUserId, upsertMaxUser } from "../services/userService";
import { releaseUnusedBrandingLogo } from "../services/brandingStorage";
import { clearBrandingDraft } from "../utils/state";
import { logger } from "../services/logger";
import { SUPPORT_FAILED, SUPPORT_PROMPT, SUPPORT_THANKS, sendSupportMessage, validateSupportText } from "../services/supportService";
import { backToSubscriptionKeyboard, brandingKeyboard, mainMenuKeyboard, subscriptionKeyboard } from "./keyboards";
import type { MaxBotContext } from "./types";

// MAX counterpart of handlers/subscription.ts and handlers/branding.ts (same rules, MAX user id).
const emptyDraft = (): ReceiptBranding => ({ logoFileName: null, name: "", subtitle: "" });
const draft = (ctx: MaxBotContext): ReceiptBranding => ctx.session.brandingDraft ?? emptyDraft();
const maxUser = (ctx: MaxBotContext): Promise<User> => upsertMaxUser({ id: ctx.user.id, username: ctx.user.username, firstName: ctx.user.firstName, lastName: ctx.user.lastName });

class SubscriptionRequiredError extends Error {
  constructor() { super("Брендированная квитанция доступна по подписке. Откройте «Моя подписка»."); }
}

export const MAX_SUBSCRIPTION_PAYLOADS = /^(menu:subscription|sub:(buy|sync)|support:open)$/;

const showSubscription = async (ctx: MaxBotContext, user: User, timeZone: string, message?: string): Promise<void> => {
  await ctx.sendMenu([message, buildSubscriptionText(user, timeZone)].filter(Boolean).join("\n\n"),
    subscriptionKeyboard(hasActiveSubscription(user.subscriptionUntil), canRenewSubscription(user.subscriptionUntil)));
};

const showBranding = async (ctx: MaxBotContext, message?: string): Promise<void> => {
  const value = parseReceiptBranding(ctx.session.brandingDraft);
  await ctx.sendMenu([message, "Оформление квитанции", "",
    value ? `Логотип: ${value.logoFileName ? "загружен" : "без картинки"}\nНазвание: ${value.name || "скрыто"}\nПодпись: ${value.subtitle || "скрыта"}` : "Стандартная шапка «Квитанатор».",
    "", "Изменения применятся к новым квитанциям после сохранения."].filter(line => line !== undefined).join("\n"), brandingKeyboard());
};

const requireSubscribed = (user: User): void => {
  if (!isBrandingAvailable(user.maxId) || !hasActiveSubscription(user.subscriptionUntil)) throw new SubscriptionRequiredError();
};

/** Handles menu:subscription, sub:* and branding:* callbacks. Returns false when the payload is not ours. */
export const handleMaxSubscriptionCallback = async (ctx: MaxBotContext, data: string, user: User, profile: EntrepreneurProfile): Promise<boolean> => {
  if (MAX_SUBSCRIPTION_PAYLOADS.test(data)) {
    if (!isBrandingAvailable(user.maxId)) { await ctx.reply("Подписка пока недоступна."); return true; }
    if (data === "support:open") {
      ctx.session.awaitingInput = "support_message";
      await ctx.sendMenu(SUPPORT_PROMPT, backToSubscriptionKeyboard());
      return true;
    }
    if (data === "sub:sync") {
      // Placeholder: Max/Telegram synchronisation is not implemented yet.
      await ctx.reply(hasActiveSubscription(user.subscriptionUntil) ? "Функция пока недоступна." : "Функция доступна по подписке.");
      return true;
    }
    if (data === "sub:buy") {
      const until = await purchaseSubscription(user.id);
      const fresh = await maxUser(ctx);
      const message = until ? `Подписка оформлена до ${formatSubscriptionDate(until, profile.timeZone)}. Подарок первым пользователям: подписка на год - бесплатно!`
        : "Подписка уже активна. Продлить её можно за 3 дня до окончания.";
      await showSubscription(ctx, fresh, profile.timeZone, message);
      return true;
    }
    await showSubscription(ctx, user, profile.timeZone);
    return true;
  }
  if (!data.startsWith("branding:")) return false;
  if (!isBrandingAvailable(user.maxId)) { clearBrandingDraft(ctx.session); await ctx.reply("Оформление квитанции недоступно."); return true; }
  try {
    requireSubscribed(user);
    const action = data.slice("branding:".length);
    if (action === "open") {
      ctx.session.awaitingInput = null;
      ctx.session.brandingDraft = parseReceiptBranding(profile.receiptBranding);
      await showBranding(ctx);
      return true;
    }
    if (action === "cancel") {
      clearBrandingDraft(ctx.session);
      await ctx.sendMenu("Изменения оформления отменены.", backToSubscriptionKeyboard());
      return true;
    }
    if (ctx.session.brandingDraft === undefined) { await ctx.reply("Откройте настройки оформления заново через «Моя подписка»."); return true; }
    ctx.session.awaitingInput = null;
    if (action === "logo" || action === "name" || action === "subtitle") {
      ctx.session.awaitingInput = `branding_${action}`;
      await ctx.reply(action === "logo" ? "Отправьте логотип как PNG или JPEG до 5 МБ. Лучше отправить как файл: PNG с прозрачным фоном, 512 × 512 или горизонтальный логотип. Картинка заменит логотип в шапке."
        : `Введите ${action === "name" ? "название (до 60 символов)" : "подпись (до 120 символов)"} одной строкой. Отправьте «-», чтобы скрыть текст.`,
      { keyboard: [[{ text: "⬅️ К оформлению", payload: "branding:menu" }]] });
    } else if (action === "reset") {
      ctx.session.brandingDraft = null;
      await showBranding(ctx, "Выбрана стандартная шапка. Нажмите «Сохранить», чтобы применить.");
    } else if (action === "save") {
      await saveReceiptBranding(user.id, parseReceiptBranding(ctx.session.brandingDraft));
      clearBrandingDraft(ctx.session);
      await ctx.sendMenu("Оформление сохранено. Оно будет применяться к новым квитанциям.", backToSubscriptionKeyboard());
    } else if (action === "preview") {
      await ctx.reply("Готовлю образец квитанции…");
      const filePath = await renderBrandingPreview(user.id, profile, ctx.session.brandingDraft ?? null);
      try { await ctx.sendImage(filePath); } finally { await removeBrandingPreview(filePath); }
      await ctx.sendMenu("Проверьте оформление и сохраните изменения.", brandingKeyboard());
    } else if (action === "menu") await showBranding(ctx);
    else await ctx.reply("Неизвестное действие оформления.");
  } catch (error) {
    if (error instanceof SubscriptionRequiredError) {
      clearBrandingDraft(ctx.session);
      await ctx.sendMenu(error.message, backToSubscriptionKeyboard());
      return true;
    }
    logger.warn({ userId: ctx.user.id, errorName: error instanceof Error ? error.name : "Error" }, "MAX branding action failed");
    await ctx.sendMenu("Не удалось выполнить действие. Попробуйте снова или откройте оформление заново.", backToSubscriptionKeyboard());
  }
  return true;
};

/** While the support screen waits for a message, forwards the text to the admin. Returns false otherwise. */
export const handleMaxSupportInput = async (ctx: MaxBotContext, value: string): Promise<boolean> => {
  if (ctx.session.awaitingInput !== "support_message") return false;
  const invalid = validateSupportText(value);
  if (invalid) { await ctx.reply(invalid); return true; }
  try {
    const user = await maxUser(ctx);
    await sendSupportMessage(user.id, "MAX", value);
  } catch (error) {
    logger.error({ err: error, userId: ctx.user.id }, "MAX support message delivery failed");
    await ctx.reply(SUPPORT_FAILED);
    return true;
  }
  ctx.session.awaitingInput = null;
  await ctx.sendMenu(`${SUPPORT_THANKS}\n\nГлавное меню`, mainMenuKeyboard());
  return true;
};

type Attachment = { type?: unknown; payload?: { url?: unknown } | null; size?: unknown };

/** The first image/file attachment with a download URL (MAX sends a temporary link). */
const logoAttachment = (attachments: unknown[] | undefined): { url: string; size: number } | null => {
  for (const item of (attachments ?? []) as Attachment[]) {
    if (!item || (item.type !== "image" && item.type !== "file")) continue;
    const url = item.payload?.url;
    if (typeof url === "string") return { url, size: typeof item.size === "number" ? item.size : 0 };
  }
  return null;
};

/** Handles messages while the branding editor waits for a logo/name/subtitle. Returns false otherwise. */
export const handleMaxBrandingInput = async (ctx: MaxBotContext, value: string, attachments: unknown[] | undefined): Promise<boolean> => {
  const awaiting = ctx.session.awaitingInput;
  if (!awaiting?.startsWith("branding_")) return false;
  try {
    const user = await maxUser(ctx);
    if (!isBrandingAvailable(user.maxId)) { clearBrandingDraft(ctx.session); await ctx.reply("Оформление квитанции недоступно."); return true; }
    requireSubscribed(user);
    if (ctx.session.brandingDraft === undefined) throw new Error("Откройте настройки оформления заново.");
    if (awaiting === "branding_logo") {
      const file = logoAttachment(attachments);
      if (!file) return void await ctx.reply("Отправьте картинку PNG или JPEG либо вернитесь к настройкам кнопкой выше."), true;
      if (file.size > MAX_LOGO_BYTES) throw new Error("Размер логотипа — не больше 5 МБ.");
      const expectedDraft = draft(ctx);
      ctx.session.brandingDraft = expectedDraft;
      const logoFileName = await storeLogo(await downloadMaxLogo(file.url));
      if (ctx.session.awaitingInput !== "branding_logo" || ctx.session.brandingDraft !== expectedDraft) { await releaseUnusedBrandingLogo(logoFileName); return true; }
      ctx.session.brandingDraft = { ...draft(ctx), logoFileName };
      ctx.session.awaitingInput = null;
      await showBranding(ctx, "Логотип загружен. Можно добавить название и подпись или сразу посмотреть образец.");
      return true;
    }
    const field = awaiting === "branding_name" ? "name" : "subtitle";
    ctx.session.brandingDraft = { ...draft(ctx), [field]: validateBrandingText(value, field) };
    ctx.session.awaitingInput = null;
    await showBranding(ctx, "Текст обновлён в черновике.");
  } catch (error) {
    if (error instanceof SubscriptionRequiredError) { clearBrandingDraft(ctx.session); await ctx.sendMenu(error.message, backToSubscriptionKeyboard()); return true; }
    await ctx.reply(error instanceof Error ? error.message : "Не удалось сохранить оформление.");
  }
  return true;
};