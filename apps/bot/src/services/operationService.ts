import { promises as fs } from "node:fs";
import { prisma, OperationStatus, Prisma, RenderJobStatus } from "@receipt-bot/db";
import type { EntrepreneurProfile, Operation, PaymentMethod, Service, User } from "@receipt-bot/db";
import type { Logger } from "pino";
import { InputFile } from "grammy";
import { renderReceipt } from "./rendererClient";
import type { BotContext, ReceiptDraft } from "../types";
import { config } from "../config";
import { formatAmount, formatDateTime, formatPaymentMethod, formatOperationStatus } from "../utils/formatters";
import { PAYMENT_METHOD_LABELS } from "@receipt-bot/shared";

const createTemporaryReceiptNumber = (): string =>
  `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export const buildReceiptNumber = (operationId: number): string => `KV-${String(operationId).padStart(6, "0")}`;

export const listRecentOperations = async (userId: number): Promise<Operation[]> =>
  prisma.operation.findMany({
    where: {
      userId,
      status: {
        not: OperationStatus.DELETED
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 10
  });

export const getOperationByIdForUser = async (userId: number, operationId: number): Promise<Operation | null> =>
  prisma.operation.findFirst({
    where: {
      id: operationId,
      userId
    }
  });

export const buildOperationsSummary = (operations: Operation[], timeZone: string): string => {
  if (operations.length === 0) {
    return "Операций пока нет.";
  }

  return [
    "Последние 10 операций:",
    "",
    ...operations.map(
      (operation, index) =>
        `${index + 1}. ${formatDateTime(operation.createdAt, timeZone)} | ${operation.receiptNumber} | ${operation.serviceTitleSnapshot} | ${formatAmount(
          operation.amount
        )} ₽ | ${PAYMENT_METHOD_LABELS[operation.paymentMethod]} | ${formatOperationStatus(operation.status)}`
    )
  ].join("\n");
};

export const buildReceiptPreviewText = (
  profile: EntrepreneurProfile,
  service: Service,
  draft: Required<Pick<ReceiptDraft, "amount" | "paymentMethod">>,
  timeZone: string
): string =>
  [
    "Проверьте данные квитанции:",
    "",
    `ИП: ${profile.ipFullName}`,
    `ИНН: ${profile.inn}`,
    `Адрес: ${profile.address}`,
    `Услуга: ${service.title}`,
    `Сумма: ${formatAmount(draft.amount)} ₽`,
    `Форма оплаты: ${formatPaymentMethod(draft.paymentMethod)}`,
    `Дата: ${formatDateTime(new Date(), timeZone)}`
  ].join("\n");

export const createOperationWithSnapshots = async (
  user: User,
  profile: EntrepreneurProfile,
  service: Service,
  draft: Required<Pick<ReceiptDraft, "amount" | "paymentMethod">>
): Promise<Operation> => {
  const temporaryReceiptNumber = createTemporaryReceiptNumber();

  return prisma.$transaction(async (tx) => {
    const created = await tx.operation.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        serviceId: service.id,
        receiptNumber: temporaryReceiptNumber,
        innSnapshot: profile.inn,
        ipFullNameSnapshot: profile.ipFullName,
        addressSnapshot: profile.address,
        serviceTitleSnapshot: service.title,
        amount: new Prisma.Decimal(draft.amount),
        paymentMethod: draft.paymentMethod,
        status: OperationStatus.CONFIRMED
      }
    });

    const receiptNumber = buildReceiptNumber(created.id);

    const operation = await tx.operation.update({
      where: { id: created.id },
      data: {
        receiptNumber,
        status: OperationStatus.RENDERING
      }
    });

    await tx.renderJob.create({
      data: {
        operationId: operation.id,
        status: RenderJobStatus.PROCESSING,
        attempts: 1
      }
    });

    return operation;
  });
};

export const sendExistingReceipt = async (
  ctx: BotContext,
  operation: Operation,
  logger: Logger,
  timeZone: string
): Promise<void> => {
  if (!operation.imagePath) {
    await ctx.reply("Для этой операции файл квитанции пока недоступен.");
    return;
  }

  await fs.access(operation.imagePath);
  await ctx.replyWithPhoto(new InputFile(operation.imagePath), {
    caption: [
      `Квитанция ${operation.receiptNumber}`,
      `Дата: ${formatDateTime(operation.createdAt, timeZone)}`,
      `Услуга: ${operation.serviceTitleSnapshot}`,
      `Сумма: ${formatAmount(operation.amount)} ₽`,
      `Форма оплаты: ${formatPaymentMethod(operation.paymentMethod)}`
    ].join("\n")
  });

  logger.info({ operationId: operation.id }, "Receipt resent to Telegram");
};

export const renderAndSendOperation = async (
  ctx: BotContext,
  user: User,
  operation: Operation,
  logger: Logger
): Promise<void> => {
  logger.info({ operationId: operation.id, userId: user.id }, "Render started");

  try {
    const renderResult = await renderReceipt(config.rendererUrl, {
      operationId: operation.id,
      receiptNumber: operation.receiptNumber,
      createdAt: operation.createdAt.toISOString(),
      inn: operation.innSnapshot,
      ipFullName: operation.ipFullNameSnapshot,
      address: operation.addressSnapshot,
      serviceTitle: operation.serviceTitleSnapshot,
      amount: operation.amount.toString(),
      paymentMethod: operation.paymentMethod
    });

    if (!renderResult.ok || !renderResult.imagePath) {
      throw new Error(renderResult.error ?? "Renderer did not return image path");
    }

    await prisma.$transaction(async (tx) => {
      await tx.operation.update({
        where: { id: operation.id },
        data: {
          status: OperationStatus.RENDERED,
          imagePath: renderResult.imagePath,
          renderedAt: new Date(),
          errorMessage: null
        }
      });

      await tx.renderJob.update({
        where: { operationId: operation.id },
        data: {
          status: RenderJobStatus.DONE,
          errorMessage: null
        }
      });
    });

    await ctx.replyWithPhoto(new InputFile(renderResult.imagePath), {
      caption: [
        `Квитанция ${operation.receiptNumber}`,
        `Услуга: ${operation.serviceTitleSnapshot}`,
        `Сумма: ${formatAmount(operation.amount)} ₽`,
        `Форма оплаты: ${PAYMENT_METHOD_LABELS[operation.paymentMethod]}`
      ].join("\n")
    });

    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: OperationStatus.SENT,
        sentAt: new Date()
      }
    });

    logger.info({ operationId: operation.id, imagePath: renderResult.imagePath }, "Render success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown rendering error";

    await prisma.$transaction(async (tx) => {
      await tx.operation.update({
        where: { id: operation.id },
        data: {
          status: OperationStatus.FAILED,
          errorMessage: message
        }
      });

      await tx.renderJob.update({
        where: { operationId: operation.id },
        data: {
          status: RenderJobStatus.FAILED,
          errorMessage: message,
          attempts: {
            increment: 1
          }
        }
      });
    });

    logger.error({ err: error, operationId: operation.id }, "Render failure");
    await ctx.reply("Не удалось сформировать квитанцию. Операция сохранена, попробуйте позже.");
  }
};
