const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { DateTime } = require("../apps/bot/node_modules/luxon");
const shared = require("../packages/shared/dist");
const { prisma } = require("../packages/db/dist");
const operations = require("../apps/bot/dist/services/operationService");
const users = require("../apps/bot/dist/services/userService");
const tzService = require("../apps/bot/dist/services/timeZoneService");
const exportService = require("../apps/bot/dist/services/exportService");
const kb = require("../apps/bot/dist/keyboards");
const maxKb = require("../apps/bot/dist/max/keyboards");
const root = path.resolve(__dirname, "..");

const EXPECTED = [
  ["МСК−1", -1, "Europe/Kaliningrad"], ["МСК", 0, "Europe/Moscow"], ["МСК+1", 1, "Europe/Samara"],
  ["МСК+2", 2, "Asia/Yekaterinburg"], ["МСК+3", 3, "Asia/Omsk"], ["МСК+4", 4, "Asia/Novosibirsk"],
  ["МСК+5", 5, "Asia/Irkutsk"], ["МСК+6", 6, "Asia/Yakutsk"], ["МСК+7", 7, "Asia/Vladivostok"],
  ["МСК+8", 8, "Asia/Magadan"], ["МСК+9", 9, "Asia/Kamchatka"]
];
const buttons = k => k.inline_keyboard.flat();
const mockOp = (timeZoneSnapshot, createdAt) => ({ id: 1, receiptNumber: "KV-000001", createdAt, timeZoneSnapshot, amount: 100, serviceTitleSnapshot: "Услуга", items: [] });

test("reference has 11 zones, labels, standard ids and city hints", () => {
  assert.equal(shared.TIME_ZONE_OPTIONS.length, 11);
  assert.deepEqual(shared.TIME_ZONE_OPTIONS.map(o => [o.label, o.offset, o.zoneId]), EXPECTED);
  assert.equal(shared.formatTimeZoneButtonLabel(shared.getTimeZoneOptionByOffset(2)), "МСК+2 — Екатеринбург");
  assert.equal(shared.formatTimeZoneButtonLabel(shared.getTimeZoneOptionByOffset(4)), "МСК+4 — Новосибирск");
  assert.equal(shared.DEFAULT_TIME_ZONE, "Europe/Moscow");
  assert.equal(shared.resolveTimeZone("Mars/Base"), "Europe/Moscow");
  assert.equal(shared.resolveTimeZone(null), "Europe/Moscow");
});

test("offsets of all 11 zones relative to Moscow are correct in the reference instant", () => {
  const instant = new Date("2026-11-14T12:00:00Z");
  for (const [, offset, zoneId] of EXPECTED) {
    const moscow = DateTime.fromJSDate(instant).setZone("Europe/Moscow").offset;
    assert.equal((DateTime.fromJSDate(instant).setZone(zoneId).offset - moscow) / 60, offset, zoneId);
  }
});

test("formatting rolls over day, month and year for every zone", () => {
  // 2026-12-31 20:30 UTC = 23:30 MSK
  const nye = new Date("2026-12-31T20:30:00Z");
  assert.equal(shared.formatDateTimeInZone(nye, "Europe/Moscow"), "31.12.2026 23:30");
  assert.equal(shared.formatDateTimeInZone(nye, "Europe/Kaliningrad"), "31.12.2026 22:30");
  assert.equal(shared.formatDateTimeInZone(nye, "Europe/Samara"), "01.01.2027 00:30");
  assert.equal(shared.formatDateTimeInZone(nye, "Asia/Kamchatka"), "01.01.2027 08:30");
  // month rollover and midnight shown as 00:xx, not 24:xx
  assert.equal(shared.formatDateTimeInZone(new Date("2026-02-28T21:05:00Z"), "Europe/Samara"), "01.03.2026 01:05");
  assert.equal(shared.formatDateTimeInZone(new Date("2026-11-14T21:00:00Z"), "Europe/Moscow"), "15.11.2026 00:00");
  assert.equal(shared.formatDateTimeInZone(nye, "Asia/Yekaterinburg", ", "), "01.01.2027, 01:30");
  // renderer expression (luxon) must produce identical text
  for (const [, , zoneId] of EXPECTED) for (const iso of ["2026-12-31T20:30:00Z", "2026-02-28T21:05:00Z", "2026-11-14T21:00:00Z", "2026-03-31T23:59:00Z"]) {
    assert.equal(DateTime.fromISO(iso, { zone: "utc" }).setZone(zoneId).toFormat("dd.LL.yyyy HH:mm"), shared.formatDateTimeInZone(iso, zoneId), `${zoneId} ${iso}`);
  }
});

