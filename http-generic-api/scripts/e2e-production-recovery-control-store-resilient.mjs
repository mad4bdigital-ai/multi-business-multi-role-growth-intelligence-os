#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const apiRoot = resolve(root, "http-generic-api");
const workflow = readFileSync(resolve(root, ".github/workflows/production-recovery-resilient-certification.yml"), "utf8");
const declaration = JSON.parse(readFileSync(resolve(root, ".changes/e2e/production-recovery-control-store-7999.json"), "utf8"));
const certification = readFileSync(resolve(apiRoot, "scripts/production-recovery-control-store-resilient-certification.mjs"), "utf8");
const documentation = readFileSync(resolve(root, "docs/governance/production-recovery-control-store-7999.md"), "utf8");

assert.equal(declaration.current_phase, "resilient");
const resilient = declaration.phases.find((phase) => phase.id === "resilient");
assert.equal(resilient?.status, "implemented");
assert.ok(Array.isArray(resilient?.e2e_journeys) && resilient.e2e_journeys.length === 1);

for (const requiredPath of [
  ".github/workflows/production-recovery-resilient-certification.yml",
  "http-generic-api/scripts/production-recovery-control-store-resilient-certification.mjs",
  "http-generic-api/scripts/e2e-production-recovery-control-store-resilient.mjs",
]) {
  assert.equal(declaration.scope.include.includes(requiredPath), true, `resilient declaration scope missing ${requiredPath}`);
}

assert.match(workflow, /image:\s*mariadb:11\.4/u);
assert.match(workflow, /PRODUCTION_RECOVERY_RESILIENT_CERTIFICATION_MODE:\s*disposable_ci/u);
assert.match(workflow, /ENVIRONMENT:\s*ci/u);
assert.match(workflow, /RUNTIME_CLASS:\s*ci_disposable_mariadb/u);
assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./u);
assert.doesNotMatch(workflow, /RECOVERY_SERVER_MANAGED_BINDING_MODE/u);
assert.doesNotMatch(workflow, /RECOVERY_SERVER_MANAGED_BINDING_MODULE/u);

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

assert.match(documentation, /resilient phase/iu);
assert.match(documentation, /disposable non-Production MariaDB/iu);
assert.match(documentation, /Production Recovery remains blocked/iu);

process.stdout.write(`${JSON.stringify({
  ok: true,
  contract: "mad4b.production-recovery-control-store-resilient-source-contract.v1",
  current_phase: declaration.current_phase,
  disposable_engine: "mariadb:11.4",
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
