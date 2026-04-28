const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

const DEFAULT_CSV_PATH = path.join(rootDir, "tmp_import", "File1.csv");
const DEFAULT_TELEGRAM_ID = "19422781";
const REQUIRED_ENV_KEYS = ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"];
const PAYMENT_METHOD_MAP = {
  "Наличная оплата": "CASH",
  "Безналичная оплата": "BANK_TRANSFER"
};

const parseArgs = (argv) => {
  const options = {
    csv: DEFAULT_CSV_PATH,
    telegramId: DEFAULT_TELEGRAM_ID
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    if ((arg === "--csv" || arg === "-c") && nextValue) {
      options.csv = path.resolve(rootDir, nextValue);
      index += 1;
      continue;
    }

    if ((arg === "--tg-id" || arg === "--telegram-id" || arg === "-t") && nextValue) {
      options.telegramId = nextValue.trim();
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
};

const printHelp = () => {
  console.log(
    [
      "Usage: node scripts/import-legacy-receipts.cjs [--csv <path>] [--tg-id <telegram-id>]",
      "",
      `Defaults: --csv ${path.relative(rootDir, DEFAULT_CSV_PATH)} --tg-id ${DEFAULT_TELEGRAM_ID}`
    ].join("\n")
  );
};

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

const parseCsv = (csvPath) => {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("CSV file is empty");
  }

  const headers = lines[0].split(";").map((header) => header.trim());

  return lines.slice(1).map((line, lineIndex) => {
    const values = line.split(";");

    if (values.length !== headers.length) {
      throw new Error(`Malformed CSV row ${lineIndex + 2}: expected ${headers.length} columns, got ${values.length}`);
    }

    return headers.reduce((record, header, headerIndex) => {
      record[header] = values[headerIndex].trim();
      return record;
    }, {});
  });
};

const parseInteger = (value, fieldName) => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer in "${fieldName}": ${value}`);
  }

  return parsed;
};

const parseAmount = (value, fieldName) => {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid amount in "${fieldName}": ${value}`);
  }

  return parsed;
};

const parseBoolean = (value, fieldName) => {
  const normalized = value.trim().toUpperCase();

  if (normalized === "TRUE") {
    return true;
  }

  if (normalized === "FALSE") {
    return false;
  }

  throw new Error(`Invalid boolean in "${fieldName}": ${value}`);
};

const toReceiptNumber = (receiptId) => `KV-${String(receiptId).padStart(6, "0")}`;

const backupCurrentOperations = async (prisma, backupDir) => {
  const [operations, renderJobs] = await Promise.all([
    prisma.operation.findMany({
      orderBy: {
        id: "asc"
      }
    }),
    prisma.renderJob.findMany({
      orderBy: {
        id: "asc"
      }
    })
  ]);

  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `operations-backup-${timestamp}.json`);

  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        operationsCount: operations.length,
        renderJobsCount: renderJobs.length,
        operations,
        renderJobs
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    backupPath,
    operationsCount: operations.length,
    renderJobsCount: renderJobs.length
  };
};

const buildImportRows = (records, serviceIdByTitle) => {
  const seenIds = new Set();
  const seenReceiptNumbers = new Set();

  return records.map((record) => {
    const legacyId = parseInteger(record.id, "id");
    const receiptId = parseInteger(record.reciept_id, "reciept_id");

    if (legacyId !== receiptId) {
      throw new Error(`Row id mismatch: id=${legacyId}, reciept_id=${receiptId}`);
    }

    if (seenIds.has(legacyId)) {
      throw new Error(`Duplicate legacy id in CSV: ${legacyId}`);
    }

    const receiptNumber = toReceiptNumber(receiptId);

    if (seenReceiptNumbers.has(receiptNumber)) {
      throw new Error(`Duplicate receipt number in CSV: ${receiptNumber}`);
    }

    seenIds.add(legacyId);
    seenReceiptNumbers.add(receiptNumber);

    const paymentMethod = PAYMENT_METHOD_MAP[record.payment_type];

    if (!paymentMethod) {
      throw new Error(`Unsupported payment type: ${record.payment_type}`);
    }

    const quantity = parseAmount(record.service_amount, "service_amount");
    const price = parseAmount(record.service_price, "service_price");
    const amount = (price * quantity).toFixed(2);
    const createdAt = new Date(record.createdAt);
    const updatedAt = new Date(record.updatedAt);
    const isDone = parseBoolean(record.done, "done");

    if (Number.isNaN(createdAt.getTime())) {
      throw new Error(`Invalid createdAt value: ${record.createdAt}`);
    }

    if (Number.isNaN(updatedAt.getTime())) {
      throw new Error(`Invalid updatedAt value: ${record.updatedAt}`);
    }

    return {
      id: legacyId,
      serviceId: serviceIdByTitle.get(record.service_name) ?? null,
      serviceTitle: record.service_name,
      receiptNumber,
      amount,
      paymentMethod,
      status: isDone ? "SENT" : "CONFIRMED",
      createdAt,
      updatedAt,
      renderedAt: isDone ? updatedAt : null,
      sentAt: isDone ? updatedAt : null
    };
  });
};

