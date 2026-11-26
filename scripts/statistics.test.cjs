const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { DateTime, cutoff, root, PERIODS, aggregatePeriod, periodBounds, buildStatisticsSnapshot, formatStatsText, sampleSnapshot } = require("./statistics-fixtures.cjs");
const { prisma, Prisma } = require("../packages/db/dist");
const { scheduledCutoff, runDueDailyStatistics, deliverStatisticsReport } = require("../apps/bot/dist/services/dailyStatsService");
const { encodeWidgetData, validateWidgetHtml } = require("../apps/bot/dist/services/statisticsWidget");
const { parseStatisticsQuery, handleStatisticsQuery } = require("../apps/bot/dist/handlers/statistics");
const { createBot } = require("../apps/bot/dist/bot");
const { upsertTelegramUser, upsertMaxUser } = require("../apps/bot/dist/services/userService");
const operations = require("../apps/bot/dist/services/operationService");
const renderer = require("../apps/bot/dist/services/rendererClient");
let db, tx, snapshot, reportNumber = 0;
const query = { id: "query-1", from: { id: 1234 }, chat: { id: 1234, type: "private" }, message_id: 42, type: { type: "data" }, data: "s:week:tg" };
const raw = async (sql, ...args) => {
  const statement = Array.isArray(sql) ? Prisma.sql(sql, ...args) : sql;
  return (await db.query(statement.text, statement.values.map(v => v instanceof Date ? v.toISOString() : v))).rows;
};
async function user(id, tg, mx, at = "2026-11-14T02:00:00Z", channel) {
  await db.query('INSERT INTO users (id,"telegramId","maxId","createdAt","updatedAt"'+(channel?',"registrationChannel"':'')+') VALUES ($1,$2,$3,$4,$4'+(channel?',$5':'')+')', [id,tg,mx,at,...(channel?[channel]:[])]);
  await db.query('INSERT INTO entrepreneur_profiles (id,"userId",inn,"ipFullName",address,"createdAt","updatedAt") VALUES ($1,$1,\'123456789012\',\'Test\',\'Test\',$2,$2)',[id,at]);
}
async function receipt(id, userId, status, sentAt, channel, createdAt = sentAt || "2026-11-13T12:00:00Z") {
  await db.query(`INSERT INTO operations (id,"userId","profileId","receiptNumber","innSnapshot","ipFullNameSnapshot","addressSnapshot","serviceTitleSnapshot",amount,"paymentMethod",status,"createdAt","updatedAt","sentAt"${channel?',channel':''})
    VALUES ($1,$2,$2,$3,'123456789012','Test','Test','Test',100,'CASH',$4,$5,$5,$6${channel?',$7':''})`, [id,userId,`TEST${id}`,status,createdAt,sentAt,...(channel?[channel]:[])]);
}
before(async () => {
  db = new PGlite();
  const migrations = path.join(root, "packages/db/prisma/migrations");
  for (const name of fs.readdirSync(migrations).filter(n => n < "202611140001").sort()) await db.exec(fs.readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
  tx = { $queryRaw: raw };
});
after(async () => { await db.close(); await prisma.$disconnect(); });

test("migration preserves history, attributes only unambiguous legacy channels", async () => {
  await user(1,101,null,"2026-01-01T00:00:00Z"); await user(2,null,102,"2026-01-01T00:00:00Z");
  await user(3,103,103,"2026-01-01T00:00:00Z"); await user(4,null,null,"2026-01-01T00:00:00Z");
  for(let i=1;i<=4;i++) await receipt(i,i,"SENT",null,undefined,"2026-01-01T00:00:00Z");
  const before = (await db.query('SELECT id,status,"createdAt","sentAt",amount FROM operations ORDER BY id')).rows;
  await db.exec(fs.readFileSync(path.join(root,"packages/db/prisma/migrations/202611140001_interactive_statistics/migration.sql"),"utf8"));
  assert.deepEqual((await db.query('SELECT id,status,"createdAt","sentAt",amount FROM operations ORDER BY id')).rows,before);
  assert.deepEqual((await db.query('SELECT channel FROM operations ORDER BY id')).rows.map(r=>r.channel),["TELEGRAM","MAX","UNKNOWN","UNKNOWN"]);
  assert.deepEqual((await db.query('SELECT "registrationChannel" FROM users ORDER BY id')).rows.map(r=>r.registrationChannel),["TELEGRAM","MAX","UNKNOWN","UNKNOWN"]);
});

test("new users have explicit registration channels, existing registration is not overwritten", async () => {
  const original = prisma.user.upsert;
  const calls=[]; prisma.user.upsert=async args=>{calls.push(args);return args.create};
  try { await upsertTelegramUser({id:500}); await upsertMaxUser({id:600}); }
  finally {prisma.user.upsert=original}
  assert.equal(calls[0].create.registrationChannel,"TELEGRAM"); assert.equal(calls[1].create.registrationChannel,"MAX");
  assert(!("registrationChannel" in calls[0].update)); assert(!("registrationChannel" in calls[1].update));
});

test("receipt creation saves the explicit channel even when user has both identifiers", async () => {
  const original=prisma.$transaction,created=[];
  prisma.$transaction=async fn=>fn({operation:{findFirst:async()=>null,create:async({data})=>{created.push(data);return{id:100,...data}}},renderJob:{create:async()=>({})}});
  const profile={id:10,inn:"123456789012",ipFullName:"Test",address:"Test",ogrn:null};
  const draft={items:[{serviceId:1,quantity:"2",price:"60"}],paymentMethod:"CASH"};
  try{for(const channel of ["TELEGRAM","MAX"])await operations.createOperationWithSnapshots({id:10,telegramId:100n,maxId:200n},profile,[{id:1,title:"Test"}],draft,channel)}
  finally{prisma.$transaction=original}
  assert.deepEqual(created.map(c=>c.channel),["TELEGRAM","MAX"]);assert(created.every(c=>c.amount.toString()==="120"&&c.status==="RENDERING"));
});

test("Telegram counts only delivered receipts; menu failure keeps SENT and resending creates no operation", async () => {
  const originals={transaction:prisma.$transaction,find:prisma.operation.findUniqueOrThrow,update:prisma.operation.update,render:renderer.renderReceipt};
  const op={id:100,userId:10,receiptNumber:"TEST100",createdAt:cutoff.toJSDate(),amount:new Prisma.Decimal(120),items:[],status:"RENDERING",imagePath:"synthetic.jpg"};
  const log={info(){},warn(){},error(){}};
  try{
    renderer.renderReceipt=async()=>({ok:true,imagePath:"synthetic.jpg"});
    prisma.operation.findUniqueOrThrow=async()=>op;
    for(const failPhoto of [false,true]){
      const events=[];prisma.$transaction=async fn=>fn({operation:{update:async()=>({})},renderJob:{update:async()=>({})}});
      prisma.operation.update=async({data})=>{events.push(data.status);return{...op,...data}};
      const ctx={replyWithPhoto:async()=>{events.push("photo");if(failPhoto)throw Error("delivery failed")},reply:async text=>{if(text==="Главное меню")throw Error("menu failed")}};
      await operations.renderAndSendOperation(ctx,{id:10},op,log);
      assert.deepEqual(events,failPhoto?["photo","FAILED"]:["photo","SENT"]);
    }
    const file=path.join(root,"test-results/statistics/resend.txt");fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,"synthetic");let updates=0,sends=0;
    prisma.operation.update=async()=>{updates++};
    await operations.sendExistingReceipt({replyWithPhoto:async()=>{sends++},reply:async()=>{}},{...op,imagePath:file},log,"Europe/Moscow");
    assert.equal(sends,1);assert.equal(updates,0);
  }finally{prisma.$transaction=originals.transaction;prisma.operation.findUniqueOrThrow=originals.find;prisma.operation.update=originals.update;renderer.renderReceipt=originals.render}
});

