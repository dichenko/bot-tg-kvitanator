import { promises as fs } from "node:fs";
import type { PaymentMethod } from "@receipt-bot/db";
import { OperationStatus, prisma, RenderJobStatus } from "@receipt-bot/db";
import type { ExportRangeKey } from "@receipt-bot/shared";
import { config } from "../config";
import { buildExportFile, getOperationsForExport } from "../services/exportService";
import { logger } from "../services/logger";
import {
  buildOperationsSummary,
  buildReceiptPreviewText,
  createOperationWithSnapshots,
  getLatestOperationForUser,
  getOperationByIdForUser,
  listRecentOperations
} from "../services/operationService";
import {
  createService,
  getActiveService,
  getProfileByUserId,
  listActiveServices,
  softDeleteService,
  updateProfileField,
  upsertMaxUser,
  upsertProfile
} from "../services/userService";
import { renderReceipt } from "../services/rendererClient";
import type { MaxBotContext, MaxUpdate } from "./types";
import { clearRegistrationDraft, clearReceiptDraft } from "../utils/state";
import { formatAmount } from "../utils/formatters";
import { parseAmountInput, validateInn, validateRequiredText, validateServiceTitle } from "../utils/validation";
import {
  deleteServiceConfirmKeyboard,
  mainMenuKeyboard,
  operationsKeyboard,
  paymentMethodKeyboard,
  profileKeyboard,
  receiptPreviewKeyboard,
  serviceSelectionKeyboard,
  servicesKeyboard
} from "./keyboards";
import type { MaxApiClient } from "./client";
import { createMaxContext } from "./context";

const registrationIntroText = [
  'Сервис "Квитанатор" помогает индивидуальным предпринимателям на патенте выписывать квитанции и вести учёт.',
  "",
  "Пожалуйста, заполните данные вашего ИП.",
  "",
  "Введите ИНН:"
].join("\n");

const ensureText = (update: MaxUpdate): string | null => {
  const text = update.message?.body?.text?.trim();
  return text ? text : null;
};

const startRegistration = async (ctx: MaxBotContext): Promise<void> => {
  clearReceiptDraft(ctx.session);
  clearRegistrationDraft(ctx.session);
  ctx.session.awaitingInput = "registration_inn";
  await ctx.reply(registrationIntroText);
};

const getMaxUser = async (ctx: MaxBotContext) =>
  upsertMaxUser({
    id: ctx.user.id,
    username: ctx.user.username,
    firstName: ctx.user.firstName,
    lastName: ctx.user.lastName
  });

const goToMainFlow = async (ctx: MaxBotContext): Promise<void> => {
  const user = await getMaxUser(ctx);
  const profile = await getProfileByUserId(user.id);

  if (!profile) {
    logger.info({ maxId: ctx.user.id }, "Starting MAX registration flow");
    await startRegistration(ctx);
    return;
  }

  clearRegistrationDraft(ctx.session);
  await ctx.sendMenu("Главное меню", mainMenuKeyboard());
};

const ensureUserAndProfile = async (ctx: MaxBotContext) => {
  const user = await getMaxUser(ctx);
  const profile = await getProfileByUserId(user.id);

  if (!profile) {
    await startRegistration(ctx);
    return null;
  }

  return { user, profile };
};

const showServicesMenu = async (ctx: MaxBotContext, userId: number): Promise<void> => {
  const services = await listActiveServices(userId);
  const lines = services.length > 0 ? services.map((service, index) => `${index + 1}. ${service.title}`) : ["Список услуг пока пуст."];

  await ctx.sendMenu(["Активные услуги:", "", ...lines].join("\n"), servicesKeyboard());
};

const showProfile = async (ctx: MaxBotContext, userId: number): Promise<void> => {
  const profile = await getProfileByUserId(userId);

  if (!profile) {
    await startRegistration(ctx);
    return;
  }

  await ctx.sendMenu(
    [`ИНН: ${profile.inn}`, `ИП: ${profile.ipFullName}`, `Адрес оказания услуги: ${profile.address}`].join("\n"),
    profileKeyboard()
  );
};

