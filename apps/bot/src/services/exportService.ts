import { promises as fs } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { OperationStatus, prisma } from "@receipt-bot/db";
import type { Operation } from "@receipt-bot/db";
import type { ExportRangeKey } from "@receipt-bot/shared";
import { DateTime } from "luxon";
import { formatAmount, formatPaymentMethod, formatOperationStatus } from "../utils/formatters";

const buildRange = (
  key: ExportRangeKey,
  timeZone: string
): { from?: Date; to?: Date } => {
  const now = DateTime.now().setZone(timeZone);

  if (key === "all_time") {
    return {};
  }

  if (key === "today") {
    return {
      from: now.startOf("day").toUTC().toJSDate(),
      to: now.endOf("day").toUTC().toJSDate()
    };
  }

  if (key === "current_month") {
    return {
      from: now.startOf("month").toUTC().toJSDate(),
      to: now.endOf("month").toUTC().toJSDate()
    };
  }

  const previous = now.minus({ months: 1 });
  return {
    from: previous.startOf("month").toUTC().toJSDate(),
    to: previous.endOf("month").toUTC().toJSDate()
  };
};

export const getOperationsForExport = async (
  userId: number,
  key: ExportRangeKey,
  timeZone: string
): Promise<Operation[]> => {
  const range = buildRange(key, timeZone);

  return prisma.operation.findMany({
    where: {
      userId,
      status: {
        not: OperationStatus.DELETED
      },
      ...(range.from || range.to
        ? {
            createdAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {})
            }
          }
        : {})
    },
    orderBy: {
      createdAt: "asc"
    }
  });
};

export const buildExportFile = async (
  operations: Operation[],
  options: { userId: number; rangeKey: ExportRangeKey; exportsDir: string; timeZone: string }
): Promise<{ filePath: string; fileName: string }> => {
  await fs.mkdir(options.exportsDir, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Операции");

  worksheet.columns = [
    { header: "Дата", key: "date", width: 22 },
    { header: "Номер квитанции", key: "receiptNumber", width: 18 },
    { header: "ИНН", key: "inn", width: 16 },
    { header: "ФИО ИП", key: "fullName", width: 32 },
    { header: "Адрес", key: "address", width: 32 },
    { header: "Услуга", key: "service", width: 28 },
    { header: "Сумма", key: "amount", width: 14 },
    { header: "Форма оплаты", key: "paymentMethod", width: 18 },
    { header: "Статус", key: "status", width: 18 },
  ];

  operations.forEach((operation) => {
    worksheet.addRow({
      date: DateTime.fromJSDate(operation.createdAt).setZone(options.timeZone).toFormat("dd.LL.yyyy HH:mm"),
      receiptNumber: operation.receiptNumber,
      inn: operation.innSnapshot,
      fullName: operation.ipFullNameSnapshot,
      address: operation.addressSnapshot,
      service: operation.serviceTitleSnapshot,
      amount: Number(operation.amount),
      paymentMethod: formatPaymentMethod(operation.paymentMethod),
      status: formatOperationStatus(operation.status)
    });
  });

  const total = operations.reduce((sum, operation) => sum + Number(operation.amount), 0);
  worksheet.addRow({});
  worksheet.addRow({
    service: "Итого",
    amount: total
  });

  worksheet.getRow(1).font = { bold: true };
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && row.getCell("amount").value) {
      row.getCell("amount").numFmt = "#,##0.00";
    }
  });

  const timestamp = DateTime.now().toFormat("yyyyLLdd-HHmmss");
  const fileName = `operations-${options.rangeKey}-${timestamp}.xlsx`;
  const filePath = path.join(options.exportsDir, fileName);

  await workbook.xlsx.writeFile(filePath);

  return { filePath, fileName };
};
