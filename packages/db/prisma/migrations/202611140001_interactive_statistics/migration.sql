BEGIN;

CREATE TYPE "StatisticsChannel" AS ENUM ('TELEGRAM', 'MAX', 'UNKNOWN');

ALTER TABLE "users" ADD COLUMN "registrationChannel" "StatisticsChannel" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "operations" ADD COLUMN "channel" "StatisticsChannel" NOT NULL DEFAULT 'UNKNOWN';

-- Only one available platform identifier is evidence of a channel.
-- Both identifiers (or neither) remain UNKNOWN; never guess or double count.
UPDATE "users" SET "registrationChannel" = CASE
  WHEN "telegramId" IS NOT NULL AND "maxId" IS NULL THEN 'TELEGRAM'::"StatisticsChannel"
  WHEN "maxId" IS NOT NULL AND "telegramId" IS NULL THEN 'MAX'::"StatisticsChannel"
  ELSE 'UNKNOWN'::"StatisticsChannel" END;
UPDATE "operations" o SET "channel" = u."registrationChannel"
FROM "users" u WHERE u.id = o."userId";

CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");
-- Expression/partial index: Prisma cannot represent this index in schema.prisma.
-- COALESCE preserves legacy SENT records which have no sentAt.
CREATE INDEX "operations_statistics_sent_idx"
  ON "operations" ((COALESCE("sentAt", "createdAt")), "channel", "userId")
  WHERE "status" = 'SENT';

CREATE TABLE "statistics_reports" (
  "id" TEXT NOT NULL,
  "deliveryKey" VARCHAR(160),
  "recipientId" BIGINT NOT NULL,
  "cutoffAt" TIMESTAMP(3) NOT NULL,
  "timezone" VARCHAR(100) NOT NULL,
  "snapshot" JSONB,
  "state" VARCHAR(20) NOT NULL DEFAULT 'PREPARING',
  "leaseUntil" TIMESTAMP(3) NOT NULL,
  "messageId" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "statistics_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "statistics_reports_deliveryKey_key" ON "statistics_reports"("deliveryKey");
CREATE UNIQUE INDEX "statistics_reports_recipientId_messageId_key" ON "statistics_reports"("recipientId", "messageId");

COMMIT;
