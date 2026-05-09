import type { BotSession } from "../types";
import { createInitialSession } from "../utils/state";
import { MaxApiClient } from "./client";
import type { MaxBotContext, MaxUpdate, MaxUser } from "./types";
import { Prisma, prisma } from "@receipt-bot/db";

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeSession = (value: unknown): BotSession => {
  const initial = createInitialSession();

  if (!isObject(value)) {
    return initial;
  }

  return {
    awaitingInput:
      value.awaitingInput === null || typeof value.awaitingInput === "string"
        ? (value.awaitingInput as BotSession["awaitingInput"])
        : initial.awaitingInput,
    registrationDraft: isObject(value.registrationDraft) ? value.registrationDraft : initial.registrationDraft,
    receiptDraft: isObject(value.receiptDraft) ? value.receiptDraft : null
  };
};

const getSession = async (key: string): Promise<BotSession> => {
  const stored = await prisma.conversationSession.findUnique({
    where: { key }
  });

  return normalizeSession(stored?.data);
};

const saveSession = async (key: string, session: BotSession): Promise<void> => {
  await prisma.conversationSession.upsert({
    where: { key },
    create: {
      key,
      data: session as unknown as Prisma.InputJsonValue
    },
    update: {
      data: session as unknown as Prisma.InputJsonValue
    }
  });
};

export const createMaxContext = async (client: MaxApiClient, update: MaxUpdate): Promise<MaxBotContext | null> => {
  const user = normalizeUser(update.message?.sender ?? update.callback?.user ?? update.user);

  if (!user) {
    return null;
  }

  const chatId = update.chat_id ?? update.message?.recipient?.chat_id ?? update.callback?.message?.recipient?.chat_id;
  const sessionKey = `max:${user.id}`;
  const session = await getSession(sessionKey);
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
    },
    async saveSession() {
      await saveSession(sessionKey, session);
    }
  };
};
