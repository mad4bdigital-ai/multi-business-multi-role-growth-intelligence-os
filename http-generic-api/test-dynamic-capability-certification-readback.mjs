import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildDynamicCapabilityCertificationReadbackPreview,
  _testingDynamicCapabilityCertificationReadback,
} from "./dynamicCapabilityCertificationReadback.js";

const manifest = {
  capability_key: "admin_tool.repo_patch_apply",
  source: { table: "admin_platform_endpoint_tools", key: "repo_patch_apply" },
  requirements: { certification: true, readback: true },
};

function baseRows(overrides = {}) {
  return {
    manifest: [{
      manifest_id: "manifest-1",
      capability_key: manifest.capability_key,
      manifest_version: 4,
      manifest_hash: "a".repeat(64),
      source_revision_hash: "b".repeat(64),
      compiler_version: "dynamic-capability-governance-compiler-v3",
      effect_class: "internal_write",
      risk_class: "C",
      status: "shadow_ready",
      rollout_mode: "shadow",
      manifest_json: JSON.stringify(manifest),
      created_at: "2026-07-01T00:00:00.000Z",
    }],
    adapters: [{
      adapter_key: "github.file.patch_apply.adapter",
      resource_type: "github_file",
      provider_key: "github",
      adapter_kind: "composite",
      installed_tool_key: "repo_patch_apply",
      supports_plan: 1,
      supports_read: 0,
      supports_write: 1,
      status: "active",
      metadata_json: JSON.stringify({ delegates_to: "repo_patch_apply", secrets_included: false }),
    }],
    generic: [{
      certification_id: "runtime:repo_patch_apply",
      capability_key: manifest.capability_key,
      certification_type: "runtime_dispatch",
      environment: "production",
      subject_type: "runtime_surface",
      subject_key: "repo_patch_apply",
      certification_status: "capability_envelope_gate_ci_passed_policy_seeded",
      evidence_id: "certification:repo_patch_apply:state",
      source_registry: "runtime_dispatch_certification_registry",
      source_key: "repo_patch_apply",
      certified_at: "2026-07-01T00:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      metadata_json: JSON.stringify({ secrets_included: false }),
      secrets_included: 0,
    }],
    runtime: [{
      certification_key: "repo_patch_apply",
      surface_key: "repo_patch_apply",
      surface_family: "admin_tool",
      tool_or_action_key: "repo_patch_apply",
      risk_class: "C",
      certification_status: "apply_certified",
      smoke_strategy: "ci_and_same_cycle_readback",
      dispatch_allowed: 1,
      apply_allowed: 1,
      requires_resource_authority: 1,
      requires_dry_run: 1,
      requires_audit_evidence: 1,
      requires_readback: 1,
      last_evidence_ref: "ci:repo_patch_apply",
      last_certified_at: "2026-07-01T00:00:00.000Z",
      expires_at: "2026-07-02T00:00:00.000Z",
    }],
    readbacks: [{
      contract_id: "contract-1",
      contract_key: "repo_patch_apply.same_cycle_readback",
      contract_version: 1,
      capability_key: manifest.capability_key,
      adapter_key: "github.file.patch_apply.adapter",
      verification_type: "git_ref_and_blob_readback",
      acknowledgement_required: 1,
      verification_required: 1,
      expected_effect_class: "internal_write",
      input_schema_json: JSON.stringify({ type: "object" }),
      observed_state_schema_json: JSON.stringify({ type: "object" }),
      provider_binding_constraints_json: JSON.stringify({ provider_key: "github" }),
      certification_status: "certified",
      status: "certified",
      is_current: 1,
      valid_from: "2026-07-01T00:00:00.000Z",
      expires_at: "2026-07-02T00:00:00.000Z",
      revoked_at: null,
      source_registry: "runtime_dispatch_certification_registry",
      source_key: "repo_patch_apply",
      secrets_included: 0,
    }],
    evidence: [{
      evidence_id: "ack-1",
      evidence_type: "provider_acknowledgement",
      evidence_status: "passed",
      source_system: "github",
      observed_at: "2026-07-01T00:00:00.000Z",
      secrets_included: 0,
    }, {
      evidence_id: "verify-1",
      evidence_type: "same_cycle_readback_verification",
      evidence_status: "passed",
      source_system: "github",
      observed_at: "2026-07-01T00:00:01.000Z",
      secrets_included: 0,
    }],
    ...overrides,
  };
}

function fakePool(rows) {
  return {
    async query(sql) {
      const value = String(sql || "");
      if (value.includes("FROM platform_capability_compiled_manifests")) return [rows.manifest];
      if (value.includes("FROM platform_resource_adapters")) return [rows.adapters];
      if (value.includes("FROM platform_capability_certifications")) return [rows.generic];
      if (value.includes("FROM runtime_dispatch_certification_registry")) return [rows.runtime];
      if (value.includes("FROM platform_capability_readback_contracts")) return [rows.readbacks];
      if (value.includes("FROM platform_evidence_events")) return [rows.evidence];
      throw new Error(`Unexpected SQL: ${value.slice(0, 160)}`);
    },
  };
}

const happy = await buildDynamicCapabilityCertificationReadbackPreview({
  capability_key: manifest.capability_key,
  operation_mode: "apply",
  adapter_key: "github.file.patch_apply.adapter",
  runtime_surface: "repo_patch_apply",
  environment: "production",
}, {
  pool: fakePool(baseRows()),
  now: () => "2026-07-01T01:00:00.000Z",
});