test("MAX receipt flow persists MAX and marks SENT after image delivery, preserving state on menu errors", async () => {
  const context=require("../apps/bot/dist/max/context"),users=require("../apps/bot/dist/services/userService"),{handleMaxUpdate}=require("../apps/bot/dist/max/handlers");
  const originals={context:context.createMaxContext,user:users.upsertMaxUser,profile:users.getProfileByUserId,services:users.listActiveServices,
    transaction:prisma.$transaction,find:prisma.operation.findUnique,update:prisma.operation.update,job:prisma.renderJob.update,render:renderer.renderReceipt};
  try{
    users.upsertMaxUser=async()=>({id:10,telegramId:100n,maxId:200n});users.getProfileByUserId=async()=>({id:10,inn:"123456789012",ipFullName:"Test",address:"Test",ogrn:null});
    users.listActiveServices=async()=>[{id:1,title:"Test"}];renderer.renderReceipt=async()=>({ok:true,imagePath:"synthetic.jpg"});prisma.renderJob.update=async()=>({});
    for(const failPhoto of [false,true]){
      const events=[];let op,saved=0;
      prisma.$transaction=async fn=>fn({operation:{findFirst:async()=>null,create:async({data})=>(op={id:100,createdAt:cutoff.toJSDate(),items:[],...data})},renderJob:{create:async()=>({})}});
      prisma.operation.findUnique=async()=>({...op,items:[]});
      prisma.operation.update=async({data})=>{events.push(data.status);Object.assign(op,data);return op};
      context.createMaxContext=async()=>({user:{id:200},session:{receiptDraft:{items:[{serviceId:1,quantity:"1",price:"120"}],paymentMethod:"CASH"}},
        reply:async()=>{},sendImage:async()=>{events.push("image");if(failPhoto)throw Error("delivery failed")},sendMenu:async()=>{throw Error("menu failed")},saveSession:async()=>{saved++}});
      await handleMaxUpdate({}, {update_type:"message_callback",callback:{payload:"receipt:confirm"}});
      assert.equal(op.channel,"MAX");assert.deepEqual(events,failPhoto?["RENDERED","image","FAILED"]:["RENDERED","image","SENT"]);assert.equal(saved,1);
    }
  }finally{
    context.createMaxContext=originals.context;users.upsertMaxUser=originals.user;users.getProfileByUserId=originals.profile;users.listActiveServices=originals.services;
    prisma.$transaction=originals.transaction;prisma.operation.findUnique=originals.find;prisma.operation.update=originals.update;prisma.renderJob.update=originals.job;renderer.renderReceipt=originals.render;
  }
});