test("callback parsing accepts only the 11 offsets", () => {
  for (const [, offset, zoneId] of EXPECTED) {
    assert.equal(tzService.parseTimeZoneCallback(`tz:set:${offset}`), zoneId);
    assert.equal(tzService.parseTimeZoneCallback(`tz:reg:${offset}`), zoneId);
  }
  for (const bad of ["tz:set:10", "tz:set:-2", "tz:set:abc", "tz:set:", "tz:set:1.5"]) assert.equal(tzService.parseTimeZoneCallback(bad), null, bad);
});

test("registration screen: text, default button first, other 10 below (Telegram and MAX)", () => {
  assert.equal(tzService.buildRegistrationTimeZoneText(), "Выберите ваш часовой пояс относительно Москвы.\nОн будет использоваться для даты и времени в квитанциях.\n\nПо умолчанию: МСК.");
  const tg = buttons(kb.registrationTimeZoneKeyboard());
  assert.equal(tg.length, 11); assert.equal(tg[0].text, "Продолжить с МСК"); assert.equal(tg[0].callback_data, "tz:reg:0");
  assert.equal(new Set(tg.map(b => b.callback_data)).size, 11);
  const mx = maxKb.registrationTimeZoneKeyboard().flat();
  assert.deepEqual(mx.map(b => [b.text, b.payload]), tg.map(b => [b.text, b.callback_data]));
  assert(tg.some(b => b.text === "МСК+2 — Екатеринбург") && tg.some(b => b.text === "МСК+4 — Новосибирск"));
});

test("profile picker marks the current zone; profile has the change button; card lines", () => {
  for (const [, offset, zoneId] of EXPECTED) {
    const tg = buttons(kb.timeZoneSelectKeyboard(zoneId)); const marked = tg.filter(b => b.text.startsWith("✅"));
    assert.equal(marked.length, 1); assert.equal(marked[0].callback_data, `tz:set:${offset}`);
    assert.equal(maxKb.timeZoneSelectKeyboard(zoneId).flat().filter(b => b.text.startsWith("✅")).length, 1);
  }
  assert(buttons(kb.profileKeyboard()).some(b => b.text === "🕒 Изменить часовой пояс" && b.callback_data === "profile:tz"));
  assert(maxKb.profileKeyboard().flat().some(b => b.text === "🕒 Изменить часовой пояс" && b.payload === "profile:tz"));
  assert.deepEqual(tzService.buildProfileTimeZoneLines("Asia/Yekaterinburg", new Date("2026-11-14T20:30:00Z")), ["Часовой пояс: МСК+2", "Местное время сейчас: 15.11.2026, 01:30"]);
});

