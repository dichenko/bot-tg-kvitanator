// Deliberately never load .env or contact a real bot/database.
Object.assign(process.env, {
  NODE_ENV: "test", BOT_TOKEN: "123456:statistics-test-token", WEBHOOK_URL: "https://test.invalid/webhook",
  RENDERER_URL: "http://127.0.0.1:1", RECEIPTS_DIR: "test-results", EXPORTS_DIR: "test-results",
  APP_TIMEZONE: "Europe/Moscow", DAILY_STATS_TELEGRAM_ID: "1234", DAILY_STATS_HOUR: "7",
  ENABLE_MAX: "false", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused"
});
const path = require("node:path");
const { DateTime } = require("../apps/bot/node_modules/luxon");
const stats = require("../apps/bot/dist/services/statisticsService");
require("../apps/bot/dist/services/logger").logger.level = "silent";
const cutoff = DateTime.fromISO("2026-11-14T07:00:00", { zone: "Europe/Moscow" });
function sampleSnapshot(empty = false) {
  const periods = {};
  for (const period of stats.PERIODS) {
    const bounds = stats.periodBounds(period, cutoff);
    const buckets = bounds.slice(0, -1).map((b, i) => ({ from: b.toUTC().toISO(), to: bounds[i + 1].toUTC().toISO(),
      telegram: empty ? 0 : i + 2, max: empty ? 0 : i % 3 + 1, unknown: empty ? 0 : i === 0 ? 2 : 0 }));
    const receipts = buckets.reduce((c, b) => ({ ...c, total: c.total + b.telegram + b.max + b.unknown,
      telegram: c.telegram + b.telegram, max: c.max + b.max, unknown: c.unknown + b.unknown }), { total: 0, telegram: 0, max: 0, unknown: 0, overlap: 0 });
    const clients = empty ? { ...receipts } : { total: 10, telegram: 6, max: 4, unknown: 1, overlap: 1 };
    periods[period] = { from: bounds[0].toUTC().toISO(), to: cutoff.toUTC().toISO(),
      newClients: empty ? { ...receipts } : { total: 11, telegram: 6, max: 4, unknown: 1, overlap: 0 }, activeClients: clients, receipts, buckets };
  }
  return { version: 1, cutoff: cutoff.toUTC().toISO(), timezone: "Europe/Moscow", periods };
}
module.exports = { ...stats, DateTime, cutoff, sampleSnapshot, root: path.resolve(__dirname, "..") };