test("PostgreSQL enforces one delivery key per day while allowing multiple manual reports", async () => {
  const insert=(id,key)=>db.query('INSERT INTO statistics_reports (id,"deliveryKey","recipientId","cutoffAt",timezone,"leaseUntil","updatedAt") VALUES ($1,$2,1234,$3,\'Europe/Moscow\',$3,$3)',[id,key,cutoff.toISO()]);
  await insert("scheduled-1","1234:Europe/Moscow:2026-11-14");
  await assert.rejects(insert("scheduled-2","1234:Europe/Moscow:2026-11-14"),e=>e.code==="23505");
  await insert("manual-1",null);await insert("manual-2",null);
  assert.equal((await db.query('SELECT count(*) AS n FROM statistics_reports')).rows[0].n,3);
});

test("registered users without receipts and an empty period", async () => {
  await user(10,110,null,undefined,"TELEGRAM"); await user(11,null,111,undefined,"MAX");
  await user(12,112,112,undefined,"UNKNOWN"); await user(13,null,null,undefined,"UNKNOWN");
  const p=await aggregatePeriod(tx,"day",cutoff);
  assert.deepEqual(p.newClients,{total:4,telegram:1,max:1,unknown:2,overlap:0});
  assert.equal(p.receipts.total,0); assert.equal(p.activeClients.total,0);
  const empty=await aggregatePeriod(tx,"day",cutoff.minus({years:10}));
  assert.equal(empty.newClients.total,0); assert(empty.buckets.every(b=>!b.telegram&&!b.max&&!b.unknown));
});

