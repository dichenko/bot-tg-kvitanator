const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "test-results/branding");
// No .env, real database, Telegram requests or messages are used by this suite.
Object.assign(process.env, {
  NODE_ENV: "test", BOT_TOKEN: "123456:branding-test-token", WEBHOOK_URL: "https://test.invalid/webhook",
  RENDERER_URL: "http://127.0.0.1:1", RECEIPTS_DIR: dir, EXPORTS_DIR: dir,
  APP_TIMEZONE: "Europe/Moscow", DAILY_STATS_TELEGRAM_ID: "19422781", ENABLE_MAX: "false",
  RECEIPT_BRANDING_TEST_ENABLED: "true", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused"
});
const sharp = require("../apps/bot/node_modules/sharp");
const { Bot, session } = require("../apps/bot/node_modules/grammy");
const { prisma, Prisma } = require("../packages/db/dist");
const { config } = require("../apps/bot/dist/config");
const shared = require("../packages/shared/dist");
const service = require("../apps/bot/dist/services/brandingService");
const storage = require("../apps/bot/dist/services/brandingStorage");
const operations = require("../apps/bot/dist/services/operationService");
const rendererClient = require("../apps/bot/dist/services/rendererClient");
const renderer = require("../apps/renderer-worker/dist/renderReceipt");
const { payloadSchema } = require("../apps/renderer-worker/dist/receiptPayload");
const { createInitialSession } = require("../apps/bot/dist/utils/state");
const { registerBrandingHandlers } = require("../apps/bot/dist/handlers/branding");
const { registerCallbackHandlers } = require("../apps/bot/dist/handlers/callbacks");
const { registerMessageHandlers } = require("../apps/bot/dist/handlers/messages");
const { registerCommandHandlers } = require("../apps/bot/dist/handlers/commands");
const { chromium } = require("../apps/renderer-worker/node_modules/playwright");
const { PGlite } = require("@electric-sql/pglite");
require("../apps/bot/dist/services/logger").logger.level = "silent";
const admin = 19422781;
const user = { id: 7, telegramId: BigInt(admin) };
const profile = { id: 1, userId: 7, inn: "123456789012", ipFullName: "Иванов Иван Иванович", address: "Москва, ул. Примерная, 1", ogrn: null, timeZone: "Europe/Moscow", receiptBranding: null };
const payload = { operationId: 7, receiptNumber: "KV-000007", createdAt: "2026-11-14T12:00:00Z", timeZone: "Europe/Moscow", inn: profile.inn, ipFullName: profile.ipFullName, address: profile.address, calculationType: "INCOME", items: [{ title: "Услуга", quantity: "1", price: "1000", amount: "1000" }], amount: "1000", paymentMethod: "CASH" };
let browser, browserChannel, square, wide, logoFileName;
const originalQueryRaw = prisma.$queryRaw;
before(async () => {
  await fs.mkdir(dir, { recursive: true });
  square = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 37, g: 99, b: 235, alpha: 0.5 } } }).png().toBuffer();
  wide = await sharp({ create: { width: 800, height: 300, channels: 3, background: "#18794e" } }).jpeg().toBuffer();
  logoFileName = await service.storeLogo(square, dir);
  prisma.$queryRaw = async () => [{ logoFileName }];
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { if (process.platform !== "win32") throw error; browserChannel = "msedge"; browser = await chromium.launch({ headless: true, channel: browserChannel }); }
});
after(async () => { prisma.$queryRaw = originalQueryRaw; await browser?.close(); await prisma.$disconnect(); });

async function withMocks(mocks, fn) {
  const restore = mocks.map(([object, key, replacement]) => { const original = object[key]; object[key] = replacement; return () => { object[key] = original; }; });
  try { return await fn(); } finally { restore.reverse().forEach(fn => fn()); }
}

