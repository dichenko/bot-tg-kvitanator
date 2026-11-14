export interface ReceiptBranding {
  logoFileName: string | null;
  name: string;
  subtitle: string;
}

export const BRANDING_LOGO_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;
export const BRANDING_NAME_LIMIT = 60;
export const BRANDING_SUBTITLE_LIMIT = 120;

/** Reject arbitrary paths and malformed persisted JSON at both sides of the renderer API. */
export const parseReceiptBranding = (value: unknown): ReceiptBranding | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { logoFileName, name, subtitle } = value as Record<string, unknown>;
  if (logoFileName !== null && (typeof logoFileName !== "string" || !BRANDING_LOGO_FILE_PATTERN.test(logoFileName))) return null;
  if (typeof name !== "string" || name.length > BRANDING_NAME_LIMIT || typeof subtitle !== "string" || subtitle.length > BRANDING_SUBTITLE_LIMIT) return null;
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(name + subtitle)) return null;
  if (!logoFileName && !name.trim() && !subtitle.trim()) return null;
  return { logoFileName, name, subtitle };
};
