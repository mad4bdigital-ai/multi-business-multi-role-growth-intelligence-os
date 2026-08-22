import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = path.join(HERE, "scripts", "governed-migration-runner-bootstrap.mjs");

function parsePayload(raw) {
  const finalStart = raw.lastIndexOf("\n{");
  const candidate = finalStart >= 0 ? raw.slice(finalStart + 1).trim() : raw;
  return JSON.parse(candidate);
}

async function runBootstrap(scriptPath, cwd, args = [], env = { ...process.env }) {
  try {
    await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd,
      env,
      maxBuffer: 1024 * 1024,
    });
    assert.fail("bootstrap wrapper should fail for the fixture");
  } catch (error) {
    const raw = String(error?.stderr || "").trim();
    assert.ok(raw, "bootstrap failure must emit structured stderr");
    return { error, raw, payload: parsePayload(raw) };
  }
}

const artifactMissingDir = await mkdtemp(path.join(os.tmpdir(), "governed-runner-bootstrap-missing-"));
const importFailureDir = await mkdtemp(path.join(os.tmpdir(), "governed-runner-bootstrap-import-"));
try {
  await cp(BOOTSTRAP, path.join(artifactMissingDir, "governed-migration-runner-bootstrap.mjs"));
  const missingResult = await runBootstrap(path.join(artifactMissingDir, "governed-migration-runner-bootstrap.mjs"), artifactMissingDir);
  const missing = missingResult.payload;
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "governed_migration_runner_bootstrap_failed");
  assert.equal(missing.error.stage, "runner_artifact_readability");
  assert.equal(missing.error.runner_exists, false);
  assert.equal(missing.secrets_included, false);

  await cp(BOOTSTRAP, path.join(importFailureDir, "governed-migration-runner-bootstrap.mjs"));
  await writeFile(
    path.join(importFailureDir, "governed-migration-runner.mjs"),
    "throw Object.assign(new Error('fixture import failure'), { code: 'ERR_FIXTURE_IMPORT' });\n",
  );
  const importedResult = await runBootstrap(path.join(importFailureDir, "governed-migration-runner-bootstrap.mjs"), importFailureDir);
  const imported = importedResult.payload;
  assert.equal(imported.ok, false);
  assert.equal(imported.error.code, "governed_migration_runner_bootstrap_failed");
  assert.equal(imported.error.stage, "runner_module_import");
  assert.equal(imported.error.runner_exists, true);
  assert.equal(imported.error.message, "fixture import failure");
  assert.equal(imported.secrets_included, false);

  const missingDbEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_PORT"].includes(key)),
  );
  const lifecycleResult = await runBootstrap(
    BOOTSTRAP,
    HERE,
    ["--migration=20260815_custom_gpt_mcp_catalog_levels.sql", "--dry-run"],
    missingDbEnv,
  );
  const lifecycleLines = lifecycleResult.raw.split(/\r?\n/).filter(Boolean);
  const lifecycleStages = lifecycleLines.slice(0, 4).map((line) => JSON.parse(line));
  assert.deepEqual(
    lifecycleStages.map((event) => event.stage),
    ["module_loaded", "main_entered", "arguments_parsed", "migration_artifact_read_started"],
  );
  const lifecycleFailure = lifecycleResult.payload;
  assert.equal(lifecycleFailure.ok, false);
  assert.equal(lifecycleFailure.error.stage, "runner_execution");
  assert.equal(lifecycleFailure.error.runner_diagnostic_stage, "authorization_preflight_started");
  assert.equal(lifecycleFailure.error.cause_code, "DB_CONFIG_MISSING");
  assert.equal(lifecycleFailure.secrets_included, false);
} finally {
  await Promise.all([
    rm(artifactMissingDir, { recursive: true, force: true }),
    rm(importFailureDir, { recursive: true, force: true }),
  ]);
}

console.log("governed migration runner bootstrap tests passed");
