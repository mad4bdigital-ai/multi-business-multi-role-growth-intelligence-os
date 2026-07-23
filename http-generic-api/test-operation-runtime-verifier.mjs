import assert from "node:assert/strict";
import { stableOperationHash } from "./operationRegistryContracts.js";
import { verifyOperationRuntimeReadiness } from "./operationRuntimeVerifier.js";

function compiledManifest(overrides = {}) {
  const core = {
    schema_version: "operation-binding-manifest-v1",
    compiler_version: "operation-binding-compiler-v1",
    compiled_at: "2026-07-23T04:00:00.000Z",
    compile_mode: "active",
    operation: {
      operation_key: "repo.change.preview",
      version: 1,
      revision_hash: "a".repeat(64),
      operation_class: "repository",
      risk_level: "medium"
    },
    scope_fingerprint: "b".repeat(64),
    source_revision_hash: "c".repeat(64),
    selected_binding: {
      binding_id: "11111111-1111-4111-8111-111111111111",
      binding_key: "binding.resource.github",
      binding_scope_type: "resource",
      scope_ref_hash: "d".repeat(64),
      provider_family: "github",
      effect_class: "repository_read",
      adapter_key: "repository.preview.adapter",
      runtime_key: "repository_runtime",
      capability_key: "repository_read",
      dispatch_binding_key: "dispatch-binding-1",
      endpoint_export_key: "export.repository.preview",
      resource_authority_recipe_key: "repository_read",
      approval_policy_key: null,
      readback_policy_key: "repository_preview_readback_v1",
      priority: 100,
      fallback_rank: 0,
      requires_approval: false,
      requires_readback: true,
      revision_hash: "e".repeat(64),
      rank: [4, 2, 1, 100, 0, 0.8],
      score: 0.8
    },
    fallback_bindings: [],
    candidate_evidence: [],
    resolution_summary: {
      candidate_count: 1,
      eligible_count: 1,
      excluded_count: 0,
      ambiguity_rejected: false,
      fail_closed: true
    },
    scoring_policy: { weights: { quality: 1 } },
    safety: {
      provider_calls_performed: false,
      credential_payloads_read: false,
      external_writes_performed: false,
      runtime_activation_changed: false,
      secrets_included: false
    },
    ...overrides
  };
  return { ...core, manifest_hash: stableOperationHash(core) };
}

function currentRow(manifest, overrides = {}) {
  return {
    manifest_id: "22222222-2222-4222-8222-222222222222",
    pointer_revision: 3,
    manifest_version: 2,
    scope_fingerprint: "b".repeat(64),
    source_revision_hash: "c".repeat(64),
    manifest_hash: manifest.manifest_hash,
    compiler_version: "operation-binding-compiler-v1",
    validation_status: "valid",
    rollout_mode: "active",
    certification_status: "certified",
    manifest_json: JSON.stringify(manifest),
    expires_at: "2026-08-01T00:00:00.000Z",
    revoked_at: null,
    operation_id: "op-1",
    operation_key: "repo.change.preview",
    operation_version: 1,
    operation_revision_hash: "a".repeat(64),
    operation_status: "active",
    ...overrides
  };
}

function dispatchRow(overrides = {}) {
  return {
    binding_id: "dispatch-binding-1",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_repository_preview",
    export_key: "export.repository.preview",
    tool_key: "repository_preview",
    capability_key: "repository_read",
    operation_intent: "repository_preview",
    runtime_surface: "repository_runtime",
    readback_policy_key: "repository_preview_readback_v1",
    status: "active",
    ...overrides
  };
}

function exportRow(overrides = {}) {
  return {
    export_key: "export.repository.preview",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_repository_preview",
    tool_name: "repository_preview",
    scope_class: "admin",
    status: "active",
    ...overrides
  };
}

function certificationRow(overrides = {}) {
  return {
    certification_key: "repository_runtime_certified_v1",
    surface_key: "repository_runtime",
    tool_or_action_key: "repository_preview",
    risk_class: "R2",
    certification_status: "certified",
    dispatch_allowed: 1,
    apply_allowed: 0,
    requires_resource_authority: 1,
    requires_dry_run: 1,
    requires_audit_evidence: 1,
    requires_readback: 1,
    last_evidence_ref: "ci:runtime-certification:1",
    last_certified_at: "2026-07-22T00:00:00.000Z",
    expires_at: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    operation_key: "repo.change.preview",
    operation_version: 1,
    scope_fingerprint: "b".repeat(64),
    allowed_compiler_versions: ["operation-binding-compiler-v1"],
    allowed_rollout_modes: ["active"],
    require_certified: true,
    expected_runtime_surface: "repository_runtime",
    expected_risk_class: "R2",
    now: "2026-07-23T18:00:00.000Z",
    ...overrides
  };
}

