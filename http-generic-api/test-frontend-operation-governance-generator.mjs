// frontend-surface-operation: POST /admin/container-authority/canary-promotions
// frontend-state-change-proof: POST /admin/container-authority/canary-promotions
// frontend-surface-operation: POST /admin/container-authority/canary-rollbacks
// frontend-state-change-proof: POST /admin/container-authority/canary-rollbacks
// frontend-surface-operation: POST /admin/container-authority/canary-closeouts
// frontend-state-change-proof: POST /admin/container-authority/canary-closeouts

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

await import("./test-dynamic-container-rollout-safety.mjs");

process.env.FRONTEND_OPERATION_GOVERNANCE_BASE_TEST = "1";
try {
  await import("./test-frontend-operation-governance-base.mjs");
} finally {
  delete process.env.FRONTEND_OPERATION_GOVERNANCE_BASE_TEST;
}

const {
  buildOperationGovernance,
  syncOperationGovernance,
} = await import("./scripts/frontend-operation-governance-generator.mjs");

const LEASE_OPERATION = "POST /admin/repository-automation/reconciliation-lease";
const EXPECTED_OPERATIONS = [
  "DELETE /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "PATCH /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "POST /admin/container-authority/canary-closeouts",
  "POST /admin/container-authority/canary-promotions",
  "POST /admin/container-authority/canary-rollbacks",
  LEASE_OPERATION,
  "POST /connect/bootstrap",
  "POST /me/workspaces/{tenant_id}/resources/{resourceKey}",
  "POST /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/restore",
].sort();

const EVIDENCE_FILES = [
  "scripts/frontend-operation-governance-generator.mjs",
  "scripts/frontend-operation-governance-base.mjs",
  "scripts/test-manifest.mjs",
  "frontend-operation-governance-tests.json",
  "routes/resourceApiRoutes.js",
  "src/application/resourceApi/resourceApiService.js",
  "src/infrastructure/resourceApi/resourceRepository.js",
  "test-resource-api-service.mjs",
  "routes/dynamicContainerAuthorityRoutes.js",
  "dynamicContainerRolloutSafety.js",
  "test-frontend-operation-governance-generator.mjs",
  "test-frontend-operation-governance-base.mjs",
  "test-dynamic-container-rollout-safety.mjs",
  "routes/connectRoutes.js",
  "tenantConnectBootstrapService.js",
  "tenantConnectBootstrapTransaction.js",
  "test-tenant-connect-bootstrap-transaction.mjs",
  "routes/repositoryAutomationRoutes.js",
  "repositoryReconciliationLeaseControl.js",
  "repositoryOperationLeaseService.js",
  "test-repository-reconciliation-lease-control.mjs",
];

function createFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-operation-governance-lease-extension-"));
  for (const relativeFile of EVIDENCE_FILES) {
    const target = path.join(fixture, relativeFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(relativeFile), target);
  }
  return fixture;
}

function replaceEvidence(fixture, relativeFile, needle, replacement) {
  const target = path.join(fixture, relativeFile);
  const source = fs.readFileSync(target, "utf8");
  assert(source.includes(needle), `fixture evidence must contain ${needle}`);
  fs.writeFileSync(target, source.replaceAll(needle, replacement));
}

function rejection(plan, operation) {
  return plan.rejected_candidates.find((candidate) => candidate.operation === operation);
}

const plan = buildOperationGovernance();
if (plan.rejected_candidates.length) {
  console.error("frontend operation governance rejected candidates:");
  console.error(JSON.stringify(plan.rejected_candidates, null, 2));
}
assert.equal(plan.schema_version, "frontend-operation-governance-v1");
assert.deepEqual(plan.coverage, {
  candidate_count: 9,
  generated_rule_count: 9,
  rejected_candidate_count: 0,
});
assert.deepEqual(plan.operation_rules.map((rule) => rule.operation).sort(), EXPECTED_OPERATIONS);
assert(plan.source_authority.every((entry) => entry.present), "every generated decision must be checksum-bound to present evidence");
assert(plan.source_authority.some((entry) => entry.file === "scripts/frontend-operation-governance-base.mjs"));
assert(plan.source_authority.some((entry) => entry.file === "scripts/frontend-operation-governance-generator.mjs"));

