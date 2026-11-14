import {
  TIME_ZONE_OPTIONS,
  formatDateTimeInZone,
  formatTimeZoneLabel,
  parseTimeZoneOffset,
  resolveTimeZone
} from "@receipt-bot/shared";

/** Two profile-card lines shared by Telegram and MAX. */
export const buildProfileTimeZoneLines = (timeZone: string | null | undefined, now: Date = new Date()): string[] => [
  `Часовой пояс: ${formatTimeZoneLabel(timeZone)}`,
  `Местное время сейчас: ${formatDateTimeInZone(now, timeZone, ", ")}`
];

export const buildRegistrationTimeZoneText = (): string =>
  [
    "Выберите ваш часовой пояс относительно Москвы.",
    "Он будет использоваться для даты и времени в квитанциях.",
    "",
    `По умолчанию: ${formatTimeZoneLabel("Europe/Moscow")}.`
  ].join("\n");

export const buildTimeZonePickerText = (currentTimeZone: string | null | undefined): string =>
  [
    "Выберите часовой пояс относительно Москвы.",
    "Он будет применяться к новым квитанциям. Ранее созданные сохранят прежнее время.",
    "",
    `Текущий: ${formatTimeZoneLabel(currentTimeZone)}`
  ].join("\n");

export const buildRegistrationCompleteText = (timeZone: string | null | undefined): string =>
  `Данные ИП сохранены. Часовой пояс: ${formatTimeZoneLabel(timeZone)}. Главное меню:`;

/** Resolves callback data like "tz:set:-1" to a supported zone id; null if malformed or unknown. */
export const parseTimeZoneCallback = (data: string): string | null => parseTimeZoneOffset(data.split(":").pop());

export { TIME_ZONE_OPTIONS, resolveTimeZone };
