export const DEFAULT_TIME_ZONE = "Europe/Moscow";

export interface TimeZoneOption {
  /** Offset relative to Moscow in whole hours: -1 (МСК−1) … 9 (МСК+9). */
  offset: number;
  /** Short label, e.g. "МСК+2". */
  label: string;
  /** City hint shown on buttons. */
  city: string;
  /** Standard IANA zone identifier stored in the database. */
  zoneId: string;
}

const option = (offset: number, city: string, zoneId: string): TimeZoneOption => ({
  offset,
  label: offset === 0 ? "МСК" : offset < 0 ? `МСК−${Math.abs(offset)}` : `МСК+${offset}`,
  city,
  zoneId
});

/** Shared reference list: 11 Russian time zones relative to Moscow. */
export const TIME_ZONE_OPTIONS: readonly TimeZoneOption[] = [
  option(-1, "Калининград", "Europe/Kaliningrad"),
  option(0, "Москва", "Europe/Moscow"),
  option(1, "Самара", "Europe/Samara"),
  option(2, "Екатеринбург", "Asia/Yekaterinburg"),
  option(3, "Омск", "Asia/Omsk"),
  option(4, "Новосибирск", "Asia/Novosibirsk"),
  option(5, "Иркутск", "Asia/Irkutsk"),
  option(6, "Якутск", "Asia/Yakutsk"),
  option(7, "Владивосток", "Asia/Vladivostok"),
  option(8, "Магадан", "Asia/Magadan"),
  option(9, "Камчатка", "Asia/Kamchatka")
];

export const getTimeZoneOptionByZoneId = (zoneId: string | null | undefined): TimeZoneOption | undefined =>
  TIME_ZONE_OPTIONS.find((item) => item.zoneId === zoneId);

export const getTimeZoneOptionByOffset = (offset: number): TimeZoneOption | undefined =>
  TIME_ZONE_OPTIONS.find((item) => item.offset === offset);

export const isSupportedTimeZone = (zoneId: string | null | undefined): zoneId is string =>
  getTimeZoneOptionByZoneId(zoneId) !== undefined;

/** Returns a supported zone id, falling back to Moscow for missing or unknown values. */
export const resolveTimeZone = (zoneId: string | null | undefined): string =>
  isSupportedTimeZone(zoneId) ? zoneId : DEFAULT_TIME_ZONE;

export const formatTimeZoneLabel = (zoneId: string | null | undefined): string =>
  (getTimeZoneOptionByZoneId(zoneId) ?? getTimeZoneOptionByZoneId(DEFAULT_TIME_ZONE)!).label;

/** Button caption: "МСК+2 — Екатеринбург". */
export const formatTimeZoneButtonLabel = (item: TimeZoneOption): string => `${item.label} — ${item.city}`;

/** Parses the numeric part of callback data ("-1", "0", "9") into a zone id; null if invalid. */
export const parseTimeZoneOffset = (value: string | undefined): string | null => {
  if (value === undefined || !/^-?\d+$/.test(value)) {
    return null;
  }

  return getTimeZoneOptionByOffset(Number(value))?.zoneId ?? null;
};

/**
 * Formats a UTC instant in the given IANA zone as "dd.MM.yyyy HH:mm".
 * Date, month and year roll over correctly because conversion is done by Intl.
 */
export const formatDateTimeInZone = (date: Date | string, zoneId: string | null | undefined, separator = " "): string => {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: resolveTimeZone(zoneId),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(typeof date === "string" ? new Date(date) : date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";

  return `${get("day")}.${get("month")}.${get("year")}${separator}${get("hour")}:${get("minute")}`;
};
