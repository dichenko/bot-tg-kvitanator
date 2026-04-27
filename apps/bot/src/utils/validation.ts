import { MAX_AMOUNT_INPUT_LENGTH, MAX_SERVICE_TITLE_LENGTH } from "@receipt-bot/shared";

const MAX_TEXT_LENGTH = 255;

export const validateInn = (value: string): { valid: boolean; warning?: string; normalized?: string; message?: string } => {
  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    return { valid: false, message: "ИНН должен содержать только цифры." };
  }

  if (normalized.length !== 10 && normalized.length !== 12) {
    return { valid: false, message: "ИНН должен содержать 10 или 12 цифр." };
  }

  return {
    valid: true,
    normalized,
    warning: normalized.length === 10 ? "ИНН ИП обычно состоит из 12 цифр. Проверьте, что данные введены верно." : undefined
  };
};

export const validateRequiredText = (value: string, fieldName: string, maxLength = MAX_TEXT_LENGTH): string => {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Поле «${fieldName}» не должно быть пустым.`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`Поле «${fieldName}» слишком длинное.`);
  }

  return normalized;
};

export const validateServiceTitle = (value: string): string => {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error("Название услуги не должно быть пустым.");
  }

  if (normalized.length > MAX_SERVICE_TITLE_LENGTH) {
    throw new Error(`Название услуги слишком длинное. Максимум ${MAX_SERVICE_TITLE_LENGTH} символов.`);
  }

  return normalized;
};

export const parseAmountInput = (value: string): string => {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error("Введите сумму.");
  }

  if (normalized.length > MAX_AMOUNT_INPUT_LENGTH) {
    throw new Error("Сумма введена в слишком длинном формате.");
  }

  if (!/^\d+([.,]\d{1,2})?$/.test(normalized)) {
    throw new Error("Сумма должна быть положительным числом. Используйте формат вроде 2500 или 2500,50.");
  }

  const numeric = Number(normalized.replace(",", "."));

  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Сумма должна быть больше нуля.");
  }

  return numeric.toFixed(2);
};
