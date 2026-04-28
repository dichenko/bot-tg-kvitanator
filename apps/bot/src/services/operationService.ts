import { promises as fs } from "node:fs";
import { InputFile } from "grammy";
import { prisma, OperationStatus, Prisma, RenderJobStatus } from "@receipt-bot/db";
import type { EntrepreneurProfile, Operation, Service, User } from "@receipt-bot/db";
import { PAYMENT_METHOD_LABELS } from "@receipt-bot/shared";
import type { Logger } from "pino";
import { config } from "../config";
import { mainMenuKeyboard } from "../keyboards";
import type { BotContext, ReceiptDraft } from "../types";
import { formatAmount, formatDateTime, formatPaymentMethod, formatOperationStatus } from "../utils/formatters";
import { escapeTelegramHtml } from "../utils/telegram";
import { renderReceipt } from "./rendererClient";

const RECEIPT_NUMBER_PREFIX = "KV-";
const RECEIPT_NUMBER_WIDTH = 6;
const MAX_RECEIPT_NUMBER_RETRIES = 5;

export const buildReceiptNumber = (sequenceNumber: number): string =>
  `${RECEIPT_NUMBER_PREFIX}${String(sequenceNumber).padStart(RECEIPT_NUMBER_WIDTH, "0")}`;

const parseReceiptSequenceNumber = (receiptNumber: string): number | null => {
  const match = receiptNumber.match(/^KV-(\d+)$/);

  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);

  return Number.isInteger(parsed) ? parsed : null;
};

const getNextReceiptNumberForUser = async (userId: number, tx: Prisma.TransactionClient): Promise<string> => {
  const latestOperation = await tx.operation.findFirst({
    where: {
      userId,
      receiptNumber: {
        startsWith: RECEIPT_NUMBER_PREFIX
      }
    },
    orderBy: {
      receiptNumber: "desc"
    },
    select: {
      receiptNumber: true
    }
  });

  const latestSequenceNumber = latestOperation ? (parseReceiptSequenceNumber(latestOperation.receiptNumber) ?? 0) : 0;

  return buildReceiptNumber(latestSequenceNumber + 1);
};

const isReceiptNumberConflict = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002" &&
  Array.isArray(error.meta?.target) &&
  error.meta.target.includes("userId") &&
  error.meta.target.includes("receiptNumber");

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

export const getLatestOperationForUser = async (userId: number): Promise<Operation | null> =>
  prisma.operation.findFirst({
    where: {
      userId,
      status: {
        not: OperationStatus.DELETED
      }
    },
    orderBy: {
      createdAt: "desc"
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
  service: Service,
  draft: Required<Pick<ReceiptDraft, "amount" | "paymentMethod">>
): string =>
  [
    "<b>Проверьте данные квитанции</b>",
    `<b>Услуга:</b> ${escapeTelegramHtml(service.title)}`,
    `<b>Сумма:</b> <code>${escapeTelegramHtml(`${formatAmount(draft.amount)} ₽`)}</code>`,
    `<b>Форма оплаты:</b> ${escapeTelegramHtml(formatPaymentMethod(draft.paymentMethod))}`
  ].join("\n");

export const createOperationWithSnapshots = async (
  user: User,
  profile: EntrepreneurProfile,
  service: Service,
  draft: Required<Pick<ReceiptDraft, "amount" | "paymentMethod">>
): Promise<Operation> => {
  for (let attempt = 0; attempt < MAX_RECEIPT_NUMBER_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const receiptNumber = await getNextReceiptNumberForUser(user.id, tx);

        const operation = await tx.operation.create({
          data: {
            userId: user.id,
            profileId: profile.id,
            serviceId: service.id,
            receiptNumber,
            innSnapshot: profile.inn,
            ipFullNameSnapshot: profile.ipFullName,
            addressSnapshot: profile.address,
            serviceTitleSnapshot: service.title,
            amount: new Prisma.Decimal(draft.amount),
            paymentMethod: draft.paymentMethod,
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
    } catch (error) {
      if (isReceiptNumberConflict(error) && attempt < MAX_RECEIPT_NUMBER_RETRIES - 1) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Failed to allocate receipt number for user");
};

export const sendExistingReceipt = async (
  ctx: BotContext,
  operation: Operation,
  logger: Logger,
  _timeZone: string
): Promise<void> => {
  if (!operation.imagePath) {
    await ctx.reply("Для этой операции файл квитанции пока недоступен.");
    return;
  }

  await fs.access(operation.imagePath);
  await ctx.replyWithPhoto(new InputFile(operation.imagePath));

  logger.info({ operationId: operation.id }, "Receipt resent to Telegram");
};

export const renderAndSendOperation = async (
  ctx: BotContext,
  user: User,
  operation: Operation,
  logger: Logger,
  pendingMessageId?: number
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

    await ctx.replyWithPhoto(new InputFile(renderResult.imagePath));

    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: OperationStatus.SENT,
        sentAt: new Date()
      }
    });

    await ctx.reply("Главное меню", { reply_markup: mainMenuKeyboard() });

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
  } finally {
    if (pendingMessageId && ctx.chat?.id) {
      await ctx.api.deleteMessage(ctx.chat.id, pendingMessageId).catch(() => undefined);
    }
  }
};
