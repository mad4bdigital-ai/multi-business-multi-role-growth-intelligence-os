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

async function runBootstrap(tempDir) {
  try {
    await execFileAsync(process.execPath, [path.join(tempDir, "governed-migration-runner-bootstrap.mjs")], {
      cwd: tempDir,
      env: { ...process.env, GOVERNED_MIGRATION_EXECUTION_ID: "bootstrap-test" },
      maxBuffer: 1024 * 1024,
    });
    assert.fail("bootstrap wrapper should fail for the fixture");
  } catch (error) {
    const raw = String(error?.stderr || "").trim();
    assert.ok(raw, "bootstrap failure must emit structured stderr");
    return JSON.parse(raw);
  }
}

const artifactMissingDir = await mkdtemp(path.join(os.tmpdir(), "governed-runner-bootstrap-missing-"));
const importFailureDir = await mkdtemp(path.join(os.tmpdir(), "governed-runner-bootstrap-import-"));
try {
  await cp(BOOTSTRAP, path.join(artifactMissingDir, "governed-migration-runner-bootstrap.mjs"));
  const missing = await runBootstrap(artifactMissingDir);
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
  const imported = await runBootstrap(importFailureDir);
  assert.equal(imported.ok, false);
  assert.equal(imported.error.code, "governed_migration_runner_bootstrap_failed");
  assert.equal(imported.error.stage, "runner_module_import");
  assert.equal(imported.error.runner_exists, true);
  assert.equal(imported.error.message, "fixture import failure");
  assert.equal(imported.secrets_included, false);
} finally {
  await Promise.all([
    rm(artifactMissingDir, { recursive: true, force: true }),
    rm(importFailureDir, { recursive: true, force: true }),
  ]);
}

console.log("governed migration runner bootstrap tests passed");
