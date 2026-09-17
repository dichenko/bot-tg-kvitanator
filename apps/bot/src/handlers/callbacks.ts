import { InlineKeyboard, type Bot } from "grammy";
import type { PaymentMethod } from "@receipt-bot/db";
import type { ExportRangeKey } from "@receipt-bot/shared";
import { config } from "../config";
import { deleteOperationConfirmKeyboard, deleteServiceConfirmKeyboard, mainMenuKeyboard, operationsKeyboard, paymentMethodKeyboard, profileKeyboard, receiptPreviewKeyboard, serviceSelectionKeyboard, servicesKeyboard } from "../keyboards";
import { startRegistration } from "./commands";
import { logger } from "../services/logger";
import { buildOperationsSummary, buildReceiptPreviewText, createOperationWithSnapshots, deleteOperationForUser, getLatestOperationForUser, getOperationByIdForUser, listRecentOperations, renderAndSendOperation, sendExistingReceipt } from "../services/operationService";
import { buildExportFile, getOperationsForExport } from "../services/exportService";
import { getActiveService, getProfileByUserId, listActiveServices, softDeleteService, upsertTelegramUser } from "../services/userService";
import type { BotContext } from "../types";
import { clearReceiptDraft } from "../utils/state";
import { sendMenu } from "../utils/telegram";

const ensure = async (ctx: BotContext) => { const user = await upsertTelegramUser(ctx.from!); const profile = await getProfileByUserId(user.id); if (!profile) { await startRegistration(ctx); return null; } return { user, profile }; };
const showServices = async (ctx: BotContext, userId: number) => { const s = await listActiveServices(userId); await sendMenu(ctx, ["Активные услуги:", "", ...(s.length ? s.map((x, i) => `${i + 1}. ${x.title}`) : ["Список услуг пока пуст."])].join("\n"), servicesKeyboard()); };
const selectService = async (ctx: BotContext, userId: number) => { const s = await listActiveServices(userId); await sendMenu(ctx, s.length ? "Выберите услугу/товар:" : "Сначала добавьте услугу.", s.length ? serviceSelectionKeyboard(s, "receipt:service") : servicesKeyboard()); };
const preview = async (ctx: BotContext, userId: number) => { const d = ctx.session.receiptDraft; const services = await listActiveServices(userId); if (!d?.items.length || d.items.some(x => !x.price) || !d.paymentMethod) return void await ctx.reply("Заполните цену для позиции."); await sendMenu(ctx, buildReceiptPreviewText(services, d), receiptPreviewKeyboard(d.paymentMethod, d.calculationType ?? "INCOME"), { parse_mode: "HTML" }); };
const showOps = async (ctx: BotContext, userId: number) => { const ops = await listRecentOperations(userId); await sendMenu(ctx, buildOperationsSummary(ops, config.timezone), operationsKeyboard(ops)); };

