import type { Operation, PaymentMethod, ReceiptCalculationType, Service } from "@receipt-bot/db";
import type { MaxKeyboard } from "./types";

export const mainMenuKeyboard = (): MaxKeyboard => [
  [{ text: "➕ Новая квитанция", payload: "menu:receipt:new" }],
  [
    { text: "🧾 Услуги", payload: "menu:services" },
    { text: "📊 Выгрузка", payload: "menu:export" }
  ],
  [
    { text: "📄 Квитанции", payload: "menu:operations" },
    { text: "👤 Данные ИП", payload: "menu:profile" }
  ]
];

export const profileKeyboard = (): MaxKeyboard => [
  [{ text: "✏️ Изменить ИНН", payload: "profile:edit:inn" }],
  [{ text: "✏️ Изменить ФИО ИП", payload: "profile:edit:full_name" }],
  [{ text: "✏️ Изменить адрес", payload: "profile:edit:address" }],
  [{ text: "✏️ Изменить ОГРН", payload: "profile:edit:ogrn" }],
  [{ text: "⬅️ Назад", payload: "menu:main" }]
];

export const servicesKeyboard = (): MaxKeyboard => [
  [{ text: "➕ Добавить услугу", payload: "service:add" }],
  [{ text: "🗑 Удалить услугу", payload: "service:delete" }],
  [{ text: "⬅️ Назад", payload: "menu:main" }]
];

export const serviceSelectionKeyboard = (services: Service[], prefix: string, includeBack = true): MaxKeyboard => {
  const rows: MaxKeyboard = services.map((service) => [{ text: service.title, payload: `${prefix}:${service.id}` }]);

  if (includeBack) {
    rows.push([{ text: "⬅️ Назад", payload: "menu:main" }]);
  }

  return rows;
};

export const deleteServiceConfirmKeyboard = (serviceId: number): MaxKeyboard => [
  [{ text: "✅ Да, удалить", payload: `service:delete:confirm:${serviceId}` }],
  [{ text: "❌ Отмена", payload: "menu:services" }]
];

export const paymentMethodKeyboard = (): MaxKeyboard => [
  [{ text: "💵 Наличные", payload: "receipt:payment:CASH" }],
  [{ text: "🏦 Безналичные", payload: "receipt:payment:BANK_TRANSFER" }],
  [{ text: "❌ Отмена", payload: "receipt:cancel" }]
];

export const receiptPreviewKeyboard = (currentPaymentMethod: PaymentMethod, calculationType: ReceiptCalculationType): MaxKeyboard => {
  const nextPaymentMethod = currentPaymentMethod === "CASH" ? "BANK_TRANSFER" : "CASH";
  const toggleLabel = currentPaymentMethod === "CASH" ? "🏦 Безнал" : "💵 Нал";

  return [
    [{ text: "✅ Сгенерировать квитанцию", payload: "receipt:confirm" }],
    [
      { text: "➕ Добавить услугу", payload: "receipt:add:item" },
      { text: "💰 Цена", payload: "receipt:change:price" }
    ],
    [{ text: "🔢 Количество", payload: "receipt:change:quantity" }, { text: `Признак: ${calculationType === "INCOME" ? "Приход" : "Возврат прихода"}`, payload: "receipt:toggle:calculation" }],
    [
      { text: toggleLabel, payload: `receipt:payment:${nextPaymentMethod}` },
      { text: "❌ Отмена", payload: "receipt:cancel" }
    ]
  ];
};

export const operationsKeyboard = (operations: Operation[]): MaxKeyboard => {
  const rows: MaxKeyboard = operations
    .flatMap((operation) => [[{ text: `👁 Показать ${operation.receiptNumber}`, payload: `history:show:${operation.id}` }], [{ text: "🗑 Удалить", payload: `history:delete:${operation.id}` }]]);

  rows.push([{ text: "⬅️ Вернуться в меню", payload: "menu:main" }]);
  return rows;
};
export const deleteOperationConfirmKeyboard = (id: number): MaxKeyboard => [[{ text: "🗑 Удалить", payload: `history:delete:confirm:${id}` }], [{ text: "❌ Отмена", payload: "menu:operations" }]];
