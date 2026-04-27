import { InputFile, InlineKeyboard, type Bot } from "grammy";
import type { PaymentMethod } from "@receipt-bot/db";
import type { ExportRangeKey } from "@receipt-bot/shared";
import { config } from "../config";
import {
  deleteServiceConfirmKeyboard,
  exportKeyboard,
  mainMenuKeyboard,
  operationsKeyboard,
  paymentMethodKeyboard,
  profileKeyboard,
  receiptPreviewKeyboard,
  serviceSelectionKeyboard,
  servicesKeyboard
} from "../keyboards";
import { startRegistration } from "./commands";
import { logger } from "../services/logger";
import {
  buildOperationsSummary,
  buildReceiptPreviewText,
  createOperationWithSnapshots,
  getLatestOperationForUser,
  getOperationByIdForUser,
  listRecentOperations,
  renderAndSendOperation,
  sendExistingReceipt
} from "../services/operationService";
import { buildExportFile, getOperationsForExport } from "../services/exportService";
import {
  getActiveService,
  getProfileByUserId,
  listActiveServices,
  softDeleteService,
  upsertTelegramUser
} from "../services/userService";
import type { BotContext } from "../types";
import { clearReceiptDraft } from "../utils/state";
import { formatPaymentMethod } from "../utils/formatters";
import { sendMenu } from "../utils/telegram";

const ensureUserAndProfile = async (ctx: BotContext) => {
  const user = await upsertTelegramUser(ctx.from!);
  const profile = await getProfileByUserId(user.id);

  if (!profile) {
    await startRegistration(ctx);
    return null;
  }

  return { user, profile };
};

const showServicesMenu = async (ctx: BotContext, userId: number): Promise<void> => {
  const services = await listActiveServices(userId);
  const lines = services.length > 0 ? services.map((service, index) => `${index + 1}. ${service.title}`) : ["Список услуг пока пуст."];

  await sendMenu(ctx, ["Активные услуги:", "", ...lines].join("\n"), servicesKeyboard());
};

const showProfile = async (ctx: BotContext, userId: number): Promise<void> => {
  const profile = await getProfileByUserId(userId);

  if (!profile) {
    await startRegistration(ctx);
    return;
  }

  await sendMenu(
    ctx,
    [`ИНН: ${profile.inn}`, `ИП: ${profile.ipFullName}`, `Адрес оказания услуги: ${profile.address}`].join("\n"),
    profileKeyboard()
  );
};

const showReceiptServiceSelection = async (ctx: BotContext, userId: number): Promise<void> => {
  const services = await listActiveServices(userId);

  if (services.length === 0) {
    await sendMenu(ctx, "Сначала добавьте хотя бы одну услугу.", servicesKeyboard());
    return;
  }

  await sendMenu(ctx, "Выберите услугу для квитанции:", serviceSelectionKeyboard(services, "receipt:service"));
};

const showDeleteServiceSelection = async (ctx: BotContext, userId: number): Promise<void> => {
  const services = await listActiveServices(userId);

  if (services.length === 0) {
    await sendMenu(ctx, "Удалять пока нечего. Список услуг пуст.", servicesKeyboard());
    return;
  }

  await sendMenu(ctx, "Выберите услугу для удаления:", serviceSelectionKeyboard(services, "service:delete:select"));
};

const showPreviewIfReady = async (ctx: BotContext, userId: number): Promise<void> => {
  const draft = ctx.session.receiptDraft;

  if (!draft?.serviceId || !draft.amount || !draft.paymentMethod) {
    await ctx.reply("Не удалось собрать данные черновика. Начните заново.", {
      reply_markup: mainMenuKeyboard()
    });
    return;
  }

  const service = await getActiveService(userId, draft.serviceId);

  if (!service) {
    await ctx.reply("Выбранная услуга больше недоступна. Начните заново.", {
      reply_markup: mainMenuKeyboard()
    });
    return;
  }

  await sendMenu(
    ctx,
    buildReceiptPreviewText(
      service,
      {
        amount: draft.amount,
        paymentMethod: draft.paymentMethod
      },
      config.timezone
    ),
    receiptPreviewKeyboard(),
    { parse_mode: "HTML" }
  );
};

