import assert from "node:assert/strict";
import {
  spec015DeterministicHash,
  validateCandidateConvergence,
  validateCredentialFreeBindings,
  validateDependencyGraph,
  validateDraftAiSafety,
  validateLifecycleTransition,
  validateOwnershipManifest,
  validatePackageComponentIdentity,
  validatePublicationPolicy,
  validateReadinessPreview,
  validateSpec015Manifest,
} from "./spec015ContractValidators.js";

const identity = {
  package_key: "retail-commerce",
  component_key: "catalog",
  version: "1.0.0",
  revision: 1,
};

assert.equal(validatePackageComponentIdentity(identity).valid, true);
assert.equal(validatePackageComponentIdentity({ ...identity, package_key: "Retail Commerce" }).valid, false);
assert.equal(validatePackageComponentIdentity({ ...identity, api_token: "Bearer secret" }).valid, false);
assert.equal(validatePackageComponentIdentity({ ...identity, version: "1.0" }).valid, false);

const graph = [
  { key: "base", dependencies: [] },
  { key: "catalog", dependencies: ["base"] },
];
assert.equal(validateDependencyGraph(graph).valid, true);
assert.deepEqual(validateDependencyGraph(graph).canonical_order, ["base", "catalog"]);
assert.equal(validateDependencyGraph([{ key: "a", dependencies: ["missing"] }]).valid, false);
assert.equal(validateDependencyGraph([{ key: "a", dependencies: ["b"] }, { key: "b", dependencies: ["a"] }]).valid, false);
assert.equal(validateDependencyGraph([{ key: "a", dependencies: [] }, { key: "a", dependencies: [] }]).valid, false);

assert.equal(validateCredentialFreeBindings([
  { binding_key: "catalog.read", tenant_id: "tenant-001", credential_ref: "vault://catalog/read" },
], { tenantId: "tenant-001" }).valid, true);
assert.equal(validateCredentialFreeBindings([
  { binding_key: "catalog.read", tenant_id: "tenant-002" },
], { tenantId: "tenant-001" }).valid, false);
assert.equal(validateCredentialFreeBindings([
  { binding_key: "catalog.read", tenant_id: "tenant-001", access_token: "raw-secret" },
], { tenantId: "tenant-001" }).valid, false);

assert.equal(validatePublicationPolicy({ state: "private" }).valid, true);
assert.equal(validatePublicationPolicy({ state: "tenant", target_tenant_id: "tenant-001" }).valid, true);
assert.equal(validatePublicationPolicy({ state: "tenant" }).valid, false);
assert.equal(validatePublicationPolicy({ state: "unknown" }).valid, false);

const manifest = {
  tenant_id: "tenant-001",
  identity,
  dependencies: graph,
  bindings: [{ binding_key: "catalog.read", tenant_id: "tenant-001", credential_ref: "vault://catalog/read" }],
  publication: { state: "private" },
};
const validManifest = validateSpec015Manifest(manifest);
assert.equal(validManifest.valid, true);
assert.match(validManifest.deterministic_hash, /^[a-f0-9]{64}$/);
assert.equal(validManifest.mutation_executed, false);
assert.equal(validManifest.provider_call_executed, false);
assert.equal(validManifest.database_mutation, false);
assert.equal(validManifest.secrets_included, false);
assert.equal(spec015DeterministicHash({ b: 2, a: 1 }), spec015DeterministicHash({ a: 1, b: 2 }));
assert.notEqual(spec015DeterministicHash({ a: 1 }), spec015DeterministicHash({ a: 2 }));

const invalidManifest = validateSpec015Manifest({
  ...manifest,
  bindings: [{ binding_key: "catalog.read", tenant_id: "tenant-002", password: "should-reject" }],
  dependencies: [{ key: "catalog", dependencies: ["catalog"] }],
});
assert.equal(invalidManifest.valid, false);
assert.ok(invalidManifest.errors.some((error) => error.code === "cross_tenant_binding"));
assert.ok(invalidManifest.errors.some((error) => error.code === "secret_key_detected"));
assert.ok(invalidManifest.errors.some((error) => error.code === "graph_cycle"));

const readiness = validateReadinessPreview({
  manifest,
  expected_hash: validManifest.deterministic_hash,
  observed_hash: validManifest.deterministic_hash,
});
assert.equal(readiness.valid, true);
assert.equal(validateReadinessPreview({ manifest, expected_hash: validManifest.deterministic_hash, stale: true }).valid, false);
assert.equal(validateReadinessPreview({ manifest, expected_hash: "0".repeat(64) }).valid, false);

assert.equal(validateLifecycleTransition("planned", "installing").valid, true);
assert.equal(validateLifecycleTransition("active", "retired").valid, false);
assert.equal(validateLifecycleTransition("active", "uninstall_requested", { revocation: true }).valid, true);
assert.equal(validateLifecycleTransition("active", "configuration").valid, false);

const safeAiDraft = validateDraftAiSafety({
  mode: "draft",
  proposal: { component_key: "catalog" },
  budget_tokens: 1200,
  safety: { sensitivity: "low", prompt_injection_detected: false },
});
assert.equal(safeAiDraft.valid, true);
assert.equal(validateDraftAiSafety({ ...safeAiDraft, mode: "execute" }).valid, false);
assert.equal(validateDraftAiSafety({ mode: "draft", proposal: {}, budget_tokens: 1200, execute: true }).valid, false);
assert.equal(validateDraftAiSafety({ mode: "draft", proposal: {}, budget_tokens: 1200, safety: { prompt_injection_detected: true } }).valid, false);
assert.equal(validateDraftAiSafety({ mode: "draft", proposal: {}, budget_tokens: 1200, safety: { sensitivity: "high" } }).valid, false);

assert.equal(validateOwnershipManifest([
  { artifact_key: "catalog.manifest", owner_type: "client", tenant_id: "tenant-001", delegation_status: "active", external_delivery_allowed: true },
], { tenantId: "tenant-001" }).valid, true);
assert.equal(validateOwnershipManifest([
  { artifact_key: "catalog.manifest", owner_type: "client", tenant_id: "tenant-002" },
], { tenantId: "tenant-001" }).valid, false);
assert.equal(validateOwnershipManifest([
  { artifact_key: "catalog.manifest", owner_type: "client", tenant_id: "tenant-001", delegation_status: "revoked", external_delivery_allowed: true },
], { tenantId: "tenant-001" }).valid, false);

assert.equal(validateCandidateConvergence({
  head_sha: "a".repeat(40),
  canonical_paths: true,
  duplicate_identity_count: 0,
  stale_artifact_count: 0,
  spec016_exposure_verified: true,
}).valid, true);
assert.equal(validateCandidateConvergence({
  head_sha: "a".repeat(40),
  canonical_paths: true,
  duplicate_identity_count: 1,
  stale_artifact_count: 0,
  spec016_exposure_verified: true,
}).valid, false);

console.log(JSON.stringify({
  ok: true,
  test: "spec015_contract_validators",
  positive_manifest: validManifest.valid,
  negative_errors: invalidManifest.errors.map((error) => error.code).sort(),
  deterministic_hash: validManifest.deterministic_hash,
  mutation_executed: validManifest.mutation_executed,
  provider_call_executed: validManifest.provider_call_executed,
  database_mutation: validManifest.database_mutation,
  secrets_included: validManifest.secrets_included,
}));
