// Проверяет, что файлы, упомянутые в docs/FEATURE_MAP.md и AGENTS.md, существуют.
// Запуск: node scripts/check-agent-map.cjs  (ненулевой код выхода = карта устарела)
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", "dist", "storage", "test-results", "tmp_import", "BACKUPS", "coverage"]);

const files = [];
const dirs = new Set();
const walk = (dir, rel) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { dirs.add(r); walk(path.join(dir, entry.name), r); }
    else files.push(r);
  }
};
walk(root, "");
const fileSet = new Set(files);

const missing = [];
for (const doc of ["AGENTS.md", "docs/FEATURE_MAP.md"]) {
  const text = fs.readFileSync(path.join(root, doc), "utf8");
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const ref = m[1].replace(/\/$/, "");
    const looksLikePath = /\.(ts|cjs|md|prisma|hbs|yml|sh)$/.test(ref) || (ref.includes("/") && /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(ref));
    if (!looksLikePath || ref.includes("*") || ref.includes("<") || ref.startsWith(".env") || ref.startsWith("http")) continue;
    const ok = fileSet.has(ref) || dirs.has(ref) || files.some((f) => f.endsWith("/" + ref)) || [...dirs].some((d) => d.endsWith("/" + ref));
    if (!ok) missing.push(`${doc}: ${ref}`);
  }
}
if (missing.length) { console.error("Устаревшие ссылки в карте:\n" + [...new Set(missing)].join("\n")); process.exit(1); }
console.log(`Карта актуальна: все упомянутые файлы существуют (проверено файлов в проекте: ${files.length}).`);