function fakePool(script) {
  const calls = [];
  let released = 0;
  const connection = {
    release() { released += 1; },
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      assert.match(compact, /^SELECT /, `runtime verifier must remain read-only: ${compact}`);
      calls.push({ sql: compact, params });
      const next = script.shift();
      assert.ok(next, `unexpected SQL: ${compact}`);
      assert.match(compact, next.match);
      return next.result;
    }
  };
  return {
    pool: { async getConnection() { return connection; } },
    calls,
    released: () => released,
    remaining: () => script.length
  };
}

{
  const manifest = compiledManifest();
  const fake = fakePool([
    { match: /^SELECT p.manifest_id,p.pointer_revision/, result: [[currentRow(manifest)]] },
    { match: /^SELECT binding_id,parent_action_key/, result: [[dispatchRow()]] },
    { match: /^SELECT export_key,parent_action_key/, result: [[exportRow()]] },
    { match: /^SELECT certification_key,surface_key/, result: [[certificationRow()]] }
  ]);
  const result = await verifyOperationRuntimeReadiness(input(), { pool: fake.pool });
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.equal(result.verification_status, "ready_for_runtime_authority_resolution");
  assert.equal(result.next_required_stage, "same_cycle_resource_credential_approval_and_readback_authority_resolution");
  assert.equal(result.provider_calls_performed, false);
  assert.equal(result.external_writes_performed, false);
  assert.equal(result.credential_payloads_read, false);
  assert.equal(result.runtime_activation_changed, false);
  assert.equal(result.evidence.authorities.runtime_certification.apply_allowed, false);
  assert.equal(fake.remaining(), 0);
  assert.equal(fake.released(), 1);
}

{
  const manifest = compiledManifest();
  const corrupted = currentRow(manifest, { manifest_hash: "f".repeat(64) });
  const fake = fakePool([
    { match: /^SELECT p.manifest_id,p.pointer_revision/, result: [[corrupted]] }
  ]);
  const result = await verifyOperationRuntimeReadiness(input(), { pool: fake.pool });
  assert.equal(result.ready, false);
  assert.equal(result.verification_status, "blocked_runtime_verification");
  assert.ok(result.blockers.some((item) => item.code === "manifest_hash_mismatch"));
  assert.equal(result.evidence.authorities, null);
  assert.equal(fake.remaining(), 0);
}

{
  const manifest = compiledManifest();
  const fake = fakePool([
    { match: /^SELECT p.manifest_id,p.pointer_revision/, result: [[currentRow(manifest, { operation_revision_hash: "f".repeat(64) })]] }
  ]);
  const result = await verifyOperationRuntimeReadiness(input(), { pool: fake.pool });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === "manifest_operation_revision_mismatch"));
}

{
  const manifest = compiledManifest();
  const fake = fakePool([
    { match: /^SELECT p.manifest_id,p.pointer_revision/, result: [[currentRow(manifest)]] },
    { match: /^SELECT binding_id,parent_action_key/, result: [[dispatchRow()]] },
    { match: /^SELECT export_key,parent_action_key/, result: [[exportRow()]] },
    { match: /^SELECT certification_key,surface_key/, result: [[certificationRow({ expires_at: "2026-07-22T00:00:00.000Z" })]] }
  ]);
  const result = await verifyOperationRuntimeReadiness(input(), { pool: fake.pool });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === "runtime_certification_expired"));
  assert.equal(result.evidence.authorities.runtime_certification.certification_key, "repository_runtime_certified_v1");
}

{
  const fake = fakePool([
    { match: /^SELECT p.manifest_id,p.pointer_revision/, result: [[]] }
  ]);
  const result = await verifyOperationRuntimeReadiness(input(), { pool: fake.pool });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === "current_manifest_cardinality_invalid"));
}

{
  await assert.rejects(
    verifyOperationRuntimeReadiness({ ...input(), allowed_compiler_versions: [] }, {
      pool: { async getConnection() { throw new Error("database must not be reached"); } }
    }),
    (error) => error.code === "operation_runtime_verifier_invalid_list"
  );
}

console.log("operation runtime verifier contract tests passed");
