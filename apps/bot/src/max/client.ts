import { promises as fs } from "node:fs";
import path from "node:path";
import type { MaxKeyboard, MaxMessageOptions } from "./types";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

type UploadResponse = {
  url: string;
  token?: string;
};

type SubscriptionResponse = {
  subscriptions?: Array<string | { url?: string }>;
};

const API_BASE_URL = "https://platform-api.max.ru";
const ATTACHMENT_NOT_READY_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 12_000];

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const isAttachmentNotReadyError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("attachment.not.ready");

const toInlineKeyboardAttachment = (keyboard: MaxKeyboard) => ({
  type: "inline_keyboard",
  payload: {
    buttons: keyboard.map((row) =>
      row.map((button) => ({
        type: "callback",
        text: button.text,
        payload: button.payload
      }))
    )
  }
});

const getContentType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }

  if (ext === ".png") {
    return "image/png";
  }

  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  return "application/octet-stream";
};

export class MaxApiClient {
  constructor(private readonly token: string) {}

  async createSubscription(input: { url: string; updateTypes: string[]; secret?: string }): Promise<void> {
    await this.request("/subscriptions", {
      method: "POST",
      body: {
        url: input.url,
        update_types: input.updateTypes,
        ...(input.secret ? { secret: input.secret } : {})
      }
    });
  }

  async listSubscriptions(): Promise<string[]> {
    const response = await this.request<SubscriptionResponse | Array<string | { url?: string }>>("/subscriptions", {
      method: "GET"
    });
    const subscriptions = Array.isArray(response) ? response : response.subscriptions ?? [];

    return subscriptions
      .map((subscription) => (typeof subscription === "string" ? subscription : subscription.url))
      .filter((url): url is string => Boolean(url));
  }

  async deleteSubscription(url: string): Promise<void> {
    await this.request("/subscriptions", {
      method: "DELETE",
      query: { url }
    });
  }

  async sendMessage(target: { userId?: number; chatId?: number }, text: string, options: MaxMessageOptions = {}): Promise<void> {
    await this.request("/messages", {
      method: "POST",
      query: {
        user_id: target.userId,
        chat_id: target.chatId
      },
      body: this.buildMessageBody(text, options)
    });
  }

  async answerCallback(callbackId: string, input: { text?: string; options?: MaxMessageOptions; notification?: string }): Promise<void> {
    await this.request("/answers", {
      method: "POST",
      query: {
        callback_id: callbackId
      },
      body: {
        ...(input.text !== undefined ? { message: this.buildMessageBody(input.text, input.options ?? {}) } : {}),
        ...(input.notification !== undefined ? { notification: input.notification } : {})
      }
    });
  }

  async sendUploadedFile(
    target: { userId?: number; chatId?: number },
    filePath: string,
    type: "image" | "file",
    text?: string
  ): Promise<void> {
    const payload = await this.upload(filePath, type);

    const request = {
      method: "POST",
      query: {
        user_id: target.userId,
        chat_id: target.chatId
      },
      body: {
        text: text ?? null,
        attachments: [{ type, payload }]
      }
    } satisfies RequestOptions;

    for (let attempt = 0; attempt <= ATTACHMENT_NOT_READY_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await this.request("/messages", request);
        return;
      } catch (error) {
        const delayMs = ATTACHMENT_NOT_READY_RETRY_DELAYS_MS[attempt];

        if (!isAttachmentNotReadyError(error) || delayMs === undefined) {
          throw error;
        }

        await sleep(delayMs);
      }
    }
  }

  private buildMessageBody(text: string, options: MaxMessageOptions): Record<string, unknown> {
    return {
      text,
      ...(options.format ? { format: options.format } : {}),
      ...(options.keyboard ? { attachments: [toInlineKeyboardAttachment(options.keyboard)] } : {})
    };
  }

  private async upload(filePath: string, type: "image" | "file"): Promise<unknown> {
    const upload = await this.request<UploadResponse>("/uploads", {
      method: "POST",
      query: { type }
    });

    const data = await fs.readFile(filePath);
    const form = new FormData();
    form.append("data", new Blob([data], { type: getContentType(filePath) }), path.basename(filePath));

    const response = await fetch(upload.url, {
      method: "POST",
      headers: {
        Authorization: this.token
      },
      body: form
    });

    if (!response.ok) {
      throw new Error(`MAX upload returned HTTP ${response.status}: ${await response.text()}`);
    }

    const uploaded = (await response.json()) as unknown;

    if (uploaded && typeof uploaded === "object") {
      return uploaded;
    }

    if (upload.token) {
      return { token: upload.token };
    }

    throw new Error("MAX upload did not return attachment payload");
  }

  private async request<T = unknown>(pathName: string, options: RequestOptions): Promise<T> {
    const url = new URL(`${API_BASE_URL}${pathName}`);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: this.token,
        ...(options.body ? { "content-type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      throw new Error(`MAX API ${pathName} returned HTTP ${response.status}: ${await response.text()}`);
    }

    return (await response.json()) as T;
  }
}
