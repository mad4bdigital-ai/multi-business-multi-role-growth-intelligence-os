import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOperationGovernance,
  extractFunctionBlock,
  syncOperationGovernance,
} from "./scripts/frontend-operation-governance-generator.mjs";

const CANARY_OPERATIONS = [
  "POST /admin/container-authority/canary-closeouts",
  "POST /admin/container-authority/canary-promotions",
  "POST /admin/container-authority/canary-rollbacks",
].sort();

const EXPECTED_OPERATIONS = [
  "DELETE /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "PATCH /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  ...CANARY_OPERATIONS,
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
  "test-dynamic-container-canary-state-change-evidence.mjs",
  "test-dynamic-container-rollout-safety.mjs",
  "routes/connectRoutes.js",
  "tenantConnectBootstrapService.js",
  "tenantConnectBootstrapTransaction.js",
  "test-tenant-connect-bootstrap-transaction.mjs",
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
  candidate_count: 8,
  generated_rule_count: 8,
  rejected_candidate_count: 0,
});
assert.deepEqual(plan.operation_rules.map((rule) => rule.operation).sort(), EXPECTED_OPERATIONS);
assert(plan.source_authority.every((entry) => entry.present), "every generated decision must be checksum-bound to present evidence");
assert(plan.operation_rules.every((rule) => rule.classification === "state_change"));
assert(plan.operation_rules.every((rule) => rule.readback.mode === "transactional_readback" && rule.readback.before_commit === true));
assert(plan.operation_rules.every((rule) => rule.rollback.mode === "transaction"));
assert(plan.operation_rules.every((rule) => /^[a-f0-9]{64}$/.test(rule.generated_evidence.source_digest)));
for (const operation of CANARY_OPERATIONS) {
  const rule = plan.operation_rules.find((entry) => entry.operation === operation);
  assert(rule, `generated rule must exist for ${operation}`);
  assert(rule.evidence_refs.includes("test-dynamic-container-canary-state-change-evidence.mjs"));
  assert(rule.evidence_refs.includes("test-dynamic-container-rollout-safety.mjs"));
}
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
assert.equal(writeResult.plan.coverage.generated_rule_count, 8);
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
for (const operation of CANARY_OPERATIONS) {
  assert(rejection(noCanaryEnvelopePlan, operation).missing_evidence.includes("capability_envelope_preflight"));
}

const noCanaryTestFixture = createFixture();
replaceEvidence(
  noCanaryTestFixture,
  "test-dynamic-container-canary-state-change-evidence.mjs",
  "// frontend-surface-operation: POST /admin/container-authority/canary-closeouts",
  "// closeout operation claim removed for fail-closed regression"
);
const noCanaryTestPlan = buildOperationGovernance({ apiRoot: noCanaryTestFixture });
assert(
  rejection(noCanaryTestPlan, "POST /admin/container-authority/canary-closeouts")
    .missing_evidence.includes("registered_operation_test")
);

const noPromotionTestFixture = createFixture();
replaceEvidence(
  noPromotionTestFixture,
  "test-dynamic-container-canary-state-change-evidence.mjs",
  "// frontend-surface-operation: POST /admin/container-authority/canary-promotions",
  "// promotion operation claim removed for fail-closed regression"
);
const noPromotionTestPlan = buildOperationGovernance({ apiRoot: noPromotionTestFixture });
assert(
  rejection(noPromotionTestPlan, "POST /admin/container-authority/canary-promotions")
    .missing_evidence.includes("registered_operation_test")
);

const noCanaryBehaviorBindingFixture = createFixture();
replaceEvidence(
  noCanaryBehaviorBindingFixture,
  "test-dynamic-container-canary-state-change-evidence.mjs",
  'await import("./test-dynamic-container-rollout-safety.mjs");',
  "// behavioral test import removed"
);
const noCanaryBehaviorBindingPlan = buildOperationGovernance({ apiRoot: noCanaryBehaviorBindingFixture });
for (const operation of CANARY_OPERATIONS) {
  assert(rejection(noCanaryBehaviorBindingPlan, operation).missing_evidence.includes("behavioral_test_bound"));
}

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

console.log("generated frontend operation governance evidence tests passed");
