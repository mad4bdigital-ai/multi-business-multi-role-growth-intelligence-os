import assert from "node:assert/strict";
import { resolveCanonicalExecutionContract } from "./canonicalExecutionContractResolver.js";

const INTENT_KEY = "repository.commit.read";
const ACTION_KEY = "repository_provider";
const ENDPOINT_KEY = "repository_get_commit";
const CAPABILITY_KEY = "repository.commit.read";

function intentBinding(overrides = {}) {
  return {
    binding_id: "intent-binding-1",
    intent_key: INTENT_KEY,
    principal_scope: "admin",
    tenant_binding_mode: "admin_only",
    parent_action_key: ACTION_KEY,
    endpoint_key: ENDPOINT_KEY,
    capability_key: CAPABILITY_KEY,
    runtime_surface: ENDPOINT_KEY,
    status: "active",
    priority: 100,
    binding_revision: 1,
    source_registry: "execution_intent_contract_bindings",
    source_key: INTENT_KEY,
    valid_from: null,
    expires_at: null,
    updated_at: "2026-07-30T20:00:00.000Z",
    secret_value: "must-not-leak",
    ...overrides,
  };
}

function actionRow(overrides = {}) {
  return {
    action_key: ACTION_KEY,
    status: "active",
    module_binding: "repository_connector",
    connector_family: "repository",
    runtime_capability_class: "external_action_only",
    runtime_callable: "TRUE",
    primary_executor: "http_client_backend",
    route_target: null,
    execution_layer: "provider_transport",
    review_required: "FALSE",
    admin_only: "FALSE",
    writeback_scope: "none",
    api_key_value: "must-not-leak",
    ...overrides,
  };
}

function endpointRow(overrides = {}) {
  return {
    endpoint_id: "endpoint-1",
    parent_action_key: ACTION_KEY,
    endpoint_key: ENDPOINT_KEY,
    endpoint_operation: "getCommit",
    provider_domain: "https://provider.invalid",
    method: "GET",
    endpoint_path_or_function: "/repos/{owner}/{repo}/commits/{ref}",
    route_target: null,
    module_binding: "repository_connector",
    connector_family: "repository",
    status: "active",
    spec_validation_status: "valid",
    auth_validation_status: "valid",
    privacy_validation_status: "valid",
    execution_readiness: "ready",
    endpoint_role: "primary",
    execution_mode: "http_delegated",
    transport_required: "TRUE",
    fallback_allowed: "FALSE",
    inventory_role: "provider_endpoint",
    transport_action_key: ENDPOINT_KEY,
    runtime_binding_profile: "provider_read",
    admin_only: "FALSE",
    writeback_scope: "none",
    schema_json: "must-not-leak",
    ...overrides,
  };
}

function resourceRow(overrides = {}) {
  return {
    operation_id: "resource-operation-1",
    resource_key: "repository_commit",
    actor_scope: "admin",
    operation_key: "read",
    http_method: "GET",
    http_path: "/repos/{owner}/{repo}/commits/{ref}",
    implementation_status: "active",
    route_file: "repositoryRoutes.js",
    tool_key: ENDPOINT_KEY,
    readback_required: 0,
    permissions_required: 0,
    status: "active",
    ...overrides,
  };
}

function certificationRow(overrides = {}) {
  return {
    certification_key: "repository-get-commit-v1",
    surface_key: ENDPOINT_KEY,
    surface_family: "repository",
    tool_or_action_key: ENDPOINT_KEY,
    risk_class: "R1",
    certification_status: "certified",
    dispatch_allowed: 1,
    apply_allowed: 1,
    requires_resource_authority: 0,
    requires_dry_run: 0,
    requires_audit_evidence: 0,
    requires_readback: 0,
    last_evidence_ref: "evidence://repository-get-commit",
    last_certified_at: "2026-07-30T20:00:00.000Z",
    expires_at: null,
    ...overrides,
  };
}

function readbackRow(overrides = {}) {
  return {
    contract_id: "readback-1",
    contract_key: "repository-commit-readback-v1",
    contract_version: 1,
    capability_key: CAPABILITY_KEY,
    adapter_key: ENDPOINT_KEY,
    verification_type: "provider_read",
    acknowledgement_required: 0,
    verification_required: 1,
    expected_effect_class: "read_only",
    certification_status: "certified",
    status: "certified",
    is_current: 1,
    expires_at: null,
    source_registry: "platform_capability_readback_contracts",
    source_key: "repository-commit-readback-v1",
    secrets_included: 0,
    ...overrides,
  };
}

class FakePool {
  constructor(options = {}) {
    this.options = options;
    this.queries = [];
  }

  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ text, params });
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|REPLACE)\b/i);
    assert.doesNotMatch(text, /credential|authorization_header|api_key_value|schema_json|secret_(?:value|payload|token)|client_secret/i);
    if (text.includes("FROM execution_intent_contract_bindings")) return [this.options.intents || [intentBinding()]];
    if (text.includes("FROM actions")) return [this.options.actions || [actionRow()]];
    if (text.includes("FROM endpoints")) return [this.options.endpoints || [endpointRow()]];
    if (text.includes("FROM platform_resource_operation_registry")) return [this.options.resources || [resourceRow()]];
    if (text.includes("FROM runtime_dispatch_certification_registry")) return [this.options.certifications || [certificationRow()]];
    if (text.includes("FROM platform_capability_readback_contracts")) return [this.options.readbacks || [readbackRow()]];
    throw new Error(`Unexpected SQL: ${text}`);
  }
}