const leaseRule = plan.operation_rules.find((rule) => rule.operation === LEASE_OPERATION);
assert(leaseRule, "Lease operation must have a generated rule");
assert.equal(leaseRule.rule_id, "generated-repository-reconciliation-lease-control-governance");
assert.equal(leaseRule.classification, "state_change");
assert.equal(leaseRule.preflight.mode, "capability_envelope_resource_and_fingerprint_binding");
assert.equal(leaseRule.approval.mode, "runtime_authorization_and_typed_confirmation");
assert.equal(leaseRule.readback.mode, "transactional_readback");
assert.equal(leaseRule.readback.same_cycle, true);
assert.equal(leaseRule.readback.before_commit, true);
assert.deepEqual(leaseRule.rollback, {
  mode: "transaction",
  on: ["mutation_failure", "readback_failure"],
});
assert.equal(leaseRule.parameter_bindings.lease_id, "response.lease.lease_id");
assert.deepEqual(leaseRule.evidence_refs, [
  "routes/repositoryAutomationRoutes.js",
  "repositoryReconciliationLeaseControl.js",
  "repositoryOperationLeaseService.js",
  "test-repository-reconciliation-lease-control.mjs",
]);
assert.match(leaseRule.generated_evidence.source_digest, /^[a-f0-9]{64}$/);
assert.deepEqual(plan.safety, {
  writes_runtime_source: false,
  writes_database: false,
  executes_provider_calls: false,
  deploys: false,
  secrets_included: false,
});

const deterministicFixture = createFixture();
const writeResult = syncOperationGovernance({ apiRoot: deterministicFixture, mode: "write" });
assert.equal(writeResult.ok, true);
assert.equal(writeResult.plan.coverage.generated_rule_count, 9);
const checkResult = syncOperationGovernance({ apiRoot: deterministicFixture, mode: "check" });
assert.equal(checkResult.ok, true);
assert.equal(checkResult.drift, false);
fs.appendFileSync(path.join(deterministicFixture, "repositoryReconciliationLeaseControl.js"), "\n// lease evidence drift\n");
const driftResult = syncOperationGovernance({ apiRoot: deterministicFixture, mode: "check" });
assert.equal(driftResult.ok, false, "Lease source drift must invalidate committed generated governance");

const noLeaseApplyFixture = createFixture();
replaceEvidence(
  noLeaseApplyFixture,
  "repositoryReconciliationLeaseControl.js",
  "resolved.apply_allowed !== true",
  "resolved.applyEvidenceRemoved !== true"
);
const noLeaseApplyPlan = buildOperationGovernance({ apiRoot: noLeaseApplyFixture });
assert(rejection(noLeaseApplyPlan, LEASE_OPERATION).missing_evidence.includes("capability_envelope_apply_authorization"));

const noLeaseConfirmationFixture = createFixture();
replaceEvidence(
  noLeaseConfirmationFixture,
  "repositoryReconciliationLeaseControl.js",
  "assertTypedConfirmation(action, args.confirm)",
  "typedConfirmationEvidenceRemoved(action, args.confirm)"
);
const noLeaseConfirmationPlan = buildOperationGovernance({ apiRoot: noLeaseConfirmationFixture });
assert(rejection(noLeaseConfirmationPlan, LEASE_OPERATION).missing_evidence.includes("typed_confirmation"));

const noLeaseReadbackFixture = createFixture();
replaceEvidence(
  noLeaseReadbackFixture,
  "repositoryOperationLeaseService.js",
  "const released = await readLeaseById(connection, leaseId)",
  "const released = await releaseReadbackEvidenceRemoved(connection, leaseId)"
);
const noLeaseReadbackPlan = buildOperationGovernance({ apiRoot: noLeaseReadbackFixture });
assert(rejection(noLeaseReadbackPlan, LEASE_OPERATION).missing_evidence.includes("release_transactional_readback"));

const noLeaseTestFixture = createFixture();
replaceEvidence(
  noLeaseTestFixture,
  "test-repository-reconciliation-lease-control.mjs",
  `// frontend-surface-operation: ${LEASE_OPERATION}`,
  "// operation claim removed for fail-closed regression"
);
const noLeaseTestPlan = buildOperationGovernance({ apiRoot: noLeaseTestFixture });
assert(rejection(noLeaseTestPlan, LEASE_OPERATION).missing_evidence.includes("registered_operation_test"));

const noLeaseRegistrationFixture = createFixture();
replaceEvidence(
  noLeaseRegistrationFixture,
  "frontend-operation-governance-tests.json",
  '"file": "test-repository-reconciliation-lease-control.mjs"',
  '"file": "test-unregistered-repository-reconciliation-lease-control.mjs"'
);
const noLeaseRegistrationPlan = buildOperationGovernance({ apiRoot: noLeaseRegistrationFixture });
assert(rejection(noLeaseRegistrationPlan, LEASE_OPERATION).missing_evidence.includes("registered_operation_test"));

console.log("generated frontend operation governance Lease extension tests passed");
