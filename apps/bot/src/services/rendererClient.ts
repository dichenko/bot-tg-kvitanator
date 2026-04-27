import type { RenderReceiptRequest, RenderReceiptResponse } from "@receipt-bot/shared";

export const renderReceipt = async (rendererUrl: string, payload: RenderReceiptRequest): Promise<RenderReceiptResponse> => {
  const response = await fetch(`${rendererUrl}/render-receipt`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Renderer worker returned HTTP ${response.status}`);
  }

  return (await response.json()) as RenderReceiptResponse;
};