export const registerCallbackHandlers = (bot: Bot<BotContext>): void => { bot.on("callback_query:data", async ctx => {
  const data = ctx.callbackQuery.data; await ctx.answerCallbackQuery().catch(() => undefined);
  if (data === "menu:main") { clearReceiptDraft(ctx.session); return void await sendMenu(ctx, "Главное меню", mainMenuKeyboard()); }
  const e = await ensure(ctx); if (!e) return; const { user, profile } = e;
  if (data === "menu:profile") return void await sendMenu(ctx, [`ИНН: ${profile.inn}`, `ОГРН: ${profile.ogrn ?? "не указан"}`, `ИП: ${profile.ipFullName}`, `Адрес оказания услуги: ${profile.address}`].join("\n"), profileKeyboard());
  if (data === "menu:services") return void await showServices(ctx, user.id);
  if (data === "menu:operations") return void await showOps(ctx, user.id);
  if (data === "menu:export") { const operations = await getOperationsForExport(user.id, "all_time" as ExportRangeKey, config.timezone); const f = await buildExportFile(operations, { userId: user.id, rangeKey: "all_time", exportsDir: config.exportsDir, timeZone: config.timezone }); await ctx.replyWithDocument(f.filePath); return; }
  if (data === "menu:receipt:new") { const last = await getLatestOperationForUser(user.id); ctx.session.receiptDraft = { items: [], paymentMethod: last?.paymentMethod ?? "BANK_TRANSFER", calculationType: "INCOME", submitted: false }; return void await selectService(ctx, user.id); }
  if (data.startsWith("profile:edit:")) { const field = data.split(":").pop(); const map: Record<string, [any, string]> = { inn: ["profile_edit_inn", "Введите новый ИНН:"], full_name: ["profile_edit_full_name", "Введите новое ФИО ИП:"], address: ["profile_edit_address", "Введите новый адрес оказания услуги:"], ogrn: ["profile_edit_ogrn", "Введите ОГРН или отправьте «-», чтобы очистить:"] }; const v = map[field ?? ""]; if (v) { ctx.session.awaitingInput = v[0]; return void await ctx.reply(v[1]); } }
  if (data === "service:add") { ctx.session.awaitingInput = "service_add"; return void await ctx.reply("Введите название услуги:"); }
  if (data === "service:delete") { const s = await listActiveServices(user.id); return void await sendMenu(ctx, "Выберите услугу для удаления:", serviceSelectionKeyboard(s, "service:delete:select")); }
  if (data.startsWith("service:delete:select:")) { const s = await getActiveService(user.id, Number(data.split(":").pop())); return void await sendMenu(ctx, s ? `Удалить услугу «${s.title}»?` : "Услуга не найдена.", s ? deleteServiceConfirmKeyboard(s.id) : mainMenuKeyboard()); }
  if (data.startsWith("service:delete:confirm:")) { await softDeleteService(user.id, Number(data.split(":").pop())); return void await showServices(ctx, user.id); }
  if (data === "receipt:add:item") return void await selectService(ctx, user.id);
  if (data.startsWith("receipt:service:")) { const id = Number(data.split(":").pop()); if (!await getActiveService(user.id, id)) return void await ctx.reply("Услуга не найдена."); const d = ctx.session.receiptDraft; if (!d) return; d.items.push({ serviceId: id, quantity: "1" }); d.editingItemIndex = d.items.length - 1; ctx.session.awaitingInput = "receipt_price"; return void await ctx.reply("Введите цену за единицу:"); }
  if (data === "receipt:change:price" || data === "receipt:change:quantity") { const d = ctx.session.receiptDraft; if (!d?.items.length) return void await selectService(ctx, user.id); d.editingItemIndex = d.items.length - 1; ctx.session.awaitingInput = data.endsWith("price") ? "receipt_price" : "receipt_quantity"; return void await ctx.reply(data.endsWith("price") ? "Введите новую цену за единицу:" : "Введите количество:"); }
  if (data === "receipt:toggle:calculation") { const d = ctx.session.receiptDraft; if (!d) return; d.calculationType = d.calculationType === "INCOME" ? "INCOME_RETURN" : "INCOME"; return void await preview(ctx, user.id); }
  if (data.startsWith("receipt:payment:")) { const d = ctx.session.receiptDraft; if (!d) return; d.paymentMethod = data.split(":").pop() as PaymentMethod; return void await preview(ctx, user.id); }
  if (data === "receipt:change:payment") return void await ctx.reply("Выберите форму оплаты:", { reply_markup: paymentMethodKeyboard() });
  if (data === "receipt:cancel") { clearReceiptDraft(ctx.session); return void await sendMenu(ctx, "Создание квитанции отменено.", mainMenuKeyboard()); }
  if (data === "receipt:confirm") { const d = ctx.session.receiptDraft; if (!d?.items.length || d.items.some(x => !x.price) || !d.paymentMethod || d.submitted) return void await ctx.reply("Черновик квитанции неполный или уже отправлен."); const s = await listActiveServices(user.id); d.submitted = true; const o = await createOperationWithSnapshots(user, profile, s, d); const pending = await ctx.reply(`Квитанция ${o.receiptNumber} формируется.`); await renderAndSendOperation(ctx, user, o, logger, pending.message_id); clearReceiptDraft(ctx.session); return; }
  if (data.startsWith("history:show:")) { const o = await getOperationByIdForUser(user.id, Number(data.split(":").pop())); return void await (o ? sendExistingReceipt(ctx, o, logger, config.timezone) : ctx.reply("Квитанция не найдена.")); }
  if (data.startsWith("history:delete:") && !data.includes(":confirm:")) { const o = await getOperationByIdForUser(user.id, Number(data.split(":").pop())); return void await sendMenu(ctx, o ? `Удалить квитанцию №${o.receiptNumber} на сумму ${o.amount} руб?` : "Квитанция не найдена.", o ? deleteOperationConfirmKeyboard(o.id) : mainMenuKeyboard()); }
  if (data.startsWith("history:delete:confirm:")) { await deleteOperationForUser(user.id, Number(data.split(":").pop())); return void await showOps(ctx, user.id); }
  await ctx.reply("Неизвестное действие.", { reply_markup: new InlineKeyboard().text("Главное меню", "menu:main") });
}); };
