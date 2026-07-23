import assert from "node:assert/strict";
import { buildActivationAuthorizedAccess } from "./routes/activationRoutes.js";

const safeProjection = Object.freeze({
  source: "ueacp_activation_projection",
  status: "active",
  availability: "available",
  decision: "shadow_ready",
  authority_granted: false,
  enforcement_mode: "shadow_only",
  legacy_runtime_authoritative: true,
  execution_authority_changed: false,
  subject_scope: {
    scopeId: null,
    scopeKey: "platform:root",
    scopeType: "platform",
    tenantId: null,
    version: null,
  },
  registered_count: 4,
  authorized_count: 4,
  projected_count: 4,
  executable_candidate_count: 1,
  drift_detected: false,
  drift_issue_codes: [],
  projection_eligibility: {
    activation: true,
    connector_inventory: true,
    execution: false,
  },
  provider_calls: false,
  credential_payload_reads: false,
  external_writes: false,
  secrets_included: false,
});

const query = async () => ({ ok: true, rows: [] });
const projectionCalls = [];
const projectionBuilder = async (input) => {
  projectionCalls.push(input);
  return {
    ...safeProjection,
    subject_scope: {
      ...safeProjection.subject_scope,
      scopeKey: input.scope.scopeKey,
      scopeType: input.scope.scopeType,
      tenantId: input.scope.tenantId,
    },
  };
};

const adminEnvelope = await buildActivationAuthorizedAccess(
  {
    auth: {
      mode: "backend_api_key",
      is_admin: true,
      user_id: "admin-1",
      tenant_id: "00000000-0000-0000-0000-000000000000",
    },
    query: {},
  },
  {
    is_admin: true,
    user_id: "admin-1",
    tenant_id: null,
    workspace_id: null,
    workspace_key: "platform_repo_governance_zero",
    brand_key: "growth_intelligence_platform",
    context_source: "admin_platform_global_context",
  },
  {
    query,
    buildEffectiveAuthorityProjection: projectionBuilder,
    logger: { warn() {} },
  }
);
assert.equal(adminEnvelope.source, "activation_dynamic_authorization_envelope");
assert.equal(adminEnvelope.effective_authority.subject_scope.scopeType, "platform");
assert.equal(adminEnvelope.effective_authority.subject_scope.tenantId, null);
assert.equal(adminEnvelope.effective_authority.authority_granted, false);
assert.equal(adminEnvelope.effective_authority.execution_authority_changed, false);
assert.equal(adminEnvelope.activation_policy.use_authorized_access_for_context_selection, true);
assert.equal(adminEnvelope.activation_policy.secrets_included, false);
assert.equal(adminEnvelope.secrets_included, false);
assert.equal(projectionCalls[0].query, query);

const tenantEnvelope = await buildActivationAuthorizedAccess(
  {
    auth: {
      mode: "user_jwt",
      is_admin: false,
      user_id: "user-1",
      tenant_id: "tenant-1",
      claims: { jti: "jti-1" },
    },
    query: {},
  },
  {
    is_admin: false,
    user_id: "user-1",
    tenant_id: "tenant-1",
    workspace_id: null,
    workspace_key: null,
    brand_key: null,
    context_source: "request_or_auth_context",
  },
  {
    query,
    buildEffectiveAuthorityProjection: projectionBuilder,
  }
);
assert.equal(tenantEnvelope.effective_authority.subject_scope.scopeType, "tenant");
assert.equal(tenantEnvelope.effective_authority.subject_scope.tenantId, "tenant-1");
assert.equal(tenantEnvelope.effective_authority.projection_eligibility.execution, false);
assert.ok(tenantEnvelope.auth_gaps.includes("no_active_membership_for_subject"));

let missingScopeProjectionCalls = 0;
const missingScopeEnvelope = await buildActivationAuthorizedAccess(
  {
    auth: {
      mode: "user_jwt",
      is_admin: false,
      user_id: "user-2",
      tenant_id: null,
    },
    query: {},
  },
  {
    is_admin: false,
    user_id: "user-2",
    tenant_id: null,
    workspace_id: null,
    workspace_key: null,
    brand_key: null,
    context_source: "request_or_auth_context",
  },
  {
    query,
    async buildEffectiveAuthorityProjection() {
      missingScopeProjectionCalls += 1;
      return safeProjection;
    },
  }
);
assert.equal(missingScopeProjectionCalls, 0);
assert.equal(Object.hasOwn(missingScopeEnvelope, "effective_authority"), false);
assert.ok(missingScopeEnvelope.auth_gaps.includes("missing_tenant_id"));
assert.equal(missingScopeEnvelope.secrets_included, false);

console.log("Activation effective-authority envelope integration tests passed");
