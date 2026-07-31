import assert from "node:assert/strict";

import {
  createGrowthControlFinalBoundaryService,
  growthControlFinalBoundaryContract,
} from "./src/application/growthControlPlane/growthControlFinalBoundaryService.js";
import {
  readGrowthControlApprovedHold,
} from "./src/application/growthControlPlane/growthControlApprovalReadbackService.js";

const NOW = new Date("2030-01-01T00:10:00.000Z");
const PLAN_HASH = "a".repeat(64);
const REQUEST_HASH = "b".repeat(64);
const BINDING_HASH = "c".repeat(64);
const TENANT_ID = "tenant-final-01";
const WORKSPACE_ID = "workspace-final-01";
const PLAN_ID = "plan-final-01";
const PLAN_STEP_ID = "plan-step-final-01";
const HOLD_ID = "approval-hold-final-01";
const RESOURCE_ID = "provider:cms/site-01";

const policy = {
  policy_key: "policy.production.publish",
  policy_version_id: "policy-version-production-publish-01",
  version: 1,
  priority: 100,
  status: "active",
  immutable: true,
  conditions: [
    { field: "environment", operator: "equals", value: "production" },
    { field: "provider_write", operator: "equals", value: true },
  ],
  effects: [
    {
      type: "require_approval",
      profile: {
        required_roles: ["publisher"],
        separation_of_duties: true,
        expires_in_seconds: 900,
        delegation_allowed: false,
        max_resource_count: 1,
      },
    },
    { type: "require_typed_confirmation", confirmation_key: "publish.production.confirm" },
    { type: "require_resource_authority", authority_keys: ["cms.site.publish"] },
    { type: "require_certification", certification_keys: ["cms.publish.v1"] },
    { type: "require_readback", readback_keys: ["cms.publish.readback"] },
    { type: "require_rollback", rollback_keys: ["cms.publish.rollback"] },
    { type: "limit_resources", maximum: 1 },
    { type: "limit_concurrency", maximum: 1 },
    { type: "limit_budget", maximum: 1000 },
    { type: "force_environment", environment: "production" },
  ],
};

function approvedRow(overrides = {}) {
  return {
    hold_id: HOLD_ID,
    run_id: PLAN_ID,
    step_run_id: PLAN_STEP_ID,
    tenant_id: TENANT_ID,
    status: "approved",
    required_role: "publisher",
    expires_at: "2030-01-01T00:30:00.000Z",
    execution_context_json: JSON.stringify({
      source: "growth_control_provider_effect",
      binding_sha256: BINDING_HASH,
      plan_id: PLAN_ID,
      plan_step_id: PLAN_STEP_ID,
      plan_hash_sha256: PLAN_HASH,
      request_hash_sha256: REQUEST_HASH,
      node_id: "content.publish",
      capability_key: "content.publish",
      action_ids: ["content.publish"],
      resource_ids: [RESOURCE_ID],
      environment: "production",
      effect_class: "provider_write",
    }),
    ...overrides,
  };
}

function poolFor(row = approvedRow()) {
  return {
    async query(sql, params) {
      assert.match(String(sql), /FROM approval_holds/);
      assert.deepEqual(params, [HOLD_ID]);
      return [[row], []];
    },
  };
}

