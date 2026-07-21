import assert from "node:assert/strict";
import { createEffectiveAuthorityService } from "./src/application/effectiveAuthority/effectiveAuthorityService.js";

function capability() {
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
}

const calls = [];
const authorityScopeService = {
  async resolve({ auth, tenantId }) {
    calls.push({ auth, tenantId });
    const platform = auth.is_admin === true && !tenantId;
    return {
      selectionMode: platform ? "platform_default" : "explicit_tenant",
      principal: {
        principalType: platform ? "platform_admin" : "tenant_member",
        principalId: auth.user_id,
      },
      scope: {
        scopeId: platform ? "scope-platform" : "scope-tenant",
        scopeKey: platform ? "platform:root" : `tenant:${tenantId}`,
        scopeType: platform ? "platform" : "tenant",
        tenantId: platform ? null : tenantId,
        version: 3,
      },
    };
  },
};
const repository = {
  async findCapabilityByKey(key) {
    assert.equal(key, "connector.inventory.read");
    return capability();
  },
  async listConnectorInventory({ scope, limit, afterSystemId }) {
    assert.equal(limit, 1);
    assert.equal(afterSystemId, null);
    return {
      rows: [
        {
          system_id: "system-1",
          tenant_id: scope.tenantId || "tenant-platform-owned",
          system_key: "wordpress",
          display_name: "WordPress",
          provider_family: "wordpress",
          connector_family: "wordpress_rest",
          status: "active",
          active_installation_count: 1,
        },
      ],
      hasMore: true,
      nextSystemId: "system-1",
    };
  },
  async summarizeConnectorProjectionStages({ scope }) {
    return {
      registeredCount: 4,
      authorizedCount: scope.scopeType === "platform" ? 4 : 1,
      projectedCount: scope.scopeType === "platform" ? 4 : 1,
      executableCandidateCount: 1,
    };
  },
};
const evidenceCalls = [];
const evidenceService = {
  enabled: true,
  async record(input) {
    evidenceCalls.push(input);
    return { status: "persisted" };
  },
};
const service = createEffectiveAuthorityService({
  authorityScopeService,
  repository,
  evidenceService,
  now: () => new Date("2026-07-21T00:00:00.000Z"),
  decisionIdFactory: () => `decision-${evidenceCalls.length + 1}`,
});

const adminProjection = await service.listConnectorProjection({
  auth: { is_admin: true, user_id: "admin-1" },
  limit: 1,
});
assert.equal(adminProjection.manifest.decision, "shadow_ready");
assert.equal(adminProjection.manifest.subjectScope.scopeType, "platform");
assert.equal(adminProjection.manifest.projectionEligibility.execution, false);
assert.equal(adminProjection.items[0].executionReadiness, "candidate");
assert.equal(adminProjection.page.hasMore, true);
assert.ok(adminProjection.page.nextCursor);
assert.equal(adminProjection.secretsIncluded, false);
assert.equal(evidenceCalls[0].source, "connector_projection_api");
assert.equal(evidenceCalls[0].projectionConsistency.driftDetected, false);

const tenantDecision = await service.resolveDecision({
  auth: { user_id: "user-1", tenant_id: "tenant-1" },
  tenantId: "tenant-1",
});
assert.equal(tenantDecision.manifest.subjectScope.tenantId, "tenant-1");
assert.equal(calls.at(-1).tenantId, "tenant-1");
assert.equal(evidenceCalls[1].source, "authority_decision_api");
assert.equal(evidenceCalls[1].projectionConsistency.counts.authorizedCount, 1);

await assert.rejects(
  () =>
    service.resolveDecision({
      auth: { is_admin: true, user_id: "admin-1" },
      capabilityKey: "content.article.publish",
    }),
  (error) => error.code === "CAPABILITY_NOT_SUPPORTED_BY_UEACP_STAGE"
);

const disabledService = createEffectiveAuthorityService({
  authorityScopeService,
  repository,
  evidenceService: { enabled: false },
  decisionIdFactory: () => "decision-disabled",
});
await disabledService.resolveDecision({
  auth: { is_admin: true, user_id: "admin-1" },
});
assert.equal(evidenceCalls.length, 2);

console.log("effective authority service tests passed");
