import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOperationGovernance,
  extractFunctionBlock,
  syncOperationGovernance,
} from "./scripts/frontend-operation-governance-generator.mjs";

const LEASE_OPERATION = "POST /admin/repository-automation/reconciliation-lease";
const EXPECTED_OPERATIONS = [
  "DELETE /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "PATCH /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "POST /admin/container-authority/canary-closeouts",
  LEASE_OPERATION,
  "POST /connect/bootstrap",
  "POST /me/workspaces/{tenant_id}/resources/{resourceKey}",
  "POST /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/restore",
].sort();

const EVIDENCE_FILES = [
  "scripts/frontend-operation-governance-generator.mjs",
  "frontend-operation-governance-tests.json",
  "routes/resourceApiRoutes.js",
  "src/application/resourceApi/resourceApiService.js",
  "src/infrastructure/resourceApi/resourceRepository.js",
  "test-resource-api-service.mjs",
  "routes/dynamicContainerAuthorityRoutes.js",
  "dynamicContainerRolloutSafety.js",
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
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-operation-governance-"));
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

const serviceSource = fs.readFileSync("src/application/resourceApi/resourceApiService.js", "utf8");
assert.match(extractFunctionBlock(serviceSource, "tenantCreateResource"), /withMutationTransaction/);
assert.equal(extractFunctionBlock(serviceSource, "missingFunction"), "");

const plan = buildOperationGovernance();
assert.equal(plan.schema_version, "frontend-operation-governance-v1");
assert.deepEqual(plan.coverage, {
  candidate_count: 7,
  generated_rule_count: 7,
  rejected_candidate_count: 0,
});
assert.deepEqual(plan.operation_rules.map((rule) => rule.operation).sort(), EXPECTED_OPERATIONS);
assert(plan.source_authority.every((entry) => entry.present), "every generated decision must be checksum-bound to present evidence");
assert(plan.operation_rules.every((rule) => rule.classification === "state_change"));
assert(plan.operation_rules.every((rule) => rule.readback.mode === "transactional_readback" && rule.readback.before_commit === true));
assert(plan.operation_rules.every((rule) => rule.rollback.mode === "transaction"));
assert(plan.operation_rules.every((rule) => /^[a-f0-9]{64}$/.test(rule.generated_evidence.source_digest)));
const leaseRule = plan.operation_rules.find((rule) => rule.operation === LEASE_OPERATION);
assert.equal(leaseRule.rule_id, "generated-repository-reconciliation-lease-control-governance");
assert.equal(leaseRule.preflight.mode, "capability_envelope_resource_and_fingerprint_binding");
assert.equal(leaseRule.approval.mode, "runtime_authorization_and_typed_confirmation");
assert.equal(leaseRule.parameter_bindings.lease_id, "response.lease.lease_id");
assert.deepEqual(leaseRule.evidence_refs, [
  "routes/repositoryAutomationRoutes.js",
  "repositoryReconciliationLeaseControl.js",
  "repositoryOperationLeaseService.js",
  "test-repository-reconciliation-lease-control.mjs",
]);
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
assert.equal(writeResult.plan.coverage.generated_rule_count, 7);
const checkResult = syncOperationGovernance({ apiRoot: deterministicFixture, mode: "check" });
assert.equal(checkResult.ok, true);
assert.equal(checkResult.drift, false);
fs.appendFileSync(path.join(deterministicFixture, "src/application/resourceApi/resourceApiService.js"), "\n// evidence drift\n");
const driftResult = syncOperationGovernance({ apiRoot: deterministicFixture, mode: "check" });
assert.equal(driftResult.ok, false, "source drift must invalidate committed generated governance");
assert.notEqual(driftResult.plan.generator.source_digest, checkResult.plan.generator.source_digest);

const noRollbackFixture = createFixture();
replaceEvidence(
  noRollbackFixture,
  "src/infrastructure/resourceApi/resourceRepository.js",
  "connection.rollback",
  "connection.noRollbackEvidence"
);
const noRollbackPlan = buildOperationGovernance({ apiRoot: noRollbackFixture });
for (const operation of EXPECTED_OPERATIONS.filter((entry) => entry.includes("/me/workspaces/"))) {
  assert(rejection(noRollbackPlan, operation).missing_evidence.includes("repository_verified_rollback"));
}

const noReadbackFixture = createFixture();
replaceEvidence(
  noReadbackFixture,
  "src/application/resourceApi/resourceApiService.js",
  "transactionRepository.getResource",
  "transactionRepository.readbackEvidenceRemoved"
);
const noReadbackPlan = buildOperationGovernance({ apiRoot: noReadbackFixture });
for (const operation of EXPECTED_OPERATIONS.filter((entry) => entry.includes("/me/workspaces/"))) {
  assert(rejection(noReadbackPlan, operation).missing_evidence.includes("readback_follows_mutation"));
}

const noCanaryEnvelopeFixture = createFixture();
replaceEvidence(
  noCanaryEnvelopeFixture,
  "dynamicContainerRolloutSafety.js",
  "envelope.apply_allowed",
  "envelope.applyEvidenceRemoved"
);
const noCanaryEnvelopePlan = buildOperationGovernance({ apiRoot: noCanaryEnvelopeFixture });
assert(
  rejection(noCanaryEnvelopePlan, "POST /admin/container-authority/canary-closeouts")
    .missing_evidence.includes("capability_envelope_preflight")
);

const noCanaryTestFixture = createFixture();
replaceEvidence(
  noCanaryTestFixture,
  "test-dynamic-container-rollout-safety.mjs",
  "// frontend-surface-operation: POST /admin/container-authority/canary-closeouts",
  "// operation claim removed for fail-closed regression"
);
const noCanaryTestPlan = buildOperationGovernance({ apiRoot: noCanaryTestFixture });
assert(
  rejection(noCanaryTestPlan, "POST /admin/container-authority/canary-closeouts")
    .missing_evidence.includes("registered_operation_test")
);

const noBootstrapRollbackFixture = createFixture();
replaceEvidence(
  noBootstrapRollbackFixture,
  "tenantConnectBootstrapTransaction.js",
  "transaction.rollback",
  "transactionRollbackEvidenceRemoved"
);
const noBootstrapRollbackPlan = buildOperationGovernance({ apiRoot: noBootstrapRollbackFixture });
assert(
  rejection(noBootstrapRollbackPlan, "POST /connect/bootstrap")
    .missing_evidence.includes("verified_rollback")
);

const noBootstrapReadbackFixture = createFixture();
replaceEvidence(
  noBootstrapReadbackFixture,
  "tenantConnectBootstrapTransaction.js",
  "const [readbackMembershipRows]",
  "const [readbackMembershipEvidenceRemoved]"
);
const noBootstrapReadbackPlan = buildOperationGovernance({ apiRoot: noBootstrapReadbackFixture });
assert(
  rejection(noBootstrapReadbackPlan, "POST /connect/bootstrap")
    .missing_evidence.includes("transactional_readback_follows_mutation")
);

const noBootstrapTestFixture = createFixture();
replaceEvidence(
  noBootstrapTestFixture,
  "test-tenant-connect-bootstrap-transaction.mjs",
  "// frontend-surface-operation: POST /connect/bootstrap",
  "// operation claim removed for fail-closed regression"
);
const noBootstrapTestPlan = buildOperationGovernance({ apiRoot: noBootstrapTestFixture });
assert(
  rejection(noBootstrapTestPlan, "POST /connect/bootstrap")
    .missing_evidence.includes("registered_operation_test")
);

const noBootstrapRegistrationFixture = createFixture();
replaceEvidence(
  noBootstrapRegistrationFixture,
  "frontend-operation-governance-tests.json",
  '"file": "test-tenant-connect-bootstrap-transaction.mjs"',
  '"file": "test-unregistered-bootstrap-transaction.mjs"'
);
const noBootstrapRegistrationPlan = buildOperationGovernance({ apiRoot: noBootstrapRegistrationFixture });
assert(
  rejection(noBootstrapRegistrationPlan, "POST /connect/bootstrap")
    .missing_evidence.includes("registered_operation_test")
);

const noLeaseApplyFixture = createFixture();
replaceEvidence(
  noLeaseApplyFixture,
  "repositoryReconciliationLeaseControl.js",
  "resolved.apply_allowed !== true",
  "resolved.applyEvidenceRemoved !== true"
);
const noLeaseApplyPlan = buildOperationGovernance({ apiRoot: noLeaseApplyFixture });
assert(
  rejection(noLeaseApplyPlan, LEASE_OPERATION)
    .missing_evidence.includes("capability_envelope_apply_authorization")
);

const noLeaseConfirmationFixture = createFixture();
replaceEvidence(
  noLeaseConfirmationFixture,
  "repositoryReconciliationLeaseControl.js",
  "assertTypedConfirmation(action, args.confirm)",
  "typedConfirmationEvidenceRemoved(action, args.confirm)"
);
const noLeaseConfirmationPlan = buildOperationGovernance({ apiRoot: noLeaseConfirmationFixture });
assert(
  rejection(noLeaseConfirmationPlan, LEASE_OPERATION)
    .missing_evidence.includes("typed_confirmation")
);

const noLeaseReadbackFixture = createFixture();
replaceEvidence(
  noLeaseReadbackFixture,
  "repositoryOperationLeaseService.js",
  "const released = await readLeaseById(connection, leaseId)",
  "const released = await releaseReadbackEvidenceRemoved(connection, leaseId)"
);
const noLeaseReadbackPlan = buildOperationGovernance({ apiRoot: noLeaseReadbackFixture });
assert(
  rejection(noLeaseReadbackPlan, LEASE_OPERATION)
    .missing_evidence.includes("release_transactional_readback")
);

const noLeaseTestFixture = createFixture();
replaceEvidence(
  noLeaseTestFixture,
  "test-repository-reconciliation-lease-control.mjs",
  `// frontend-surface-operation: ${LEASE_OPERATION}`,
  "// operation claim removed for fail-closed regression"
);
const noLeaseTestPlan = buildOperationGovernance({ apiRoot: noLeaseTestFixture });
assert(
  rejection(noLeaseTestPlan, LEASE_OPERATION)
    .missing_evidence.includes("registered_operation_test")
);

const noLeaseRegistrationFixture = createFixture();
replaceEvidence(
  noLeaseRegistrationFixture,
  "frontend-operation-governance-tests.json",
  '"file": "test-repository-reconciliation-lease-control.mjs"',
  '"file": "test-unregistered-repository-reconciliation-lease-control.mjs"'
);
const noLeaseRegistrationPlan = buildOperationGovernance({ apiRoot: noLeaseRegistrationFixture });
assert(
  rejection(noLeaseRegistrationPlan, LEASE_OPERATION)
    .missing_evidence.includes("registered_operation_test")
);

console.log("generated frontend operation governance evidence tests passed");
