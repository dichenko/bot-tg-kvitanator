CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER');
CREATE TYPE "OperationStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'RENDERING', 'RENDERED', 'SENT', 'FAILED', 'DELETED');
CREATE TYPE "RenderJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" VARCHAR(64),
    "firstName" VARCHAR(128),
    "lastName" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entrepreneur_profiles" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "inn" VARCHAR(12) NOT NULL,
    "ipFullName" VARCHAR(255) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "entrepreneur_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "services" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operations" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "profileId" INTEGER NOT NULL,
    "serviceId" INTEGER,
    "receiptNumber" VARCHAR(32) NOT NULL,
    "innSnapshot" VARCHAR(12) NOT NULL,
    "ipFullNameSnapshot" VARCHAR(255) NOT NULL,
    "addressSnapshot" VARCHAR(255) NOT NULL,
    "serviceTitleSnapshot" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'DRAFT',
    "imagePath" VARCHAR(500),
    "errorMessage" VARCHAR(1000),
    "renderedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "render_jobs" (
    "id" SERIAL NOT NULL,
    "operationId" INTEGER NOT NULL,
    "status" "RenderJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "render_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_telegramId_key" ON "users"("telegramId");
CREATE UNIQUE INDEX "entrepreneur_profiles_userId_key" ON "entrepreneur_profiles"("userId");
CREATE INDEX "services_userId_isActive_idx" ON "services"("userId", "isActive");
CREATE INDEX "operations_userId_createdAt_idx" ON "operations"("userId", "createdAt");
CREATE UNIQUE INDEX "operations_userId_receiptNumber_key" ON "operations"("userId", "receiptNumber");
CREATE UNIQUE INDEX "render_jobs_operationId_key" ON "render_jobs"("operationId");

ALTER TABLE "entrepreneur_profiles" ADD CONSTRAINT "entrepreneur_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "services" ADD CONSTRAINT "services_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operations" ADD CONSTRAINT "operations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operations" ADD CONSTRAINT "operations_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "entrepreneur_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operations" ADD CONSTRAINT "operations_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
