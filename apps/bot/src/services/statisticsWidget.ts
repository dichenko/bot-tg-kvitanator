import { deflateSync, constants } from "node:zlib";
import { DateTime } from "luxon";
import type { ChartChannel, StatisticsSnapshot, StatsPeriod } from "./statisticsService";

export const encodeWidgetData = (snapshot: StatisticsSnapshot, p: StatsPeriod = "day", c: ChartChannel = "all", r = 0): string => {
  const data = snapshot.periods[p];
  const boundaries = [data.buckets[0].from, ...data.buckets.map(b => b.to)].map(s => Math.floor(Date.parse(s) / 1000));
  const result = JSON.stringify({ p, c, r, t: DateTime.fromISO(snapshot.cutoff).setZone(snapshot.timezone).toFormat("dd.LL.yyyy · HH:mm"),
    z: snapshot.timezone,
    m: [data.newClients, data.activeClients, data.receipts].map(v => [v.total, v.telegram, v.max, v.unknown, v.overlap]),
    b: boundaries.map((n, i) => (i ? n - boundaries[i - 1] : n).toString(36)).join("."),
    g: data.buckets.map(b => [b.telegram, b.max, b.unknown].map(n => n.toString(36)).join(".")).join(",")
  });
  if (Buffer.byteLength(result, "utf8") > 1024) throw new Error("Statistics widget chat_data exceeds 1024 bytes");
  return result;
};

