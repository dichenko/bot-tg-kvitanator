ALTER TABLE "users" ADD COLUMN "maxId" BIGINT;
ALTER TABLE "users" ALTER COLUMN "telegramId" DROP NOT NULL;
CREATE UNIQUE INDEX "users_maxId_key" ON "users"("maxId");