test("receipt creation copies the profile zone into timeZoneSnapshot; no zone prompts in receipt flow", async () => {
  const original = prisma.$transaction, created = [];
  prisma.$transaction = async fn => fn({ operation: { findFirst: async () => null, create: async ({ data }) => { created.push(data); return { id: 1, ...data }; } }, renderJob: { create: async () => ({}) } });
  const draft = { items: [{ serviceId: 1, quantity: "1", price: "10" }], paymentMethod: "CASH" };
  try {
    for (const [, , zoneId] of EXPECTED) await operations.createOperationWithSnapshots({ id: 1 }, { id: 1, inn: "1", ipFullName: "T", address: "A", ogrn: null, timeZone: zoneId }, [{ id: 1, title: "S" }], draft, "TELEGRAM");
    await operations.createOperationWithSnapshots({ id: 1 }, { id: 1, inn: "1", ipFullName: "T", address: "A", ogrn: null }, [{ id: 1, title: "S" }], draft, "MAX");
  } finally { prisma.$transaction = original; }
  assert.deepEqual(created.slice(0, 11).map(c => c.timeZoneSnapshot), EXPECTED.map(e => e[2]));
  assert.equal(created[11].timeZoneSnapshot, "Europe/Moscow");
  const src = fs.readFileSync(path.join(root, "apps/bot/src/handlers/callbacks.ts"), "utf8");
  const confirm = src.split("\n").find(l => l.includes('data === "receipt:confirm"'));
  assert(!/tz:|timeZone|часов/i.test(confirm));
});

test("render payload carries the operation snapshot zone (Telegram and MAX)", async () => {
  const renderer = require("../apps/bot/dist/services/rendererClient");
  const original = renderer.renderReceipt; const payloads = [];
  const op = { id: 5, userId: 1, receiptNumber: "KV-000005", createdAt: new Date("2026-12-31T20:30:00Z"), timeZoneSnapshot: "Asia/Kamchatka", innSnapshot: "1", ogrnSnapshot: null, ipFullNameSnapshot: "T", addressSnapshot: "A", calculationType: "INCOME", items: [], amount: 1, paymentMethod: "CASH", status: "RENDERING" };
  const originals = { find: prisma.operation.findUniqueOrThrow, update: prisma.operation.update, tx: prisma.$transaction };
  try {
    renderer.renderReceipt = async (_u, p) => { payloads.push(p); return { ok: true, imagePath: "x.jpg" }; };
    prisma.operation.findUniqueOrThrow = async () => op; prisma.operation.update = async () => ({}); prisma.$transaction = async fn => fn({ operation: { update: async () => ({}) }, renderJob: { update: async () => ({}) } });
    await operations.renderAndSendOperation({ replyWithPhoto: async () => {}, reply: async () => {} }, { id: 1 }, op, { info() {}, warn() {}, error() {} });
  } finally { renderer.renderReceipt = original; prisma.operation.findUniqueOrThrow = originals.find; prisma.operation.update = originals.update; prisma.$transaction = originals.tx; }
  assert.equal(payloads[0].timeZone, "Asia/Kamchatka"); assert.equal(payloads[0].createdAt, "2026-12-31T20:30:00.000Z");
  assert(fs.readFileSync(path.join(root, "apps/bot/src/max/handlers.ts"), "utf8").includes("timeZone: o.timeZoneSnapshot"));
});

test("two users with different zones and an old receipt after a profile change", () => {
  const instant = new Date("2026-12-31T20:30:00Z");
  const alice = mockOp("Europe/Moscow", instant), bob = mockOp("Asia/Yekaterinburg", instant);
  assert.match(operations.buildOperationsSummary([alice]), /31\.12\.2026, 23:30/);
  assert.match(operations.buildOperationsSummary([bob]), /01\.01\.2027, 01:30/);
  // Bob moves to МСК+9: his old receipt snapshot is unchanged, a new one uses the new zone.
  const bobProfile = { timeZone: "Asia/Kamchatka" }; const newOp = mockOp(bobProfile.timeZone, new Date("2027-01-01T00:00:00Z"));
  assert.match(operations.buildOperationsSummary([bob]), /01\.01\.2027, 01:30/);
  assert.match(operations.buildOperationsSummary([newOp]), /01\.01\.2027, 12:00/);
});

