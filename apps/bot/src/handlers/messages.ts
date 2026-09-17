import type { Bot } from "grammy";
import { mainMenuKeyboard, receiptPreviewKeyboard, servicesKeyboard } from "../keyboards";
import { buildReceiptPreviewText } from "../services/operationService";
import { createService, getProfileByUserId, listActiveServices, updateProfileField, upsertProfile, upsertTelegramUser } from "../services/userService";
import type { BotContext } from "../types";
import { clearRegistrationDraft } from "../utils/state";
import { sendMenu } from "../utils/telegram";
import { parseAmountInput, parseQuantityInput, validateInn, validateOgrn, validateRequiredText, validateServiceTitle } from "../utils/validation";

const profileField = async (ctx: BotContext, field: "inn" | "ipFullName" | "address" | "ogrn", text: string) => { const user = await upsertTelegramUser(ctx.from!); const value = field === "inn" ? (() => { const r = validateInn(text); if (!r.valid || !r.normalized) throw new Error(r.message); return r.normalized; })() : field === "ogrn" ? validateOgrn(text === "-" ? "" : text) : validateRequiredText(text, field === "ipFullName" ? "ФИО ИП" : "Адрес оказания услуги"); await updateProfileField(user.id, field, value || null as any); ctx.session.awaitingInput = null; await sendMenu(ctx, "Данные ИП обновлены.", mainMenuKeyboard()); };
export const registerMessageHandlers = (bot: Bot<BotContext>): void => { bot.on("message:text", async ctx => {
  const text = ctx.message.text.trim(); if (!text) return;
  try {
    if (ctx.session.awaitingInput === "registration_inn") { const r = validateInn(text); if (!r.valid || !r.normalized) throw new Error(r.message); ctx.session.registrationDraft.inn = r.normalized; ctx.session.awaitingInput = "registration_full_name"; return void await ctx.reply("Введите ФИО ИП:"); }
    if (ctx.session.awaitingInput === "registration_full_name") { ctx.session.registrationDraft.ipFullName = validateRequiredText(text, "ФИО ИП"); ctx.session.awaitingInput = "registration_address"; return void await ctx.reply("Введите адрес оказания услуги:"); }
    if (ctx.session.awaitingInput === "registration_address") { const user = await upsertTelegramUser(ctx.from!); await upsertProfile(user.id, { inn: ctx.session.registrationDraft.inn ?? "", ipFullName: ctx.session.registrationDraft.ipFullName ?? "", address: validateRequiredText(text, "Адрес"), ogrn: "" }); clearRegistrationDraft(ctx.session); ctx.session.awaitingInput = "registration_ogrn"; return void await ctx.reply("Введите ОГРН (необязательно) или отправьте «-», чтобы пропустить:"); }
    if (ctx.session.awaitingInput === "registration_ogrn") { const user = await upsertTelegramUser(ctx.from!); await updateProfileField(user.id, "ogrn", validateOgrn(text === "-" ? "" : text) || null as any); clearRegistrationDraft(ctx.session); ctx.session.awaitingInput = null; return void await sendMenu(ctx, "Данные ИП сохранены. Главное меню:", mainMenuKeyboard()); }
    if (ctx.session.awaitingInput === "profile_edit_inn") return void await profileField(ctx, "inn", text);
    if (ctx.session.awaitingInput === "profile_edit_full_name") return void await profileField(ctx, "ipFullName", text);
    if (ctx.session.awaitingInput === "profile_edit_address") return void await profileField(ctx, "address", text);
    if (ctx.session.awaitingInput === "profile_edit_ogrn") return void await profileField(ctx, "ogrn", text);
    if (ctx.session.awaitingInput === "service_add") { const user = await upsertTelegramUser(ctx.from!); const title = validateServiceTitle(text); await createService(user.id, title); ctx.session.awaitingInput = null; return void await sendMenu(ctx, `Услуга «${title}» добавлена.`, servicesKeyboard()); }
    if (ctx.session.awaitingInput === "receipt_price" || ctx.session.awaitingInput === "receipt_quantity") { const user = await upsertTelegramUser(ctx.from!); const d = ctx.session.receiptDraft; const index = d?.editingItemIndex ?? -1; if (!d || !d.items[index]) throw new Error("Сначала выберите услугу."); if (ctx.session.awaitingInput === "receipt_price") d.items[index].price = parseAmountInput(text); else d.items[index].quantity = parseQuantityInput(text); ctx.session.awaitingInput = null; const services = await listActiveServices(user.id); return void await sendMenu(ctx, buildReceiptPreviewText(services, d), receiptPreviewKeyboard(d.paymentMethod ?? "BANK_TRANSFER", d.calculationType ?? "INCOME"), { parse_mode: "HTML" }); }
    await ctx.reply("Используйте кнопки меню ниже.", { reply_markup: mainMenuKeyboard() });
  } catch (e) { await ctx.reply(e instanceof Error ? e.message : "Не удалось сохранить данные."); }
}); };
