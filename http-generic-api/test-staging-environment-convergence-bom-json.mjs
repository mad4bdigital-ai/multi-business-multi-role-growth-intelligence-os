import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(here, "scripts", "staging-environment-convergence-plan.mjs");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-staging-convergence-bom-"));
const runtimePath = path.join(tempRoot, "autopilot-state.json");
const preflightPath = path.join(tempRoot, "staging-schema-governance-preflight.json");
const commit = "a".repeat(40);

const runtime = {
  commit,
  certified_commit: commit,
  certification_status: "ready",
  certification_blocking_failures: [],
  certification_degraded_reasons: [],
};

const preflight = {
  contract: "mad4b.staging.schema-governance-preflight.v1",
  status: "passed",
  expected_commit: commit,
  observed_commit: commit,
  safety: {
    read_only: true,
    schema_bundle_applied: false,
    database_mutation: false,
    migration_apply: false,
    production_access: false,
    provider_access: false,
    data_export: false,
    credential_access: false,
    secrets_included: false,
    tunnel_started: false,
    auto_deploy_installed: false,
  },
};

try {
  fs.writeFileSync(runtimePath, `\uFEFF${JSON.stringify(runtime)}`, "utf8");
  fs.writeFileSync(preflightPath, `\uFEFF${JSON.stringify(preflight)}`, "utf8");

  const result = spawnSync(process.execPath, [
    bridgePath,
    "--runtime-state", runtimePath,
    "--preflight", preflightPath,
    "--repository", "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    "--recovery-trust-exact", "true",
  ], {
    cwd: here,
    encoding: "utf8",
    env: process.env,
  });

  assert.equal(result.status, 0, `bridge must accept Windows PowerShell UTF-8 BOM JSON inputs: ${result.stderr || result.stdout}`);
  const output = JSON.parse(String(result.stdout || "").trim());
  assert.equal(output.contract, "mad4b.staging-environment-convergence-bridge.v1");
  assert.equal(output.status, "not_required");
  assert.equal(output.expected_commit, commit);
  assert.equal(output.safety.provider_mutation, false);
  assert.equal(output.safety.workflow_dispatch, false);
  assert.equal(output.safety.production_mutation, false);
  assert.equal(output.safety.database_mutation, false);
  assert.equal(output.safety.secrets_included, false);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("staging environment convergence BOM JSON regression: ok");
