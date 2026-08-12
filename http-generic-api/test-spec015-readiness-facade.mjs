import assert from "node:assert/strict";
import { buildSpec015ReadinessPreview } from "./spec015ReadinessFacade.js";
import { spec015DeterministicHash } from "./spec015ContractValidators.js";

const manifest = {
  tenant_id: "tenant-001",
  identity: { package_key: "retail-commerce", component_key: "catalog", version: "1.0.0", revision: 1 },
  dependencies: [{ key: "base", dependencies: [] }],
  bindings: [{ binding_key: "catalog.read", tenant_id: "tenant-001", credential_ref: "vault://catalog/read" }],
  publication: { state: "private" },
};

const hash = spec015DeterministicHash(manifest);
const ready = buildSpec015ReadinessPreview({
  manifest,
  expected_hash: hash,
  observed_hash: hash,
  ai_draft: { mode: "draft", proposal: { component_key: "catalog" }, budget_tokens: 1000, safety: { sensitivity: "low" } },
  ownership: [{ artifact_key: "catalog.manifest", owner_type: "client", tenant_id: "tenant-001", delegation_status: "active", external_delivery_allowed: true }],
  candidate: { head_sha: "a".repeat(40), canonical_paths: true, duplicate_identity_count: 0, stale_artifact_count: 0, spec016_exposure_verified: true },
});
assert.equal(ready.status, "ready");
assert.equal(ready.ready, true);
assert.deepEqual(ready.blocking_gaps, []);
assert.equal(ready.mutation_executed, false);
assert.equal(ready.provider_call_executed, false);
assert.equal(ready.database_mutation, false);
assert.equal(ready.secrets_included, false);

const blocked = buildSpec015ReadinessPreview({
  manifest,
  expected_hash: "0".repeat(64),
  observed_hash: "1".repeat(64),
  conflicts: ["revision-conflict"],
  stale: true,
  ai_draft: { mode: "execute", proposal: {}, budget_tokens: 1000, execute: true },
  ownership: [{ artifact_key: "catalog.manifest", owner_type: "client", tenant_id: "tenant-002", delegation_status: "revoked", external_delivery_allowed: true }],
  candidate: { head_sha: "invalid", canonical_paths: false, duplicate_identity_count: 1, stale_artifact_count: 1, spec016_exposure_verified: false },
});
assert.equal(blocked.status, "blocked");
assert.equal(blocked.ready, false);
assert.ok(blocked.blocking_gaps.includes("expected_hash_mismatch"));
assert.ok(blocked.blocking_gaps.includes("stale_evidence"));
assert.ok(blocked.blocking_gaps.includes("ai_mode_not_draft"));
assert.ok(blocked.blocking_gaps.includes("ownership_cross_tenant"));
assert.ok(blocked.blocking_gaps.includes("candidate_head_invalid"));
assert.equal(blocked.mutation_executed, false);
assert.equal(blocked.provider_call_executed, false);
assert.equal(blocked.database_mutation, false);
assert.equal(blocked.secrets_included, false);

console.log(JSON.stringify({
  ok: true,
  test: "spec015_readiness_facade",
  ready_status: ready.status,
  blocked_status: blocked.status,
  blocking_gap_count: blocked.blocking_gaps.length,
  mutation_executed: blocked.mutation_executed,
  provider_call_executed: blocked.provider_call_executed,
  database_mutation: blocked.database_mutation,
  secrets_included: blocked.secrets_included,
}));
