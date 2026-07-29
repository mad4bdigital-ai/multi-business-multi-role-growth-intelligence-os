import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAuthenticatedPrincipal,
  createEffectiveSubject,
} from "./contextKernel/domain/index.js";
import {
  createContextPinService,
  createContextResolutionService,
  createContextSwitchService,
  createExecutionPlanService,
  createUnknownOutcomeReconciliationService,
  freezeApplicationValue,
} from "./contextKernel/application/index.js";

const FIXED_INSTANT = "2026-07-25T12:00:00.000Z";
const clock = () => new Date(FIXED_INSTANT);

function assertRejectCode(run, expectedCode) {
  let error = null;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `Expected ${expectedCode} to be thrown.`);
  assert.equal(error.code, expectedCode);
  return error;
}

const sanitized = freezeApplicationValue({
  secretsIncluded: false,
  credentialPayloadRead: false,
  providerCallMade: false,
  automaticWritePerformed: false,
  credentialRef: "credential-ref-a",
  secret: "remove-me",
  accessToken: "remove-me",
  nested: {
    apiKey: "remove-me",
    readbackPerformed: true,
    secretsIncluded: false,
  },
});
assert.equal(sanitized.secretsIncluded, false);
assert.equal(sanitized.credentialPayloadRead, false);
assert.equal(sanitized.providerCallMade, false);
assert.equal(sanitized.automaticWritePerformed, false);
assert.equal(sanitized.credentialRef, "credential-ref-a");
assert.equal(Object.hasOwn(sanitized, "secret"), false);
assert.equal(Object.hasOwn(sanitized, "accessToken"), false);
assert.equal(Object.hasOwn(sanitized.nested, "apiKey"), false);
assert.equal(sanitized.nested.readbackPerformed, true);
assert.equal(sanitized.nested.secretsIncluded, false);

const principal = createAuthenticatedPrincipal({
  principalType: "tenant_user",
  principalRef: "user-a",
  authorizedTenantRefs: ["tenant-a"],
});
const effectiveSubject = createEffectiveSubject({
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
});
const tenantOnlySubject = createEffectiveSubject({
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
});

const authorizedScopeRepository = {
  async findAuthorizedScope({ tenantRef, userRef }) {
    assert.equal(tenantRef, "tenant-a");
    assert.equal(userRef, "user-a");
    return {
      tenantRef,
      userRef,
      membership: { role: "owner", status: "active" },
      workspaces: [{ workspaceRef: "workspace-a" }],
    };
  },
};

const resourceRows = [
  {
    sourceType: "workspace_resource_grant",
    stableRef: "resource-grant-a",
    tenantRef: "tenant-a",
    userRef: "user-a",
    workspaceRef: "workspace-a",
    resourceType: "workspace",
    resourceRef: "workspace-a",
    permission: "admin",
    authoritySource: "membership_default",
  },
];
const resourceGraphRepository = {
  async listAuthorizedResources() {
    return resourceRows;
  },
};

const exactConnectionCalls = [];
const exactConnectionRepository = {
  async findExactConnection(input) {
    exactConnectionCalls.push(input);
    if (input.connectionRef !== "connection-a") return null;
    return {
      connectionRef: "connection-a",
      userRef: "user-a",
      tenantRef: "tenant-a",
      workspaceRef: "workspace-a",
      appKey: "wordpress",
      displayLabel: "WordPress A",
      accountLabel: "Account A",
      authType: "application_password",
      permissionMode: "strict",
      validationStatus: "valid",
      status: "active",
      primary: true,
      actionGrant: {
        grantRef: "grant-a",
        grantMode: "explicit",
      },
    };
  },
};

const readiness = {
  capabilityKey: "wordpress.post.publish",
  runtimeStatus: "active",
  operationClass: "mutation",
  riskClass: "high",
  dispatchAllowed: true,
  applyAllowed: true,
  hardBlockCount: 0,
  currentManifest: {
    manifestHash: "manifest-hash-a",
    manifestVersion: 3,
  },
};
const capabilityReadinessRepository = {
  async findCapabilityReadiness({ capabilityKey }) {
    return capabilityKey === readiness.capabilityKey ? readiness : null;
  },
};

const pinWrites = [];
const pinInvalidations = [];
const pinnedConnection = {
  pinRef: "pin-connection",
  stableRef: "connection-a",
  contextRevision: "revision-a",
  verified: true,
  expiresAt: "2026-07-26T12:00:00.000Z",
};
const contextPinRepository = {
  async findContextPin({ pinRef }) {
    return pinRef === pinnedConnection.pinRef ? pinnedConnection : null;
  },
  async createPin(request) {
    pinWrites.push(request);
    return { ...request, persisted: true };
  },
  async invalidatePin(request) {
    pinInvalidations.push(request);
    return { ...request, invalidated: true };
  },
};

