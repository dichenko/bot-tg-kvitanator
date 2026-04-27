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
    let details = "";
    const clonedResponse = response.clone();

    try {
      const body = (await response.json()) as { error?: string };
      details = body.error ? `: ${body.error}` : "";
    } catch {
      try {
        const text = await clonedResponse.text();
        details = text ? `: ${text}` : "";
      } catch {
        details = "";
      }
    }

    throw new Error(`Renderer worker returned HTTP ${response.status}${details}`);
  }

  return (await response.json()) as RenderReceiptResponse;
};