const main = async () => {
  loadEnv();
  ensureDatabaseUrl();

  const { csv, telegramId } = parseArgs(process.argv.slice(2));
  const records = parseCsv(csv).filter((record) => record.tg_id === telegramId);

  if (records.length === 0) {
    throw new Error(`No rows found in CSV for Telegram ID ${telegramId}`);
  }

  const { PrismaClient, Prisma } = require(path.join(rootDir, "packages", "db", "node_modules", "@prisma", "client"));
  const prisma = new PrismaClient({
    log: ["warn", "error"]
  });

  try {
    const user = await prisma.user.findUnique({
      where: {
        telegramId: BigInt(telegramId)
      },
      include: {
        profile: true
      }
    });

    if (!user) {
      throw new Error(`User with Telegram ID ${telegramId} was not found in the database`);
    }

    if (!user.profile) {
      throw new Error(`User ${telegramId} does not have an entrepreneur profile in the database`);
    }

    const uniqueServiceTitles = [...new Set(records.map((record) => record.service_name))];
    const existingServices = await prisma.service.findMany({
      where: {
        userId: user.id,
        title: {
          in: uniqueServiceTitles
        }
      },
      orderBy: {
        id: "asc"
      }
    });

    const serviceIdByTitle = new Map(existingServices.map((service) => [service.title, service.id]));

    for (const title of uniqueServiceTitles) {
      if (serviceIdByTitle.has(title)) {
        continue;
      }

      const service = await prisma.service.create({
        data: {
          userId: user.id,
          title,
          isActive: true
        }
      });

      serviceIdByTitle.set(title, service.id);
    }

    const importRows = buildImportRows(records, serviceIdByTitle);
    const backup = await backupCurrentOperations(prisma, path.join(rootDir, "tmp_import", "backups"));
    const maxImportedId = Math.max(...importRows.map((row) => row.id));

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('TRUNCATE TABLE "render_jobs", "operations" RESTART IDENTITY CASCADE');

      for (const row of importRows) {
        await tx.$executeRaw`
          INSERT INTO "operations" (
            "id",
            "userId",
            "profileId",
            "serviceId",
            "receiptNumber",
            "innSnapshot",
            "ipFullNameSnapshot",
            "addressSnapshot",
            "serviceTitleSnapshot",
            "amount",
            "paymentMethod",
            "status",
            "imagePath",
            "errorMessage",
            "renderedAt",
            "sentAt",
            "createdAt",
            "updatedAt"
          )
          VALUES (
            ${row.id},
            ${user.id},
            ${user.profile.id},
            ${row.serviceId},
            ${row.receiptNumber},
            ${user.profile.inn},
            ${user.profile.ipFullName},
            ${user.profile.address},
            ${row.serviceTitle},
            CAST(${row.amount} AS DECIMAL(12, 2)),
            CAST(${row.paymentMethod} AS "PaymentMethod"),
            CAST(${row.status} AS "OperationStatus"),
            ${null},
            ${null},
            ${row.renderedAt},
            ${row.sentAt},
            ${row.createdAt},
            ${row.updatedAt}
          )
        `;
      }

      await tx.$executeRaw`
        SELECT setval(
          pg_get_serial_sequence('"operations"', 'id'),
          ${maxImportedId},
          true
        )
      `;
    });

    const [totalOperations, importedOperations, firstOperation, lastOperation] = await Promise.all([
      prisma.operation.count(),
      prisma.operation.count({
        where: {
          userId: user.id
        }
      }),
      prisma.operation.findFirst({
        where: {
          userId: user.id
        },
        orderBy: {
          id: "asc"
        }
      }),
      prisma.operation.findFirst({
        where: {
          userId: user.id
        },
        orderBy: {
          id: "desc"
        }
      })
    ]);

    console.log(
      [
        `Backup created: ${path.relative(rootDir, backup.backupPath)}`,
        `Deleted test receipts: ${backup.operationsCount}`,
        `Deleted render jobs: ${backup.renderJobsCount}`,
        `Imported receipts: ${importRows.length}`,
        `Operations in database now: ${totalOperations}`,
        `Operations for Telegram ID ${telegramId}: ${importedOperations}`,
        `Receipt range restored: ${firstOperation?.receiptNumber ?? "n/a"} .. ${lastOperation?.receiptNumber ?? "n/a"}`,
        "Note: IP snapshots were filled from the current entrepreneur profile because the legacy CSV does not contain INN/FIO/address."
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
