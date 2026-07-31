import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(scriptsDir, "..");
const reportDir = process.env.TEST_SUITE_REPORT_DIR || path.join(apiDir, ".test-suite-reports");

const child = spawn(process.execPath, ["test-release-readiness-migration-drift.mjs"], {
  cwd: apiDir,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += String(chunk); });
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolve(Number.isInteger(code) ? code : 1));
});

await mkdir(reportDir, { recursive: true });
await writeFile(
  path.join(reportDir, "release-readiness-migration-drift-diagnostic.json"),
  `${JSON.stringify({
    schema_version: "release_readiness_migration_drift_diagnostic.v1",
    command: "node test-release-readiness-migration-drift.mjs",
    exit_code: exitCode,
    stdout,
    stderr,
    mutations_executed: false,
    secrets_included: false,
  }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  diagnostic_captured: true,
  exit_code: exitCode,
  report_file: "release-readiness-migration-drift-diagnostic.json",
  mutations_executed: false,
  secrets_included: false,
}));