const resolutionService = createContextResolutionService({
  authorizedScopeRepository,
  resourceGraphRepository,
  exactConnectionRepository,
  capabilityReadinessRepository,
  contextPinRepository,
});

const resolution = await resolutionService.resolve({
  principal,
  effectiveSubject,
  pinRef: "pin-connection",
  currentContextRevision: "revision-a",
  appKey: "wordpress",
  actionKey: "post.publish",
  capabilityKey: "wordpress.post.publish",
  operationIntent: "publish_wordpress_post",
  operationKind: "mutation",
  riskClass: "high",
  now: clock(),
});
assert.equal(resolution.status, "resolved");
assert.equal(resolution.selectedCandidate.stableRef, "connection-a");
assert.equal(resolution.context.connectionRef, "connection-a");
assert.equal(resolution.context.pinRef, "pin-connection");
assert.equal(resolution.automaticWritePerformed, false);
assert.equal(resolution.secretsIncluded, false);
assert.equal(exactConnectionCalls.length, 1);
assert.equal(exactConnectionCalls[0].connectionRef, "connection-a");
assert.equal(exactConnectionCalls[0].workspaceRef, "workspace-a");

const ambiguousResolutionService = createContextResolutionService({
  authorizedScopeRepository,
  resourceGraphRepository: {
    async listAuthorizedResources() {
      return [
        resourceRows[0],
        {
          ...resourceRows[0],
          stableRef: "resource-grant-b",
          resourceRef: "workspace-b",
          workspaceRef: "workspace-b",
        },
      ];
    },
  },
  exactConnectionRepository,
  capabilityReadinessRepository,
  contextPinRepository,
});
const ambiguous = await ambiguousResolutionService.resolve({
  principal,
  effectiveSubject: tenantOnlySubject,
  operationIntent: "read_workspace",
  operationKind: "read",
  riskClass: "read",
  now: clock(),
});
assert.equal(ambiguous.status, "interpretation_required");
assert.equal(ambiguous.candidates.length, 2);
assert.equal(ambiguous.automaticWritePerformed, false);
assert.equal(ambiguous.secretsIncluded, false);

const pinService = createContextPinService({
  contextPinRepository,
  idFactory: () => "pin-created",
  clock,
});
const createdPin = await pinService.create({
  resolution,
  principalType: "tenant_user",
  principalRef: "user-a",
  expiresAt: "2026-07-26T12:00:00.000Z",
});
assert.equal(createdPin.pin.pinRef, "pin-created");
assert.equal(createdPin.pin.stableRef, "connection-a");
assert.equal(createdPin.persisted, true);
assert.equal(pinWrites.length, 1);
const readPin = await pinService.read({
  tenantRef: "tenant-a",
  pinRef: "pin-connection",
  principalType: "tenant_user",
  principalRef: "user-a",
});
assert.equal(readPin.stableRef, "connection-a");
const invalidatedPin = await pinService.invalidate({
  tenantRef: "tenant-a",
  pinRef: "pin-connection",
  principalType: "tenant_user",
  principalRef: "user-a",
  reason: "manual_switch",
});
assert.equal(invalidatedPin.invalidated, true);
assert.equal(pinInvalidations.length, 1);

const nextContext = {
  ...resolution.context,
  contextHash: "next-context-hash",
  contextRevision: "next-context-revision",
  connectionRef: "connection-b",
  resourceRef: "wordpress:connection-b",
  selectedCandidate: {
    ...resolution.context.selectedCandidate,
    stableRef: "connection-b",
    connectionRef: "connection-b",
    resourceRef: "wordpress:connection-b",
  },
  pinRef: null,
};
const switchService = createContextSwitchService({
  resolutionService: {
    async resolve() {
      return {
        status: "resolved",
        reasonCodes: [],
        selectedCandidate: nextContext.selectedCandidate,
        context: nextContext,
      };
    },
  },
  contextPinRepository,
});
const preparedSwitch = await switchService.prepare({
  currentContext: resolution.context,
  nextResolutionInput: { explicitRef: "connection-b" },
});
assert.equal(preparedSwitch.status, "switch_ready");
assert.ok(preparedSwitch.changedDimensions.includes("connection"));
assert.equal(preparedSwitch.pinInvalidationRequired, true);
assert.equal(preparedSwitch.automaticWritePerformed, false);
const appliedSwitch = await switchService.apply({
  currentContext: resolution.context,
  nextResolutionInput: { explicitRef: "connection-b" },
  principalType: "tenant_user",
  principalRef: "user-a",
});
assert.equal(appliedSwitch.status, "switched");
assert.equal(appliedSwitch.automaticWritePerformed, true);
assert.equal(appliedSwitch.invalidatedPin.invalidated, true);
assert.equal(pinInvalidations.length, 2);