assert.equal(happy.assurance_state, "ready_for_dispatch_shadow");
assert.equal(happy.blockers.length, 0);
assert.equal(happy.adapter_resolution.state, "pass");
assert.equal(happy.certification_resolution.state, "pass");
assert.equal(happy.certification_resolution.specialized_source.certification_key, "repo_patch_apply");
assert.equal(happy.readback_contract_resolution.state, "pass");
assert.equal(happy.post_execution_evidence.acknowledgement.state, "acknowledged");
assert.equal(happy.post_execution_evidence.verification.state, "verified");
assert.equal(happy.execution_performed, false);
assert.equal(happy.guarantees.runtime_authority_changed, false);
assert.equal(happy.guarantees.provider_calls_performed, false);
assert.equal(happy.guarantees.secrets_included, false);

const ambiguousAdapters = baseRows({
  adapters: [
    { ...baseRows().adapters[0], adapter_key: "adapter-a", installed_tool_key: null, resource_type: "github_file" },
    { ...baseRows().adapters[0], adapter_key: "adapter-b", installed_tool_key: null, resource_type: "github_file" },
  ],
});
const ambiguous = await buildDynamicCapabilityCertificationReadbackPreview({
  capability_key: manifest.capability_key,
  operation_mode: "apply",
  resource_type: "github_file",
}, {
  pool: fakePool(ambiguousAdapters),
  now: () => "2026-07-01T01:00:00.000Z",
});
assert.equal(ambiguous.adapter_resolution.state, "ambiguous");
assert(ambiguous.blockers.includes("ADAPTER_BINDING_AMBIGUOUS"));
assert.equal(ambiguous.assurance_state, "blocked");

const stale = baseRows({ generic: [{ ...baseRows().generic[0], expires_at: "2026-06-30T00:00:00.000Z" }] });
const staleResult = await buildDynamicCapabilityCertificationReadbackPreview({
  capability_key: manifest.capability_key,
  operation_mode: "apply",
  adapter_key: "github.file.patch_apply.adapter",
  runtime_surface: "repo_patch_apply",
}, {
  pool: fakePool(stale),
  now: () => "2026-07-01T01:00:00.000Z",
});
assert.equal(staleResult.certification_resolution.state, "stale");
assert(staleResult.blockers.includes("CERTIFICATION_STALE"));

const missingReadback = await buildDynamicCapabilityCertificationReadbackPreview({
  capability_key: manifest.capability_key,
  operation_mode: "apply",
  adapter_key: "github.file.patch_apply.adapter",
  runtime_surface: "repo_patch_apply",
}, {
  pool: fakePool(baseRows({ readbacks: [] })),
  now: () => "2026-07-01T01:00:00.000Z",
});
assert.equal(missingReadback.readback_contract_resolution.state, "missing");
assert(missingReadback.blockers.includes("READBACK_CONTRACT_REQUIRED"));

const revokedReadback = await buildDynamicCapabilityCertificationReadbackPreview({
  capability_key: manifest.capability_key,
  operation_mode: "apply",
  adapter_key: "github.file.patch_apply.adapter",
  runtime_surface: "repo_patch_apply",
}, {
  pool: fakePool(baseRows({
    readbacks: [{ ...baseRows().readbacks[0], status: "revoked", certification_status: "revoked", revoked_at: "2026-07-01T00:30:00.000Z" }],
  })),
  now: () => "2026-07-01T01:00:00.000Z",
});
assert.equal(revokedReadback.readback_contract_resolution.state, "revoked");
assert(revokedReadback.blockers.includes("READBACK_CONTRACT_REVOKED"));

const preview = await buildDynamicCapabilityCertificationReadbackPreview({
  capability_key: manifest.capability_key,
  operation_mode: "preview",
}, {
  pool: fakePool(baseRows({ adapters: [], generic: [], runtime: [], readbacks: [], evidence: [] })),
  now: () => "2026-07-01T01:00:00.000Z",
});
assert.equal(preview.assurance_state, "shadow_preview");
assert.equal(preview.blockers.length, 0);
assert.equal(preview.diagnostics.apply_contract_ready, false);

assert.throws(
  () => _testingDynamicCapabilityCertificationReadback.normalizeInput({ capability_key: manifest.capability_key, operation_mode: "execute" }),
  (error) => error.code === "capability_certification_readback_mode_invalid",
);

const migration = fs.readFileSync(new URL("./migrations/20260701_dynamic_capability_certification_readback.sql", import.meta.url), "utf8");
for (const marker of [
  "CREATE TABLE IF NOT EXISTS platform_capability_readback_contracts",
  "CREATE OR REPLACE VIEW v_platform_capability_readback_readiness",
  "platform_capability_certifications",
  "runtime_dispatch_certification_registry",
  "platform_resource_adapters",
  "platform_capability_source_links",
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) assert(migration.includes(marker), marker);
assert(!migration.includes("CREATE TABLE IF NOT EXISTS platform_capability_certifications"));
assert(!migration.includes("CREATE TABLE IF NOT EXISTS platform_resource_adapters"));
assert(!migration.includes("CREATE TABLE IF NOT EXISTS runtime_dispatch_certification_registry"));

console.log("dynamic capability certification and readback preview tests passed");
