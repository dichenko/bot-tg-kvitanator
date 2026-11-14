import type { Operation, PaymentMethod, ReceiptCalculationType, Service } from "@receipt-bot/db";
import { InlineKeyboard } from "grammy";
import { DEFAULT_TIME_ZONE, TIME_ZONE_OPTIONS, formatTimeZoneButtonLabel, formatTimeZoneLabel } from "@receipt-bot/shared";

/** `showSubscription` is true only for the Telegram subscription pilot user (see subscriptionService). */
export const mainMenuKeyboard = (showSubscription = false): InlineKeyboard => {
  const keyboard = new InlineKeyboard()
    .text("➕ Новая квитанция", "menu:receipt:new")
    .row()
    .text("🧾 Услуги", "menu:services")
    .text("📊 Выгрузка", "menu:export")
    .row()
    .text("📄 Квитанции", "menu:operations")
    .text("👤 Данные ИП", "menu:profile");
  if (showSubscription) keyboard.row().text("⭐ Моя подписка", "menu:subscription");
  return keyboard;
};

export const backToSubscriptionKeyboard = (): InlineKeyboard => new InlineKeyboard().text("⬅️ Назад", "menu:subscription");

export const backToMainKeyboard = (): InlineKeyboard => new InlineKeyboard().text("⬅️ Назад", "menu:main");

/** Subscription screen: purchase for users without a subscription, paid features otherwise. */
export const subscriptionKeyboard = (active: boolean, canRenew: boolean): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  if (!active) return keyboard.text("💳 Купить подписку", "sub:buy").row().text("🛟 Поддержка", "support:open").row().text("⬅️ Назад", "menu:main");
  keyboard.text("🖼 Добавить свой логотип", "branding:open").row().text("🔄 Синхронизировать Max и TG", "sub:sync").row();
  if (canRenew) keyboard.text("💳 Продлить подписку", "sub:buy").row();
  return keyboard.text("🛟 Поддержка", "support:open").row().text("⬅️ Назад", "menu:main");
};

export const profileKeyboard = (): InlineKeyboard => {
  const keyboard = new InlineKeyboard()
    .text("✏️ Изменить ИНН", "profile:edit:inn")
    .row()
    .text("✏️ Изменить ФИО ИП", "profile:edit:full_name")
    .row()
    .text("✏️ Изменить адрес", "profile:edit:address")
    .row()
    .text("✏️ Изменить ОГРН", "profile:edit:ogrn")
    .row()
    .text("🕒 Изменить часовой пояс", "profile:tz")
    .row();
  return keyboard.text("⬅️ Назад", "menu:main");
};

/** Registration screen: default МСК first, the other zones below. */
export const registrationTimeZoneKeyboard = (): InlineKeyboard => {
  const keyboard = new InlineKeyboard().text(`Продолжить с ${formatTimeZoneLabel(DEFAULT_TIME_ZONE)}`, "tz:reg:0").row();

  TIME_ZONE_OPTIONS.filter((item) => item.zoneId !== DEFAULT_TIME_ZONE).forEach((item) => {
    keyboard.text(formatTimeZoneButtonLabel(item), `tz:reg:${item.offset}`).row();
  });

  return keyboard;
};

/** Profile screen: all zones, the current one is marked. */
export const timeZoneSelectKeyboard = (currentTimeZone: string): InlineKeyboard => {
  const keyboard = new InlineKeyboard();

  TIME_ZONE_OPTIONS.forEach((item) => {
    const mark = item.zoneId === currentTimeZone ? "✅ " : "";
    keyboard.text(`${mark}${formatTimeZoneButtonLabel(item)}`, `tz:set:${item.offset}`).row();
  });

  return keyboard.text("⬅️ Назад", "menu:profile");
};

export const servicesKeyboard = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("➕ Добавить услугу", "service:add")
    .row()
    .text("🗑 Удалить услугу", "service:delete")
    .row()
    .text("⬅️ Назад", "menu:main");

export const serviceSelectionKeyboard = (services: Service[], prefix: string, includeBack = true, includeManual = false): InlineKeyboard => {
  const keyboard = new InlineKeyboard();

  services.forEach((service, index) => {
    keyboard.text(`${index + 1}. ${service.title}`, `${prefix}:${service.id}`).row();
  });

  if (includeManual) {
    keyboard.text("✏️ Ввести вручную", `${prefix}:manual`).row();
  }

  if (includeBack) {
    keyboard.text("⬅️ Назад", "menu:main");
  }

  return keyboard;
};

export const deleteServiceConfirmKeyboard = (serviceId: number): InlineKeyboard =>
  new InlineKeyboard()
    .text("✅ Да, удалить", `service:delete:confirm:${serviceId}`)
    .row()
    .text("❌ Отмена", "menu:services");

export const paymentMethodKeyboard = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("💵 Наличные", "receipt:payment:CASH")
    .row()
    .text("🏦 Безналичные", "receipt:payment:BANK_TRANSFER")
    .row()
    .text("❌ Отмена", "receipt:cancel");

export const receiptPreviewKeyboard = (currentPaymentMethod: PaymentMethod, calculationType: ReceiptCalculationType): InlineKeyboard => {
  const nextPaymentMethod = currentPaymentMethod === "CASH" ? "BANK_TRANSFER" : "CASH";
  const toggleLabel = currentPaymentMethod === "CASH" ? "🏦 Безнал" : "💵 Нал";

  return new InlineKeyboard()
    .text("✅ Сгенерировать квитанцию", "receipt:confirm")
    .row()
    .text("➕ Добавить услугу", "receipt:add:item")
    .text("💰 Цена", "receipt:change:price")
    .row()
    .text("🔢 Количество", "receipt:change:quantity")
    .text(`Признак: ${calculationType === "INCOME" ? "Приход" : "Возврат прихода"}`, "receipt:toggle:calculation")
    .row()
    .text(toggleLabel, `receipt:payment:${nextPaymentMethod}`)
    .text("❌ Отмена", "receipt:cancel");
};

export const operationsKeyboard = (operations: Operation[]): InlineKeyboard => {
  const keyboard = new InlineKeyboard();

  operations
    .forEach((operation) => {
      keyboard.text(`👁 ${operation.receiptNumber}`, `history:show:${operation.id}`).text("🗑", `history:delete:${operation.id}`).row();
    });
  keyboard.text("⬅️ Вернуться в меню", "menu:main");
  return keyboard;
};

export const deleteOperationConfirmKeyboard = (id: number): InlineKeyboard => new InlineKeyboard().text("🗑 Удалить", `history:delete:confirm:${id}`).text("❌ Отмена", "menu:operations");
