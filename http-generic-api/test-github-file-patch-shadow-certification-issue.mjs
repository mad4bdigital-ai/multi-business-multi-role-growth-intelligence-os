import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_CONFIRM,
  issueGithubFilePatchShadowCertification,
  _testingGithubFilePatchShadowCertification,
} from "./githubFilePatchShadowCertificationIssuer.js";

const t = _testingGithubFilePatchShadowCertification;
assert.equal(t.CAPABILITY_KEY, "github_file_patch_apply");
assert.equal(t.ADAPTER_KEY, "repository_change_set_apply");
assert.equal(t.CONTRACT_KEY, "github_file_patch_apply__github_change_set_branch_head_v1__52d0eb30144b4bb4");
assert.equal(t.RUNTIME_CERTIFICATION_KEY, "github_file_patch_apply_after_review");
assert.equal(t.FIXED_PLAN.certification_status, "shadow_certified");
assert.equal(t.FIXED_PLAN.contract_status_after, "certified");
assert.equal(t.FIXED_PLAN.runtime_dispatch_changed, false);
assert.equal(t.FIXED_PLAN.runtime_apply_changed, false);
assert.equal(t.FIXED_PLAN.active_capability_exports_created, false);

function baseRows(overrides = {}) {
  return {
    adapter: [],
    contract: [{
      contract_id: "contract-1",
      contract_key: t.CONTRACT_KEY,
      contract_version: 1,
      capability_key: t.CAPABILITY_KEY,
      adapter_key: t.ADAPTER_KEY,
      verification_type: "github_change_set_branch_head_v1",
      acknowledgement_required: 1,
      verification_required: 1,
      expected_effect_class: "external_write",
      certification_status: "pending",
      status: "shadow",
      is_current: 1,
      secrets_included: 0,
    }],
    capability: [{
      capability_key: t.CAPABILITY_KEY,
      operation_class: "state_changing",
      risk_class: "C",
      runtime_status: "shadow",
      exposure_scope: "admin",
      dispatch_allowed: 1,
      apply_allowed: 0,
      requires_readback: 1,
      status: "active",
    }],
    certification: [],
    evidence: [],
    exports: [{ export_key: "virtual_tool_export.repo_patch_apply", capability_key: t.CAPABILITY_KEY, export_status: "shadow", exposure_scope: "admin" }],
    runtime: [{
      certification_key: t.RUNTIME_CERTIFICATION_KEY,
      surface_key: "github.file.patch_apply_after_review",
      tool_or_action_key: "repo_patch_apply",
      certification_status: "after_review_gate_registered_positive_smoke_pending",
      dispatch_allowed: 0,
      apply_allowed: 0,
      requires_resource_authority: 1,
      requires_dry_run: 1,
      requires_audit_evidence: 1,
      requires_readback: 1,
    }],
    envelopes: [{
      envelope_id: t.WRITE_ENVELOPE_ID,
      app_key: "github",
      capability_key: t.CAPABILITY_KEY,
      operation_intent: "github_repo_patch",
      selected_runtime_surface: t.ADAPTER_KEY,
      execution_ref: t.WRITE_EXECUTION_REF,
      execution_status: "executed",
      secrets_included: 0,
    }, {
      envelope_id: t.CLEANUP_ENVELOPE_ID,
      app_key: "github",
      capability_key: t.CAPABILITY_KEY,
      operation_intent: "github_repo_patch",
      selected_runtime_surface: t.ADAPTER_KEY,
      execution_ref: t.CLEANUP_EXECUTION_REF,
      execution_status: "executed",
      secrets_included: 0,
    }],
    bindings: [{
      binding_id: t.WRITE_BINDING_ID,
      resource_type: "github_repo",
      resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      resource_ref_json: JSON.stringify({ branch: t.SMOKE_BRANCH }),
      recipe_key: "repo_patch_apply",
      permission_level: "patch",
      allowed_modes_json: JSON.stringify(["write_file", "delete_file"]),
      status: "active",
    }, {
      binding_id: t.CLEANUP_BINDING_ID,
      resource_type: "github_repo",
      resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      resource_ref_json: JSON.stringify({ branch: t.SMOKE_BRANCH }),
      recipe_key: "repo_patch_apply",
      permission_level: "patch",
      allowed_modes_json: JSON.stringify(["delete_file"]),
      status: "active",
    }],
    ...overrides,
  };
}

function fakePool(rows) {
  return {
    async query(sql) {
      const value = String(sql || "");
      if (value.includes("FROM platform_resource_adapters")) return [rows.adapter, []];
      if (value.includes("FROM platform_capability_readback_contracts")) return [rows.contract, []];
      if (value.includes("FROM platform_plugin_capabilities")) return [rows.capability, []];
      if (value.includes("FROM platform_capability_certifications")) return [rows.certification, []];
      if (value.includes("FROM platform_evidence_events")) return [rows.evidence, []];
      if (value.includes("FROM platform_plugin_capability_exports")) return [rows.exports, []];
      if (value.includes("FROM runtime_dispatch_certification_registry")) return [rows.runtime, []];
      if (value.includes("FROM capability_resolution_envelope_ledger")) return [rows.envelopes, []];
      if (value.includes("FROM platform_resource_authority_bindings")) return [rows.bindings, []];
      throw new Error(`Unexpected SQL: ${value.slice(0, 180)}`);
    },
  };
}

