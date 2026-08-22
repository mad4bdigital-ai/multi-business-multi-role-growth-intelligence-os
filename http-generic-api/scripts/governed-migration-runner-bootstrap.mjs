#!/usr/bin/env node

import { access, constants } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.join(__dirname, "governed-migration-runner.mjs");
const startedAt = Date.now();

function safeMessage(error) {
  return String(error?.message || error || "Unknown runner bootstrap failure")
    .replace(/\b([A-Za-z0-9_]*(?:secret|password|passwd|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_]*)\s*=\s*([^\s,;]+)/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .slice(0, 2000);
}

function failurePayload(error, stage, runnerExists = null) {
  return {
    ok: false,
    error: {
      code: stage === "runner_execution" && error?.code
        ? String(error.code)
        : "governed_migration_runner_bootstrap_failed",
      name: error?.name || "Error",
      message: safeMessage(error),
      stage,
      runner_path: RUNNER_PATH,
      runner_exists: runnerExists,
      runner_diagnostic_stage: error?.diagnostic_stage || null,
      cause_code: error?.code || null,
      duration_ms: Math.max(0, Date.now() - startedAt),
    },
    secrets_included: false,
  };
}

async function main() {
  let runnerExists = false;
  try {
    await access(RUNNER_PATH, constants.R_OK);
    runnerExists = true;
  } catch (error) {
    process.stderr.write(`${JSON.stringify(failurePayload(error, "runner_artifact_readability", false), null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  let runnerModule;
  try {
    runnerModule = await import(pathToFileURL(RUNNER_PATH).href);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(failurePayload(error, "runner_module_import", runnerExists), null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  if (typeof runnerModule?.runGovernedMigrationRunner !== "function") {
    const error = new Error("Runner module does not export runGovernedMigrationRunner().");
    error.code = "runner_lifecycle_export_missing";
    process.stderr.write(`${JSON.stringify(failurePayload(error, "runner_module_contract", runnerExists), null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await runnerModule.runGovernedMigrationRunner(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify(failurePayload(error, "runner_execution", runnerExists), null, 2)}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify(failurePayload(error, "bootstrap_wrapper", null), null, 2)}\n`);
  process.exitCode = 1;
});
