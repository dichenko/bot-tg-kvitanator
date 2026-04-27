export const PAYMENT_METHOD_LABELS = {
  CASH: "Наличные",
  BANK_TRANSFER: "Безналичные"
} as const;

export const OPERATION_STATUS_LABELS = {
  DRAFT: "Черновик",
  CONFIRMED: "Подтверждена",
  RENDERING: "Рендеринг",
  RENDERED: "Сформирована",
  SENT: "Отправлена",
  FAILED: "Ошибка",
  DELETED: "Удалена"
} as const;

export const EXPORT_RANGE_LABELS = {
  today: "Сегодня",
  current_month: "Этот месяц",
  previous_month: "Прошлый месяц",
  all_time: "Всё время"
} as const;

export const MAX_SERVICE_TITLE_LENGTH = 160;
export const MAX_AMOUNT_INPUT_LENGTH = 20;
