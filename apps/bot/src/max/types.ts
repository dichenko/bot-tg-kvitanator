import type { BotSession } from "../types";

export type MaxKeyboardButton = {
  text: string;
  payload: string;
};

export type MaxKeyboard = MaxKeyboardButton[][];

export type MaxTextFormat = "html" | "markdown";

export type MaxMessageOptions = {
  keyboard?: MaxKeyboard;
  format?: MaxTextFormat;
};

export type MaxUser = {
  user_id: number;
  username?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
};

export type MaxMessage = {
  sender?: MaxUser;
  recipient?: {
    user_id?: number;
    chat_id?: number;
  };
  body?: {
    text?: string | null;
    attachments?: unknown[];
  } | null;
};

export type MaxCallback = {
  callback_id: string;
  payload?: string;
  user?: MaxUser;
  message?: MaxMessage;
};

export type MaxUpdate = {
  update_type: string;
  timestamp?: number;
  user?: MaxUser;
  chat_id?: number;
  message?: MaxMessage;
  callback?: MaxCallback;
  payload?: string;
};

export type MaxSessionKey = string;

export type MaxBotContext = {
  user: {
    id: number;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  chatId?: number;
  callbackId?: string;
  session: BotSession;
  reply(text: string, options?: MaxMessageOptions): Promise<void>;
  sendMenu(text: string, keyboard: MaxKeyboard, options?: Omit<MaxMessageOptions, "keyboard">): Promise<void>;
  sendImage(filePath: string): Promise<void>;
  sendDocument(filePath: string, fileName: string, caption?: string): Promise<void>;
  deleteMessage(messageId?: number): Promise<void>;
};