// Profile 1 only: no WebView, external assets, network, or framework.
// Keep this static: all report data belongs in the message's chat_data.
export const STATISTICS_WIDGET_HTML = String.raw`<!doctype html><html lang="ru"><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;padding:10px 12px;line-height:16px;color:var(--tg-theme-text-color);font-family:system-ui;font-size:14px}
h1{font-size:18px;line-height:22px;margin:0 0 3px}.hint{color:var(--tg-theme-hint-color);font-size:12px;line-height:14px}.tabs{display:flex;gap:4px;margin:8px 0}
button{border:0;border-radius:9px;padding:9px 4px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color);font-size:13px;flex:1;min-width:0}
button.on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}button[disabled]{color:var(--tg-theme-hint-color)}
.card{border-radius:12px;background:var(--tg-theme-secondary-bg-color);padding:7px 11px;margin:6px 0}.top{display:flex;align-items:center;justify-content:space-between;gap:8px}.value{font-size:27px;font-weight:700;line-height:28px}.split{display:flex;justify-content:space-between;gap:6px;margin-top:3px;font-size:13px}.focus{font-weight:700;text-decoration:underline}.tg{color:#168acd}.mx{color:#9866e8}.bar{display:flex;height:4px;border-radius:3px;overflow:hidden;margin-top:5px;background:var(--tg-theme-hint-color)}.bar span{height:4px}.extra{font-size:12px;line-height:14px;color:var(--tg-theme-hint-color);margin-top:3px}.charthead{display:flex;align-items:center;justify-content:space-between;margin-top:10px;gap:6px}.charthead .tabs{margin:0;width:145px}.charthead button{padding:7px 4px}
#chart{height:76px;margin-top:5px}svg{width:100%;height:76px;display:block}#tip{min-height:30px;font-size:12px;line-height:15px;margin-top:3px}#range{display:flex;justify-content:space-between}#status{margin-top:3px}#status:empty{display:none}.empty{padding:26px 0;text-align:center;color:var(--tg-theme-hint-color)}
</style><h1>Квитанатор · Статистика</h1><div id="time" class="hint"></div><div id="periods" class="tabs"></div><div id="cards"></div><div class="charthead"><b>Квитанции</b><div id="channels" class="tabs"></div></div><div id="chart"></div><div id="range" class="hint"></div><div id="tip"></div><div id="status" class="hint" aria-live="polite"></div>
<script>
const W=window.TelegramWidget,$=id=>document.getElementById(id),names=['Новые клиенты','Активные клиенты','Квитанции'];
let S=null,busy=false,taps=[],series=[],bounds=[],selected=-1;
function text(id,t){$(id).textContent=t}
function fmt(n){return n.toLocaleString('ru-RU')}
function label(t,full){return new Intl.DateTimeFormat('ru-RU',{timeZone:S.z,day:'2-digit',month:'2-digit',...(full?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(t*1000))}
function tabs(id,values,active,field){$(id).innerHTML='';values.forEach(v=>{let b=document.createElement('button');b.textContent=v[1];b.className=v[0]===active?'on':'';b.disabled=busy;b.setAttribute('aria-pressed',String(v[0]===active));b.onclick=()=>choose(field,v[0]);$(id).appendChild(b)})}
function tooltip(i){selected=i;let v=series[i];text('tip',label(bounds[i],true)+' — '+label(bounds[i+1],true)+' · '+(S.c==='all'?'TG: '+fmt(v[0])+' · MAX: '+fmt(v[1])+(v[2]?' · Неизв.: '+fmt(v[2]):''):S.c==='tg'?'TG: '+fmt(v[0]):'MAX: '+fmt(v[1])))}
function draw(){
if(!S)return;text('time',S.t+' · '+(S.z==='Europe/Moscow'?'МСК':S.z));
tabs('periods',[['day','День'],['week','Неделя'],['month','Месяц'],['half','Полгода']],S.p,'p');tabs('channels',[['all','Все'],['tg','TG'],['max','MAX']],S.c,'c');
$('cards').innerHTML=S.m.map((v,i)=>{let sum=v[1]+v[2]+v[3]||1;return '<div class="card"><div class="top"><span>'+names[i]+'</span><span class="value">'+fmt(v[0])+'</span></div><div class="split"><span class="tg'+(S.c==='tg'?' focus':'')+'">Telegram: '+fmt(v[1])+'</span><span class="mx'+(S.c==='max'?' focus':'')+'">MAX: '+fmt(v[2])+'</span></div><div class="bar"><span style="background:#168acd;width:'+v[1]/sum*100+'%"></span><span style="background:#9866e8;width:'+v[2]/sum*100+'%"></span></div>'+((v[3]||v[4])?'<div class="extra">'+(v[3]?'Неизвестно: '+fmt(v[3]):'')+(v[3]&&v[4]?' · ':'')+(v[4]?'В обоих: '+fmt(v[4]):'')+'</div>':'')+'</div>'}).join('');
series=S.g.split(',').map(s=>s.split('.').map(n=>parseInt(n,36)));let t=0;bounds=S.b.split('.').map(n=>t+=parseInt(n,36));$('chart').onclick=null;
let visible=S.c==='all'?[0,1,2]:S.c==='tg'?[0]:[1],peak=Math.max(0,...series.flatMap(v=>visible.map(k=>v[k])));text('tip','');
if(!peak){$('chart').innerHTML='<div class="empty">За период нет данных</div>';text('range','');return}
let x=i=>8+i*284/(series.length-1||1),y=n=>72-n/peak*62;
let svg='<svg viewBox="0 0 300 84" preserveAspectRatio="none" role="img" aria-label="Динамика квитанций"><path d="M8 72H292" stroke="'+W.themeParams.hint_color+'" fill="none"/>';
visible.forEach(k=>{let color=['#168acd','#9866e8',W.themeParams.hint_color][k];svg+='<polyline points="'+series.map((v,i)=>x(i)+','+y(v[k])).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2"/>';series.forEach((v,i)=>svg+='<circle cx="'+x(i)+'" cy="'+y(v[k])+'" r="3" fill="'+color+'"/>')});
$('chart').innerHTML=svg+'</svg>';$('range').innerHTML='<span>'+label(bounds[0],S.p==='day')+'</span><span>'+label(bounds[bounds.length-1],S.p==='day')+'</span>';
$('chart').onclick=e=>{let r=$('chart').getBoundingClientRect();tooltip(Math.max(0,Math.min(series.length-1,Math.round(((e.clientX-r.left)/r.width*300-8)/284*(series.length-1)))))};
tooltip(selected>=0&&selected<series.length?selected:series.length-1);
}
function apply(r){if(!S||r.r>=S.r){S=r;selected=-1;draw()}}
function load(){try{apply(JSON.parse(W.chatData))}catch(e){text('status','Не удалось прочитать отчёт')}}
function choose(field,value){if(busy||S[field]===value)return;let now=Date.now();taps=taps.filter(t=>now-t<5000);if(taps.length>=5){text('status','Подождите несколько секунд');return}taps.push(now);busy=true;draw();text('status','Обновляем…');let p=field==='p'?value:S.p,c=field==='c'?value:S.c;
W.request('s:'+p+':'+c).then(a=>{let r=a.result?JSON.parse(a.result):{};if(r.error)throw Error(r.error);if(r.p)apply(r);text('status','')}).catch(e=>text('status',e.code==='RATE_LIMITED'?'Подождите несколько секунд':'Не удалось обновить. Нажмите ещё раз.')).finally(()=>{busy=false;draw()})}
if(W){W.onEvent('chatDataChanged',load);W.onEvent('themeChanged',draw);load();W.ready()}
</script></html>`;

export const validateWidgetHtml = (): { bytes: number; compressedBytes: number } => {
  const bytes = Buffer.byteLength(STATISTICS_WIDGET_HTML, "utf8");
  const compressedBytes = deflateSync(STATISTICS_WIDGET_HTML, { level: constants.Z_BEST_COMPRESSION }).length;
  if (bytes > 32768 || compressedBytes > 4096) throw new Error(`Statistics widget HTML exceeds Telegram limits: ${bytes}/${compressedBytes}`);
  return { bytes, compressedBytes };
};
