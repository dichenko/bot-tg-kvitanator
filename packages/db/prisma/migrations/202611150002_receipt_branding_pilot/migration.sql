-- Nullable fields keep all existing profiles and receipts on the standard design.
ALTER TABLE "entrepreneur_profiles" ADD COLUMN "receiptBranding" JSONB;
ALTER TABLE "operations" ADD COLUMN "brandingSnapshot" JSONB;