const baseInput = {
  pool: poolFor(),
  principal: {
    principalType: "tenant_user",
    principalRef: "user-final-01",
    authorizedTenantRefs: [TENANT_ID],
    actorRoles: ["publisher"],
  },
  effectiveSubject: {
    subjectType: "tenant_user",
    subjectRef: "user-final-01",
    tenantRef: TENANT_ID,
    workspaceRef: WORKSPACE_ID,
  },
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandId: "brand-final-01",
  activityBindingId: "binding-final-01",
  capabilityKey: "content.publish",
  operation: "content.publish",
  resource: {
    nodeRef: "site:site-01",
    resourceType: "site",
    resourceRef: "site-01",
    approvalResourceId: RESOURCE_ID,
  },
  resourceIds: [RESOURCE_ID],
  actionIds: ["content.publish"],
  environment: "production",
  effectClass: "provider_write",
  providerBinding: {
    providerBindingRef: "provider-binding-final-01",
    appKey: "wordpress",
    parentActionKey: "content.publish",
    configuredEndpointKey: "legacy.content.publish",
    adapterKey: "wordpress.publish",
    connectionId: "connection-final-01",
    certificationKeys: ["cms.publish.v1"],
  },
  resourceGraph: {
    relationTypes: ["contains"],
    inheritancePolicyKeys: ["inherit_publish"],
    maxDepth: 3,
    maxNodes: 20,
  },
  planId: PLAN_ID,
  planStepId: PLAN_STEP_ID,
  holdId: HOLD_ID,
  nodeId: "content.publish",
  planHashSha256: PLAN_HASH,
  requestHashSha256: REQUEST_HASH,
  policies: [policy],
  typedConfirmationKeys: ["publish.production.confirm"],
  plannedReadbackKeys: ["cms.publish.readback"],
  plannedRollbackKeys: ["cms.publish.rollback"],
  intent: {
    dispatchRequested: true,
    applyRequested: true,
    externalWriteRequested: true,
    concurrency: 1,
    budgetAmount: 500,
  },
  now: NOW,
};

function semanticResult(overrides = {}) {
  return {
    status: "ready",
    ready: true,
    items: [{
      capabilityKey: "content.publish",
      status: "ready",
      ready: true,
      selection: {
        appKey: "wordpress",
        parentActionKey: "content.publish",
        configuredEndpointKey: "legacy.content.publish",
        canonicalEndpointKey: "content.publish",
        adapterKey: "wordpress.publish",
      },
      decisionSha256: "d".repeat(64),
    }],
    evidenceSha256: "e".repeat(64),
    secretsIncluded: false,
    ...overrides,
  };
}

function resourceResult(overrides = {}) {
  return {
    status: "resolved",
    nodes: [{
      nodeRef: "site:site-01",
      resourceType: "site",
      resourceRef: "site-01",
    }],
    edges: [],
    blockedBranches: [],
    reasonCodes: [],
    authorityGranted: false,
    secretsIncluded: false,
    ...overrides,
  };
}

function policyGrantResult(overrides = {}) {
  return {
    status: "resolved",
    decision: "allow",
    policySatisfied: true,
    grantSatisfied: true,
    policyEvidence: [{ reference: "policy-evidence-01", revisionRef: "policy-revision-01" }],
    grantEvidence: [{ reference: "grant-evidence-01", revisionRef: "grant-revision-01" }],
    reasonCodes: ["POLICY_GRANT_ALLOW_RESOLVED"],
    authorityGranted: false,
    secretsIncluded: false,
    ...overrides,
  };
}

function endpointResult(overrides = {}) {
  return {
    status: "resolved",
    decision: "allow",
    canonicalEndpointKey: "content.publish",
    endpointResolved: true,
    certificationSatisfied: true,
    dispatchCertified: true,
    applyCertified: true,
    aliasEvidence: { aliasRef: "alias-final-01" },
    endpointEvidence: { endpointRef: "endpoint-final-01", revisionRef: "endpoint-revision-01" },
    certificationEvidence: { certificationRef: "certification-final-01", revisionRef: "certification-revision-01" },
    reasonCodes: ["ENDPOINT_CERTIFICATION_RESOLVED"],
    authorityGranted: false,
    secretsIncluded: false,
    ...overrides,
  };
}

function harness(overrides = {}) {
  const calls = [];
  const service = createGrowthControlFinalBoundaryService({
    semanticCapabilityAdapter: {
      async previewSemanticCapabilities(input, context) {
        calls.push("semantic_capability");
        assert.deepEqual(input, {
          capabilityKeys: ["content.publish"],
          workspaceId: WORKSPACE_ID,
          resourceRef: "site-01",
          connectionId: "connection-final-01",
        });
        assert.equal(context.tenantId, TENANT_ID);
        return overrides.semantic ?? semanticResult();
      },
    },
    resourceGraphResolver: {
      async resolve(input) {
        calls.push("resource_authority");
        assert.equal(input.tenantRef, TENANT_ID);
        assert.equal(input.rootResource.nodeRef, "site:site-01");
        return overrides.resource ?? resourceResult();
      },
    },
    policyGrantEvaluator: {
      async evaluate(input) {
        calls.push("policy_grant");
        assert.equal(input.capabilityKey, "content.publish");
        assert.equal(input.resource.resourceRef, "site-01");
        return overrides.policyGrant ?? policyGrantResult();
      },
    },
    endpointCertificationResolver: {
      async resolve(input) {
        calls.push("endpoint_certification");
        assert.equal(input.providerBinding.providerBindingRef, "provider-binding-final-01");
        return overrides.endpoint ?? endpointResult();
      },
    },
    approvalHoldReader: {
      async read(input) {
        calls.push("approval");
        return readGrowthControlApprovedHold(input);
      },
    },
  });
  return { service, calls };
}

