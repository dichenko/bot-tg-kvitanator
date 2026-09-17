import { promises as fs } from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { chromium } from "playwright";
import { DateTime } from "luxon";
import type { RenderReceiptRequest } from "@receipt-bot/shared";
import { PAYMENT_METHOD_LABELS } from "@receipt-bot/shared";
import { CALCULATION_TYPE_LABELS } from "@receipt-bot/shared";

let compiledTemplate: Handlebars.TemplateDelegate | null = null;

const resolveTemplatePath = async (): Promise<string> => {
  const candidates = [
    path.join(__dirname, "templates", "receipt.hbs"),
    path.join(__dirname, "..", "src", "templates", "receipt.hbs")
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("Receipt template not found");
};

const getTemplate = async (): Promise<Handlebars.TemplateDelegate> => {
  if (compiledTemplate) {
    return compiledTemplate;
  }

  const templatePath = await resolveTemplatePath();
  const source = await fs.readFile(templatePath, "utf8");
  compiledTemplate = Handlebars.compile(source);
  return compiledTemplate;
};

export const renderReceiptImage = async (
  payload: RenderReceiptRequest,
  options: { receiptsDir: string; timeZone: string }
): Promise<string> => {
  await fs.mkdir(options.receiptsDir, { recursive: true });

  const template = await getTemplate();
  const html = template({
    title: "КВИТАНЦИЯ",
    receiptNumber: payload.receiptNumber,
    createdAt: DateTime.fromISO(payload.createdAt).setZone(options.timeZone).toFormat("dd.LL.yyyy HH:mm"),
    inn: payload.inn,
    ogrn: payload.ogrn,
    ipFullName: payload.ipFullName,
    address: payload.address,
    items: payload.items.map((item) => ({ ...item, quantity: Number(item.quantity).toLocaleString("ru-RU"), price: Number(item.price).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), amount: Number(item.amount).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })),
    amount: Number(payload.amount).toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }),
    paymentMethodLabel: PAYMENT_METHOD_LABELS[payload.paymentMethod],
    calculationTypeLabel: CALCULATION_TYPE_LABELS[payload.calculationType]
  });

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 460,
        height: 200
      },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: false
    });

    await page.emulateMedia({ media: "screen" });
    await page.setContent(html, { waitUntil: "networkidle" });

    const imagePath = path.join(options.receiptsDir, `receipt-${payload.operationId}.jpg`);
    const receiptCard = page.locator(".receipt-wrapper");

    await receiptCard.screenshot({
      path: imagePath,
      type: "jpeg",
      quality: 92
    });

    return imagePath;
  } finally {
    await browser.close();
  }
};
