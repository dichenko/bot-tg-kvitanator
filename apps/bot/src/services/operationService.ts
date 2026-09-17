import { promises as fs } from "node:fs";
import { InputFile } from "grammy";
import { prisma, OperationStatus, Prisma, RenderJobStatus } from "@receipt-bot/db";
import type { EntrepreneurProfile, Operation, Service, User } from "@receipt-bot/db";
import { CALCULATION_TYPE_LABELS } from "@receipt-bot/shared";
import type { Logger } from "pino";
import { config } from "../config";
import { mainMenuKeyboard } from "../keyboards";
import type { BotContext, ReceiptDraft } from "../types";
import { formatAmount, formatDateTime, formatPaymentMethod } from "../utils/formatters";
import { escapeTelegramHtml } from "../utils/telegram";
import { renderReceipt } from "./rendererClient";

const PREFIX = "KV-";
const nextNumber = async (userId: number, tx: Prisma.TransactionClient) => {
  const last = await tx.operation.findFirst({ where: { userId, receiptNumber: { startsWith: PREFIX } }, orderBy: { id: "desc" } });
  return `${PREFIX}${String(Number(last?.receiptNumber.replace(PREFIX, "") ?? 0) + 1).padStart(6, "0")}`;
};
export const listRecentOperations = async (userId: number) => prisma.operation.findMany({ where: { userId, status: { not: OperationStatus.DELETED } }, orderBy: { createdAt: "desc" }, take: 10, include: { items: true } });
export const getOperationByIdForUser = async (userId: number, id: number) => prisma.operation.findFirst({ where: { id, userId, status: { not: OperationStatus.DELETED } }, include: { items: true } });
export const getLatestOperationForUser = async (userId: number) => prisma.operation.findFirst({ where: { userId, status: { not: OperationStatus.DELETED } }, orderBy: { createdAt: "desc" } });
export const buildOperationsSummary = (ops: Awaited<ReturnType<typeof listRecentOperations>>, zone: string) => ops.length ? ["Последние 10 квитанций:", "", ...ops.map((o, i) => `${i + 1}. ${formatDateTime(o.createdAt, zone)} — ${formatAmount(o.amount)} ₽ — ${o.items[0]?.title ?? o.serviceTitleSnapshot}`)].join("\n") : "Квитанций пока нет.";
export const buildReceiptPreviewText = (services: Service[], draft: ReceiptDraft) => {
  const rows = draft.items.map((i, n) => { const s = services.find(x => x.id === i.serviceId); const t = Number(i.quantity) * Number(i.price ?? 0); return `${n + 1}. ${escapeTelegramHtml(s?.title ?? "Услуга")} — ${i.quantity} × ${i.price ?? "…"} ₽ = ${formatAmount(t)} ₽`; });
  const total = draft.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.price ?? 0), 0);
  return ["<b>Проверьте данные квитанции</b>", ...rows, "", `<b>Итого:</b> <code>${formatAmount(total)} ₽</code>`, `<b>Признак расчёта:</b> ${CALCULATION_TYPE_LABELS[draft.calculationType ?? "INCOME"]}`, `<b>Форма оплаты:</b> ${formatPaymentMethod(draft.paymentMethod ?? "BANK_TRANSFER")}`].join("\n");
};
export const createOperationWithSnapshots = async (user: User, profile: EntrepreneurProfile, services: Service[], draft: ReceiptDraft): Promise<Operation> => {
  if (!draft.items.length || !draft.paymentMethod) throw new Error("Черновик квитанции неполный.");
  const paymentMethod = draft.paymentMethod;
  return prisma.$transaction(async tx => { const itemData = draft.items.map(i => { const s = services.find(x => x.id === i.serviceId); if (!s || !i.price) throw new Error("Не удалось найти услугу или цену."); const quantity = new Prisma.Decimal(i.quantity); const price = new Prisma.Decimal(i.price); return { serviceId: s.id, title: s.title, quantity, price, amount: quantity.mul(price) }; }); const total = itemData.reduce((sum, i) => sum.add(i.amount), new Prisma.Decimal(0)); const operation = await tx.operation.create({ data: { userId: user.id, profileId: profile.id, serviceId: itemData[0].serviceId, receiptNumber: await nextNumber(user.id, tx), innSnapshot: profile.inn, ogrnSnapshot: profile.ogrn, ipFullNameSnapshot: profile.ipFullName, addressSnapshot: profile.address, serviceTitleSnapshot: itemData[0].title, amount: total, paymentMethod, calculationType: draft.calculationType ?? "INCOME", status: OperationStatus.RENDERING, items: { create: itemData } } }); await tx.renderJob.create({ data: { operationId: operation.id, status: RenderJobStatus.PROCESSING, attempts: 1 } }); return operation; });
};
const payload = (o: Operation & { items: { title: string; quantity: Prisma.Decimal; price: Prisma.Decimal; amount: Prisma.Decimal }[] }) => ({ operationId: o.id, receiptNumber: o.receiptNumber, createdAt: o.createdAt.toISOString(), inn: o.innSnapshot, ogrn: o.ogrnSnapshot, ipFullName: o.ipFullNameSnapshot, address: o.addressSnapshot, calculationType: o.calculationType, items: o.items.map(i => ({ title: i.title, quantity: i.quantity.toString(), price: i.price.toString(), amount: i.amount.toString() })), amount: o.amount.toString(), paymentMethod: o.paymentMethod });
export const sendExistingReceipt = async (ctx: BotContext, o: Operation, logger: Logger, _zone: string) => { if (!o.imagePath) return void await ctx.reply("Для этой операции файл квитанции пока недоступен."); await fs.access(o.imagePath); await ctx.replyWithPhoto(new InputFile(o.imagePath)); await ctx.reply("Главное меню", { reply_markup: mainMenuKeyboard() }); logger.info({ operationId: o.id }, "Receipt resent to Telegram"); };
export const renderAndSendOperation = async (ctx: BotContext, user: User, operation: Operation, logger: Logger, pendingMessageId?: number) => { try { const o = await prisma.operation.findUniqueOrThrow({ where: { id: operation.id }, include: { items: true } }); const result = await renderReceipt(config.rendererUrl, payload(o)); if (!result.ok || !result.imagePath) throw new Error(result.error ?? "Renderer did not return image path"); await prisma.$transaction(async tx => { await tx.operation.update({ where: { id: o.id }, data: { status: OperationStatus.RENDERED, imagePath: result.imagePath, renderedAt: new Date(), errorMessage: null } }); await tx.renderJob.update({ where: { operationId: o.id }, data: { status: RenderJobStatus.DONE, errorMessage: null } }); }); await ctx.replyWithPhoto(new InputFile(result.imagePath)); await prisma.operation.update({ where: { id: o.id }, data: { status: OperationStatus.SENT, sentAt: new Date() } }); await ctx.reply("Главное меню", { reply_markup: mainMenuKeyboard() }); } catch (e) { const message = e instanceof Error ? e.message : "Unknown rendering error"; await prisma.operation.update({ where: { id: operation.id }, data: { status: OperationStatus.FAILED, errorMessage: message } }); logger.error({ err: e, operationId: operation.id, userId: user.id }, "Render failure"); await ctx.reply("Не удалось сформировать квитанцию. Операция сохранена, попробуйте позже."); } finally { if (pendingMessageId && ctx.chat?.id) await ctx.api.deleteMessage(ctx.chat.id, pendingMessageId).catch(() => undefined); } };
export const deleteOperationForUser = async (userId: number, id: number) => {
  const operation = await prisma.operation.findFirst({ where: { id, userId, status: { not: OperationStatus.DELETED } }, select: { id: true } });
  if (operation) await prisma.operation.delete({ where: { id: operation.id } });
};
