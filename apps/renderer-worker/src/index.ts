import express from "express";
import type { RenderReceiptRequest } from "@receipt-bot/shared";
import { payloadSchema } from "./receiptPayload";
import { config } from "./config";
import { logger } from "./logger";
import { renderReceiptImage } from "./renderReceipt";

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