test("SENT only, unique active clients, cross-channel overlap, half-open boundaries and first-send date", async () => {
  await receipt(10,10,"SENT","2026-11-13T04:00:00Z","TELEGRAM"); // lower bound included
  await receipt(11,10,"SENT","2026-11-13T08:00:00Z","TELEGRAM"); // bucket boundary
  await receipt(12,10,"SENT","2026-11-13T12:00:00Z","MAX");
  await receipt(13,11,"SENT","2026-11-14T03:00:00Z","MAX","2026-10-01T00:00:00Z");
  await receipt(14,12,"SENT",null,"UNKNOWN"); // historical sentAt missing
  await receipt(15,13,"SENT","2026-11-14T04:00:00Z","UNKNOWN"); // upper bound excluded
  await receipt(16,13,"SENT","2026-11-13T03:59:59.999Z","UNKNOWN");
  for(const [i,s] of ["DRAFT","CONFIRMED","RENDERING","RENDERED","FAILED","DELETED"].entries()) await receipt(20+i,13,s,"2026-11-13T12:00:00Z","TELEGRAM");
  const p=await aggregatePeriod(tx,"day",cutoff);
  assert.deepEqual(p.receipts,{total:5,telegram:2,max:2,unknown:1,overlap:0});
  assert.deepEqual(p.activeClients,{total:3,telegram:1,max:2,unknown:1,overlap:1});
  assert.equal(p.activeClients.total,p.activeClients.telegram+p.activeClients.max+p.activeClients.unknown-p.activeClients.overlap);
  assert.equal(p.buckets[0].telegram,1); assert.equal(p.buckets[1].telegram,1);
  for(const period of PERIODS){
    const s=await aggregatePeriod(tx,period,cutoff);
    assert.equal(s.receipts.total,s.receipts.telegram+s.receipts.max+s.receipts.unknown);
    assert.equal(s.receipts.total,s.buckets.reduce((n,b)=>n+b.telegram+b.max+b.unknown,0));
  }
});

test("calendar months, leap day, DST and timezone boundaries have no gaps", () => {
  for(const zone of ["Europe/Moscow","America/New_York","Asia/Kathmandu","Pacific/Apia"]){
    for(const at of ["2026-11-14T07:00","2026-03-09T07:00","2026-11-02T07:00","2024-08-31T07:00"]){
      const end=DateTime.fromISO(at,{zone});
      for(const p of PERIODS){const b=periodBounds(p,end);assert.equal(+b.at(-1),+end);assert(b.every((v,i)=>!i||+v>+b[i-1]));
        if(p!=="half")assert.equal(+end-+b[0],{day:24,week:168,month:720}[p]*3600000);
        else assert.equal(b[0].toISO(),end.minus({months:6}).toISO());}
    }
  }
  assert.equal(periodBounds("half",DateTime.fromISO("2024-08-31T07:00",{zone:"Europe/Moscow"}))[0].day,29);
  assert.throws(()=>periodBounds("day",DateTime.invalid("test")));
});

test("all periods are aggregated in one repeatable-read transaction; saved report stays frozen", async () => {
  const original=prisma.$transaction;
  prisma.$transaction=async(fn,opts)=>{assert.equal(opts.isolationLevel,"RepeatableRead");return fn(tx)};
  try{snapshot=await buildStatisticsSnapshot(cutoff)}finally{prisma.$transaction=original}
  assert.equal(snapshot.monthlyChart.length, 30);
  assert.deepEqual(snapshot.monthlyChart[0], {date:"2026-10-16", users:4, active:0, active7:0, receipts:0});
  // active7 = unique users with a SENT receipt in the 7 local days ending on that date (rolling window).
  assert.deepEqual(snapshot.monthlyChart.slice(-3), [
    {date:"2026-11-12", users:4, active:0, active7:0, receipts:0},
    {date:"2026-11-13", users:4, active:3, active7:3, receipts:5},
    {date:"2026-11-14", users:8, active:1, active7:4, receipts:1}
  ]);
  const stored=JSON.stringify(snapshot);
  await db.query('DELETE FROM operations WHERE id=10');
  assert.equal(JSON.stringify(snapshot),stored);
  assert.equal((await aggregatePeriod(tx,"day",cutoff)).receipts.total,4);
  assert.equal(snapshot.periods.day.receipts.total,5);
});