const showReceiptServiceSelection = async (ctx: MaxBotContext, userId: number): Promise<void> => {
  const services = await listActiveServices(userId);

  if (services.length === 0) {
    await ctx.sendMenu("Сначала добавьте хотя бы одну услугу.", servicesKeyboard());
    return;
  }

  await ctx.sendMenu("Выберите услугу для квитанции:", serviceSelectionKeyboard(services, "receipt:service"));
};

const showDeleteServiceSelection = async (ctx: MaxBotContext, userId: number): Promise<void> => {
  const services = await listActiveServices(userId);

  if (services.length === 0) {
    await ctx.sendMenu("Удалять пока нечего. Список услуг пуст.", servicesKeyboard());
    return;
  }

  await ctx.sendMenu("Выберите услугу для удаления:", serviceSelectionKeyboard(services, "service:delete:select"));
};

const showPreviewIfReady = async (ctx: MaxBotContext, userId: number): Promise<void> => {
  const draft = ctx.session.receiptDraft;

  if (!draft?.serviceId || !draft.amount || !draft.paymentMethod) {
    await ctx.sendMenu("Не удалось собрать данные черновика. Начните заново.", mainMenuKeyboard());
    return;
  }

  const service = await getActiveService(userId, draft.serviceId);

  if (!service) {
    await ctx.sendMenu("Выбранная услуга больше недоступна. Начните заново.", mainMenuKeyboard());
    return;
  }

  await ctx.sendMenu(
    buildReceiptPreviewText(service, {
      amount: draft.amount,
      paymentMethod: draft.paymentMethod
    }),
    receiptPreviewKeyboard(draft.paymentMethod),
    { format: "html" }
  );
};

const sendExport = async (ctx: MaxBotContext, userId: number, rangeKey: ExportRangeKey = "all_time"): Promise<void> => {
  const operations = await getOperationsForExport(userId, rangeKey, config.timezone);
  const { fileName, filePath } = await buildExportFile(operations, {
    userId,
    rangeKey,
    exportsDir: config.exportsDir,
    timeZone: config.timezone
  });

  logger.info({ userId, rangeKey, operationCount: operations.length }, "MAX Excel export generated");
  await ctx.sendDocument(filePath, fileName, `Excel-выгрузка готова: ${fileName}`);
  await ctx.sendMenu("Главное меню", mainMenuKeyboard());
};

const startReceiptFlow = async (ctx: MaxBotContext, userId: number): Promise<void> => {
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
    await ctx.sendMenu("Сначала добавьте хотя бы одну услугу.", servicesKeyboard());
    return;
  }

  if (!service) {
    await showReceiptServiceSelection(ctx, userId);
    return;
  }

  ctx.session.awaitingInput = "receipt_amount";
  await ctx.reply("Введите сумму поступления:");
};

const renderAndSendOperation = async (ctx: MaxBotContext, userId: number, operationId: number): Promise<void> => {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId }
  });

  if (!operation) {
    await ctx.reply("Операция не найдена.");
    return;
  }

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

    await ctx.sendImage(renderResult.imagePath);

    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: OperationStatus.SENT,
        sentAt: new Date()
      }
    });

    await ctx.sendMenu("Главное меню", mainMenuKeyboard());
    logger.info({ operationId: operation.id, userId }, "MAX render success");
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

    logger.error({ err: error, operationId: operation.id }, "MAX render failure");
    await ctx.reply("Не удалось сформировать квитанцию. Операция сохранена, попробуйте позже.");
  }
};

const sendExistingReceipt = async (ctx: MaxBotContext, operationId: number, userId: number): Promise<void> => {
  const operation = await getOperationByIdForUser(userId, operationId);

  if (!operation) {
    await ctx.reply("Операция не найдена.");
    return;
  }

  if (!operation.imagePath) {
    await ctx.reply("Для этой операции файл квитанции пока недоступен.");
    return;
  }

  try {
    await fs.access(operation.imagePath);
    await ctx.sendImage(operation.imagePath);
  } catch (error) {
    logger.error({ err: error, operationId: operation.id }, "MAX receipt resend failed");
    await ctx.reply("Не удалось отправить файл квитанции. Попробуйте позже.");
  }
};

