#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEnvironmentConvergence } from "../environmentConvergenceEngine.js";
import { readEnvironmentConvergenceRegistry } from "../environmentConvergenceRegistry.js";

const SHA_RE = /^[0-9a-f]{40}$/u;
const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const repositoryRoot = path.resolve(apiRoot, "..");

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function parseArgs(argv) {
  const out = {
    runtimeState: path.join(repositoryRoot, "autopilot-portable-staging", "autopilot-state.json"),
    preflight: path.join(repositoryRoot, "autopilot-portable-staging", "logs", "staging-schema-governance-preflight.json"),
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    recoveryTrustExact: true,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--runtime-state") { out.runtimeState = path.resolve(value); index += 1; }
    else if (key === "--preflight") { out.preflight = path.resolve(value); index += 1; }
    else if (key === "--repository") { out.repository = String(value || "").trim(); index += 1; }
    else if (key === "--recovery-trust-exact") { out.recoveryTrustExact = String(value || "").trim().toLowerCase() === "true"; index += 1; }
    else fail("staging_convergence_argument_unknown", `Unknown argument: ${key}`);
  }
  return out;
}

function readJson(filePath, label) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { fail("staging_convergence_input_invalid", `${label} is missing or invalid JSON.`, { file_path: filePath }); }
}

function values(input) {
  return [...new Set((Array.isArray(input) ? input : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function reasonCheck(reason, registry) {
  const metadata = registry?.dependencies?.activation_gateway?.checks?.[reason] || null;
  return {
    key: reason,
    ok: false,
    severity: metadata?.failure_kind === "integrity_failure" ? "blocking" : "readiness",
    detail: {
      source: "staging_autopilot_runtime_observation",
      secrets_included: false,
    },
  };
}

function validateInputs(runtime, preflight) {
  const commit = String(runtime?.commit || "").trim().toLowerCase();
  if (!SHA_RE.test(commit)) fail("staging_convergence_commit_invalid", "AutoPilot runtime commit is not an exact SHA.");
  if (String(preflight?.status || "") !== "passed") fail("staging_convergence_preflight_not_passed", "Staging schema/governance preflight is not passed.");
  if (String(preflight?.expected_commit || "").trim().toLowerCase() !== commit || String(preflight?.observed_commit || "").trim().toLowerCase() !== commit) {
    fail("staging_convergence_preflight_commit_mismatch", "Staging preflight is not bound to the runtime exact SHA.");
  }
  const safety = preflight?.safety || {};
  if (safety.production_access !== false || safety.provider_access !== false || safety.database_mutation !== false || safety.migration_apply !== false) {
    fail("staging_convergence_preflight_safety_invalid", "Staging preflight did not prove the no-mutation boundary.");
  }
  return commit;
}

try {
  const args = parseArgs(process.argv);
  const registry = readEnvironmentConvergenceRegistry();
  const runtime = readJson(args.runtimeState, "AutoPilot runtime state");
  const preflight = readJson(args.preflight, "Staging schema/governance preflight report");
  const commit = validateInputs(runtime, preflight);
  const reasons = values([
    ...values(runtime.certification_blocking_failures),
    ...values(runtime.certification_degraded_reasons),
    ...(args.recoveryTrustExact ? [] : ["gateway_recovery_trusted_ingress"]),
  ]);

  if (reasons.length === 0) {
    console.log(JSON.stringify({
      contract: "mad4b.staging-environment-convergence-bridge.v1",
      status: "not_required",
      expected_commit: commit,
      report: { convergence: { status: "converged", next_governed_handoff: null } },
      convergence_run: null,
      safety: { provider_mutation: false, workflow_dispatch: false, production_mutation: false, database_mutation: false, secrets_included: false },
    }));
    process.exit(0);
  }

  const checks = reasons.map((reason) => reasonCheck(reason, registry));
  const certificationReport = {
    outcome: "degraded",
    expected: { commit_sha: commit },
    gateway: { health: { sourceCommit: runtime?.activation_gateway_source_commit || null } },
    integrity_checks: checks.filter((entry) => entry.severity === "blocking"),
    readiness_checks: checks.filter((entry) => entry.severity !== "blocking"),
  };
  const convergenceRun = runEnvironmentConvergence({
    environment: "staging",
    releaseSpec: {
      repository: args.repository,
      source_branch: "main",
      commit_sha: commit,
    },
    certificationReport,
    registry,
  });

  console.log(JSON.stringify({
    contract: "mad4b.staging-environment-convergence-bridge.v1",
    status: convergenceRun.status,
    expected_commit: commit,
    reasons,
    report: { convergence: convergenceRun.classification || null },
    plan: convergenceRun.plan || null,
    approval_checkpoint: convergenceRun.approval_checkpoint || null,
    convergence_run: convergenceRun,
    safety: { provider_mutation: false, workflow_dispatch: false, production_mutation: false, database_mutation: false, secrets_included: false },
  }));
} catch (error) {
  console.error(JSON.stringify({
    contract: "mad4b.staging-environment-convergence-bridge.v1",
    status: "blocked",
    error: { code: error?.code || "staging_convergence_bridge_failed", message: String(error?.message || "failed"), details: error?.details || {} },
    safety: { provider_mutation: false, workflow_dispatch: false, production_mutation: false, database_mutation: false, secrets_included: false },
  }));
  process.exitCode = 1;
}
