import { DateTime } from "luxon";
import sharp from "sharp";
import type { MonthChartDay } from "./statisticsService";

const number = new Intl.NumberFormat("ru-RU");
const axisNumber = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const shortDate = (iso: string) => DateTime.fromISO(iso).toFormat("dd.MM");

function chartPanel(days: MonthChartDay[], metric: "users" | "active" | "receipts", title: string, color: string, top: number): string {
  const values = days.map(day => day[metric]);
  const peak = Math.max(1, ...values);
  const unit = 10 ** Math.floor(Math.log10(peak));
  const ceiling = Math.ceil(peak / unit) * unit;
  const left = 99, right = 842, base = top + 184, height = 95;
  const step = (right - left) / days.length;
  const x = (i: number) => left + (i + 0.5) * step;
  const y = (v: number) => base - v / ceiling * height;
  const grid = [0, ceiling].map(tick => `
    <path d="M${left} ${y(tick)}H${right}" stroke="#d9e4e4"/>
    <text x="${left - 10}" y="${y(tick) + 6}" text-anchor="end" font-size="17" fill="#455d63">${axisNumber.format(tick)}</text>`).join("");
  const series = metric === "users"
    ? `<path d="M${x(0)} ${y(values[0])} ${values.slice(1).map((v, i) => `H${x(i + 1)}V${y(v)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round"/>
       <circle cx="${x(days.length - 1)}" cy="${y(values[values.length - 1])}" r="5" fill="${color}"/>`
    : values.map((v, i) => `<rect x="${x(i) - step * 0.34}" y="${y(v)}" width="${step * 0.68}" height="${base - y(v)}" fill="${color}" rx="2"/>`).join("");
  const dates = [0, 7, 14, 21, 29].map(i =>
    `<text x="${x(i)}" y="${base + 28}" text-anchor="middle" font-size="18" fill="#455d63">${shortDate(days[i].date)}</text>`
  ).join("");
  return `<rect x="26" y="${top}" width="848" height="235" rx="20" fill="#fff"/>
    <text x="52" y="${top + 48}" font-size="27" font-weight="bold">${title}</text>
    <text x="840" y="${top + 48}" text-anchor="end" font-size="30" font-weight="bold" fill="${color}">${number.format(values[values.length - 1])}</text>
    ${grid}${series}${dates}`;
}

export async function renderStatisticsChart(days: MonthChartDay[], cutoff: string, timezone: string): Promise<Buffer> {
  const end = DateTime.fromISO(cutoff).setZone(timezone);
  const stamp = end.toFormat("dd.MM.yyyy, HH:mm");
  const zone = timezone === "Europe/Moscow" ? "МСК" : end.toFormat("'UTC'ZZ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
    <rect width="900" height="900" fill="#edf4f2"/>
    <g font-family="DejaVu Sans, Arial, sans-serif" fill="#193638">
      <text x="44" y="58" font-weight="bold" font-size="40">Статистика за 30 дней</text>
      <text x="46" y="97" font-size="23" fill="#455d63">${shortDate(days[0].date)} – ${shortDate(days[29].date)} · Данные на ${stamp} ${zone}</text>
      <text x="46" y="132" font-size="20" fill="#455d63">Справа — значения за ${shortDate(days[29].date)}</text>
      ${chartPanel(days, "users", "Всего пользователей", "#146e66", 152)}
      ${chartPanel(days, "active", "Активные пользователи за день", "#345ea6", 400)}
      ${chartPanel(days, "receipts", "Выданные квитанции за день", "#a75622", 648)}
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
