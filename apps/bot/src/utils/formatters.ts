import type { OperationStatus, PaymentMethod } from "@receipt-bot/db";
import { OPERATION_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@receipt-bot/shared";

export const formatAmount = (value: string | number | { toString(): string }): string => {
  const numeric = typeof value === "string" ? Number(value) : Number(value);

  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numeric);
};

export const formatDateTime = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone
  }).format(date);

export const formatPaymentMethod = (paymentMethod: PaymentMethod): string => PAYMENT_METHOD_LABELS[paymentMethod];

export const formatOperationStatus = (status: OperationStatus): string => OPERATION_STATUS_LABELS[status];
