const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const [, , ...args] = process.argv;

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

if (args.length === 0) {
  console.error("Usage: node scripts/run-prisma.cjs <prisma-args>");
  process.exit(1);
}

const required = ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"];

if (!process.env.DATABASE_URL) {
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing database environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const user = encodeURIComponent(process.env.POSTGRES_USER);
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
  const database = encodeURIComponent(process.env.POSTGRES_DB);
  const host = process.env.POSTGRES_HOST || "postgres";
  const port = process.env.POSTGRES_PORT || "5432";

  process.env.DATABASE_URL = `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
}

const prismaBin = path.join(
  rootDir,
  "packages",
  "db",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma"
);

const prismaArgs = [...args, "--schema", "prisma/schema.prisma"];
const result =
  process.platform === "win32"
    ? spawnSync(prismaBin, prismaArgs, {
        cwd: path.join(rootDir, "packages", "db"),
        env: process.env,
        stdio: "inherit",
        shell: true
      })
    : spawnSync(prismaBin, prismaArgs, {
        cwd: path.join(rootDir, "packages", "db"),
        env: process.env,
        stdio: "inherit"
      });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
