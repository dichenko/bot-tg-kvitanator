const REQUIRED_ENV_KEYS = ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"] as const;

export const ensureDatabaseUrl = (): string => {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);

  if (missingKeys.length > 0) {
    throw new Error(`Missing database environment variables: ${missingKeys.join(", ")}`);
  }

  const user = encodeURIComponent(process.env.POSTGRES_USER!);
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD!);
  const database = encodeURIComponent(process.env.POSTGRES_DB!);
  const host = process.env.POSTGRES_HOST ?? "postgres";
  const port = process.env.POSTGRES_PORT ?? "5432";

  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
  process.env.DATABASE_URL = databaseUrl;
  return databaseUrl;
};
