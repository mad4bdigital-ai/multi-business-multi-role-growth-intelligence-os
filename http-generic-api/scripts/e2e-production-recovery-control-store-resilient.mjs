#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const apiRoot = resolve(root, "http-generic-api");
const workflowPath = ".github/workflows/brand-skill-mariadb-certification.yml";
const workflow = readFileSync(resolve(root, workflowPath), "utf8");
const disposableCertificationPath =
  "http-generic-api/scripts/brand-skill-mariadb-disposable-certification.mjs";
const disposableCertification = readFileSync(
  resolve(root, disposableCertificationPath),
  "utf8",
);
const declaration = JSON.parse(readFileSync(resolve(root, ".changes/e2e/production-recovery-control-store-7999.json"), "utf8"));
const certification = readFileSync(resolve(apiRoot, "scripts/production-recovery-control-store-resilient-certification.mjs"), "utf8");
const documentation = readFileSync(resolve(root, "docs/governance/production-recovery-control-store-7999.md"), "utf8");

assert.equal(declaration.current_phase, "resilient");
const resilient = declaration.phases.find((phase) => phase.id === "resilient");
assert.equal(resilient?.status, "implemented");
assert.ok(Array.isArray(resilient?.e2e_journeys) && resilient.e2e_journeys.length === 1);

for (const requiredPath of [
  workflowPath,
  disposableCertificationPath,
  "http-generic-api/scripts/production-recovery-control-store-resilient-certification.mjs",
  "http-generic-api/scripts/e2e-production-recovery-control-store-resilient.mjs",
]) {
  assert.equal(declaration.scope.include.includes(requiredPath), true, `resilient declaration scope missing ${requiredPath}`);
}

assert.match(workflow, /image:\s*mariadb:11\.4/u);

const disposableWorkflowStepStart = workflow.indexOf(
  "- name: Certify migration on disposable MariaDB",
);

const disposableWorkflowStepEnd = workflow.indexOf(
  "- name: Validate bounded disposable evidence",
  disposableWorkflowStepStart,
);

assert.ok(
  disposableWorkflowStepStart >= 0 &&
    disposableWorkflowStepEnd > disposableWorkflowStepStart,
  "resilient certification must reuse the governed MariaDB certification workflow surface",
);

const disposableWorkflowSection = workflow.slice(
  disposableWorkflowStepStart,
  disposableWorkflowStepEnd,
);

assert.match(
  disposableWorkflowSection,
  /node scripts\/brand-skill-mariadb-disposable-certification\.mjs/u,
);

const resilientRunnerStart = disposableCertification.indexOf(
  "async function certifyProductionRecoveryResilient()",
);

const resilientRunnerEnd = disposableCertification.indexOf(
  "async function main()",
  resilientRunnerStart,
);

assert.ok(
  resilientRunnerStart >= 0 && resilientRunnerEnd > resilientRunnerStart,
  "disposable MariaDB runner must expose the Production Recovery resilient certification boundary",
);

const resilientRunner = disposableCertification.slice(
  resilientRunnerStart,
  resilientRunnerEnd,
);

assert.match(
  resilientRunner,
  /e2e-production-recovery-control-store-resilient\.mjs/u,
);

assert.match(
  resilientRunner,
  /production-recovery-control-store-resilient-certification\.mjs/u,
);

assert.match(
  resilientRunner,
  /"--disposable-ci"[\s\S]*?"127\.0\.0\.1"[\s\S]*?"3306"[\s\S]*?"brand_skill_cert_ci"[\s\S]*?"brand_skill_cert"[\s\S]*?"brand_skill_cert"/u,
);

assert.doesNotMatch(resilientRunner, /process\.env/u);
assert.doesNotMatch(resilientRunner, /RECOVERY_SERVER_MANAGED_BINDING_MODE/u);
assert.doesNotMatch(resilientRunner, /RECOVERY_SERVER_MANAGED_BINDING_MODULE/u);

assert.equal(workflow.includes("production-recovery-resilient-certification.yml"), false, "resilient certification must not add a new workflow surface");

for (const marker of [
  "Promise.all([",
  "reserveApproval(",
  "reserveExecutionTicket(",
  "finalizeExecutionTicket(",
  "claimExecution(",
  "appendEvidenceEvent(",
  "getRunByIdempotency(",
  "assertFence(",
  "setTimeout(resolve, 250)",
  "poolA.end()",
  "poolB.end()",
  "production_authorized: false",
  "production_database_connection_performed: false",
  "production_database_mutation_performed: false",
  "live_activation_performed: false",
  "secrets_included: false",
]) {
  assert.equal(certification.includes(marker), true, `resilient certification missing marker: ${marker}`);
}
assert.doesNotMatch(certification, /process\.env/u, "disposable resilient certification must not accept environment-selectable database targets");

assert.match(documentation, /resilient phase/iu);
assert.match(documentation, /disposable non-Production MariaDB/iu);
assert.match(documentation, /Production Recovery remains blocked/iu);

process.stdout.write(`${JSON.stringify({
  ok: true,
  contract: "mad4b.production-recovery-control-store-resilient-source-contract.v1",
  current_phase: declaration.current_phase,
  disposable_engine: "mariadb:11.4",
  reused_workflow_surface: workflowPath,
  concurrent_reservations_covered: true,
  fencing_takeover_covered: true,
  restart_durability_covered: true,
  replay_rejection_covered: true,
  ambiguous_outcome_retry_covered: true,
  production_authorized: false,
  production_database_connection_performed: false,
  production_database_mutation_performed: false,
  provider_mutation_performed: false,
  deployment_or_restart_executed: false,
  secrets_included: false,
}, null, 2)}\n`);
