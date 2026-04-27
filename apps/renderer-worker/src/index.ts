import "dotenv/config";
import express from "express";
import type { RenderReceiptRequest } from "@receipt-bot/shared";
import { z } from "zod";
import { config } from "./config";
import { logger } from "./logger";
import { renderReceiptImage } from "./renderReceipt";

const payloadSchema = z.object({
  operationId: z.number().int().positive(),
  receiptNumber: z.string().min(1),
  createdAt: z.string().datetime(),
  inn: z.string().min(1),
  ipFullName: z.string().min(1),
  address: z.string().min(1),
  serviceTitle: z.string().min(1),
  amount: z.string().min(1),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER"])
});

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/render-receipt", async (req, res) => {
  try {
    const payload = payloadSchema.parse(req.body) as RenderReceiptRequest;
    const imagePath = await renderReceiptImage(payload, {
      receiptsDir: config.receiptsDir,
      timeZone: config.timeZone
    });

    logger.info({ operationId: payload.operationId, imagePath }, "Receipt rendered");
    res.status(200).json({
      ok: true,
      imagePath
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown render error";
    logger.error({ err: error }, "Renderer failed");
    res.status(500).json({
      ok: false,
      error: message
    });
  }
});

app.listen(config.port, () => {
  logger.info({ port: config.port }, "Renderer worker started");
});
