import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runner = "scripts/governed-migration-runner.mjs";
const migration = "20260815_custom_gpt_mcp_catalog_levels.sql";
const dbKeys = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_PORT"];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !dbKeys.includes(key)),
);
env.GOVERNED_MIGRATION_DIAGNOSTIC = "1";

try {
  await execFileAsync(process.execPath, [runner, `--migration=${migration}`, "--dry-run"], {
    cwd: process.cwd(),
    env,
    maxBuffer: 1024 * 1024,
  });
  assert.fail("runner should fail closed when DB configuration is absent");
} catch (error) {
  const stderr = String(error?.stderr || "");
  const lines = stderr.split(/\r?\n/).filter(Boolean);
  const stageEvents = lines.slice(0, 4).map((line) => JSON.parse(line));
  const finalEnvelopeStart = stderr.lastIndexOf("\n{\n");
  assert.ok(finalEnvelopeStart >= 0, "runner must emit a final structured error envelope");
  const finalEnvelope = JSON.parse(stderr.slice(finalEnvelopeStart + 1).trim());
  assert.deepEqual(
    stageEvents.map((event) => event.stage),
    ["module_loaded", "main_entered", "arguments_parsed", "authorization_preflight_started"],
  );
  assert.equal(stageEvents[0].secrets_included, false);
  assert.equal(finalEnvelope.error.code, "DB_CONFIG_MISSING");
  assert.equal(finalEnvelope.error.diagnostic_stage, "authorization_preflight_started");
  assert.equal(finalEnvelope.secrets_included, false);
}

console.log("governed migration runner stage diagnostic tests passed");
