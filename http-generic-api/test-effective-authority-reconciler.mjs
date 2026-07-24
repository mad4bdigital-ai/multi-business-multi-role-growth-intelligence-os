import assert from "node:assert/strict";
import { createEffectiveAuthorityReconciler } from "./src/application/effectiveAuthority/effectiveAuthorityReconciler.js";

const capabilityRow = {
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
const scopes = [
  {
    scopeId: "scope-platform",
    scopeKey: "platform:root",
    scopeType: "platform",
    tenantId: null,
    version: 5,
  },
  {
    scopeId: "scope-tenant-1",
    scopeKey: "tenant:tenant-1",
    scopeType: "tenant",
    tenantId: "tenant-1",
    version: 3,
  },
];
const scopeRepository = {
  async listScopes({ limit, afterScopeKey }) {
    assert.equal(limit, 10);
    assert.equal(afterScopeKey, null);
    return {
      scopes,
      page: { hasMore: false, nextScopeKey: null },
    };
  },
};
const authorityRepository = {
  async findCapabilityByKey(key) {
    assert.equal(key, "connector.inventory.read");
    return capabilityRow;
  },
  async summarizeConnectorProjectionStages({ scope }) {
    if (scope.scopeType === "platform") {
      return {
        registeredCount: 6,
        authorizedCount: 6,
        projectedCount: 6,
        executableCandidateCount: 2,
      };
    }
    return {
      registeredCount: 6,
      authorizedCount: 2,
      projectedCount: 0,
      executableCandidateCount: 0,
    };
  },
};
let sequence = 0;
const previewReconciler = createEffectiveAuthorityReconciler({
  scopeRepository,
  authorityRepository,
  evidenceService: { enabled: false },
  now: () => new Date("2026-07-24T00:00:00.000Z"),
  decisionIdFactory: () => `decision-${++sequence}`,
});
const preview = await previewReconciler.run({ limit: 10, persist: false });
assert.equal(preview.ok, true);
assert.equal(preview.status, "drift_detected");
assert.equal(preview.mode, "preview");
assert.equal(preview.synthetic_principal.principalType, "system_reconciler");
assert.equal(preview.synthetic_principal.principalId, "ueacp_shadow_reconciler");
assert.deepEqual(preview.summary, {
  scope_count: 2,
  matched_count: 1,
  drift_count: 1,
  degraded_count: 0,
  persisted_count: 0,
});
assert.equal(preview.items[0].status, "aligned");
assert.equal(preview.items[0].authority_granted, false);
assert.equal(preview.items[0].execution_authority_changed, false);
assert.equal(preview.items[1].status, "drift");
assert.ok(
  preview.items[1].drift_issue_codes.includes("AUTHORITY_AUTHORIZED_NOT_PROJECTED")
);
assert.equal(preview.provider_calls, false);
assert.equal(preview.credential_payload_reads, false);
assert.equal(preview.external_writes, false);
assert.equal(preview.secrets_included, false);

const evidenceCalls = [];
sequence = 0;
const persistReconciler = createEffectiveAuthorityReconciler({
  scopeRepository,
  authorityRepository,
  evidenceService: {
    enabled: true,
    async record(input) {
      evidenceCalls.push(input);
      return {
        status: "persisted",
        readbackVerified: true,
        driftEventCount: input.projectionConsistency.driftDetected ? 1 : 0,
      };
    },
  },
  now: () => new Date("2026-07-24T00:01:00.000Z"),
  decisionIdFactory: () => `persisted-${++sequence}`,
});
const persisted = await persistReconciler.run({ limit: 10, persist: true });
assert.equal(persisted.mode, "persist");
assert.equal(persisted.summary.persisted_count, 2);
assert.equal(evidenceCalls.length, 2);
assert.equal(evidenceCalls[0].source, "ueacp_shadow_reconciler");
assert.equal(
  evidenceCalls[0].manifest.principal.principalType,
  "system_reconciler"
);
assert.equal(evidenceCalls[0].manifest.authorityGranted, false);
assert.equal(evidenceCalls[1].projectionConsistency.driftDetected, true);

await assert.rejects(
  () => previewReconciler.run({ limit: 10, persist: true }),
  (error) =>
    error.code === "AUTHORITY_RECONCILIATION_EVIDENCE_DISABLED" && error.status === 503
);

const degraded = await createEffectiveAuthorityReconciler({
  scopeRepository: {
    async listScopes() {
      return { scopes: [scopes[1]], page: { hasMore: false, nextScopeKey: null } };
    },
  },
  authorityRepository: {
    async findCapabilityByKey() {
      return capabilityRow;
    },
    async summarizeConnectorProjectionStages() {
      const error = new Error("database unavailable");
      error.code = "ER_DBACCESS_DENIED_ERROR";
      throw error;
    },
  },
  now: () => new Date("2026-07-24T00:02:00.000Z"),
}).run({ persist: false });
assert.equal(degraded.ok, false);
assert.equal(degraded.status, "degraded");
assert.equal(degraded.summary.degraded_count, 1);
assert.equal(degraded.items[0].error_code, "ER_DBACCESS_DENIED_ERROR");
assert.equal(degraded.items[0].authority_granted, false);

console.log("effective authority reconciler tests passed");
