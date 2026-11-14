import type { OperationStatus, PaymentMethod } from "@receipt-bot/db";
import { OPERATION_STATUS_LABELS, PAYMENT_METHOD_LABELS, formatDateTimeInZone } from "@receipt-bot/shared";

export const formatAmount = (value: string | number | { toString(): string }): string => {
  const numeric = typeof value === "string" ? Number(value) : Number(value);

  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numeric);
};

export const formatDateTime = (date: Date, timeZone: string | null | undefined): string => formatDateTimeInZone(date, timeZone, ", ");

export const formatPaymentMethod = (paymentMethod: PaymentMethod): string => PAYMENT_METHOD_LABELS[paymentMethod];

export const formatOperationStatus = (status: OperationStatus): string => OPERATION_STATUS_LABELS[status];

export const buildServicesListText = (services: { title: string }[]): string =>
  ["Активные услуги:", "", ...(services.length ? services.map((service, index) => `${index + 1}. ${service.title}`) : ["Список услуг пока пуст."])].join("\n");
