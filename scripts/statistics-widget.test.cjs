const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../apps/renderer-worker/node_modules/playwright");
const { sampleSnapshot, PERIODS, root } = require("./statistics-fixtures.cjs");
const { STATISTICS_WIDGET_HTML, encodeWidgetData } = require("../apps/bot/dist/services/statisticsWidget");
let browser;
const palettes={light:{bg_color:"#ffffff",text_color:"#17212b",hint_color:"#707579",secondary_bg_color:"#f1f3f5",button_color:"#168acd",button_text_color:"#ffffff"},
  dark:{bg_color:"#17212b",text_color:"#f5f5f5",hint_color:"#8e9ba8",secondary_bg_color:"#232e3c",button_color:"#2b78a6",button_text_color:"#ffffff"}};
before(async()=>{
  try{browser=await chromium.launch({headless:true})}
  catch(e){if(process.platform!=="win32")throw e;browser=await chromium.launch({headless:true,channel:"msedge"})}
  fs.mkdirSync(path.join(root,"test-results/statistics"),{recursive:true});
});
after(async()=>{if(browser)await browser.close()});
async function preview(width,theme,empty=false){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const states={};for(const p of PERIODS)for(const c of ["all","tg","max"])states[`${p}:${c}`]=encodeWidgetData(sampleSnapshot(empty),p,c);
  const style=Object.entries(palettes[theme]).map(([k,v])=>`--tg-theme-${k.replaceAll('_','-')}:${v}`).join(';');
  const stub=`<style>:root{${style}}body{background:var(--tg-theme-bg-color)}</style><script>
  const events={},states=${JSON.stringify(states)};
  window.calls=[];window.fail=false;window.answerBeforeState=false;window.delay=0;window.rev=0;
  window.TelegramWidget={chatData:states['day:all'],themeParams:${JSON.stringify(palettes[theme])},colorScheme:'${theme}',onEvent:(n,f)=>events[n]=f,ready(){},
    request:async data=>{calls.push(data);if(fail)throw Object.assign(Error('rate limit'),{code:'RATE_LIMITED'});if(delay)await new Promise(r=>setTimeout(r,delay));
      let key=data.slice(2),s=JSON.parse(states[key]);s.r=++rev;let state=JSON.stringify(s);
      if(answerBeforeState){setTimeout(()=>{TelegramWidget.chatData=state;events.chatDataChanged()},30);return{result:state}}
      TelegramWidget.chatData=state;events.chatDataChanged();return{result:state}}
  };
  window.pushOld=()=>{TelegramWidget.chatData=states['day:all'];events.chatDataChanged()};
  </script>`;
  await page.setContent(STATISTICS_WIDGET_HTML.replace('<style>',stub+'<style>'));return{page,errors};
}

test("phone/desktop widths, light/dark themes, full-size text and no clipping",async()=>{
  for(const width of [280,320,390,430,600])for(const theme of ["light","dark"]){
    const {page,errors}=await preview(width,theme);
    assert.equal(await page.locator(".card").count(),3);assert.equal(await page.locator("polyline").count(),3);
    const size=await page.evaluate(()=>({height:document.body.getBoundingClientRect().height,width:document.documentElement.scrollWidth,nodes:document.querySelectorAll('*').length}));
    assert(size.height<=560,`${width}/${theme}: height ${size.height}`);assert(size.width<=width,`overflow at ${width}/${theme}`);assert(size.nodes<2000);
    assert.equal(await page.locator(".value").first().evaluate(el=>getComputedStyle(el).fontSize),"27px");
    if(width===390)await page.screenshot({path:path.join(root,`test-results/statistics/${theme}.png`),clip:{x:0,y:0,width,height:size.height}});
    assert.deepEqual(errors,[]);await page.close();
  }
});

test("all periods/channels update existing dashboard; point taps show interval/counts",async()=>{
  const {page,errors}=await preview(390,"light");
  for(const [label,p] of [["День","day"],["Неделя","week"],["Месяц","month"],["Полгода","half"]]){
    await page.getByRole("button",{name:label,exact:true}).click();
    for(const [name,c,lines] of [["Все","all",3],["TG","tg",1],["MAX","max",1]]){
      await page.getByRole("button",{name,exact:true}).click();
      assert.equal(await page.locator("polyline").count(),lines);
      const last=await page.evaluate(()=>JSON.parse(TelegramWidget.chatData));assert.equal(last.p,p);assert.equal(last.c,c);
      await page.locator("#chart").click({position:{x:100,y:40}});const tip=await page.locator("#tip").textContent();assert.match(tip,/\d{2}\.\d{2}.*\d{2}:\d{2}/);
      // Exercise the widget's local 5 requests / 5 seconds window without a real wait.
      await page.evaluate(()=>{taps=[]});
    }
  }
  assert.deepEqual(errors,[]);await page.close();
});

test("empty database and empty selected platform render a readable state",async()=>{
  const {page,errors}=await preview(320,"dark",true);
  assert.equal(await page.getByText("За период нет данных",{exact:true}).count(),1);assert.equal(await page.locator("svg").count(),0);
  await page.getByRole("button",{name:"MAX",exact:true}).click();assert.equal(await page.locator("svg").count(),0);assert.deepEqual(errors,[]);await page.close();
});

test("failed requests recover, rapid taps are bounded, answers work before state events and old revisions are ignored",async()=>{
  const {page,errors}=await preview(390,"dark");
  await page.evaluate(()=>{fail=true});await page.getByRole("button",{name:"Неделя",exact:true}).click();
  await page.waitForFunction(()=>!busy);assert.match(await page.locator("#status").textContent(),/Подождите/);
  await page.evaluate(()=>{fail=false;answerBeforeState=true;delay=50;taps=[]});
  await page.getByRole("button",{name:"Неделя",exact:true}).click();assert.equal(await page.locator("button[disabled]").count(),7);
  await page.waitForFunction(()=>!busy);assert.equal(await page.getByRole("button",{name:"Неделя",exact:true}).getAttribute("aria-pressed"),"true");
  await page.evaluate(()=>pushOld());assert.equal(await page.getByRole("button",{name:"Неделя",exact:true}).getAttribute("aria-pressed"),"true");
  await page.evaluate(()=>{taps=[Date.now(),Date.now(),Date.now(),Date.now(),Date.now()]});const before=await page.evaluate(()=>calls.length);
  await page.getByRole("button",{name:"Месяц",exact:true}).click();assert.equal(await page.evaluate(()=>calls.length),before);
  assert.deepEqual(errors,[]);await page.close();
});
