const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
for (const project of ["packages/db", "packages/shared", "apps/bot", "apps/renderer-worker"]) {
  const compiler = require.resolve("typescript/bin/tsc", { paths: [path.join(root, project)] });
  const result = spawnSync(process.execPath, [compiler, "-p", path.join(root, project, "tsconfig.json")], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync(process.execPath, ["--test", "scripts/branding.test.cjs"], { cwd: root, stdio: "inherit" });
process.exit(result.status || 0);