test("Widget data and HTML obey byte limits for every period and large values", () => {
  const sizes=validateWidgetHtml();assert(sizes.bytes<=32768);assert(sizes.compressedBytes<=4096);
  for(const p of PERIODS)for(const c of ["all","tg","max"]){const s=sampleSnapshot();s.periods[p].buckets.forEach(b=>{b.telegram=1000000000;b.max=1000000000;b.unknown=1000000000});
    const encoded=encodeWidgetData(s,p,c,9999);assert(Buffer.byteLength(encoded)<=1024);assert.equal(JSON.parse(encoded).p,p)}
  const text=formatStatsText(snapshot);assert(text.includes("07:00 МСК"));assert(text.includes("в обоих: 1"));assert(text.includes("Квитанции: 5"));
});

test("unauthorized users, groups, inline widgets, invalid periods/channels and oversized queries are denied", () => {
  assert.deepEqual(parseStatisticsQuery(query,1234),{period:"week",channel:"tg"});
  for(const patch of [{from:{id:999}},{chat:{id:999,type:"private"}},{chat:{id:1234,type:"group"}},{inline_message_id:"x"},{message_id:undefined},{type:{type:"sign_data"}},{data:"s:year:all"},{data:"s:day:evil"},{data:"я".repeat(40)},{data:null}]) assert.equal(parseStatisticsQuery({...query,...patch},1234),null);
});

function report(where={}){return {id:"report-1",recipientId:1234n,cutoffAt:cutoff.toJSDate(),timezone:"Europe/Moscow",snapshot:sampleSnapshot(),state:"PREPARING",leaseUntil:new Date(Date.now()+120000),messageId:null,revision:0,...where}}
function mockReports(initial){
  const rows=initial||[];
  const matches=(r,w)=>Object.entries(w).every(([k,v])=>v&&typeof v==="object"&&"lte" in v?r[k]<=v.lte:r[k] instanceof Date?+r[k]===+v:r[k]===v);
  const original={};
  const methods={
    create:async({data})=>{if(data.deliveryKey&&rows.some(r=>r.deliveryKey===data.deliveryKey))throw new Prisma.PrismaClientKnownRequestError("duplicate",{code:"P2002",clientVersion:"test"});const r=report({id:`report-${++reportNumber}`,snapshot:null,...data});rows.push(r);return {...r}},
    findUniqueOrThrow:async({where})=>{const r=rows.find(r=>matches(r,where));if(!r)throw Error("missing");return {...r}},
    findUnique:async({where})=>rows.find(r=>where.deliveryKey?r.deliveryKey===where.deliveryKey:r.recipientId===where.recipientId_messageId.recipientId&&r.messageId===where.recipientId_messageId.messageId)||null,
    updateMany:async({where,data})=>{const found=rows.filter(r=>matches(r,where));found.forEach(r=>Object.assign(r,data));return {count:found.length}},
    update:async({where,data})=>{const r=rows.find(r=>r.id===where.id);if(!r)throw Error("missing");if(data.revision)data={...data,revision:r.revision+data.revision.increment};Object.assign(r,data);return {...r}}
  };
  for(const key of Object.keys(methods)){original[key]=prisma.statisticsReport[key];prisma.statisticsReport[key]=methods[key]}
  return {rows,methods,restore(){for(const key of Object.keys(original))prisma.statisticsReport[key]=original[key]}};
}

test("successful widget delivery and legacy text fallback use identical metrics", async () => {
  for(const fail of [false,true]){
    const r=report();const mock=mockReports([r]);const calls=[];
    const bot={api:{raw:{sendWidget:async args=>{calls.push(["widget",args]);if(fail)throw Error("unsupported");return {message_id:42}}},sendMessage:async(id,text)=>{calls.push(["text",text]);return {message_id:43}}}};
    try{await deliverStatisticsReport(bot,{...r});assert.equal(calls[0][1].caption,formatStatsText(r.snapshot));assert(calls[0][1].allow_queries);assert.equal(r.state,fail?"FALLBACK":"SENT");if(fail)assert.equal(calls[1][1],calls[0][1].caption);else assert.equal(calls.length,1)}finally{mock.restore()}
  }
});

