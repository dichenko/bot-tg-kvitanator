import type { BotSession } from "../types";
import { createInitialSession } from "../utils/state";
import { MaxApiClient } from "./client";
import type { MaxBotContext, MaxUpdate, MaxUser } from "./types";

const sessions = new Map<string, BotSession>();

const splitName = (name?: string): { firstName?: string; lastName?: string } => {
  if (!name) {
    return {};
  }

  const [firstName, ...rest] = name.trim().split(/\s+/);
  return {
    firstName,
    lastName: rest.length > 0 ? rest.join(" ") : undefined
  };
};

const normalizeUser = (user?: MaxUser): MaxBotContext["user"] | null => {
  if (!user?.user_id) {
    return null;
  }

  const fallback = splitName(user.name);

  return {
    id: user.user_id,
    username: user.username ?? null,
    firstName: user.first_name ?? fallback.firstName ?? null,
    lastName: user.last_name ?? fallback.lastName ?? null
  };
};

const getSession = (key: string): BotSession => {
  const existing = sessions.get(key);

  if (existing) {
    return existing;
  }

  const created = createInitialSession();
  sessions.set(key, created);
  return created;
};

export const createMaxContext = (client: MaxApiClient, update: MaxUpdate): MaxBotContext | null => {
  const user = normalizeUser(update.message?.sender ?? update.callback?.user ?? update.user);

  if (!user) {
    return null;
  }

  const chatId = update.chat_id ?? update.message?.recipient?.chat_id ?? update.callback?.message?.recipient?.chat_id;
  const session = getSession(`max:${user.id}`);
  const target = chatId ? { chatId } : { userId: user.id };
  let callbackAnswered = false;
  const callbackId = update.callback?.callback_id;

  const acknowledgeCallback = async (): Promise<void> => {
    if (!callbackId || callbackAnswered) {
      return;
    }

    callbackAnswered = true;
    await client.answerCallback(callbackId, { notification: " " }).catch(() => undefined);
  };

  return {
    user,
    chatId,
    callbackId,
    session,
    async reply(text, options) {
      await client.sendMessage(target, text, options);
      await acknowledgeCallback();
    },
    async sendMenu(text, keyboard, options) {
      if (callbackId && !callbackAnswered) {
        try {
          callbackAnswered = true;
          await client.answerCallback(callbackId, {
            text,
            options: {
              ...options,
              keyboard
            }
          });
          return;
        } catch {
          callbackAnswered = false;
        }
      }

      await client.sendMessage(target, text, { ...options, keyboard });
      await acknowledgeCallback();
    },
    async sendImage(filePath) {
      await client.sendUploadedFile(target, filePath, "image");
      await acknowledgeCallback();
    },
    async sendDocument(filePath, fileName, caption) {
      await client.sendUploadedFile(target, filePath, "file", caption ?? fileName);
      await acknowledgeCallback();
    },
    async deleteMessage() {
      await acknowledgeCallback();
    }
  };
};
