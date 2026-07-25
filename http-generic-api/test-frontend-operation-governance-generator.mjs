import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOperationGovernance,
  extractFunctionBlock,
  syncOperationGovernance,
} from "./scripts/frontend-operation-governance-generator.mjs";

const EXPECTED_MUTATION_OPERATIONS = [
  "DELETE /admin/resources/{resourceKey}/{resourceId}",
  "DELETE /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "PATCH /admin/resources/{resourceKey}/{resourceId}",
  "PATCH /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "POST /admin/container-authority/canary-closeouts",
  "POST /admin/resources/{resourceKey}",
  "POST /admin/resources/{resourceKey}/{resourceId}/restore",
  "POST /connect/bootstrap",
  "POST /me/workspaces/{tenant_id}/resources/{resourceKey}",
  "POST /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/restore",
].sort();

const evidenceRegistry = JSON.parse(fs.readFileSync("frontend-operation-governance-tests.json", "utf8"));
const EXPECTED_READ_ACTION_OPERATIONS = evidenceRegistry.read_action_batches
  .flatMap((batch) => batch.operations.map((operation) => operation.operation))
  .sort();
const EXPECTED_EXTERNAL_EFFECT_OPERATIONS = evidenceRegistry.external_effect_batches
  .flatMap((batch) => batch.operations.map((operation) => operation.operation))
  .sort();
const EXPECTED_OPERATIONS = [
  ...EXPECTED_MUTATION_OPERATIONS,
  ...EXPECTED_READ_ACTION_OPERATIONS,
  ...EXPECTED_EXTERNAL_EFFECT_OPERATIONS,
].sort();

