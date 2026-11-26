import { Prisma, prisma } from "@receipt-bot/db";
import { DateTime } from "luxon";

export const PERIODS = ["day", "week", "month", "half"] as const;
export type StatsPeriod = typeof PERIODS[number];
export type ChartChannel = "all" | "tg" | "max";
export type ChannelCounts = { total: number; telegram: number; max: number; unknown: number; overlap: number };
export type StatsBucket = { from: string; to: string; telegram: number; max: number; unknown: number };
// active7: unique users with >=1 sent receipt in the 7 local days ending on `date` (absent in reports saved before this metric).
export type MonthChartDay = { date: string; users: number; active: number; active7?: number; receipts: number };
export type PeriodStatistics = {
  from: string;
  to: string;
  newClients: ChannelCounts;
  activeClients: ChannelCounts;
  receipts: ChannelCounts;
  buckets: StatsBucket[];
};
export type StatisticsSnapshot = {
  version: 1;
  cutoff: string;
  timezone: string;
  periods: Record<StatsPeriod, PeriodStatistics>;
  monthlyChart?: MonthChartDay[]; // Older saved reports contain only period aggregates.
};

export const periodBounds = (period: StatsPeriod, cutoff: DateTime): DateTime[] => {
  if (!cutoff.isValid) throw new Error("Invalid statistics cutoff or timezone");
  const from = period === "half" ? cutoff.minus({ months: 6 })
    : cutoff.minus({ hours: { day: 24, week: 168, month: 720 }[period] });
  const bounds = [from];
  let cursor = period === "day" ? from.plus({ hours: 4 })
    : period === "half" ? from.startOf("month").plus({ months: 1 })
    : from.startOf("day").plus({ days: 1 });
  while (cursor < cutoff) {
    bounds.push(cursor);
    cursor = period === "day" ? cursor.plus({ hours: 4 })
      : period === "half" ? cursor.plus({ months: 1 }) : cursor.plus({ days: 1 });
  }
  bounds.push(cutoff);
  return bounds;
};

const zeroCounts = (): ChannelCounts => ({ total: 0, telegram: 0, max: 0, unknown: 0, overlap: 0 });
type CountRow = { kind: string; bucket: number; total: bigint; telegram: bigint; max: bigint; unknown: bigint; overlap: bigint };
const counts = (row?: CountRow): ChannelCounts => row ? {
  total: Number(row.total), telegram: Number(row.telegram), max: Number(row.max),
  unknown: Number(row.unknown), overlap: Number(row.overlap)
} : zeroCounts();

export const aggregatePeriod = async (
  tx: Prisma.TransactionClient, period: StatsPeriod, cutoff: DateTime
): Promise<PeriodStatistics> => {
  const bounds = periodBounds(period, cutoff);
  const from = bounds[0].toUTC().toJSDate();
  const to = cutoff.toUTC().toJSDate();
  const values = Prisma.join(bounds.slice(0, -1).map((b, i) =>
    Prisma.sql`(${i}::int, ${b.toUTC().toJSDate()}::timestamp, ${bounds[i + 1].toUTC().toJSDate()}::timestamp)`));
  // One bounded, aggregate-only result. Half-open intervals [from, to) never
  // count a boundary twice. A receipt belongs to its first successful send.
  const rows = await tx.$queryRaw<CountRow[]>(Prisma.sql`
    WITH issued AS MATERIALIZED (
      SELECT "userId", channel, COALESCE("sentAt", "createdAt") AS at
      FROM operations WHERE status = 'SENT'
        AND COALESCE("sentAt", "createdAt") >= ${from}
        AND COALESCE("sentAt", "createdAt") < ${to}
    ), active AS (
      SELECT "userId", bool_or(channel = 'TELEGRAM') AS tg,
        bool_or(channel = 'MAX') AS mx FROM issued GROUP BY "userId"
    ), bounds(bucket, lo, hi) AS (VALUES ${values})
    SELECT 'new' AS kind, -1 AS bucket, count(*) AS total,
      count(*) FILTER (WHERE "registrationChannel" = 'TELEGRAM') AS telegram,
      count(*) FILTER (WHERE "registrationChannel" = 'MAX') AS max,
      count(*) FILTER (WHERE "registrationChannel" = 'UNKNOWN') AS unknown, 0::bigint AS overlap
      FROM users WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
    UNION ALL
    SELECT 'active', -1, count(*), count(*) FILTER (WHERE tg), count(*) FILTER (WHERE mx),
      count(*) FILTER (WHERE NOT tg AND NOT mx), count(*) FILTER (WHERE tg AND mx) FROM active
    UNION ALL
    SELECT 'receipts', -1, count(*), count(*) FILTER (WHERE channel = 'TELEGRAM'),
      count(*) FILTER (WHERE channel = 'MAX'), count(*) FILTER (WHERE channel = 'UNKNOWN'), 0::bigint FROM issued
    UNION ALL
    SELECT 'bucket', b.bucket, count(i.at), count(*) FILTER (WHERE i.channel = 'TELEGRAM'),
      count(*) FILTER (WHERE i.channel = 'MAX'), count(*) FILTER (WHERE i.channel = 'UNKNOWN'), 0::bigint
      FROM bounds b LEFT JOIN issued i ON i.at >= b.lo AND i.at < b.hi GROUP BY b.bucket
  `);
  return {
    from: bounds[0].toUTC().toISO()!, to: cutoff.toUTC().toISO()!,
    newClients: counts(rows.find(r => r.kind === "new")),
    activeClients: counts(rows.find(r => r.kind === "active")),
    receipts: counts(rows.find(r => r.kind === "receipts")),
    buckets: bounds.slice(0, -1).map((b, i) => {
      const c = counts(rows.find(r => r.kind === "bucket" && r.bucket === i));
      return { from: b.toUTC().toISO()!, to: bounds[i + 1].toUTC().toISO()!, telegram: c.telegram, max: c.max, unknown: c.unknown };
    })
  };
};

