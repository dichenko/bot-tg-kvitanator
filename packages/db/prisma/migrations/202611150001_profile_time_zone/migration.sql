BEGIN;

-- Existing profiles and operations keep Moscow time (the only zone used so far).
ALTER TABLE "entrepreneur_profiles" ADD COLUMN "timeZone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow';
ALTER TABLE "operations" ADD COLUMN "timeZoneSnapshot" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow';

COMMIT;