const originalPool = baseInput.pool;
const originalPolicy = baseInput.policies[0];
const { service, calls } = harness();
const decision = await service.evaluate(baseInput);
assert.deepEqual(calls, [
  "semantic_capability",
  "resource_authority",
  "policy_grant",
  "endpoint_certification",
  "approval",
]);
assert.equal(decision.contract_version, "growth-control-final-boundary-decision-v1");
assert.equal(decision.status, "ready");
assert.equal(decision.decision, "allow");
assert.equal(decision.stage, "complete");
assert.deepEqual(decision.reason_codes, ["FINAL_BOUNDARY_ALL_CHECKS_SATISFIED"]);
assert.equal(decision.execution_authorized, true);
assert.equal(decision.dispatch_allowed, true);
assert.equal(decision.apply_allowed, true);
assert.equal(decision.external_write_allowed, true);
assert.equal(decision.authority_granted, false);
assert.equal(decision.runtime_authority_changed, false);
assert.equal(decision.provider_call_made, false);
assert.equal(decision.provider_dispatch_performed, false);
assert.equal(decision.credential_payload_read, false);
assert.equal(decision.secrets_included, false);
assert.match(decision.boundary_decision_sha256, /^[a-f0-9]{64}$/);
assert.match(decision.evidence.approval.evidence_sha256, /^[a-f0-9]{64}$/);
assert.equal(decision.evidence.policy.decision, "allow_with_requirements");
assert.equal(Object.isFrozen(decision), true);
assert.equal(Object.isFrozen(decision.evidence), true);
assert.equal(Object.isFrozen(originalPool), false, "final-boundary normalization must not freeze the caller's pool");
assert.equal(Object.isFrozen(originalPolicy), false, "final-boundary normalization must not freeze caller-owned policy objects");

const replay = await service.evaluate({
  ...baseInput,
  resourceIds: [...baseInput.resourceIds].reverse(),
  actionIds: [...baseInput.actionIds].reverse(),
  typedConfirmationKeys: [...baseInput.typedConfirmationKeys].reverse(),
});
assert.equal(replay.boundary_decision_sha256, decision.boundary_decision_sha256);

const capabilityBlockedHarness = harness({ semantic: semanticResult({ ready: false, status: "blocked" }) });
const capabilityBlocked = await capabilityBlockedHarness.service.evaluate(baseInput);
assert.equal(capabilityBlocked.status, "blocked");
assert.equal(capabilityBlocked.stage, "semantic_capability");
assert.deepEqual(capabilityBlockedHarness.calls, ["semantic_capability"]);
assert.equal(capabilityBlocked.dispatch_allowed, false);

const resourceBlockedHarness = harness({ resource: resourceResult({ status: "blocked", nodes: [] }) });
const resourceBlocked = await resourceBlockedHarness.service.evaluate(baseInput);
assert.equal(resourceBlocked.stage, "resource_authority");
assert.deepEqual(resourceBlockedHarness.calls, ["semantic_capability", "resource_authority"]);

const policyGrantBlockedHarness = harness({ policyGrant: policyGrantResult({ decision: "deny", grantSatisfied: false }) });
const policyGrantBlocked = await policyGrantBlockedHarness.service.evaluate(baseInput);
assert.equal(policyGrantBlocked.stage, "policy_grant");
assert.deepEqual(policyGrantBlockedHarness.calls, ["semantic_capability", "resource_authority", "policy_grant"]);

