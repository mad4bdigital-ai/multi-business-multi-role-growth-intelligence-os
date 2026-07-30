import assert from "node:assert/strict";
import { resolveCanonicalExecutionContract } from "./canonicalExecutionContractResolver.js";

const ACTION_KEY = "github_api_mcp";
const ENDPOINT_KEY = "github_get_commit";
const CAPABILITY_KEY = "github.commit.read";

function baseAction(overrides = {}) {
  return { action_key: ACTION_KEY, status: "active", module_binding: "github_com_connector", connector_family: "github", runtime_capability_class: "external_action_only", runtime_callable: "TRUE", primary_executor: "http_client_backend", route_target: null, execution_layer: "provider_transport", review_required: "FALSE", admin_only: "FALSE", writeback_scope: "none", ...overrides };
}
function baseEndpoint(overrides = {}) {
  return { endpoint_id: "ACT-GH-EP-001", parent_action_key: ACTION_KEY, endpoint_key: ENDPOINT_KEY, endpoint_operation: "getCommit", provider_domain: "https://api.github.com", method: "GET", endpoint_path_or_function: "/repos/{owner}/{repo}/commits/{ref}", route_target: null, module_binding: "github_com_connector", connector_family: "github", status: "active", spec_validation_status: "valid", auth_validation_status: "valid", privacy_validation_status: "valid", execution_readiness: "ready", endpoint_role: "primary", execution_mode: "http_delegated", transport_required: "TRUE", fallback_allowed: "FALSE", inventory_role: "provider_endpoint", transport_action_key: ENDPOINT_KEY, runtime_binding_profile: "provider_read", admin_only: "FALSE", writeback_scope: "none", ...overrides };
}
function baseResource(overrides = {}) {
  return { operation_id: "resource-op-1", resource_key: "github_commit", actor_scope: "admin", operation_key: "read", http_method: "GET", http_path: "/repos/{owner}/{repo}/commits/{ref}", implementation_status: "active", route_file: "githubRestRoutes.js", tool_key: ENDPOINT_KEY, readback_required: 0, permissions_required: 0, status: "active", ...overrides };
}
function baseCertification(overrides = {}) {
  return { certification_key: "github-get-commit-v1", surface_key: ENDPOINT_KEY, surface_family: "github", tool_or_action_key: ENDPOINT_KEY, risk_class: "R1", certification_status: "certified", dispatch_allowed: 1, apply_allowed: 1, requires_resource_authority: 0, requires_dry_run: 0, requires_audit_evidence: 0, requires_readback: 0, last_evidence_ref: "evidence://github-get-commit", last_certified_at: "2026-07-23T00:00:00.000Z", expires_at: null, ...overrides };
}
function baseReadback(overrides = {}) {
  return { contract_id: "readback-contract-1", contract_key: "github-commit-readback-v1", contract_version: 1, capability_key: CAPABILITY_KEY, adapter_key: ENDPOINT_KEY, verification_type: "provider_read", acknowledgement_required: 0, verification_required: 1, expected_effect_class: "read_only", certification_status: "certified", status: "certified", is_current: 1, expires_at: null, source_registry: "platform_capability_readback_contracts", source_key: "github-commit-readback-v1", secrets_included: 0, ...overrides };
}

class FakePool {
  constructor(options = {}) { this.options = options; this.queries = []; }
  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ text, params });
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|REPLACE)\b/i);
    if (text.includes("FROM actions")) return [this.options.actions || [baseAction({ api_key_value: "must-not-leak" })]];
    if (text.includes("FROM endpoints")) return [this.options.endpoints || [baseEndpoint({ schema_json: "{\"token\":\"must-not-leak\"}" })]];
    if (text.includes("FROM platform_resource_operation_registry")) return [this.options.resources || [baseResource()]];
    if (text.includes("FROM runtime_dispatch_certification_registry")) return [this.options.certifications || [baseCertification()]];
    if (text.includes("FROM platform_capability_readback_contracts")) return [this.options.readbacks || [baseReadback()]];
    throw new Error(`Unexpected SQL: ${text}`);
  }
}

function capabilityDecision(adaptiveDecision, blockers = []) {
  return async (input) => ({ adaptive_decision: adaptiveDecision, decision_hash: "decision-hash", manifest: { manifest_hash: "manifest-hash", source_revision_hash: "source-revision-hash" }, blockers, received_input: input });
}
const fixedNow = () => "2026-07-23T04:00:00.000Z";

const previewPool = new FakePool();
const preview = await resolveCanonicalExecutionContract({ parent_action_key: ACTION_KEY, endpoint_key: ENDPOINT_KEY, capability_key: CAPABILITY_KEY, requested_mode: "preview", principal_scope: "admin" }, { pool: previewPool, now: fixedNow, capabilityEvaluator: capabilityDecision("allow_preview") });
assert.equal(preview.decision, "resolved_preview");
assert.equal(preview.selection.bindings.runtime_surface, ENDPOINT_KEY);
assert.equal(preview.execution_performed, false);
assert.equal(preview.secrets_included, false);
assert.equal(JSON.stringify(preview).includes("must-not-leak"), false);
assert.deepEqual(previewPool.queries[0].params, [ACTION_KEY]);
assert.deepEqual(previewPool.queries[1].params, [ACTION_KEY, ENDPOINT_KEY]);