function capabilityDecision(capture = null) {
  return async (input) => {
    if (capture) capture(input);
    return {
      adaptive_decision: input.requested_mode === "apply" ? "ready_for_dispatch" : "allow_preview",
      decision_hash: "decision-hash",
      manifest: { manifest_hash: "manifest-hash", source_revision_hash: "source-revision-hash" },
      blockers: [],
    };
  };
}

const fixedNow = () => "2026-07-30T21:00:00.000Z";

const adminPool = new FakePool();
const adminResult = await resolveCanonicalExecutionContract({
  intent_key: INTENT_KEY,
  requested_mode: "preview",
  principal_scope: "admin",
}, {
  pool: adminPool,
  now: fixedNow,
  capabilityEvaluator: capabilityDecision(),
});
assert.equal(adminResult.decision, "resolved_preview");
assert.equal(adminResult.request.intent_key, INTENT_KEY);
assert.equal(adminResult.request.parent_action_key, ACTION_KEY);
assert.equal(adminResult.selection.intent_binding.binding_revision, 1);
assert.equal(adminResult.guarantees.intent_first_resolution, true);
assert.equal(JSON.stringify(adminResult).includes("must-not-leak"), false);
assert.deepEqual(adminPool.queries[0].params, [INTENT_KEY]);

let tenantCapabilityInput = null;
const tenantResult = await resolveCanonicalExecutionContract({
  intent_key: INTENT_KEY,
  principal_scope: "tenant",
  tenant_ref: "tenant-alpha",
  workspace_ref: "workspace-alpha",
}, {
  pool: new FakePool({
    intents: [intentBinding({ principal_scope: "tenant", tenant_binding_mode: "tenant_required" })],
    resources: [resourceRow({ actor_scope: "tenant" })],
  }),
  now: fixedNow,
  capabilityEvaluator: capabilityDecision((input) => { tenantCapabilityInput = input; }),
});
assert.equal(tenantResult.decision, "resolved_preview");
assert.equal(tenantCapabilityInput.principal_scope, "tenant");
assert.equal(tenantCapabilityInput.tenant_ref, "tenant-alpha");
assert.equal(tenantResult.guarantees.tenant_scope_enforced, true);

const noQueryPool = new FakePool();
await assert.rejects(
  () => resolveCanonicalExecutionContract({ intent_key: INTENT_KEY, principal_scope: "tenant" }, {
    pool: noQueryPool,
    now: fixedNow,
    capabilityEvaluator: capabilityDecision(),
  }),
  (error) => error.status === 400 && error.code === "EXECUTION_INTENT_TENANT_REQUIRED",
);
assert.equal(noQueryPool.queries.length, 0);

await assert.rejects(
  () => resolveCanonicalExecutionContract({ intent_key: INTENT_KEY, principal_scope: "tenant", tenant_ref: "tenant-alpha" }, {
    pool: new FakePool({ intents: [intentBinding()] }),
    now: fixedNow,
    capabilityEvaluator: capabilityDecision(),
  }),
  (error) => error.status === 403 && error.code === "EXECUTION_INTENT_SCOPE_CONFLICT",
);

await assert.rejects(
  () => resolveCanonicalExecutionContract({
    intent_key: INTENT_KEY,
    parent_action_key: "conflicting-action",
    endpoint_key: ENDPOINT_KEY,
    capability_key: CAPABILITY_KEY,
    principal_scope: "admin",
  }, {
    pool: new FakePool(),
    now: fixedNow,
    capabilityEvaluator: capabilityDecision(),
  }),
  (error) => error.status === 409
    && error.code === "EXECUTION_INTENT_EXPLICIT_BINDING_CONFLICT"
    && error.details.conflicts.includes("parent_action_key"),
);

await assert.rejects(
  () => resolveCanonicalExecutionContract({ intent_key: INTENT_KEY, principal_scope: "admin" }, {
    pool: new FakePool({
      intents: [
        intentBinding({ binding_id: "binding-a" }),
        intentBinding({ binding_id: "binding-b" }),
      ],
    }),
    now: fixedNow,
    capabilityEvaluator: capabilityDecision(),
  }),
  (error) => error.status === 409 && error.code === "EXECUTION_INTENT_BINDING_AMBIGUOUS",
);

await assert.rejects(
  () => resolveCanonicalExecutionContract({ intent_key: INTENT_KEY, principal_scope: "tenant", tenant_ref: "tenant-alpha" }, {
    pool: new FakePool({
      intents: [intentBinding({ principal_scope: "tenant", tenant_binding_mode: "tenant_required" })],
      endpoints: [endpointRow({ admin_only: "TRUE" })],
      resources: [resourceRow({ actor_scope: "tenant" })],
    }),
    now: fixedNow,
    capabilityEvaluator: capabilityDecision(),
  }),
  (error) => error.status === 403 && error.code === "EXECUTION_CONTRACT_PRINCIPAL_SCOPE_CONFLICT",
);

await assert.rejects(
  () => resolveCanonicalExecutionContract({ intent_key: INTENT_KEY, principal_scope: "tenant", tenant_ref: "tenant-alpha" }, {
    pool: new FakePool({
      intents: [intentBinding({ principal_scope: "tenant", tenant_binding_mode: "tenant_required" })],
      resources: [resourceRow({ actor_scope: "admin" })],
    }),
    now: fixedNow,
    capabilityEvaluator: capabilityDecision(),
  }),
  (error) => error.status === 403 && error.code === "EXECUTION_CONTRACT_PRINCIPAL_SCOPE_CONFLICT",
);

console.log("canonical execution intent isolation tests passed");