const showOperations = async (ctx: BotContext, userId: number): Promise<void> => {
  const operations = await listRecentOperations(userId);
  await sendMenu(ctx, buildOperationsSummary(operations, config.timezone), operationsKeyboard(operations));
};

const sendExport = async (ctx: BotContext, userId: number, rangeKey: ExportRangeKey): Promise<void> => {
  const operations = await getOperationsForExport(userId, rangeKey, config.timezone);
  const { fileName, filePath } = await buildExportFile(operations, {
    userId,
    rangeKey,
    exportsDir: config.exportsDir,
    timeZone: config.timezone
  });

  logger.info({ userId, rangeKey, operationCount: operations.length }, "Excel export generated");
  await ctx.replyWithDocument(new InputFile(filePath, fileName), {
    caption: `Excel-выгрузка готова: ${fileName}`
  });
};

const startReceiptFlow = async (ctx: BotContext, userId: number): Promise<void> => {
  const [lastOperation, services] = await Promise.all([getLatestOperationForUser(userId), listActiveServices(userId)]);
  const paymentMethod = lastOperation?.paymentMethod ?? "BANK_TRANSFER";

  let service = null;

  if (lastOperation?.serviceId) {
    service = services.find((item) => item.id === lastOperation.serviceId) ?? null;
  }

  if (!service && services.length === 1) {
    service = services[0];
  }

  ctx.session.receiptDraft = {
    serviceId: service?.id,
    paymentMethod,
    submitted: false
  };
  ctx.session.awaitingInput = null;

  if (services.length === 0) {
    await sendMenu(ctx, "Сначала добавьте хотя бы одну услугу.", servicesKeyboard());
    return;
  }

  if (!service) {
    await showReceiptServiceSelection(ctx, userId);
    return;
  }

  ctx.session.awaitingInput = "receipt_amount";
  await ctx.reply(
    [`Услуга: «${service.title}»`, `Форма оплаты: ${formatPaymentMethod(paymentMethod)}`, "", "Введите сумму поступления:"].join("\n")
  );
};

