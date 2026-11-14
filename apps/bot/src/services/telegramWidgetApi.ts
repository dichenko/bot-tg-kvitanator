import { API_CONSTANTS, type Api } from "grammy";

// Preserve Telegram's default update categories, explicitly include widget_query.
export const WIDGET_ALLOWED_UPDATES = [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, "widget_query"] as unknown as
  NonNullable<Parameters<Api["getUpdates"]>[0]>["allowed_updates"];

// Older grammY uses abort-controller's signal type. Its transport accepts the
// native Node signal structurally at runtime; keep the type bridge here too.
export const telegramTimeout = (ms: number): NonNullable<Parameters<Api["sendMessage"]>[3]> =>
  AbortSignal.timeout(ms) as unknown as NonNullable<Parameters<Api["sendMessage"]>[3]>;

// grammY 1.x has a dynamic raw API proxy, but its bundled types predate 10.4.
// Keep the compatibility boundary here; use grammY's transport/transformers.
// https://core.telegram.org/bots/api#sendwidget
export type WidgetQuery = {
  id: string;
  from: { id: number };
  chat?: { id: number; type: string };
  message_id?: number;
  inline_message_id?: string;
  type: { type: string };
  data: string;
};
type WidgetMethods = {
  sendWidget(args: { chat_id: number; html: string; chat_data: string; caption: string; allow_queries: true }, signal?: AbortSignal): Promise<{ message_id: number }>;
  answerWidgetQuery(args: { widget_query_id: string; data?: string }, signal?: AbortSignal): Promise<true>;
  editMessageWidgetData(args: { chat_id: number; message_id: number; chat_data: string }, signal?: AbortSignal): Promise<true>;
};
export const widgetApi = (api: Api): WidgetMethods => api.raw as unknown as WidgetMethods;
