import { z } from "zod";
import { IANAZone } from "luxon";
import { BRANDING_LOGO_FILE_PATTERN, BRANDING_NAME_LIMIT, BRANDING_SUBTITLE_LIMIT, parseReceiptBranding } from "@receipt-bot/shared";

export const payloadSchema = z.object({
  operationId: z.number().int().positive(),
  receiptNumber: z.string().min(1),
  createdAt: z.string().datetime(),
  timeZone: z.string().refine(value => IANAZone.isValidZone(value), "Invalid IANA timezone").optional(),
  inn: z.string().min(1),
  ogrn: z.string().nullable().optional(),
  ipFullName: z.string().min(1),
  address: z.string().min(1),
  calculationType: z.enum(["INCOME", "INCOME_RETURN"]),
  items: z.array(z.object({ title: z.string().min(1), quantity: z.string().min(1), price: z.string().min(1), amount: z.string().min(1) })).min(1),
  amount: z.string().min(1),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER"]),
  branding: z.object({
    logoFileName: z.string().regex(BRANDING_LOGO_FILE_PATTERN).nullable(),
    name: z.string().max(BRANDING_NAME_LIMIT),
    subtitle: z.string().max(BRANDING_SUBTITLE_LIMIT)
  }).refine(value => parseReceiptBranding(value) !== null, "Invalid receipt branding").nullable().optional(),
  preview: z.boolean().optional()
});