test("pilot permits only configured TGID, private chat, and Telegram operations; flag disables it", () => {
  assert(service.isBrandingTestUser(admin)); assert(service.isBrandingTestUser(BigInt(admin)));
  for (const id of [null, undefined, 0, admin + 1, NaN, Infinity, 1.5]) assert.equal(service.isBrandingTestUser(id), false);
  for (const [id, chatId, type, allowed] of [[admin, admin, "private", true], [admin + 1, admin + 1, "private", false], [admin, -1, "supergroup", false], [admin, admin + 1, "private", false]]) {
    assert.equal(service.canConfigureBranding({ from: { id }, chat: { id: chatId, type } }), allowed);
  }
  const brand = { logoFileName: null, name: "Мастерская", subtitle: "Ремонт" };
  assert.deepEqual(service.brandingForOperation(admin, "TELEGRAM", brand), brand);
  assert.equal(service.brandingForOperation(admin, "MAX", brand), null);
  assert.equal(service.brandingForOperation(admin + 1, "TELEGRAM", brand), null);
  config.receiptBrandingTestEnabled = false;
  try { assert.equal(service.canConfigureBranding({ from: { id: admin }, chat: { id: admin, type: "private" } }), false); assert.equal(service.brandingForOperation(admin, "TELEGRAM", brand), null); }
  finally { config.receiptBrandingTestEnabled = true; }
});

test("normalization preserves alpha and aspect ratio, creates immutable PNGs and rejects invalid input", async () => {
  const result = await service.normalizeLogo(square), info = await sharp(result).metadata();
  assert.equal(info.format, "png"); assert.equal(info.width, 128); assert.equal(info.height, 128); assert(info.hasAlpha); assert.equal(info.exif, undefined);
  const horizontal = await sharp(await service.normalizeLogo(wide)).metadata();
  assert.equal(horizontal.width, 320); assert.equal(horizontal.height, 120);
  const another = await service.storeLogo(square, dir); assert.notEqual(another, logoFileName);
  assert.deepEqual(await fs.readFile(path.join(dir, "branding", another)), await fs.readFile(path.join(dir, "branding", logoFileName)));
  for (const input of [Buffer.from("<svg></svg>"), Buffer.from("GIF89a"), Buffer.from("bad"), Buffer.from([255,216,255]), Buffer.alloc(service.MAX_LOGO_BYTES + 1)]) await assert.rejects(service.normalizeLogo(input));
  const tooWide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(service.normalizeLogo(tooWide));
  const animated = Buffer.concat([square.subarray(0,8), Buffer.from([0,0,0,8]), Buffer.from("acTL"), Buffer.alloc(12), square.subarray(8)]);
  await assert.rejects(service.normalizeLogo(animated));
});

test("download rejects oversized streams even without file size/header; text and paths are validated", async () => {
  assert.deepEqual(await service.readLimitedLogoBody(new Response(square)), square);
  await assert.rejects(service.readLimitedLogoBody(new Response(square, { headers: { "content-length": String(service.MAX_LOGO_BYTES + 1) } })), /5 МБ/);
  await assert.rejects(service.readLimitedLogoBody(new Response(Buffer.alloc(service.MAX_LOGO_BYTES + 1))), /5 МБ/);
  assert.equal(service.validateBrandingText(" - ", "name"), "");
  assert.equal(service.validateBrandingText(" Компания ", "name"), "Компания");
  assert.throws(() => service.validateBrandingText("x".repeat(61), "name"));
  assert.throws(() => service.validateBrandingText("x".repeat(121), "subtitle"));
  assert.throws(() => service.validateBrandingText("a\nb", "name"));
  for (const file of ["../../.env", "https://example.com/logo.png", "C:/logo.png"]) {
    const branding = { logoFileName: file, name: "Test", subtitle: "" };
    assert.equal(shared.parseReceiptBranding(branding), null);
    assert.equal(payloadSchema.safeParse({ ...payload, branding }).success, false);
  }
  assert(payloadSchema.safeParse(payload).success);
  assert(payloadSchema.safeParse({ ...payload, branding: null }).success);
});

