const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const REQUIRED_ENV_KEYS = ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"];
const RECEIPT_NUMBER_PREFIX = "KV-";
const RECEIPT_NUMBER_WIDTH = 6;

const loadEnv = () => {
  const envPath = path.join(rootDir, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

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
};

const ensureDatabaseUrl = () => {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !process.env[key]);

  if (missingKeys.length > 0) {
    throw new Error(`Missing database environment variables: ${missingKeys.join(", ")}`);
  }

  const user = encodeURIComponent(process.env.POSTGRES_USER);
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
  const database = encodeURIComponent(process.env.POSTGRES_DB);
  const isInsideContainer = fs.existsSync("/.dockerenv");
  const host = process.env.POSTGRES_HOST ?? (isInsideContainer ? "postgres" : "127.0.0.1");
  const port = process.env.POSTGRES_PORT ?? "5432";
  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;

  process.env.DATABASE_URL = databaseUrl;
  return databaseUrl;
};

const buildReceiptNumber = (sequenceNumber) =>
  `${RECEIPT_NUMBER_PREFIX}${String(sequenceNumber).padStart(RECEIPT_NUMBER_WIDTH, "0")}`;

const main = async () => {
  loadEnv();
  ensureDatabaseUrl();

  const { PrismaClient } = require(path.join(rootDir, "packages", "db", "node_modules", "@prisma", "client"));
  const prisma = new PrismaClient({
    log: ["warn", "error"]
  });

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        telegramId: true
      },
      orderBy: {
        id: "asc"
      }
    });

    let updatedUsers = 0;
    let updatedOperations = 0;

    for (const user of users) {
      const operations = await prisma.operation.findMany({
        where: {
          userId: user.id
        },
        select: {
          id: true,
          receiptNumber: true,
          createdAt: true
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      });

      if (operations.length === 0) {
        continue;
      }

      const finalNumbers = operations.map((operation, index) => ({
        id: operation.id,
        currentReceiptNumber: operation.receiptNumber,
        nextReceiptNumber: buildReceiptNumber(index + 1)
      }));

      const needsUpdate = finalNumbers.some(
        (operation) => operation.currentReceiptNumber !== operation.nextReceiptNumber
      );

      if (!needsUpdate) {
        continue;
      }

      await prisma.$transaction(async (tx) => {
        for (const operation of finalNumbers) {
          await tx.operation.update({
            where: {
              id: operation.id
            },
            data: {
              receiptNumber: `TMP-RESEQ-${user.id}-${operation.id}`
            }
          });
        }

        for (const operation of finalNumbers) {
          await tx.operation.update({
            where: {
              id: operation.id
            },
            data: {
              receiptNumber: operation.nextReceiptNumber
            }
          });
        }
      });

      updatedUsers += 1;
      updatedOperations += finalNumbers.length;
    }

    console.log(
      [
        `Users checked: ${users.length}`,
        `Users resequenced: ${updatedUsers}`,
        `Operations resequenced: ${updatedOperations}`
      ].join("\n")
    );
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