test("excel export shows each receipt in its saved zone", async () => {
  const ExcelJS = require("../apps/bot/node_modules/exceljs"); const dir = path.join(root, "test-results/timezone");
  const ops = [["Europe/Moscow", "KV-1"], ["Asia/Kamchatka", "KV-2"]].map(([z, n]) => ({ createdAt: new Date("2026-12-31T20:30:00Z"), receiptNumber: n, innSnapshot: "1", ipFullNameSnapshot: "T", addressSnapshot: "A", serviceTitleSnapshot: "S", amount: 1, calculationType: "INCOME", paymentMethod: "CASH", status: "SENT", timeZoneSnapshot: z }));
  const file = await exportService.buildExportFile(ops, { userId: 1, rangeKey: "all_time", exportsDir: dir });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file.filePath); const ws = wb.worksheets[0];
  assert.equal(ws.getRow(2).getCell(1).value, "31.12.2026 23:30"); assert.equal(ws.getRow(3).getCell(1).value, "01.01.2027 08:30");
});

test("'today' / month export boundaries use the profile zone", async () => {
  const original = prisma.operation.findMany; const wheres = []; prisma.operation.findMany = async a => { wheres.push(a.where.createdAt); return []; };
  try {
    for (const z of ["Europe/Kaliningrad", "Asia/Kamchatka"]) {
      await exportService.getOperationsForExport(1, "today", z);
      const w = wheres.pop(); const from = DateTime.fromJSDate(w.gte).setZone(z), to = DateTime.fromJSDate(w.lte).setZone(z);
      assert.equal(from.toFormat("HH:mm:ss"), "00:00:00"); assert.equal(to.toFormat("HH:mm:ss"), "23:59:59");
      await exportService.getOperationsForExport(1, "current_month", z);
      const m = wheres.pop(); assert.equal(DateTime.fromJSDate(m.gte).setZone(z).day, 1);
    }
  } finally { prisma.operation.findMany = original; }
});

test("profile time zone setter writes only timeZone", async () => {
  const original = prisma.entrepreneurProfile.update; let args;
  prisma.entrepreneurProfile.update = async a => (args = a);
  try { await users.updateProfileTimeZone(7, "Asia/Omsk"); } finally { prisma.entrepreneurProfile.update = original; }
  assert.deepEqual(args, { where: { userId: 7 }, data: { timeZone: "Asia/Omsk" } });
});

test("migration sets МСК for existing profiles/operations and persists non-default values", async () => {
  const db = new PGlite(); const dir = path.join(root, "packages/db/prisma/migrations"); const all = fs.readdirSync(dir).sort();
  try {
    for (const n of all.filter(n => n < "202611150001")) await db.exec(fs.readFileSync(path.join(dir, n, "migration.sql"), "utf8"));
    await db.query(`INSERT INTO users (id,"createdAt","updatedAt") VALUES (1,now(),now())`);
    await db.query(`INSERT INTO entrepreneur_profiles (id,"userId",inn,"ipFullName",address,"createdAt","updatedAt") VALUES (1,1,'123456789012','T','A',now(),now())`);
    await db.query(`INSERT INTO operations (id,"userId","profileId","receiptNumber","innSnapshot","ipFullNameSnapshot","addressSnapshot","serviceTitleSnapshot",amount,"paymentMethod","createdAt","updatedAt") VALUES (1,1,1,'KV-1','1','T','A','S',1,'CASH',now(),now())`);
    await db.exec(fs.readFileSync(path.join(dir, "202611150001_profile_time_zone/migration.sql"), "utf8"));
    assert.equal((await db.query('SELECT "timeZone" FROM entrepreneur_profiles')).rows[0].timeZone, "Europe/Moscow");
    assert.equal((await db.query('SELECT "timeZoneSnapshot" FROM operations')).rows[0].timeZoneSnapshot, "Europe/Moscow");
    // "restart" = new read of the persisted row after update
    await db.query(`UPDATE entrepreneur_profiles SET "timeZone"='Asia/Novosibirsk'`);
    assert.equal((await db.query('SELECT "timeZone" FROM entrepreneur_profiles')).rows[0].timeZone, "Asia/Novosibirsk");
    assert.equal((await db.query('SELECT "timeZoneSnapshot" FROM operations')).rows[0].timeZoneSnapshot, "Europe/Moscow");
  } finally { await db.close(); }
});

after(async () => { await prisma.$disconnect(); });
