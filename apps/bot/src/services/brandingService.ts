import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma, Prisma, type EntrepreneurProfile } from "@receipt-bot/db";
import { BRANDING_NAME_LIMIT, BRANDING_SUBTITLE_LIMIT, parseReceiptBranding, type ReceiptBranding } from "@receipt-bot/shared";
import { config } from "../config";
import { renderReceipt } from "./rendererClient";
import { markLogoSaved, protectReplacedLogo, registerTemporaryLogo } from "./brandingStorage";
import { canUseSubscription, hasActiveSubscription, isSubscriptionAvailable } from "./subscriptionService";

export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
// Branding is a paid feature: availability is shared with the subscription (see subscriptionService).
export const isBrandingAvailable = isSubscriptionAvailable;
export const canConfigureBranding = canUseSubscription;

/** Branding applies to receipts of a user (`platformId`: Telegram or MAX id of the channel) with an active subscription. */
export const brandingForOperation = (
  platformId: number | bigint | undefined | null, value: unknown,
  subscriptionUntil?: Date | null, now = new Date()
): ReceiptBranding | null => isBrandingAvailable(platformId) && hasActiveSubscription(subscriptionUntil, now)
  ? parseReceiptBranding(value) : null;

export const validateBrandingText = (text: string, field: "name" | "subtitle"): string => {
  const value = text.trim() === "-" ? "" : text.trim();
  const limit = field === "name" ? BRANDING_NAME_LIMIT : BRANDING_SUBTITLE_LIMIT;
  if (value.length > limit) throw new Error(`Максимум ${limit} символов. Отправьте текст короче.`);
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error("Введите текст одной строкой.");
  return value;
};

export const readLimitedLogoBody = async (response: Response): Promise<Buffer> => {
  if (!response.ok || !response.body) throw new Error("Не удалось скачать логотип. Отправьте файл ещё раз.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_LOGO_BYTES) throw new Error("Размер логотипа — не больше 5 МБ.");
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_LOGO_BYTES) throw new Error("Размер логотипа — не больше 5 МБ.");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

const readLogoResponse = async (response: Response): Promise<Buffer> => {
  try { return await readLimitedLogoBody(response); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("Размер логотипа")) throw error;
    throw new Error("Не удалось скачать логотип. Отправьте файл ещё раз.");
  }
};

/** MAX sends a temporary file URL in the attachment: only plain public https hosts, no redirects, no credentials. */
export const downloadMaxLogo = async (rawUrl: string): Promise<Buffer> => {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Не удалось получить файл MAX. Отправьте его ещё раз."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !host.includes(".") || host.startsWith("[") || /^[0-9.]+$/.test(host) || /\.(local|localhost|internal)$/.test(host)) {
    throw new Error("Не удалось получить файл MAX. Отправьте его ещё раз.");
  }
  let response: Response;
  try { response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("Не удалось скачать логотип. Отправьте файл ещё раз."); }
  return readLogoResponse(response);
};

export const downloadTelegramLogo = async (filePath: string): Promise<Buffer> => {
  // The URL contains the bot token: never persist it or include fetch errors in logs/replies.
  if (!/^[a-zA-Z0-9_./-]+$/.test(filePath) || filePath.split("/").includes("..")) throw new Error("Не удалось получить файл Telegram.");
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${filePath}`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("Не удалось скачать логотип. Отправьте файл ещё раз.");
  }
  return readLogoResponse(response);
};

export const normalizeLogo = async (input: Buffer): Promise<Buffer> => {
  if (input.length > MAX_LOGO_BYTES) throw new Error("Размер логотипа — не больше 5 МБ.");
  const png = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255;
  if (!png && !jpeg) throw new Error("Отправьте статичную картинку PNG или JPEG.");
  try {
    // APNG may be decoded as its first frame: explicitly reject its animation chunk.
    if (png) for (let offset = 8; offset + 12 <= input.length;) {
      const length = input.readUInt32BE(offset);
      if (input.toString("ascii", offset + 4, offset + 8) === "acTL") throw new Error("animation");
      offset += length + 12;
    }
    const image = sharp(input, { limitInputPixels: 16_000_000, failOn: "error" });
    const metadata = await image.metadata();
    if (!["png", "jpeg"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new Error("format");
    if (!metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) throw new Error("dimensions");
    // Decode/re-encode the pixels, preserving transparency and removing input metadata.
    return await image.rotate().resize(320, 128, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new Error("Не удалось обработать изображение. Нужен PNG или JPEG до 4096 пикселей по стороне и 16 мегапикселей, без анимации.");
  }
};

export const storeLogo = async (input: Buffer, receiptsDir = config.receiptsDir): Promise<string> => {
  const normalized = await normalizeLogo(input);
  const dir = path.join(receiptsDir, "branding");
  await fs.mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.png`;
  await fs.writeFile(path.join(dir, name), normalized, { flag: "wx" });
  registerTemporaryLogo(name);
  return name;
};

export const saveReceiptBranding = async (userId: number, branding: ReceiptBranding | null): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { telegramId: true, maxId: true, subscriptionUntil: true } });
  if (!isBrandingAvailable(user.telegramId) && !isBrandingAvailable(user.maxId)) throw new Error("Оформление квитанции недоступно.");
  if (!hasActiveSubscription(user.subscriptionUntil)) throw new Error("Брендированная квитанция доступна по подписке.");
  const value = parseReceiptBranding(branding);
  if (branding && !value && (branding.logoFileName || branding.name || branding.subtitle)) throw new Error("Некорректное оформление.");
  const previous = await prisma.entrepreneurProfile.findUniqueOrThrow({ where: { userId }, select: { receiptBranding: true } });
  await protectReplacedLogo(parseReceiptBranding(previous.receiptBranding)?.logoFileName);
  await prisma.entrepreneurProfile.update({ where: { userId }, data: { receiptBranding: value ? { ...value } : Prisma.DbNull } });
  markLogoSaved(value?.logoFileName);
};

export const renderBrandingPreview = async (userId: number, profile: EntrepreneurProfile, branding: ReceiptBranding | null): Promise<string> => {
  const result = await renderReceipt(config.rendererUrl, {
    operationId: userId, receiptNumber: "ОБРАЗЕЦ", createdAt: new Date().toISOString(), timeZone: profile.timeZone,
    inn: profile.inn, ogrn: profile.ogrn, ipFullName: profile.ipFullName, address: profile.address,
    calculationType: "INCOME", items: [{ title: "Пример услуги", quantity: "1", price: "1000", amount: "1000" }],
    amount: "1000", paymentMethod: "BANK_TRANSFER", branding: parseReceiptBranding(branding), preview: true
  });
  if (!result.ok || !result.imagePath) throw new Error("Не удалось создать образец. Повторите попытку.");
  return result.imagePath;
};

export const removeBrandingPreview = async (filePath: string): Promise<void> => {
  if (path.dirname(path.resolve(filePath)) === path.resolve(config.receiptsDir) && /^preview-[0-9a-f-]+\.jpg$/.test(path.basename(filePath))) {
    await fs.unlink(filePath).catch(() => undefined);
  }
};