const aggregateMonthlyChart = async (tx: Prisma.TransactionClient, cutoff: DateTime): Promise<MonthChartDay[]> => {
  const lastDay = cutoff.minus({ milliseconds: 1 }).startOf("day");
  const firstDay = lastDay.minus({ days: 29 });
  const days = Array.from({ length: 30 }, (_, i) => firstDay.plus({ days: i }));
  // wlo: start of the rolling 7-day window (this local day and the 6 before it).
  const bounds = Prisma.join(days.map((day, i) => {
    const end = days[i + 1] ?? cutoff;
    return Prisma.sql`(${i}::int, ${day.toJSDate()}::timestamp, ${end.toJSDate()}::timestamp, ${day.minus({ days: 6 }).toJSDate()}::timestamp)`;
  }));
  const rows = await tx.$queryRaw<{ day: number; users: bigint; active: bigint; active7: bigint; receipts: bigint }[]>(Prisma.sql`
    WITH bounds(day, lo, hi, wlo) AS (VALUES ${bounds})
    SELECT day, ((SELECT count(*) FROM users WHERE "createdAt" < ${firstDay.toJSDate()}) +
      sum(registrations.n) OVER (ORDER BY day))::bigint AS users, issued.active, rolling.active7, issued.receipts
    FROM bounds
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT "userId") AS active7 FROM operations
      WHERE status = 'SENT' AND COALESCE("sentAt", "createdAt") >= wlo AND COALESCE("sentAt", "createdAt") < hi
    ) rolling
    CROSS JOIN LATERAL (
      SELECT count(*) AS n FROM users WHERE "createdAt" >= lo AND "createdAt" < hi
    ) registrations
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT "userId") AS active, count(*) AS receipts FROM operations
      WHERE status = 'SENT' AND COALESCE("sentAt", "createdAt") >= lo AND COALESCE("sentAt", "createdAt") < hi
    ) issued
    ORDER BY day
  `);
  return rows.map(row => ({
    date: days[row.day].toISODate()!, users: Number(row.users), active: Number(row.active), active7: Number(row.active7), receipts: Number(row.receipts)
  }));
};

export const buildStatisticsSnapshot = async (cutoff: DateTime): Promise<StatisticsSnapshot> =>
  prisma.$transaction(async tx => {
    const periods = {} as Record<StatsPeriod, PeriodStatistics>;
    for (const period of PERIODS) periods[period] = await aggregatePeriod(tx, period, cutoff);
    const monthlyChart = await aggregateMonthlyChart(tx, cutoff);
    return { version: 1, cutoff: cutoff.toUTC().toISO()!, timezone: cutoff.zoneName!, periods, monthlyChart };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });

export const formatStatsText = (snapshot: StatisticsSnapshot): string => {
  const p = snapshot.periods.day;
  const time = DateTime.fromISO(snapshot.cutoff).setZone(snapshot.timezone);
  const line = (title: string, c: ChannelCounts): string =>
    `${title}: ${c.total} (TG: ${c.telegram}, MAX: ${c.max}, неизвестно: ${c.unknown}${c.overlap ? `; в обоих: ${c.overlap}` : ""})`;
  return ["Квитанатор · Статистика за последние 24 часа", `${time.toFormat("dd.LL.yyyy, HH:mm")} ${snapshot.timezone === "Europe/Moscow" ? "МСК" : snapshot.timezone}`,
    line("Новые клиенты", p.newClients), line("Активные клиенты", p.activeClients), line("Квитанции", p.receipts)].join("\n");
};