const preview = await issueGithubFilePatchShadowCertification({ mode: "dry_run" }, { pool: fakePool(baseRows()) });
assert.equal(preview.ok, true);
assert.equal(preview.mode, "dry_run");
assert.equal(preview.apply_ready, true);
assert.equal(preview.current_state.capability_apply_allowed, false);
assert.equal(preview.current_state.runtime_dispatch_allowed, false);
assert.equal(preview.current_state.runtime_apply_allowed, false);
assert.equal(preview.current_state.active_capability_export_count, 0);
assert.equal(preview.current_state.tenant_export_count, 0);
assert.equal(preview.mutations_performed, false);
assert.equal(preview.provider_calls_performed, false);
assert.equal(preview.external_writes_performed, false);
assert.match(preview.plan_hash, /^[0-9a-f]{64}$/);
assert.equal(preview.expected_confirmation, GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_CONFIRM);

await assert.rejects(
  () => issueGithubFilePatchShadowCertification({ mode: "apply", confirm: "WRONG" }, { pool: fakePool(baseRows()) }),
  (error) => error?.code === "github_file_patch_shadow_certification_confirmation_required",
);

const certifiedRows = baseRows({
  adapter: [{
    adapter_key: t.ADAPTER_KEY,
    resource_type: "github_file",
    provider_key: "github",
    adapter_kind: "composite",
    installed_tool_key: "repo_patch_apply",
    supports_plan: 1,
    supports_read: 0,
    supports_write: 1,
    status: "active",
  }],
  contract: [{
    ...baseRows().contract[0],
    status: "certified",
    certification_status: "certified",
  }],
  certification: [{
    certification_id: t.CERTIFICATION_ID,
    capability_key: t.CAPABILITY_KEY,
    certification_type: "shadow_external_write",
    certification_status: "shadow_certified",
    evidence_id: t.VERIFY_EVIDENCE_ID,
    secrets_included: 0,
  }],
  evidence: [{
    evidence_id: t.ACK_EVIDENCE_ID,
    evidence_type: "provider_acknowledgement",
    envelope_id: t.WRITE_ENVELOPE_ID,
    evidence_status: "passed",
    secrets_included: 0,
  }, {
    evidence_id: t.VERIFY_EVIDENCE_ID,
    evidence_type: "same_cycle_readback_verification",
    envelope_id: t.CLEANUP_ENVELOPE_ID,
    evidence_status: "passed",
    secrets_included: 0,
  }],
});
const readback = t.verifyReadback({
  adapter: certifiedRows.adapter[0],
  contract: certifiedRows.contract[0],
  capability: certifiedRows.capability[0],
  certification: certifiedRows.certification[0],
  evidence: Object.fromEntries(certifiedRows.evidence.map((row) => [row.evidence_id, row])),
  exports: certifiedRows.exports,
  runtime_certification: certifiedRows.runtime[0],
  envelopes: Object.fromEntries(certifiedRows.envelopes.map((row) => [row.envelope_id, row])),
  bindings: Object.fromEntries(certifiedRows.bindings.map((row) => [row.binding_id, row])),
});
assert.equal(readback.ok, true);
assert.equal(readback.adapter_status, "active");
assert.equal(readback.contract_status, "certified");
assert.equal(readback.certification_status, "shadow_certified");
assert.equal(readback.runtime_dispatch_allowed, false);
assert.equal(readback.runtime_apply_allowed, false);

const migration = fs.readFileSync(
  new URL("./migrations/20260720_github_file_patch_shadow_certification_issue.sql", import.meta.url),
  "utf8",
);
for (const marker of [
  "github_file_patch_shadow_certification_issue",
  "ISSUE_SHADOW_CERTIFICATION_GITHUB_FILE_PATCH_APPLY",
  "repository_change_set_apply",
  "github_file_patch_apply__github_change_set_branch_head_v1__52d0eb30144b4bb4",
  "71024f58-21fa-45b5-83f2-a75d05694f92",
  "bb74693c-2b7b-4f05-a391-a918fab67cfa",
  "runtime_dispatch_change_forbidden',true",
  "runtime_apply_change_forbidden',true",
  "no_provider_call=true",
  "no_external_write=true",
  "secrets_included=false",
]) assert(migration.includes(marker), marker);
assert.doesNotMatch(migration, /UPDATE\s+runtime_dispatch_certification_registry/i);
assert.doesNotMatch(migration, /UPDATE\s+platform_plugin_capability_exports/i);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+platform_capability_certifications/i);
assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|DATABASE)|\bTRUNCATE\s+TABLE|\bDELETE\s+FROM/i);

console.log("github file patch shadow certification issue tests passed");