const EVIDENCE_FILES = [
  "scripts/frontend-operation-governance-generator.mjs",
  "frontend-operation-governance-tests.json",
  "scripts/test-manifest.mjs",
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
  ...evidenceRegistry.tests.map((entry) => entry.file),
  ...evidenceRegistry.read_action_batches.flatMap((batch) => [
    batch.source_file,
    batch.implementation_file,
    batch.test_file,
    ...batch.operations.flatMap((operation) => [operation.source_file, operation.implementation_file, operation.test_file]),
  ]),
  ...evidenceRegistry.external_effect_batches.flatMap((batch) => [
    batch.source_file,
    batch.implementation_file,
    batch.test_file,
    ...batch.operations.flatMap((operation) => [operation.source_file, operation.implementation_file, operation.test_file]),
  ]),
].filter(Boolean).filter((file, index, files) => files.indexOf(file) === index);

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
  candidate_count: EXPECTED_OPERATIONS.length,
  generated_rule_count: EXPECTED_OPERATIONS.length,
  rejected_candidate_count: 0,
});
assert.deepEqual(plan.operation_rules.map((rule) => rule.operation).sort(), EXPECTED_OPERATIONS);
assert(plan.source_authority.every((entry) => entry.present), "every generated decision must be checksum-bound to present evidence");
const mutationRules = plan.operation_rules.filter((rule) => rule.classification === "state_change");
const readActionRules = plan.operation_rules.filter((rule) => rule.classification === "read_action");
const externalEffectRules = plan.operation_rules.filter((rule) => rule.classification === "external_effect");
assert.deepEqual(mutationRules.map((rule) => rule.operation).sort(), EXPECTED_MUTATION_OPERATIONS);
assert.deepEqual(readActionRules.map((rule) => rule.operation).sort(), EXPECTED_READ_ACTION_OPERATIONS);
assert.deepEqual(externalEffectRules.map((rule) => rule.operation).sort(), EXPECTED_EXTERNAL_EFFECT_OPERATIONS);
assert(mutationRules.every((rule) => rule.readback.mode === "transactional_readback" && rule.readback.before_commit === true));
assert(mutationRules.every((rule) => rule.rollback.mode === "transaction"));
assert(readActionRules.every((rule) => !Object.hasOwn(rule, "preflight") && !Object.hasOwn(rule, "approval")));
assert(readActionRules.every((rule) => !Object.hasOwn(rule, "readback") && !Object.hasOwn(rule, "rollback") && !Object.hasOwn(rule, "parameter_bindings")));
assert(externalEffectRules.every((rule) => rule.readback.mode === "inline_provider_response" && rule.readback.same_cycle === true));
assert(externalEffectRules.every((rule) => rule.rollback.mode === "not_required" && rule.rollback.rationale));
assert(externalEffectRules.every((rule) => rule.preflight.mode && rule.approval.mode && Object.keys(rule.parameter_bindings).length));
assert(plan.operation_rules.every((rule) => /^[a-f0-9]{64}$/.test(rule.generated_evidence.source_digest)));
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
assert.equal(writeResult.plan.coverage.generated_rule_count, EXPECTED_OPERATIONS.length);
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
for (const operation of EXPECTED_MUTATION_OPERATIONS.filter((entry) => entry.includes("/resources/"))) {
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
for (const operation of EXPECTED_MUTATION_OPERATIONS.filter((entry) => entry.includes("/resources/"))) {
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

const noReadActionProofFixture = createFixture();
replaceEvidence(
  noReadActionProofFixture,
  "test-agent-governance-runtime.mjs",
  "// frontend-read-action-proof: POST /platform/agent-governance/response-profile/resolve",
  "// explicit read-action proof removed for fail-closed regression"
);
const noReadActionProofPlan = buildOperationGovernance({ apiRoot: noReadActionProofFixture });
assert(
  rejection(noReadActionProofPlan, "POST /platform/agent-governance/response-profile/resolve")
    .missing_evidence.includes("explicit_read_action_test_proof")
);

const readActionEffectFixture = createFixture();
replaceEvidence(
  readActionEffectFixture,
  "platformEngineRegistry.js",
  "return resolvePlatformEngineIntent(input);",
  "writePlatformEngineIntent(input);\n  return resolvePlatformEngineIntent(input);"
);
const readActionEffectPlan = buildOperationGovernance({ apiRoot: readActionEffectFixture });
assert(
  rejection(readActionEffectPlan, "POST /platform/engines/resolve-intent")
    .missing_evidence.includes("implementation_side_effect_free")
);

const readActionRouteDriftFixture = createFixture();
replaceEvidence(
  readActionRouteDriftFixture,
  "routes/platformEngineRoutes.js",
  "const result = resolvePlatformEngineTaskIntent(req.body || {});",
  "const result = resolvePlatformEngineIntentEvidenceRemoved(req.body || {});"
);
const readActionRouteDriftPlan = buildOperationGovernance({ apiRoot: readActionRouteDriftFixture });
assert(
  rejection(readActionRouteDriftPlan, "POST /platform/engines/resolve-intent")
    .missing_evidence.includes("route_binding_present")
);

const readActionManifestFixture = createFixture();
replaceEvidence(
  readActionManifestFixture,
  "scripts/test-manifest.mjs",
  '"node test-agent-governance-runtime.mjs"',
  '"node test-agent-governance-runtime-unregistered.mjs"'
);
const readActionManifestPlan = buildOperationGovernance({ apiRoot: readActionManifestFixture });
assert(
  rejection(readActionManifestPlan, "POST /platform/agent-governance/response-profile/resolve")
    .missing_evidence.includes("test_manifest_registered")
);

const noExternalEffectProofFixture = createFixture();
replaceEvidence(
  noExternalEffectProofFixture,
  "test-ai-resolvers.mjs",
  "// frontend-external-effect-proof: POST /ai/implementation-plan",
  "// explicit external-effect proof removed for fail-closed regression"
);
const noExternalEffectProofPlan = buildOperationGovernance({ apiRoot: noExternalEffectProofFixture });
assert(
  rejection(noExternalEffectProofPlan, "POST /ai/implementation-plan")
    .missing_evidence.includes("explicit_external_effect_test_proof")
);

const externalTargetWriteFixture = createFixture();
replaceEvidence(
  externalTargetWriteFixture,
  "services/planningResolver.js",
  "const payload = {",
  "writeProviderTarget();\n  const payload = {"
);
const externalTargetWritePlan = buildOperationGovernance({ apiRoot: externalTargetWriteFixture });
assert(
  rejection(externalTargetWritePlan, "POST /ai/implementation-plan")
    .missing_evidence.includes("target_write_absent")
);

const externalWriteDenialFixture = createFixture();
replaceEvidence(
  externalWriteDenialFixture,
  "operationOrchestrator.js",
  "provider_write_performed: false,",
  "provider_write_status_removed: true,"
);
const externalWriteDenialPlan = buildOperationGovernance({ apiRoot: externalWriteDenialFixture });
for (const operation of [
  "POST /admin/operations/ci-diagnose",
  "POST /tenant/operations/ci-diagnose",
]) {
  assert(
    rejection(externalWriteDenialPlan, operation)
      .missing_evidence.includes("target_write_denial_explicit")
  );
}

console.log("generated frontend operation governance evidence tests passed");
