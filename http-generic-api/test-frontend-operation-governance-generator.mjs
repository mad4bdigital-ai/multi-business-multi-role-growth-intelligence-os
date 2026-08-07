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
const BRAND_OPERATION = "POST /me/workspaces/{tenant_id}/brands";
const MATERIALIZE_OPERATION = "POST /me/workspaces/{tenant_id}/assets/materialize-brand-core";
const EXPECTED_OPERATIONS = [
  "DELETE /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "PATCH /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "POST /admin/container-authority/canary-closeouts",
  "POST /admin/container-authority/canary-promotions",
  "POST /admin/container-authority/canary-rollbacks",
  LEASE_OPERATION,
  "POST /connect/bootstrap",
  BRAND_OPERATION,
  MATERIALIZE_OPERATION,
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
  "routes/workspaceResourceRoutes.js",
  "workspaceBrandLifecycle.js",
  "test-workspace-brand-create-operation-governance.mjs",
  "routes/brandCoreAssetMaterializationRoutes.js",
  "workspaceBrandCoreAssetMaterialization.js",
  "migrations/1050_workspace_asset_provenance_content_identity.sql",
  "test-brand-core-asset-materialization-operation-governance.mjs",
];

function createFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-operation-governance-materialization-extension-"));
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
  candidate_count: 11,
  generated_rule_count: 11,
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
assert.deepEqual(leaseRule.rollback, { mode: "transaction", on: ["mutation_failure", "readback_failure"] });
assert.equal(leaseRule.parameter_bindings.lease_id, "response.lease.lease_id");
assert.match(leaseRule.generated_evidence.source_digest, /^[a-f0-9]{64}$/);

const brandRule = plan.operation_rules.find((rule) => rule.operation === BRAND_OPERATION);
assert(brandRule, "Brand Create operation must have a generated rule");
assert.equal(brandRule.rule_id, "generated-workspace-brand-create-governance");
assert.equal(brandRule.classification, "state_change");
assert.equal(brandRule.preflight.mode, "locked_workspace_owner_authority_and_canonical_identity");
assert.equal(brandRule.approval.mode, "runtime_authorization");
assert.equal(brandRule.readback.before_commit, true);
assert.equal(brandRule.parameter_bindings.brand_target_key, "response.brand.target_key");
assert.match(brandRule.generated_evidence.source_digest, /^[a-f0-9]{64}$/);

const materializeRule = plan.operation_rules.find((rule) => rule.operation === MATERIALIZE_OPERATION);
assert(materializeRule, "Brand Core materialization must have a generated rule");
assert.equal(materializeRule.rule_id, "generated-workspace-brand-core-asset-materialize-governance");
assert.equal(materializeRule.classification, "state_change");
assert.equal(materializeRule.owner, "workspace-platform");
assert.equal(materializeRule.preflight.mode, "canonical_user_jwt_brand_authority_and_provenance_schema");
assert.equal(materializeRule.approval.mode, "runtime_authorization");
assert.equal(materializeRule.readback.mode, "transactional_readback");
assert.equal(materializeRule.readback.before_commit, true);
assert.equal(materializeRule.rollback.mode, "transaction");
assert.equal(materializeRule.parameter_bindings.asset_id, "response.asset.asset_id");
assert.equal(materializeRule.parameter_bindings.provenance_sha256, "response.asset.provenance_sha256");
assert(materializeRule.evidence_refs.includes("migrations/1050_workspace_asset_provenance_content_identity.sql"));
assert(materializeRule.evidence_refs.includes("test-brand-core-asset-materialization-operation-governance.mjs"));
assert.match(materializeRule.generated_evidence.source_digest, /^[a-f0-9]{64}$/);

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
assert.equal(writeResult.plan.coverage.generated_rule_count, 11);
const checkResult = syncOperationGovernance({ apiRoot: deterministicFixture, mode: "check" });
assert.equal(checkResult.ok, true);
assert.equal(checkResult.drift, false);
fs.appendFileSync(path.join(deterministicFixture, "workspaceBrandCoreAssetMaterialization.js"), "\n// materialization evidence drift\n");
const driftResult = syncOperationGovernance({ apiRoot: deterministicFixture, mode: "check" });
assert.equal(driftResult.ok, false, "Brand Core materialization source drift must invalidate committed generated governance");

const noLeaseApplyFixture = createFixture();
replaceEvidence(noLeaseApplyFixture, "repositoryReconciliationLeaseControl.js", "resolved.apply_allowed !== true", "resolved.applyEvidenceRemoved !== true");
const noLeaseApplyPlan = buildOperationGovernance({ apiRoot: noLeaseApplyFixture });
assert(rejection(noLeaseApplyPlan, LEASE_OPERATION).missing_evidence.includes("capability_envelope_apply_authorization"));

const noBrandOwnerFixture = createFixture();
replaceEvidence(noBrandOwnerFixture, "workspaceBrandLifecycle.js", "OWNER_ROLES.has", "ownerRoleEvidenceRemoved");
const noBrandOwnerPlan = buildOperationGovernance({ apiRoot: noBrandOwnerFixture });
assert(rejection(noBrandOwnerPlan, BRAND_OPERATION).missing_evidence.includes("locked_owner_authority"));

const noMaterializeSchemaFixture = createFixture();
replaceEvidence(
  noMaterializeSchemaFixture,
  "migrations/1050_workspace_asset_provenance_content_identity.sql",
  "v_workspace_asset_provenance_schema_readiness",
  "workspace_asset_provenance_schema_readiness_removed"
);
const noMaterializeSchemaPlan = buildOperationGovernance({ apiRoot: noMaterializeSchemaFixture });
assert(rejection(noMaterializeSchemaPlan, MATERIALIZE_OPERATION).missing_evidence.includes("migration_contract"));

const noMaterializeReadbackFixture = createFixture();
replaceEvidence(
  noMaterializeReadbackFixture,
  "workspaceBrandCoreAssetMaterialization.js",
  "brand_core_asset_materialize_readback_mismatch",
  "materializeReadbackEvidenceRemoved"
);
const noMaterializeReadbackPlan = buildOperationGovernance({ apiRoot: noMaterializeReadbackFixture });
assert(rejection(noMaterializeReadbackPlan, MATERIALIZE_OPERATION).missing_evidence.includes("transactional_readback"));

const noMaterializeTestFixture = createFixture();
replaceEvidence(
  noMaterializeTestFixture,
  "test-brand-core-asset-materialization-operation-governance.mjs",
  `// frontend-surface-operation: ${MATERIALIZE_OPERATION}`,
  "// materialization operation claim removed"
);
const noMaterializeTestPlan = buildOperationGovernance({ apiRoot: noMaterializeTestFixture });
assert(rejection(noMaterializeTestPlan, MATERIALIZE_OPERATION).missing_evidence.includes("registered_operation_test"));

const noMaterializeRegistrationFixture = createFixture();
replaceEvidence(
  noMaterializeRegistrationFixture,
  "frontend-operation-governance-tests.json",
  '"file": "test-brand-core-asset-materialization-operation-governance.mjs"',
  '"file": "test-unregistered-brand-core-asset-materialization-operation-governance.mjs"'
);
const noMaterializeRegistrationPlan = buildOperationGovernance({ apiRoot: noMaterializeRegistrationFixture });
assert(rejection(noMaterializeRegistrationPlan, MATERIALIZE_OPERATION).missing_evidence.includes("registered_operation_test"));

console.log("generated frontend operation governance Lease + Brand Create + Brand Core materialization extension tests passed");