test("unavailable widgets produce one PNG photo with the daily caption; ambiguous photo sends are not retried", async () => {
  for (const timeout of [false, true]) {
    const r = report({snapshot});
    const mock = mockReports([r]);
    let photos = 0;
    const bot = {api: {
      raw: {sendWidget: async () => {throw Error("INPUT_MEDIA_WIDGET_NOT_ALLOWED");}},
      sendPhoto: async (id, file, options) => {
        photos++;
        assert.equal(id, 1234);
        assert.equal(options.caption, formatStatsText(snapshot));
        assert.equal(file.filename, "statistics.png");
        const bytes = await file.toRaw();
        assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        if (timeout) throw Error("photo timeout");
        return {message_id: 77};
      }
    }};
    try {
      if (timeout) {
        await assert.rejects(deliverStatisticsReport(bot, r), /photo timeout/);
        assert.equal(r.state, "UNCERTAIN");
      } else {
        await deliverStatisticsReport(bot, r);
        assert.equal(r.state, "FALLBACK");
        assert.equal(r.messageId, 77);
      }
      assert.equal(photos, 1);
    } finally {mock.restore();}
  }
});

test("a database error after accepted send never triggers a second message", async () => {
  const r=report(),mock=mockReports([r]),original=prisma.statisticsReport.update;let sends=0;
  prisma.statisticsReport.update=async()=>{throw Error("database down")};
  try{await assert.rejects(deliverStatisticsReport({api:{raw:{sendWidget:async()=>{sends++;return {message_id:42}}},sendMessage:async()=>{sends++;return {message_id:43}}}},r));assert.equal(sends,1);assert.equal(r.state,"SENDING")}
  finally{prisma.statisticsReport.update=original;mock.restore()}
});

test("07:00 schedule, concurrent replicas, restart, lease recovery and no ambiguous resend", async () => {
  assert.equal(scheduledCutoff(cutoff.minus({minutes:1}),7),null);assert.equal(+scheduledCutoff(cutoff,7),+cutoff);
  assert.equal(scheduledCutoff(cutoff.setZone("Asia/Kathmandu"),7).hour,7);
  const mock=mockReports(),original=prisma.$transaction;
  prisma.$transaction=async fn=>fn(tx);let sends=0;
  const bot={api:{raw:{sendWidget:async()=>({message_id:++sends})}}};
  try{
    await runDueDailyStatistics(bot,cutoff.minus({minutes:1}));assert.equal(mock.rows.length,0);
    await Promise.all([runDueDailyStatistics(bot,cutoff),runDueDailyStatistics(bot,cutoff)]);assert.equal(sends,1);
    await runDueDailyStatistics(bot,cutoff.plus({hours:2}));assert.equal(sends,1);
    const r=mock.rows[0];r.state="PREPARING";r.leaseUntil=new Date(0);await runDueDailyStatistics(bot,cutoff);assert.equal(sends,2);
    r.state="SENDING";await runDueDailyStatistics(bot,cutoff);assert.equal(sends,2);
    r.state="UNCERTAIN";await runDueDailyStatistics(bot,cutoff);assert.equal(sends,2);
  }finally{mock.restore();prisma.$transaction=original}
});

