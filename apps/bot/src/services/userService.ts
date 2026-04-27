import { prisma } from "@receipt-bot/db";
import type { EntrepreneurProfile, Service, User } from "@receipt-bot/db";

type TelegramUserInput = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export const upsertTelegramUser = async (telegramUser: TelegramUserInput): Promise<User> =>
  prisma.user.upsert({
    where: {
      telegramId: BigInt(telegramUser.id)
    },
    create: {
      telegramId: BigInt(telegramUser.id),
      username: telegramUser.username ?? null,
      firstName: telegramUser.first_name ?? null,
      lastName: telegramUser.last_name ?? null
    },
    update: {
      username: telegramUser.username ?? null,
      firstName: telegramUser.first_name ?? null,
      lastName: telegramUser.last_name ?? null
    }
  });

export const getProfileByUserId = async (userId: number): Promise<EntrepreneurProfile | null> =>
  prisma.entrepreneurProfile.findUnique({
    where: { userId }
  });

export const upsertProfile = async (
  userId: number,
  input: { inn: string; ipFullName: string; address: string }
): Promise<EntrepreneurProfile> =>
  prisma.entrepreneurProfile.upsert({
    where: { userId },
    create: {
      userId,
      inn: input.inn,
      ipFullName: input.ipFullName,
      address: input.address
    },
    update: {
      inn: input.inn,
      ipFullName: input.ipFullName,
      address: input.address
    }
  });

export const updateProfileField = async (
  userId: number,
  field: "inn" | "ipFullName" | "address",
  value: string
): Promise<EntrepreneurProfile> =>
  prisma.entrepreneurProfile.update({
    where: { userId },
    data: { [field]: value }
  });

export const listActiveServices = async (userId: number): Promise<Service[]> =>
  prisma.service.findMany({
    where: {
      userId,
      isActive: true
    },
    orderBy: [{ createdAt: "asc" }]
  });

export const getActiveService = async (userId: number, serviceId: number): Promise<Service | null> =>
  prisma.service.findFirst({
    where: {
      id: serviceId,
      userId,
      isActive: true
    }
  });

export const createService = async (userId: number, title: string): Promise<Service> =>
  prisma.service.create({
    data: {
      userId,
      title,
      isActive: true
    }
  });

export const softDeleteService = async (userId: number, serviceId: number): Promise<void> => {
  await prisma.service.updateMany({
    where: {
      id: serviceId,
      userId,
      isActive: true
    },
    data: {
      isActive: false
    }
  });
};
