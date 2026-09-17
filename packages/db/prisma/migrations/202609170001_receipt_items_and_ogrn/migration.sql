CREATE TYPE "ReceiptCalculationType" AS ENUM ('INCOME', 'INCOME_RETURN');

ALTER TABLE "entrepreneur_profiles" ADD COLUMN "ogrn" VARCHAR(15);
ALTER TABLE "operations" ADD COLUMN "ogrnSnapshot" VARCHAR(15);
ALTER TABLE "operations" ADD COLUMN "calculationType" "ReceiptCalculationType" NOT NULL DEFAULT 'INCOME';

CREATE TABLE "operation_items" (
  "id" SERIAL NOT NULL,
  "operationId" INTEGER NOT NULL,
  "serviceId" INTEGER,
  "title" VARCHAR(160) NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "operation_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "operation_items_operationId_idx" ON "operation_items"("operationId");
ALTER TABLE "operation_items" ADD CONSTRAINT "operation_items_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operation_items" ADD CONSTRAINT "operation_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve existing single-line receipts as one item.
INSERT INTO "operation_items" ("operationId", "serviceId", "title", "quantity", "price", "amount")
SELECT "id", "serviceId", "serviceTitleSnapshot", 1, "amount", "amount" FROM "operations";