const policyDeniedHarness = harness();
const policyDenied = await policyDeniedHarness.service.evaluate({
  ...baseInput,
  policies: [{
    ...policy,
    policy_key: "policy.production.deny",
    policy_version_id: "policy-version-production-deny-01",
    effects: [{ type: "deny", reason_code: "production.publish.denied" }],
  }],
});
assert.equal(policyDenied.stage, "bounded_policy");
assert.deepEqual(policyDeniedHarness.calls, ["semantic_capability", "resource_authority", "policy_grant"]);

const confirmationHarness = harness();
const confirmationBlocked = await confirmationHarness.service.evaluate({
  ...baseInput,
  typedConfirmationKeys: [],
});
assert.equal(confirmationBlocked.stage, "bounded_policy");
assert.deepEqual(confirmationBlocked.reason_codes, ["FINAL_BOUNDARY_TYPED_CONFIRMATION_MISSING"]);
assert.deepEqual(confirmationHarness.calls, ["semantic_capability", "resource_authority", "policy_grant"]);

const certificationHarness = harness({ endpoint: endpointResult({ applyCertified: false }) });
const certificationBlocked = await certificationHarness.service.evaluate(baseInput);
assert.equal(certificationBlocked.stage, "endpoint_certification");
assert.deepEqual(certificationHarness.calls, ["semantic_capability", "resource_authority", "policy_grant", "endpoint_certification"]);

const missingApprovalHarness = harness();
const missingApproval = await missingApprovalHarness.service.evaluate({
  ...baseInput,
  holdId: null,
});
assert.equal(missingApproval.stage, "approval");
assert.deepEqual(missingApproval.reason_codes, ["FINAL_BOUNDARY_APPROVAL_REQUIRED"]);
assert.deepEqual(missingApprovalHarness.calls, ["semantic_capability", "resource_authority", "policy_grant", "endpoint_certification"]);

const openApprovalHarness = harness();
const openApproval = await openApprovalHarness.service.evaluate({
  ...baseInput,
  pool: poolFor(approvedRow({ status: "open" })),
});
assert.equal(openApproval.stage, "approval");
assert.deepEqual(openApproval.reason_codes, ["growth_control_approval_readback_not_approved"]);

const expiredApprovalHarness = harness();
const expiredApproval = await expiredApprovalHarness.service.evaluate({
  ...baseInput,
  pool: poolFor(approvedRow({ expires_at: "2030-01-01T00:05:00.000Z" })),
});
assert.equal(expiredApproval.stage, "approval");
assert.deepEqual(expiredApproval.reason_codes, ["growth_control_approval_readback_expired"]);

const mismatchedApprovalHarness = harness();
const mismatchedContext = JSON.parse(approvedRow().execution_context_json);
mismatchedContext.request_hash_sha256 = "f".repeat(64);
const mismatchedApproval = await mismatchedApprovalHarness.service.evaluate({
  ...baseInput,
  pool: poolFor(approvedRow({ execution_context_json: JSON.stringify(mismatchedContext) })),
});
assert.equal(mismatchedApproval.stage, "approval");
assert.deepEqual(mismatchedApproval.reason_codes, ["growth_control_approval_readback_binding_mismatch"]);

await assert.rejects(
  () => service.evaluate({ ...baseInput, api_key: "forbidden" }),
  (error) => error?.code === "growth_control_final_boundary_sensitive_input",
);
await assert.rejects(
  () => service.evaluate({
    ...baseInput,
    resourceIds: ["provider:cms/site-other"],
  }),
  (error) => error?.code === "growth_control_final_boundary_resource_binding_mismatch",
);

assert.deepEqual(growthControlFinalBoundaryContract.stage_order, [
  "semantic_capability",
  "resource_authority",
  "policy_grant",
  "bounded_policy",
  "endpoint_certification",
  "approval",
]);
assert.equal(growthControlFinalBoundaryContract.fail_closed, true);
assert.equal(growthControlFinalBoundaryContract.approval_required_for_provider_effect, true);
assert.equal(growthControlFinalBoundaryContract.authority_granted, false);
assert.equal(growthControlFinalBoundaryContract.provider_call_made, false);
assert.equal(growthControlFinalBoundaryContract.provider_dispatch_performed, false);
assert.equal(growthControlFinalBoundaryContract.secrets_included, false);

console.log("growth control final-boundary execution gate tests passed");