const planService = createExecutionPlanService({
  idFactory: () => "plan-a",
  clock,
  defaultTtlMs: 10 * 60 * 1000,
});
const plan = planService.compile({
  resolution,
  operationIntent: "publish_wordpress_post",
  operationKind: "mutation",
  riskClass: "high",
  capabilityKey: "wordpress.post.publish",
  idempotencyKey: "idem-a",
  steps: [
    {
      stepRef: "step-a",
      actionKey: "wordpress.post.publish",
      resourceRef: "post-a",
      capabilityKey: "wordpress.post.publish",
      operationKind: "mutation",
      riskClass: "high",
    },
  ],
});
assert.equal(plan.status, "compiled");
assert.equal(plan.requiresApproval, true);
assert.equal(plan.executionAllowed, false);
assert.equal(plan.secretsIncluded, false);
const validPlan = planService.validate({
  plan,
  currentContext: resolution.context,
  approvalRef: "approval-a",
  now: new Date("2026-07-25T12:01:00.000Z"),
});
assert.equal(validPlan.valid, true);
assert.equal(validPlan.executionAllowed, true);
assert.equal(validPlan.secretsIncluded, false);
const stalePlan = planService.validate({
  plan,
  currentContext: {
    ...resolution.context,
    contextRevision: "different-revision",
  },
  approvalRef: "approval-a",
  now: new Date("2026-07-25T12:01:00.000Z"),
});
assert.equal(stalePlan.valid, false);
assert.ok(stalePlan.reasonCodes.includes("context_revision_mismatch"));
assertRejectCode(
  () => planService.compile({
    resolution: {
      ...resolution,
      capabilityReadiness: null,
    },
    operationIntent: "unsafe_mutation",
    operationKind: "mutation",
    riskClass: "high",
  }),
  "capability_readiness_required",
);

let conflictReadbackCalls = 0;
const conflictReconciliation = createUnknownOutcomeReconciliationService({
  executionLedgerRepository: {
    async findExecutionPlan() {
      return { planRef: "plan-a", planStatus: "applied", runtimeStatus: "unknown" };
    },
    async listExecutionEvents() {
      return [{ eventType: "failed_before_apply", toStatus: "failed_before_apply" }];
    },
    async appendExecutionEvent() {
      throw new Error("not used");
    },
  },
  async readbackPort() {
    conflictReadbackCalls += 1;
    return "still_unknown";
  },
  clock,
});
const conflictResult = await conflictReconciliation.reconcile({
  tenantRef: "tenant-a",
  planRef: "plan-a",
});
assert.equal(conflictResult.outcome, "conflict");
assert.equal(conflictResult.nextAction, "manual_conflict_review");
assert.equal(conflictResult.readbackPerformed, false);
assert.equal(conflictResult.retryAllowed, false);
assert.equal(conflictResult.automaticRetryPerformed, false);
assert.equal(conflictResult.secretsIncluded, false);
assert.equal(conflictReadbackCalls, 0);

const readbackReconciliation = createUnknownOutcomeReconciliationService({
  executionLedgerRepository: {
    async findExecutionPlan() {
      return { planRef: "plan-b", planStatus: "unknown", runtimeStatus: "unknown" };
    },
    async listExecutionEvents() {
      return [];
    },
    async appendExecutionEvent() {
      throw new Error("not used");
    },
  },
  async readbackPort({ input }) {
    assert.equal(Object.hasOwn(input, "accessToken"), false);
    return {
      outcome: "confirmed_not_applied",
      evidence: {
        source: "provider_readback",
        credentialRef: "credential-ref-a",
        secret: "remove-me",
        secretsIncluded: false,
      },
    };
  },
  clock,
});
const readbackResult = await readbackReconciliation.reconcile({
  tenantRef: "tenant-a",
  planRef: "plan-b",
  readbackInput: {
    resourceRef: "post-a",
    accessToken: "remove-me",
  },
});
assert.equal(readbackResult.outcome, "confirmed_not_applied");
assert.equal(readbackResult.nextAction, "prepare_new_plan");
assert.equal(readbackResult.readbackPerformed, true);
assert.equal(readbackResult.retryAllowed, false);
assert.equal(Object.hasOwn(readbackResult.evidence, "secret"), false);
assert.equal(readbackResult.evidence.credentialRef, "credential-ref-a");
assert.equal(readbackResult.evidence.secretsIncluded, false);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationDirectory = path.join(currentDirectory, "contextKernel", "application");
const applicationFiles = (await readdir(applicationDirectory))
  .filter((fileName) => fileName.endsWith(".js"));
for (const fileName of applicationFiles) {
  const source = await readFile(path.join(applicationDirectory, fileName), "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*infrastructure/i, `${fileName} must not import infrastructure.`);
  assert.doesNotMatch(source, /\bexpress\b|\bmysql2\b|process\.env|\bfetch\s*\(/i, `${fileName} crossed the application boundary.`);
  assert.doesNotMatch(source, /@google|@aws-sdk|openai|axios/i, `${fileName} imported a provider SDK.`);
}

console.log("context kernel application use-case tests passed");
