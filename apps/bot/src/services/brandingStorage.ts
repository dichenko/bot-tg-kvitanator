import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@receipt-bot/db";
import { BRANDING_LOGO_FILE_PATTERN } from "@receipt-bot/shared";
import { config } from "../config";
import type { BotSession } from "../types";
import { clearBrandingDraft } from "../utils/state";
import { logger } from "./logger";

const temporaryLogos = new Set<string>();
const leases = new Map<string, number>();
const DRAFT_LEASE_MS = 30 * 60_000;
export const UNUSED_LOGO_GRACE_MS = 10 * 60_000;

export const retainBrandingLogo = (name: string | null | undefined): void => {
  if (name && BRANDING_LOGO_FILE_PATTERN.test(name)) leases.set(name, Date.now() + DRAFT_LEASE_MS);
};

export const registerTemporaryLogo = (name: string): void => {
  temporaryLogos.add(name);
  retainBrandingLogo(name);
};

export const markLogoSaved = (name: string | null | undefined): void => {
  if (name) temporaryLogos.delete(name);
};

/** One database snapshot protects both selected logos and every historical receipt. */
export const cleanupUnusedBrandingLogos = async (options: {
  receiptsDir?: string; minAgeMs?: number; candidates?: string[]; now?: number;
} = {}): Promise<{ scanned: number; removed: number }> => {
  const dir = path.resolve(options.receiptsDir ?? config.receiptsDir, "branding");
  let files;
  try { files = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { scanned: 0, removed: 0 };
    throw error;
  }
  const candidates = options.candidates ? new Set(options.candidates) : null;
  const eligible = files.filter(file => file.isFile() && BRANDING_LOGO_FILE_PATTERN.test(file.name) && (!candidates || candidates.has(file.name)));
  if (!eligible.length) return { scanned: 0, removed: 0 };
  // If the query fails, nothing is deleted. Do not infer usage from file age alone.
  const rows = await prisma.$queryRaw<Array<{ logoFileName: string | null }>>`
    SELECT "receiptBranding"->>'logoFileName' AS "logoFileName" FROM entrepreneur_profiles
    UNION
    SELECT "brandingSnapshot"->>'logoFileName' AS "logoFileName" FROM operations
  `;
  const used = new Set(rows.map(row => row.logoFileName).filter((name): name is string => Boolean(name)));
  const now = options.now ?? Date.now();
  let removed = 0;
  for (const file of eligible) {
    if (used.has(file.name) || (leases.get(file.name) ?? 0) > now) continue;
    const target = path.resolve(dir, file.name);
    if (path.dirname(target) !== dir) throw new Error("Invalid branding cleanup path");
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || now - stat.mtimeMs < (options.minAgeMs ?? UNUSED_LOGO_GRACE_MS)) continue;
      if ((leases.get(file.name) ?? 0) > now) continue;
      await fs.unlink(target);
      leases.delete(file.name);
      temporaryLogos.delete(file.name);
      removed++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { scanned: eligible.length, removed };
};

export const releaseUnusedBrandingLogo = async (name: string | null | undefined): Promise<void> => {
  if (!name || !BRANDING_LOGO_FILE_PATTERN.test(name)) return;
  leases.delete(name);
  await cleanupUnusedBrandingLogos({ candidates: [name], minAgeMs: temporaryLogos.has(name) ? 0 : UNUSED_LOGO_GRACE_MS });
};

export const cleanupBrandingDraftChange = async (previous: string | null | undefined, session: BotSession): Promise<void> => {
  const current = session.brandingDraft?.logoFileName;
  retainBrandingLogo(current);
  if (previous && previous !== current) await releaseUnusedBrandingLogo(previous);
};

export const discardBrandingDraft = async (session: BotSession): Promise<void> => {
  const previous = session.brandingDraft?.logoFileName;
  clearBrandingDraft(session);
  await cleanupBrandingDraftChange(previous, session);
};

/** Refresh before removing a profile reference so in-flight receipt creation has time to finish. */
export const protectReplacedLogo = async (name: string | null | undefined): Promise<void> => {
  if (!name || !BRANDING_LOGO_FILE_PATTERN.test(name)) return;
  const now = new Date();
  await fs.utimes(path.join(config.receiptsDir, "branding", name), now, now).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
};

export const startBrandingCleanup = async (): Promise<void> => {
  const clean = async (minAgeMs: number) => {
    try {
      const result = await cleanupUnusedBrandingLogos({ minAgeMs });
      logger.info(result, "Unused branding logos cleaned");
    } catch (error) { logger.warn({ err: error }, "Branding logo cleanup failed; no unverified files are deleted"); }
  };
  // No Telegram sessions exist yet: remove abandoned files from earlier versions/restarts.
  await clean(0);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await clean(UNUSED_LOGO_GRACE_MS); } finally { running = false; }
  }, 60_000);
  timer.unref();
};