const applyWithoutIdempotency = await resolveCanonicalExecutionContract({ parent_action_key: ACTION_KEY, endpoint_key: ENDPOINT_KEY, capability_key: CAPABILITY_KEY, requested_mode: "apply", principal_scope: "admin" }, { pool: new FakePool({ endpoints: [baseEndpoint({ method: "POST" })], resources: [baseResource({ http_method: "POST", readback_required: 1, permissions_required: 1 })], certifications: [baseCertification({ requires_resource_authority: 1, requires_dry_run: 1, requires_audit_evidence: 1, requires_readback: 1 })] }), now: fixedNow, capabilityEvaluator: capabilityDecision("ready_for_dispatch") });
assert.equal(applyWithoutIdempotency.decision, "blocked");
assert.ok(applyWithoutIdempotency.blockers.includes("IDEMPOTENCY_KEY_REQUIRED"));
assert.equal(applyWithoutIdempotency.policy.readback.required, true);
assert.equal(applyWithoutIdempotency.policy.retry.mode, "read_before_retry");

const applyReady = await resolveCanonicalExecutionContract({ parent_action_key: ACTION_KEY, endpoint_key: ENDPOINT_KEY, capability_key: CAPABILITY_KEY, requested_mode: "apply", principal_scope: "admin", idempotency_key: "spec011-phase2-apply-1" }, { pool: new FakePool({ endpoints: [baseEndpoint({ method: "POST" })], resources: [baseResource({ http_method: "POST", readback_required: 1, permissions_required: 1 })], certifications: [baseCertification({ requires_resource_authority: 1, requires_dry_run: 1, requires_audit_evidence: 1, requires_readback: 1 })] }), now: fixedNow, capabilityEvaluator: capabilityDecision("ready_for_dispatch") });
assert.equal(applyReady.decision, "resolved_apply_candidate");
assert.equal(applyReady.policy.resource_authority.required, true);
assert.equal(applyReady.policy.readback.contract_present, true);
assert.equal(applyReady.policy.dry_run.required, true);
assert.equal(applyReady.policy.audit.required, true);

await assert.rejects(() => resolveCanonicalExecutionContract({ parent_action_key: ACTION_KEY, endpoint_key: ENDPOINT_KEY, capability_key: CAPABILITY_KEY }, { pool: new FakePool({ endpoints: [baseEndpoint(), baseEndpoint({ endpoint_id: "ACT-GH-EP-002" })] }), now: fixedNow, capabilityEvaluator: capabilityDecision("allow_preview") }), (error) => error.status === 409 && error.code === "EXECUTION_CONTRACT_AMBIGUOUS");
await assert.rejects(() => resolveCanonicalExecutionContract({ parent_action_key: ACTION_KEY, endpoint_key: ENDPOINT_KEY, capability_key: CAPABILITY_KEY }, { pool: new FakePool({ endpoints: [baseEndpoint({ execution_readiness: "pending" })] }), now: fixedNow, capabilityEvaluator: capabilityDecision("allow_preview") }), (error) => error.status === 409 && error.code === "EXECUTION_CONTRACT_STALE");
await assert.rejects(() => resolveCanonicalExecutionContract({ parent_action_key: ACTION_KEY, endpoint_key: ENDPOINT_KEY, capability_key: CAPABILITY_KEY }, { pool: new FakePool({ actions: [baseAction({ module_binding: "action-module" })], endpoints: [baseEndpoint({ module_binding: "endpoint-module" })] }), now: fixedNow, capabilityEvaluator: capabilityDecision("allow_preview") }), (error) => error.status === 409 && error.code === "EXECUTION_CONTRACT_AMBIGUOUS" && error.details.conflicts.includes("MODULE_BINDING_CONFLICT"));
await assert.rejects(() => resolveCanonicalExecutionContract({ parent_action_key: ACTION_KEY, endpoint_key: ENDPOINT_KEY, capability_key: CAPABILITY_KEY, expected_contract_hash: "0".repeat(64) }, { pool: new FakePool(), now: fixedNow, capabilityEvaluator: capabilityDecision("allow_preview") }), (error) => error.status === 409 && error.code === "EXECUTION_CONTRACT_STALE");

let receivedTenantInput = null;
await resolveCanonicalExecutionContract({ parent_action_key: ACTION_KEY, endpoint_key: ENDPOINT_KEY, capability_key: CAPABILITY_KEY, principal_scope: "tenant", tenant_ref: "tenant-1", workspace_ref: "workspace-1" }, { pool: new FakePool({ resources: [baseResource({ actor_scope: "tenant" })] }), now: fixedNow, capabilityEvaluator: async (input) => { receivedTenantInput = input; return capabilityDecision("allow_preview")(input); } });
assert.equal(receivedTenantInput.principal_scope, "tenant");
assert.equal(receivedTenantInput.tenant_ref, "tenant-1");
assert.equal(receivedTenantInput.workspace_ref, "workspace-1");

console.log("canonical execution contract resolver tests passed");