function harness(id = admin, chatType = "private", initial = createInitialSession()) {
  const calls = [], data = structuredClone(initial);
  const bot = new Bot("123456:test", { botInfo: { id: 123456, is_bot: true, first_name: "Test", username: "test_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } });
  const chat = { id: chatType === "private" ? id : -123, type: chatType };
  const from = { id, is_bot: false, first_name: "Test" };
  let sequence = 0;
  bot.api.config.use(async (_previous, method, params) => {
    calls.push({ method, params });
    if (method === "getFile") return { ok: true, result: { file_id: "logo", file_unique_id: "logo", file_path: "photos/logo.png" } };
    if (method === "answerCallbackQuery") return { ok: true, result: true };
    return { ok: true, result: { message_id: ++sequence, date: 0, chat, text: params.text } };
  });
  bot.use(session({ initial: () => data }));
  registerCommandHandlers(bot);
  registerBrandingHandlers(bot); registerMessageHandlers(bot); registerCallbackHandlers(bot);
  const message = extra => ({ message_id: ++sequence, date: 0, from, chat, ...extra });
  return { calls, data,
    callback: text => bot.handleUpdate({ update_id: ++sequence, callback_query: { id: String(sequence), from, chat_instance: "1", data: text, message: message({ text: "Menu" }) } }),
    text: text => bot.handleUpdate({ update_id: ++sequence, message: message({ text, ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } : {}) }) }),
    photo: extra => bot.handleUpdate({ update_id: ++sequence, message: message(extra ?? { photo: [{ file_id: "logo", file_unique_id: "logo", width: 512, height: 512, file_size: square.length }] }) })
  };
}

test("real bot middleware hides menu and rejects forged callbacks/media for other TGIDs and groups", async () => {
  let reads = 0, writes = 0;
  await withMocks([
    [prisma.user, "upsert", async () => { reads++; return user; }],
    [prisma.entrepreneurProfile, "findUnique", async () => profile],
    [prisma.entrepreneurProfile, "update", async () => { writes++; return profile; }]
  ], async () => {
    for (const [id, type] of [[admin + 1, "private"], [admin, "supergroup"]]) {
      reads = 0;
      const h = harness(id, type, { ...createInitialSession(), awaitingInput: "branding_logo", brandingDraft: null });
      await h.callback("branding:save");
      assert.equal(reads, 0); assert.equal(writes, 0);
      assert(h.calls.some(c => c.method === "answerCallbackQuery" && c.params.show_alert));
      h.data.awaitingInput = "branding_logo"; await h.photo();
      assert.equal(h.calls.filter(c => c.method === "getFile").length, 0);
      const menu = harness(id, type); await menu.callback("menu:profile");
      assert(!menu.calls.some(c => JSON.stringify(c.params.reply_markup ?? {}).includes("branding:open")));
    }
    const menu = harness(); await menu.callback("menu:profile");
    assert(menu.calls.some(c => JSON.stringify(c.params.reply_markup ?? {}).includes("branding:open")));
  });
});

test("editing uploads photo/document, validates text, saves only on confirmation, cancels and resets", async () => {
  let saved = null, writes = 0;
  await withMocks([
    [prisma.user, "upsert", async () => user], [prisma.user, "findUniqueOrThrow", async () => user],
    [prisma.entrepreneurProfile, "findUnique", async () => ({ ...profile, receiptBranding: saved })],
    [prisma.entrepreneurProfile, "findUniqueOrThrow", async () => ({ ...profile, receiptBranding: saved })],
    [prisma.entrepreneurProfile, "update", async ({ data }) => { writes++; saved = data.receiptBranding === Prisma.DbNull ? null : data.receiptBranding; return profile; }],
    [global, "fetch", async () => new Response(square)]
  ], async () => {
    const h = harness(); await h.callback("branding:open"); await h.callback("branding:logo"); await h.photo();
    assert(h.data.brandingDraft.logoFileName); const first = h.data.brandingDraft.logoFileName;
    await h.callback("branding:name"); await h.text("Компания " + "x".repeat(61));
    assert.equal(h.data.awaitingInput, "branding_name");
    await h.text("Мастерская <Север>"); await h.callback("branding:subtitle"); await h.text("Спасибо за покупку!");
    assert.equal(writes, 0); await h.callback("branding:save"); assert.equal(writes, 1);
    assert.equal(saved.name, "Мастерская <Север>"); assert.equal(saved.logoFileName, first);
    await h.callback("branding:open"); await h.callback("branding:name"); await h.text("Несохранённое"); await h.callback("branding:cancel");
    assert.equal(saved.name, "Мастерская <Север>"); assert.equal(h.data.brandingDraft, undefined);
    await h.callback("branding:open"); await h.callback("branding:logo");
    await h.photo({ document: { file_id: "doc", file_unique_id: "doc", file_name: "logo.png", mime_type: "image/png", file_size: square.length } });
    assert.notEqual(h.data.brandingDraft.logoFileName, first); assert.equal(saved.logoFileName, first);
    await h.callback("branding:reset"); assert(saved); await h.callback("branding:save"); assert.equal(saved, null);
    await h.callback("branding:open"); await h.callback("branding:name"); await h.callback("menu:profile");
    assert.equal(h.data.awaitingInput, null); assert.equal(h.data.brandingDraft, undefined);
    await service.saveReceiptBranding(user.id, null);
  });
});

test("failed upload retains previous logo and service independently rejects unauthorized saves", async () => {
  const branding = { logoFileName, name: "Company", subtitle: "" };
  const h = harness(admin, "private", { ...createInitialSession(), awaitingInput: "branding_logo", brandingDraft: branding });
  await withMocks([[prisma.user, "upsert", async () => user], [prisma.entrepreneurProfile, "findUnique", async () => profile], [global, "fetch", async () => new Response("not an image")]], async () => {
    await h.photo(); assert.deepEqual(h.data.brandingDraft, branding); assert.equal(h.data.awaitingInput, "branding_logo");
  });
  await withMocks([[prisma.user, "findUniqueOrThrow", async () => ({ telegramId: BigInt(admin + 1) })]], async () => {
    await assert.rejects(service.saveReceiptBranding(user.id, branding), /недоступно/);
  });
});

test("cancelling while a logo downloads prevents a late upload from restoring the draft", async () => {
  let started, finish;
  const downloading = new Promise(resolve => { started = resolve; });
  const response = new Promise(resolve => { finish = resolve; });
  const h = harness(admin, "private", { ...createInitialSession(), awaitingInput: "branding_logo", brandingDraft: null });
  await withMocks([
    [prisma.user, "upsert", async () => user], [prisma.entrepreneurProfile, "findUnique", async () => profile],
    [global, "fetch", async () => { started(); return response; }]
  ], async () => {
    const before = new Set(await fs.readdir(path.join(dir, "branding")));
    const upload = h.photo(); await downloading;
    await h.callback("branding:cancel"); finish(new Response(square)); await upload;
    assert.equal(h.data.brandingDraft, undefined); assert.equal(h.data.awaitingInput, null);
    assert(!h.calls.some(c => c.params.text?.includes("Логотип загружен")));
    assert.deepEqual(new Set(await fs.readdir(path.join(dir, "branding"))), before);
  });
});

test("replacing, cancelling, resetting and leaving a draft immediately deletes unused uploads", async () => {
  await withMocks([
    [prisma.user, "upsert", async () => user], [prisma.entrepreneurProfile, "findUnique", async () => profile],
    [global, "fetch", async () => new Response(square)]
  ], async () => {
    const h = harness();
    const upload = async () => { await h.callback("branding:logo"); await h.photo(); return h.data.brandingDraft.logoFileName; };
    const exists = name => fs.access(path.join(dir, "branding", name));
    await h.callback("branding:open");
    const first = await upload(), second = await upload();
    await assert.rejects(exists(first)); await exists(second);
    await h.callback("branding:cancel"); await assert.rejects(exists(second));
    for (const action of ["branding:reset", "branding:open", "menu:profile", "/start"]) {
      await h.callback("branding:open"); const name = await upload();
      if (action === "/start") await h.text(action); else await h.callback(action);
      await assert.rejects(exists(name), `draft file survives ${action}`);
    }
  });
});

test("cleanup keeps selected and historical logos and active drafts; deletes abandoned files after lease expiry", async () => {
  const receiptsDir = await fs.mkdtemp(path.join(dir, "cleanup-"));
  const selected = await service.storeLogo(square, receiptsDir);
  const historical = await service.storeLogo(square, receiptsDir);
  const orphan = await service.storeLogo(square, receiptsDir);
  const active = await service.storeLogo(square, receiptsDir);
  const foreign = path.join(receiptsDir, "branding", "notes.txt"); await fs.writeFile(foreign, "keep");
  const read = name => fs.access(path.join(receiptsDir, "branding", name));
  await withMocks([[prisma, "$queryRaw", async () => [{ logoFileName: selected }, { logoFileName: historical }]]], async () => {
    assert.equal((await storage.cleanupUnusedBrandingLogos({ receiptsDir, minAgeMs: 0 })).removed, 0);
    const future = Date.now() + 31 * 60_000;
    await withMocks([[Date, "now", () => future]], async () => {
      storage.retainBrandingLogo(active);
      const result = await storage.cleanupUnusedBrandingLogos({ receiptsDir, minAgeMs: 0 });
      assert.equal(result.removed, 1); await assert.rejects(read(orphan));
      await read(selected); await read(historical); await read(active); await fs.access(foreign);
    });
    const result = await storage.cleanupUnusedBrandingLogos({ receiptsDir, minAgeMs: 0, now: future + 31 * 60_000 });
    assert.equal(result.removed, 1); await assert.rejects(read(active)); await read(selected); await read(historical);
  });
});

test("cleanup fails closed when database references cannot be read", async () => {
  const receiptsDir = await fs.mkdtemp(path.join(dir, "failed-cleanup-"));
  const name = await service.storeLogo(square, receiptsDir);
  await withMocks([[prisma, "$queryRaw", async () => { throw new Error("database unavailable"); }]], async () => {
    await assert.rejects(storage.cleanupUnusedBrandingLogos({ receiptsDir, minAgeMs: 0, now: Date.now() + 60 * 60_000 }), /database unavailable/);
    await fs.access(path.join(receiptsDir, "branding", name));
  });
});

test("operation snapshot is gated and immutable; rendering uses saved branding rather than profile", async () => {
  const branding = { logoFileName, name: "Original", subtitle: "" }, created = [];
  await withMocks([[prisma, "$transaction", async fn => fn({ operation: { findFirst: async () => null, create: async ({ data }) => { created.push(data); return { id: 1, ...data }; } }, renderJob: { create: async () => ({}) } })]], async () => {
    const draft = { items: [{ title: "Service", quantity: "1", price: "100" }], paymentMethod: "CASH" };
    const p = { ...profile, receiptBranding: branding };
    await operations.createOperationWithSnapshots(user, p, [], draft, "TELEGRAM");
    p.receiptBranding = { ...branding, name: "Changed" };
    assert.equal(created[0].brandingSnapshot.name, "Original");
    await operations.createOperationWithSnapshots({ ...user, telegramId: BigInt(admin + 1) }, p, [], draft, "TELEGRAM");
    await operations.createOperationWithSnapshots(user, p, [], draft, "MAX");
    assert.equal(created[1].brandingSnapshot, Prisma.DbNull); assert.equal(created[2].brandingSnapshot, Prisma.DbNull);
  });
  const op = { ...created[0], id: 1, createdAt: new Date(payload.createdAt), items: [{ title: "Service", quantity: 1, price: 100, amount: 100 }] };
  let sent;
  await withMocks([
    [rendererClient, "renderReceipt", async (_url, data) => { sent = data; return { ok: true, imagePath: "saved.jpg" }; }],
    [prisma.operation, "findUniqueOrThrow", async () => op], [prisma.operation, "update", async () => ({})],
    [prisma, "$transaction", async fn => fn({ operation: { update: async () => ({}) }, renderJob: { update: async () => ({}) } })]
  ], async () => {
    await operations.renderAndSendOperation({ replyWithPhoto: async () => {}, reply: async () => {} }, user, op, { warn() {}, info() {}, error() {} });
  });
  assert.deepEqual(sent.branding, branding);
});

test("preview does not create an operation or consume a number, and uses unique files", async () => {
  const originalLaunch = chromium.launch.bind(chromium);
  if (browserChannel) chromium.launch = options => originalLaunch({ ...options, channel: browserChannel });
  try {
    const sentinel = path.join(dir, "receipt-7.jpg"); await fs.writeFile(sentinel, "existing receipt");
    let requests = 0, writes = 0;
    await withMocks([
      [rendererClient, "renderReceipt", async (_url, data) => { requests++; assert.equal(data.preview, true); return { ok: true, imagePath: await renderer.renderReceiptImage(data, { receiptsDir: dir, timeZone: "Europe/Moscow" }) }; }],
      [prisma.operation, "create", async () => { writes++; throw new Error("must not create"); }],
      [prisma, "$transaction", async () => { writes++; throw new Error("must not transact"); }]
    ], async () => {
      const first = await service.renderBrandingPreview(7, profile, { logoFileName, name: "Мастерская", subtitle: "Спасибо!" });
      const second = await service.renderBrandingPreview(7, profile, null);
      assert.notEqual(first, second); assert.match(path.basename(first), /^preview-/);
      assert.equal(await fs.readFile(sentinel, "utf8"), "existing receipt"); assert.equal(writes, 0); assert.equal(requests, 2);
      await fs.copyFile(first, path.join(dir, "preview.jpg"));
      await service.removeBrandingPreview(first); await assert.rejects(fs.access(first));
      await service.removeBrandingPreview(sentinel); assert.equal(await fs.readFile(sentinel, "utf8"), "existing receipt");
      await service.removeBrandingPreview(second);
    });
  } finally { chromium.launch = originalLaunch; }
});

test("real browser renders square/wide logos, maximum text, escaping and standard header without overflow", async () => {
  const wideName = await service.storeLogo(wide, dir);
  const cases = [
    ["standard", null], ["square", { logoFileName, name: "Мастерская «Север»", subtitle: "Спасибо за покупку!" }],
    ["wide", { logoFileName: wideName, name: "", subtitle: "" }],
    ["long", { logoFileName: wideName, name: "Я".repeat(60), subtitle: "Подпись".repeat(17) }],
    ["escaped", { logoFileName, name: "<script>window.injected=1</script>", subtitle: "<img src=x onerror=alert(1)>" }]
  ];
  for (const [name, branding] of cases) {
    const html = await renderer.buildReceiptHtml({ ...payload, branding }, { receiptsDir: dir, timeZone: "Europe/Moscow" });
    const page = await browser.newPage({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: 2 });
    const requests = []; page.on("request", request => requests.push(request.url()));
    await page.setContent(html);
    await page.locator("img").evaluateAll(async images => Promise.all(images.map(image => image.decode())));
    if (branding) {
      assert.equal(await page.locator(".logo-mark").count(), 0);
      const logo = await page.locator(".custom-brand-logo").boundingBox(); assert(logo.width <= 160); assert(logo.height <= 64);
      if (name === "square") {
        const text = await page.locator(".custom-brand-text").boundingBox();
        assert(text.x >= logo.x + logo.width, "ordinary text should fit beside the logo");
      }
      const source = await sharp(await fs.readFile(path.join(dir, "branding", branding.logoFileName))).metadata();
      assert(Math.abs(logo.width / logo.height - source.width / source.height) < 0.05);
    } else assert.equal(await page.locator(".logo-text-main").textContent(), "Квитанатор");
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, injected: window.injected, card: document.querySelector('.receipt-card').getBoundingClientRect().width }));
    assert.equal(size.injected, undefined); assert(size.scroll <= size.width); assert.equal(size.card, 428);
    assert.equal(requests.filter(url => /^https?:/.test(url)).length, 0);
    assert.match(await page.locator(".footer-note").textContent(), /Квитанатор/);
    await page.locator(".receipt-wrapper").screenshot({ path: path.join(dir, `${name}.png`) }); await page.close();
  }
  await assert.rejects(renderer.buildReceiptHtml({ ...payload, branding: { logoFileName: "../../.env", name: "X", subtitle: "" } }, { receiptsDir: dir, timeZone: "Europe/Moscow" }));
});

