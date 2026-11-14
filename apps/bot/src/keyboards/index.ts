import type { Operation, PaymentMethod, ReceiptCalculationType, Service } from "@receipt-bot/db";
import { InlineKeyboard } from "grammy";

export const mainMenuKeyboard = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("➕ Новая квитанция", "menu:receipt:new")
    .row()
    .text("🧾 Услуги", "menu:services")
    .text("📊 Выгрузка", "menu:export")
    .row()
    .text("📄 Квитанции", "menu:operations")
    .text("👤 Данные ИП", "menu:profile");

export const backToMainKeyboard = (): InlineKeyboard => new InlineKeyboard().text("⬅️ Назад", "menu:main");

export const profileKeyboard = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("✏️ Изменить ИНН", "profile:edit:inn")
    .row()
    .text("✏️ Изменить ФИО ИП", "profile:edit:full_name")
    .row()
    .text("✏️ Изменить адрес", "profile:edit:address")
    .row()
    .text("✏️ Изменить ОГРН", "profile:edit:ogrn")
    .row()
    .text("⬅️ Назад", "menu:main");

export const servicesKeyboard = (): InlineKeyboard =>
  new InlineKeyboard()
    .text("➕ Добавить услугу", "service:add")
    .row()
    .text("🗑 Удалить услугу", "service:delete")
    .row()
    .text("⬅️ Назад", "menu:main");

export const serviceSelectionKeyboard = (services: Service[], prefix: string, includeBack = true): InlineKeyboard => {
  const keyboard = new InlineKeyboard();

  services.forEach((service) => {
    keyboard.text(service.title, `${prefix}:${service.id}`).row();
  });

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
      keyboard.text(`👁 Показать ${operation.receiptNumber}`, `history:show:${operation.id}`).text("🗑 Удалить", `history:delete:${operation.id}`).row();
    });
  keyboard.text("⬅️ Вернуться в меню", "menu:main");
  return keyboard;
};

export const deleteOperationConfirmKeyboard = (id: number): InlineKeyboard => new InlineKeyboard().text("🗑 Удалить", `history:delete:confirm:${id}`).text("❌ Отмена", "menu:operations");