const handleRegistrationInn = async (ctx: MaxBotContext, text: string): Promise<void> => {
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

const handleRegistrationFullName = async (ctx: MaxBotContext, text: string): Promise<void> => {
  try {
    ctx.session.registrationDraft.ipFullName = validateRequiredText(text, "ФИО ИП");
    ctx.session.awaitingInput = "registration_address";
    await ctx.reply("Введите адрес оказания услуги:");
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Не удалось сохранить ФИО ИП.");
  }
};

const handleRegistrationAddress = async (ctx: MaxBotContext, text: string): Promise<void> => {
  try {
    const address = validateRequiredText(text, "Адрес оказания услуги");
    const user = await getMaxUser(ctx);
    const profile = await upsertProfile(user.id, {
      inn: ctx.session.registrationDraft.inn ?? "",
      ipFullName: ctx.session.registrationDraft.ipFullName ?? "",
      address
    });

    clearRegistrationDraft(ctx.session);
    logger.info({ userId: user.id, profileId: profile.id }, "MAX user registration completed");
    await ctx.sendMenu("Данные ИП сохранены. Главное меню:", mainMenuKeyboard());
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Не удалось сохранить адрес оказания услуги.");
  }
};

const handleProfileEdit = async (
  ctx: MaxBotContext,
  field: "inn" | "ipFullName" | "address",
  text: string
): Promise<void> => {
  const user = await getMaxUser(ctx);

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
    await ctx.sendMenu("Данные ИП обновлены.", mainMenuKeyboard());
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Не удалось обновить профиль.");
  }
};

const handleAddService = async (ctx: MaxBotContext, text: string): Promise<void> => {
  const user = await getMaxUser(ctx);

  try {
    const title = validateServiceTitle(text);
    await createService(user.id, title);
    ctx.session.awaitingInput = null;
    await ctx.sendMenu(`Услуга «${title}» добавлена.`, servicesKeyboard());
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Не удалось добавить услугу.");
  }
};

const handleReceiptAmount = async (ctx: MaxBotContext, text: string): Promise<void> => {
  const user = await getMaxUser(ctx);
  const profile = await getProfileByUserId(user.id);

  if (!profile || !ctx.session.receiptDraft?.serviceId) {
    ctx.session.awaitingInput = null;
    await ctx.sendMenu("Сначала выберите услугу для квитанции.", mainMenuKeyboard());
    return;
  }

  try {
    const amount = parseAmountInput(text);
    ctx.session.receiptDraft.amount = amount;
    ctx.session.awaitingInput = null;

    if (!ctx.session.receiptDraft.paymentMethod) {
      await ctx.reply(`Сумма сохранена: ${formatAmount(amount)} ₽\n\nВыберите форму оплаты:`, {
        keyboard: paymentMethodKeyboard()
      });
      return;
    }

    const service = await getActiveService(user.id, ctx.session.receiptDraft.serviceId);

    if (!service) {
      await ctx.sendMenu("Услуга больше недоступна. Начните создание квитанции заново.", mainMenuKeyboard());
      return;
    }

    await ctx.sendMenu(
      buildReceiptPreviewText(service, {
        amount,
        paymentMethod: ctx.session.receiptDraft.paymentMethod
      }),
      receiptPreviewKeyboard(ctx.session.receiptDraft.paymentMethod),
      { format: "html" }
    );
  } catch (error) {
    await ctx.reply(error instanceof Error ? error.message : "Некорректная сумма.");
  }
};

const handleTextMessage = async (ctx: MaxBotContext, text: string): Promise<void> => {
  if (text === "/start") {
    await goToMainFlow(ctx);
    return;
  }

  if (text === "/help") {
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
      { keyboard: mainMenuKeyboard() }
    );
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
      await ctx.reply("Используйте кнопки меню ниже.", { keyboard: mainMenuKeyboard() });
  }
};

