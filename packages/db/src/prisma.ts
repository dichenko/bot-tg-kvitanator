import { PrismaClient } from "@prisma/client";
import { ensureDatabaseUrl } from "./databaseUrl";

declare global {
  // eslint-disable-next-line no-var
  var __receiptBotPrisma__: PrismaClient | undefined;
}

ensureDatabaseUrl();

export const prisma =
  global.__receiptBotPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "info", "warn", "error"] : ["warn", "error"]
  });

if (process.env.NODE_ENV !== "production") {
  global.__receiptBotPrisma__ = prisma;
}