test("additive migration retains old records, persists branding JSON and keeps operation snapshot on profile change", async () => {
  const db = new PGlite(), migrationDir = path.join(root, "packages/db/prisma/migrations");
  try {
    for (const name of (await fs.readdir(migrationDir)).sort().filter(name => name < "202611150002")) await db.exec(await fs.readFile(path.join(migrationDir, name, "migration.sql"), "utf8"));
    await db.exec(`INSERT INTO users (id,"createdAt","updatedAt") VALUES (1,now(),now()); INSERT INTO entrepreneur_profiles (id,"userId",inn,"ipFullName",address,"createdAt","updatedAt") VALUES (1,1,'123456789012','T','A',now(),now()); INSERT INTO operations (id,"userId","profileId","receiptNumber","innSnapshot","ipFullNameSnapshot","addressSnapshot","serviceTitleSnapshot",amount,"paymentMethod","createdAt","updatedAt") VALUES (1,1,1,'KV-1','1','T','A','S',1,'CASH',now(),now());`);
    await db.exec(await fs.readFile(path.join(migrationDir, "202611150002_receipt_branding_pilot/migration.sql"), "utf8"));
    assert.equal((await db.query('SELECT "receiptBranding" FROM entrepreneur_profiles')).rows[0].receiptBranding, null);
    assert.equal((await db.query('SELECT "brandingSnapshot" FROM operations')).rows[0].brandingSnapshot, null);
    const branding = { logoFileName, name: "Original", subtitle: "" };
    await db.query('UPDATE entrepreneur_profiles SET "receiptBranding"=$1', [JSON.stringify(branding)]);
    await db.query('UPDATE operations SET "brandingSnapshot"=$1', [JSON.stringify(branding)]);
    await db.query('UPDATE entrepreneur_profiles SET "receiptBranding"=NULL');
    assert.deepEqual((await db.query('SELECT "brandingSnapshot" FROM operations')).rows[0].brandingSnapshot, branding);
    const receiptsDir = await fs.mkdtemp(path.join(dir, "database-cleanup-"));
    await fs.mkdir(path.join(receiptsDir, "branding"));
    await fs.copyFile(path.join(dir, "branding", logoFileName), path.join(receiptsDir, "branding", logoFileName));
    const unused = await service.storeLogo(square, receiptsDir);
    await withMocks([[prisma, "$queryRaw", async strings => (await db.query(strings.join(""))).rows]], async () => {
      assert.equal((await storage.cleanupUnusedBrandingLogos({ receiptsDir, minAgeMs: 0, now: Date.now() + 60 * 60_000 })).removed, 1);
      await fs.access(path.join(receiptsDir, "branding", logoFileName));
      await assert.rejects(fs.access(path.join(receiptsDir, "branding", unused)));
    });
  } finally { await db.close(); }
});