const handleCallback = async (ctx: MaxBotContext, data: string): Promise<void> => {
  if (data === "menu:main") {
    clearReceiptDraft(ctx.session);
    await ctx.sendMenu("Главное меню", mainMenuKeyboard());
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
    const operations = await listRecentOperations(user.id);
    await ctx.sendMenu(buildOperationsSummary(operations, config.timezone), operationsKeyboard(operations));
    return;
  }

  if (data === "menu:export") {
    await sendExport(ctx, user.id, "all_time");
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

    await ctx.sendMenu(`Удалить услугу «${service.title}»?`, deleteServiceConfirmKeyboard(service.id));
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
      await ctx.reply("Введите сумму поступления:");
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
    await ctx.reply("Выберите новую форму оплаты:", { keyboard: paymentMethodKeyboard() });
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
      await ctx.reply("Введите сумму поступления:");
      return;
    }

    await showPreviewIfReady(ctx, user.id);
    return;
  }

  if (data === "receipt:cancel") {
    clearReceiptDraft(ctx.session);
    await ctx.sendMenu("Создание квитанции отменено.", mainMenuKeyboard());
    return;
  }

  if (data === "receipt:confirm") {
    const draft = ctx.session.receiptDraft;

    if (!draft?.serviceId || !draft.amount || !draft.paymentMethod) {
      await ctx.sendMenu("Черновик квитанции неполный. Начните заново.", mainMenuKeyboard());
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

    logger.info({ operationId: operation.id, userId: user.id }, "MAX operation created");
    await ctx.reply(`Квитанция ${operation.receiptNumber} формируется. Подождите несколько секунд.`);
    await renderAndSendOperation(ctx, user.id, operation.id);
    clearReceiptDraft(ctx.session);
    return;
  }

  if (data.startsWith("history:resend:")) {
    const operationId = Number(data.split(":").pop());
    await sendExistingReceipt(ctx, operationId, user.id);
    return;
  }

  await ctx.sendMenu("Неизвестное действие.", [[{ text: "Главное меню", payload: "menu:main" }]]);
};

export const handleMaxUpdate = async (client: MaxApiClient, update: MaxUpdate): Promise<void> => {
  const ctx = await createMaxContext(client, update);

  if (!ctx) {
    logger.warn({ updateType: update.update_type }, "MAX update skipped without user");
    return;
  }

  const sessionBefore = {
    awaitingInput: ctx.session.awaitingInput,
    hasRegistrationInn: Boolean(ctx.session.registrationDraft.inn),
    hasRegistrationFullName: Boolean(ctx.session.registrationDraft.ipFullName),
    hasReceiptDraft: Boolean(ctx.session.receiptDraft)
  };

  logger.info(
    {
      updateType: update.update_type,
      userId: ctx.user.id,
      textLength: update.message?.body?.text?.length ?? 0,
      callbackPayload: update.callback?.payload,
      sessionBefore
    },
    "MAX update handling started"
  );

  try {
    if (update.update_type === "bot_started") {
      await goToMainFlow(ctx);
      return;
    }

    if (update.update_type === "message_created") {
      const text = ensureText(update);

      if (!text) {
        await ctx.reply("Пока поддерживаются только текстовые сообщения и кнопки меню.", { keyboard: mainMenuKeyboard() });
        return;
      }

      await handleTextMessage(ctx, text);
      return;
    }

    if (update.update_type === "message_callback") {
      const payload = update.callback?.payload;

      if (!payload) {
        await ctx.reply("Неизвестное действие.", { keyboard: mainMenuKeyboard() });
        return;
      }

      await handleCallback(ctx, payload);
    }
  } finally {
    logger.info(
      {
        updateType: update.update_type,
        userId: ctx.user.id,
        sessionAfter: {
          awaitingInput: ctx.session.awaitingInput,
          hasRegistrationInn: Boolean(ctx.session.registrationDraft.inn),
          hasRegistrationFullName: Boolean(ctx.session.registrationDraft.ipFullName),
          hasReceiptDraft: Boolean(ctx.session.receiptDraft)
        }
      },
      "MAX update handling finished"
    );
    await ctx.saveSession();
  }
};
