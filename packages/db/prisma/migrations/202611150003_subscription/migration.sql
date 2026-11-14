-- Nullable columns: every existing user starts without a subscription (standard receipt design).
ALTER TABLE "users" ADD COLUMN "subscriptionUntil" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "subscriptionReminderDay" INTEGER;