export const registerCallbackHandlers = (bot: Bot<BotContext>): void => {
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => undefined);

    if (data === "menu:main") {
      clearReceiptDraft(ctx.session);
      await sendMenu(ctx, "Главное меню", mainMenuKeyboard());
      return;
    }

    const ensured = await ensureUserAndProfile(ctx);

    if (!ensured) {
      return;
    }

    const { user, profile } = ensured;

    if (data === "menu:profile") {
      await showProfile(ctx, user.id);
      return;
    }

    if (data === "menu:services") {
      await showServicesMenu(ctx, user.id);
      return;
    }

    if (data === "menu:receipt:new") {
      await startReceiptFlow(ctx, user.id);
      return;
    }

    if (data === "menu:operations") {
      await showOperations(ctx, user.id);
      return;
    }

    if (data === "menu:export") {
      await sendMenu(ctx, "Выберите период для Excel-выгрузки:", exportKeyboard());
      return;
    }

    if (data === "profile:edit:inn") {
      ctx.session.awaitingInput = "profile_edit_inn";
      await ctx.reply("Введите новый ИНН:");
      return;
    }

    if (data === "profile:edit:full_name") {
      ctx.session.awaitingInput = "profile_edit_full_name";
      await ctx.reply("Введите новое ФИО ИП:");
      return;
    }

    if (data === "profile:edit:address") {
      ctx.session.awaitingInput = "profile_edit_address";
      await ctx.reply("Введите новый адрес оказания услуги:");
      return;
    }

    if (data === "service:add") {
      ctx.session.awaitingInput = "service_add";
      await ctx.reply("Введите название услуги:");
      return;
    }

    if (data === "service:delete") {
      await showDeleteServiceSelection(ctx, user.id);
      return;
    }

    if (data.startsWith("service:delete:select:")) {
      const serviceId = Number(data.split(":").pop());
      const service = await getActiveService(user.id, serviceId);

      if (!service) {
        await ctx.reply("Услуга не найдена.");
        return;
      }

      await sendMenu(ctx, `Удалить услугу «${service.title}»?`, deleteServiceConfirmKeyboard(service.id));
      return;
    }

    if (data.startsWith("service:delete:confirm:")) {
      const serviceId = Number(data.split(":").pop());
      await softDeleteService(user.id, serviceId);
      await showServicesMenu(ctx, user.id);
      return;
    }

    if (data.startsWith("receipt:service:")) {
      const serviceId = Number(data.split(":").pop());
      const service = await getActiveService(user.id, serviceId);

      if (!service) {
        await ctx.reply("Услуга не найдена или уже удалена.");
        return;
      }

      const paymentMethod = ctx.session.receiptDraft?.paymentMethod ?? "BANK_TRANSFER";

      ctx.session.receiptDraft = {
        ...ctx.session.receiptDraft,
        serviceId,
        paymentMethod,
        submitted: false
      };

      if (!ctx.session.receiptDraft.amount) {
        ctx.session.awaitingInput = "receipt_amount";
        await ctx.reply(
          [`Услуга: «${service.title}»`, `Форма оплаты: ${formatPaymentMethod(paymentMethod)}`, "", "Введите сумму поступления:"].join("\n")
        );
        return;
      }

      await showPreviewIfReady(ctx, user.id);
      return;
    }

    if (data === "receipt:change:service") {
      await showReceiptServiceSelection(ctx, user.id);
      return;
    }

    if (data === "receipt:change:amount") {
      ctx.session.awaitingInput = "receipt_amount";
      await ctx.reply("Введите новую сумму:");
      return;
    }

    if (data === "receipt:change:payment") {
      await ctx.reply("Выберите новую форму оплаты:", { reply_markup: paymentMethodKeyboard() });
      return;
    }

    if (data.startsWith("receipt:payment:")) {
      const paymentMethod = data.split(":").pop() as PaymentMethod;

      ctx.session.receiptDraft = {
        ...ctx.session.receiptDraft,
        paymentMethod,
        submitted: false
      };

      if (!ctx.session.receiptDraft?.amount) {
        ctx.session.awaitingInput = "receipt_amount";
        await ctx.reply("Введите сумму:");
        return;
      }

      await showPreviewIfReady(ctx, user.id);
      return;
    }

    if (data === "receipt:cancel") {
      clearReceiptDraft(ctx.session);
      await sendMenu(ctx, "Создание квитанции отменено.", mainMenuKeyboard());
      return;
    }

    if (data === "receipt:confirm") {
      const draft = ctx.session.receiptDraft;

      if (!draft?.serviceId || !draft.amount || !draft.paymentMethod) {
        await ctx.reply("Черновик квитанции неполный. Начните заново.", { reply_markup: mainMenuKeyboard() });
        return;
      }

      if (draft.submitted) {
        await ctx.reply("Квитанция уже формируется. Подождите немного.");
        return;
      }

      const service = await getActiveService(user.id, draft.serviceId);

      if (!service) {
        await ctx.reply("Выбранная услуга больше недоступна.");
        return;
      }

      ctx.session.receiptDraft = {
        ...draft,
        submitted: true
      };

      const operation = await createOperationWithSnapshots(user, profile, service, {
        amount: draft.amount,
        paymentMethod: draft.paymentMethod
      });

      logger.info({ operationId: operation.id, userId: user.id }, "Operation created");
      await ctx.reply(`Квитанция ${operation.receiptNumber} формируется. Подождите несколько секунд.`);
      await renderAndSendOperation(ctx, user, operation, logger);
      clearReceiptDraft(ctx.session);
      return;
    }

    if (data.startsWith("history:resend:")) {
      const operationId = Number(data.split(":").pop());
      const operation = await getOperationByIdForUser(user.id, operationId);

      if (!operation) {
        await ctx.reply("Операция не найдена.");
        return;
      }

      await sendExistingReceipt(ctx, operation, logger, config.timezone);
      return;
    }

    if (data.startsWith("export:")) {
      const rangeKey = data.split(":").pop() as ExportRangeKey;
      await sendExport(ctx, user.id, rangeKey);
      return;
    }

    await ctx.reply("Неизвестное действие.", {
      reply_markup: new InlineKeyboard().text("Главное меню", "menu:main")
    });
  });
};