test("query authorization, message binding, frozen snapshot, edits and answers; no extra messages", async () => {
  const mock=mockReports([report({state:"SENT",messageId:42})]),original=prisma.$transaction,calls=[];
  prisma.$transaction=async fn=>fn({$executeRaw:async()=>0,$queryRaw:async()=>[{locked:true}],statisticsReport:prisma.statisticsReport});
  const bot={api:{raw:{editMessageWidgetData:async args=>{calls.push(["edit",args]);return true},answerWidgetQuery:async args=>{calls.push(["answer",args]);return true}}}};
  try{
    await handleStatisticsQuery(bot,{...query,from:{id:888}});assert.equal(calls.length,1);assert(JSON.parse(calls[0][1].data).error);calls.length=0;
    await handleStatisticsQuery(bot,{...query,message_id:999});assert.equal(calls.length,1);calls.length=0;
    for(const p of PERIODS)for(const c of ["all","tg","max"]){await handleStatisticsQuery(bot,{...query,data:`s:${p}:${c}`});assert.equal(calls.at(-2)[0],"edit");assert.equal(calls.at(-1)[0],"answer");const data=JSON.parse(calls.at(-1)[1].data);assert.equal(data.p,p);assert.equal(data.c,c);assert.equal(data.t,"14.11.2026 · 07:00")}
  }finally{mock.restore();prisma.$transaction=original}
});

test("parallel queries reject busy report and edit errors are answered within deadline", async () => {
  const mock=mockReports([report({state:"SENT",messageId:42})]),original=prisma.$transaction;let locked=false,edits=0,answers=[];
  prisma.$transaction=async fn=>{let owns=false;try{return await fn({$executeRaw:async()=>0,$queryRaw:async()=>{if(locked)return[{locked:false}];locked=true;owns=true;return[{locked:true}]},statisticsReport:prisma.statisticsReport})}finally{if(owns)locked=false}};
  const bot={api:{raw:{editMessageWidgetData:async()=>{edits++;await new Promise(r=>setTimeout(r,20));return true},answerWidgetQuery:async a=>{answers.push(a);return true}}}};
  try{await Promise.all([handleStatisticsQuery(bot,query),handleStatisticsQuery(bot,{...query,id:"query-2"})]);assert.equal(edits,1);assert.equal(answers.length,2);assert.equal(answers.filter(a=>JSON.parse(a.data).error).length,1);
    bot.api.raw.editMessageWidgetData=async()=>{throw Error("API unavailable")};await handleStatisticsQuery(bot,query);assert(JSON.parse(answers.at(-1).data).error);
    bot.api.raw.editMessageWidgetData=async()=>{throw Error("Bad Request: message is not modified")};await handleStatisticsQuery(bot,query);assert(!JSON.parse(answers.at(-1).data).error)
  }finally{mock.restore();prisma.$transaction=original}
});

test("unresponsive database still gets an answer before Telegram's 15-second deadline", async () => {
  const original=prisma.$transaction;prisma.$transaction=()=>new Promise(()=>{});
  const answers=[];const started=Date.now();
  try{
    await handleStatisticsQuery({api:{raw:{answerWidgetQuery:async a=>{answers.push(a);return true}}}},query);
    assert(Date.now()-started<15000);assert.equal(answers.length,1);assert(JSON.parse(answers[0].data).error);
  }finally{prisma.$transaction=original}
});

test("/stats and widget updates bypass receipt conversations and unknown users get no data", async () => {
  const bot=createBot();bot.botInfo={id:123456,is_bot:true,first_name:"Test",username:"stats_test_bot"};
  const mock=mockReports(),original=prisma.$transaction;prisma.$transaction=async fn=>fn(tx);let calls=[];
  bot.api.config.use(async(_prev,method,payload)=>{calls.push({method,payload});return {ok:true,result:method==="sendWidget"?{message_id:90,chat:{id:1234,type:"private"}}:true}});
  const msg=(id,chat=id)=>({update_id:id,message:{message_id:1,date:1,chat:{id:chat,type:chat===id?"private":"group"},from:{id,is_bot:false,first_name:"Test"},text:"/stats",entities:[{type:"bot_command",offset:0,length:6}]}});
  try{await bot.handleUpdate(msg(999));assert.equal(calls.length,0);await bot.handleUpdate(msg(1234,-1));assert.equal(calls.length,0);await bot.handleUpdate(msg(1234));assert.equal(calls[0].method,"sendWidget");calls=[];
    await bot.handleUpdate({update_id:77,widget_query:{...query,from:{id:999}}});assert.equal(calls.length,1);assert.equal(calls[0].method,"answerWidgetQuery")
  }finally{mock.restore();prisma.$transaction=original}
});
