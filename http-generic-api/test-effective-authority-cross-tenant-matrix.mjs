import assert from "node:assert/strict";

import { buildActivationAuthorizedAccess } from "./routes/activationRoutes.js";
import { createEffectiveAuthorityController } from "./src/api/effectiveAuthority/effectiveAuthorityController.js";
import { createAuthorityScopeService } from "./src/application/authorityScope/authorityScopeService.js";
import { createEffectiveAuthorityService } from "./src/application/effectiveAuthority/effectiveAuthorityService.js";
import { createEffectiveAuthorityRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityRepository.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const controllerCalls = [];
const controller = createEffectiveAuthorityController({
  service: {
    async listConnectorProjection(input) {
      controllerCalls.push({ method: "list", input });
      return {
        manifest: { authorityGranted: false },
        items: [],
        page: { nextCursor: null, hasMore: false },
        secretsIncluded: false,
      };
    },
    async resolveDecision(input) {
      controllerCalls.push({ method: "resolve", input });
      return {
        manifest: { authorityGranted: false },
        secretsIncluded: false,
      };
    },
  },
});

const listOverrideResponse = responseRecorder();
await controller.listTenantConnectors(
  {
    auth: { mode: "user_jwt", user_id: "user-a", tenant_id: TENANT_A },
    query: { tenantId: TENANT_B },
    requestId: "req-list-override",
  },
  listOverrideResponse
);
assert.equal(listOverrideResponse.statusCode, 400);
assert.equal(listOverrideResponse.body.error.code, "AUTHORITY_UNSUPPORTED_FIELD");
assert.equal(controllerCalls.length, 0);

const decisionOverrideResponse = responseRecorder();
await controller.resolveTenantDecision(
  {
    auth: { mode: "user_jwt", user_id: "user-a", tenant_id: TENANT_A },
    body: { tenantId: TENANT_B },
    requestId: "req-decision-override",
  },
  decisionOverrideResponse
);
assert.equal(decisionOverrideResponse.statusCode, 400);
assert.equal(decisionOverrideResponse.body.error.code, "AUTHORITY_UNSUPPORTED_FIELD");
assert.equal(controllerCalls.length, 0);

const validTenantResponse = responseRecorder();
await controller.listTenantConnectors(
  {
    auth: { mode: "user_jwt", user_id: "user-a", tenant_id: TENANT_A },
    query: {},
    requestId: "req-valid-tenant",
  },
  validTenantResponse
);
assert.equal(validTenantResponse.statusCode, 200);
assert.equal(controllerCalls.length, 1);
assert.equal(controllerCalls[0].input.tenantId, TENANT_A);

const tenantScopes = new Map([
  [TENANT_A, {
    scopeId: "scope-tenant-a",
    scopeKey: `tenant:${TENANT_A}`,
    scopeType: "tenant",
    tenantId: TENANT_A,
    status: "active",
    version: 1,
  }],
  [TENANT_B, {
    scopeId: "scope-tenant-b",
    scopeKey: `tenant:${TENANT_B}`,
    scopeType: "tenant",
    tenantId: TENANT_B,
    status: "active",
    version: 1,
  }],
]);
const authorityScopeService = createAuthorityScopeService({
  repository: {
    async findByKey(scopeKey) {
      return [...tenantScopes.values()].find((scope) => scope.scopeKey === scopeKey) || null;
    },
    async findByTenantId(tenantId) {
      return tenantScopes.get(tenantId) || null;
    },
  },
});

const downstreamCalls = {
  capability: 0,
  connectors: 0,
  summary: 0,
  evidence: 0,
};
const effectiveAuthorityService = createEffectiveAuthorityService({
  authorityScopeService,
  repository: {
    async findCapabilityByKey() {
      downstreamCalls.capability += 1;
      return {
        capability_key: "connector.inventory.read",
        display_name: "Read Connector Inventory",
        resource_type: "connector_collection",
        operation_key: "read",
        risk_class: "A",
        default_execution_mode: "preview",
        requires_connection: 0,
        requires_workspace_authority: 0,
        requires_approval: 0,
        requires_audit_evidence: 1,
        requires_readback: 0,
        schema_version: 1,
        status: "active",
      };
    },
    async listConnectorInventory() {
      downstreamCalls.connectors += 1;
      return { rows: [], hasMore: false, nextSystemId: null };
    },
    async summarizeConnectorProjectionStages() {
      downstreamCalls.summary += 1;
      return {
        registeredCount: 0,
        authorizedCount: 0,
        projectedCount: 0,
        executableCandidateCount: 0,
      };
    },
  },
  evidenceService: {
    enabled: true,
    async record() {
      downstreamCalls.evidence += 1;
    },
  },
});

await assert.rejects(
  () =>
    effectiveAuthorityService.listConnectorProjection({
      auth: { mode: "user_jwt", user_id: "user-a", tenant_id: TENANT_A },
      tenantId: TENANT_B,
    }),
  (error) => {
    assert.equal(error.code, "CROSS_TENANT_AUTHORITY_SCOPE_DENIED");
    assert.equal(error.status, 403);
    return true;
  }
);
assert.deepEqual(downstreamCalls, {
  capability: 0,
  connectors: 0,
  summary: 0,
  evidence: 0,
});

const sqlCalls = [];
const sqlRepository = createEffectiveAuthorityRepository({
  resolvePool: async () => ({
    async execute(sql, params) {
      sqlCalls.push({ sql, params });
      if (sql.includes("registered_count")) {
        return [[{
          registered_count: 0,
          authorized_count: 0,
          projected_count: 0,
          executable_candidate_count: 0,
        }]];
      }
      return [[]];
    },
  }),
});
await sqlRepository.listConnectorInventory({
  scope: tenantScopes.get(TENANT_A),
  limit: 2,
  afterSystemId: null,
});
await sqlRepository.summarizeConnectorProjectionStages({
  scope: tenantScopes.get(TENANT_A),
});
assert.equal(sqlCalls.length, 2);
assert.match(sqlCalls[0].sql, /cs\.tenant_id = \?/);
assert.equal(sqlCalls[0].params[0], TENANT_A);
assert.equal(sqlCalls[0].params.includes(TENANT_B), false);
assert.deepEqual(sqlCalls[1].params, [TENANT_A, TENANT_A, TENANT_A]);

const activationProjectionCalls = [];
const activationEnvelope = await buildActivationAuthorizedAccess(
  {
    auth: {
      mode: "user_jwt",
      is_admin: false,
      user_id: "user-a",
      tenant_id: TENANT_A,
      claims: { jti: "jti-a" },
    },
    query: { tenantId: TENANT_B },
  },
  {
    is_admin: false,
    user_id: "user-a",
    tenant_id: TENANT_A,
    workspace_id: null,
    workspace_key: null,
    brand_key: null,
    context_source: "request_or_auth_context",
  },
  {
    query: async () => ({ ok: true, rows: [] }),
    async buildEffectiveAuthorityProjection(input) {
      activationProjectionCalls.push(input);
      return {
        source: "ueacp_activation_projection",
        status: "active",
        availability: "available",
        decision: "shadow_ready",
        authority_granted: false,
        enforcement_mode: "shadow_only",
        legacy_runtime_authoritative: true,
        execution_authority_changed: false,
        subject_scope: input.scope,
        registered_count: 0,
        authorized_count: 0,
        projected_count: 0,
        executable_candidate_count: 0,
        drift_detected: false,
        drift_issue_codes: [],
        projection_eligibility: {
          activation: true,
          connector_inventory: true,
          execution: false,
        },
        evaluated_at: "2026-07-25T00:00:00.000Z",
        provider_calls: false,
        credential_payload_reads: false,
        external_writes: false,
        secrets_included: false,
      };
    },
  }
);
assert.equal(activationProjectionCalls.length, 1);
assert.equal(activationProjectionCalls[0].scope.scopeType, "tenant");
assert.equal(activationProjectionCalls[0].scope.tenantId, TENANT_A);
assert.equal(JSON.stringify(activationEnvelope).includes(TENANT_B), false);
assert.equal(activationEnvelope.effective_authority.authority_granted, false);
assert.equal(activationEnvelope.effective_authority.execution_authority_changed, false);
assert.equal(activationEnvelope.secrets_included, false);

console.log("effective authority cross-tenant matrix tests passed");
