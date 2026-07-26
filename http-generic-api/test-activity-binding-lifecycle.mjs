import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIVITY_BINDING_STATES,
  ACTIVITY_BINDING_TRANSITIONS,
  evaluateActivityBindingReadiness,
  planActivityBindingTransition
} from "./src/domain/growthControlPlane/activityBindingLifecycle.js";
import { createActivityBindingLifecycleService } from "./src/application/growthControlPlane/activityBindingLifecycleService.js";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const BINDING_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const BRAND_KEY = "example.brand";

const baseBinding = Object.freeze({
  activityBindingId: BINDING_ID,
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  activityTypeKey: "organic_growth",
  activityPackKey: "travel.organic_growth",
  activityPackVersion: 1,
  allowedCapabilities: ["intent_map_generate", "content_brief_generate"],
  status: "validating",
  revision: 3,
  effectiveFrom: null,
  effectiveTo: null
});
const readyBrandCore = Object.freeze({
  brandKey: BRAND_KEY,
  status: "active",
  validationStatus: "active",
  activeStatus: "active"
});
const readyActivityPack = Object.freeze({
  activityPackKey: "travel.organic_growth",
  version: 1,
  activityTypeKey: "organic_growth",
  status: "active",
  capabilities: ["intent_map_generate", { capabilityKey: "content_brief_generate" }]
});
const activeCapabilities = Object.freeze({
  intent_map_generate: "active",
  content_brief_generate: "active"
});

assert.deepEqual(ACTIVITY_BINDING_STATES, [
  "draft", "validating", "ready", "active", "blocked", "deprecated", "archived"
]);
assert.deepEqual(ACTIVITY_BINDING_TRANSITIONS.active, ["deprecated", "blocked"]);

const readyEvaluation = evaluateActivityBindingReadiness({
  binding: baseBinding,
  brandCore: readyBrandCore,
  activityPack: readyActivityPack,
  capabilityStatuses: activeCapabilities,
  now: NOW
});
assert.equal(readyEvaluation.ready, true);
assert.equal(readyEvaluation.targetStatus, "ready");
assert.equal(readyEvaluation.bindingRevision, 3);
assert.match(readyEvaluation.evidenceSha256, /^[a-f0-9]{64}$/);
assert(readyEvaluation.checks.every((check) => check.pass));
assert.equal(readyEvaluation.providerCalls, false);
assert.equal(readyEvaluation.externalWrites, false);
assert.equal(readyEvaluation.mutationAllowed, false);
assert.equal(readyEvaluation.secretsIncluded, false);

const missingBrandCore = evaluateActivityBindingReadiness({
  binding: baseBinding,
  brandCore: null,
  activityPack: readyActivityPack,
  capabilityStatuses: activeCapabilities,
  now: NOW
});
assert.equal(missingBrandCore.ready, false);
assert.equal(missingBrandCore.targetStatus, "blocked");
assert(missingBrandCore.checks.some((check) => check.code === "brand_core_missing" && !check.pass));

const validatingBrandCore = evaluateActivityBindingReadiness({
  binding: baseBinding,
  brandCore: { ...readyBrandCore, validationStatus: "registered_pending_readback" },
  activityPack: readyActivityPack,
  capabilityStatuses: activeCapabilities,
  now: NOW
});
assert.equal(validatingBrandCore.ready, false);
assert(validatingBrandCore.checks.some((check) => check.code === "brand_core_not_validated" && !check.pass));

const incompatiblePack = evaluateActivityBindingReadiness({
  binding: baseBinding,
  brandCore: readyBrandCore,
  activityPack: { ...readyActivityPack, activityTypeKey: "paid_growth" },
  capabilityStatuses: activeCapabilities,
  now: NOW
});
assert.equal(incompatiblePack.ready, false);
assert(incompatiblePack.checks.some((check) => check.code === "activity_type_compatible" && !check.pass));

const missingPackCapability = evaluateActivityBindingReadiness({
  binding: baseBinding,
  brandCore: readyBrandCore,
  activityPack: { ...readyActivityPack, capabilities: ["intent_map_generate"] },
  capabilityStatuses: activeCapabilities,
  now: NOW
});
assert.equal(missingPackCapability.ready, false);
assert(missingPackCapability.checks.some((check) => check.code === "capabilities_declared_by_pack" && !check.pass));

const inactiveCapability = evaluateActivityBindingReadiness({
  binding: baseBinding,
  brandCore: readyBrandCore,
  activityPack: readyActivityPack,
  capabilityStatuses: { ...activeCapabilities, content_brief_generate: "disabled" },
  now: NOW
});
assert.equal(inactiveCapability.ready, false);
assert(inactiveCapability.checks.some((check) => check.code === "capabilities_active" && !check.pass));

const expiredBinding = evaluateActivityBindingReadiness({
  binding: { ...baseBinding, effectiveTo: "2026-07-25T12:00:00.000Z" },
  brandCore: readyBrandCore,
  activityPack: readyActivityPack,
  capabilityStatuses: activeCapabilities,
  now: NOW
});
assert.equal(expiredBinding.ready, false);
assert(expiredBinding.checks.some((check) => check.code === "binding_not_expired" && !check.pass));

const readyTransition = planActivityBindingTransition({
  binding: baseBinding,
  targetStatus: "ready",
  expectedRevision: 3,
  actorId: "admin",
  now: NOW
});
assert.equal(readyTransition.fromStatus, "validating");
assert.equal(readyTransition.targetStatus, "ready");
assert.equal(readyTransition.update.revision, 4);

assert.throws(
  () => planActivityBindingTransition({
    binding: { ...baseBinding, status: "draft" },
    targetStatus: "active",
    expectedRevision: 3,
    readiness: readyEvaluation,
    now: NOW
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_BINDING_TRANSITION_INVALID" && error.status === 422
);
assert.throws(
  () => planActivityBindingTransition({
    binding: baseBinding,
    targetStatus: "ready",
    expectedRevision: 2,
    now: NOW
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_BINDING_REVISION_CONFLICT" && error.status === 409
);

const readyBinding = { ...baseBinding, status: "ready", revision: 4 };
assert.throws(
  () => planActivityBindingTransition({
    binding: readyBinding,
    targetStatus: "active",
    expectedRevision: 4,
    readiness: null,
    now: NOW
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_BINDING_READINESS_REQUIRED" && error.status === 409
);
const activation = planActivityBindingTransition({
  binding: readyBinding,
  targetStatus: "active",
  expectedRevision: 4,
  readiness: { ready: true, bindingRevision: 4 },
  actorId: "admin-user",
  now: NOW
});
assert.equal(activation.update.status, "active");
assert.equal(activation.update.revision, 5);
assert.equal(activation.update.approvedBy, "admin-user");
assert.equal(activation.update.effectiveFrom.toISOString(), NOW.toISOString());

const repositoryCalls = [];
let repositoryBinding = { ...baseBinding };
let latestReadiness = null;
const repository = {
  async getActivityBindingReadinessContext({ activityBindingId }) {
    repositoryCalls.push(["getContext", activityBindingId]);
    return {
      binding: { ...repositoryBinding },
      brandCore: readyBrandCore,
      activityPack: readyActivityPack,
      capabilityStatuses: activeCapabilities
    };
  },
  async recordActivityBindingReadiness(input) {
    repositoryCalls.push(["recordReadiness", input]);
    latestReadiness = {
      ready: input.targetStatus === "ready",
      bindingRevision: input.expectedRevision + 1,
      evidenceId: input.evidenceId,
      evidenceSha256: input.evidenceSha256
    };
    repositoryBinding = { ...repositoryBinding, status: input.targetStatus, revision: input.expectedRevision + 1 };
    return { evidenceId: input.evidenceId, revision: repositoryBinding.revision };
  },
  async getLatestActivityBindingReadiness({ activityBindingId }) {
    repositoryCalls.push(["getLatestReadiness", activityBindingId]);
    return latestReadiness;
  },
  async applyActivityBindingTransition(input) {
    repositoryCalls.push(["applyTransition", input]);
    repositoryBinding = {
      ...repositoryBinding,
      status: input.targetStatus,
      revision: input.update.revision,
      effectiveFrom: input.update.effectiveFrom,
      effectiveTo: input.update.effectiveTo
    };
    return {
      revision: repositoryBinding.revision,
      approvedBy: input.update.approvedBy,
      effectiveFrom: input.update.effectiveFrom,
      effectiveTo: input.update.effectiveTo
    };
  }
};
const lifecycleService = createActivityBindingLifecycleService({
  repository,
  uuid: () => "44444444-4444-4444-8444-444444444444",
  now: () => new Date(NOW)
});
const readinessResult = await lifecycleService.assessReadiness(BINDING_ID, { expectedRevision: 3 }, {
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  actorId: "admin-user",
  requestId: "request-1",
  correlationId: "correlation-1"
});
assert.equal(readinessResult.ready, true);
assert.equal(readinessResult.status, "ready");
assert.equal(readinessResult.bindingRevision, 4);
assert.equal(readinessResult.evidenceId, "44444444-4444-4444-8444-444444444444");
assert.equal(readinessResult.providerCalls, false);
assert.equal(readinessResult.externalWrites, false);
assert.equal(readinessResult.secretsIncluded, false);

const activationResult = await lifecycleService.transitionActivityBinding(BINDING_ID, {
  targetStatus: "active",
  expectedRevision: 4,
  reason: "Reviewed readiness evidence"
}, {
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  actorId: "admin-user"
});
assert.equal(activationResult.status, "active");
assert.equal(activationResult.revision, 5);
assert.equal(activationResult.providerCalls, false);
assert.equal(activationResult.externalWrites, false);
assert.equal(activationResult.secretsIncluded, false);
assert(repositoryCalls.some(([name]) => name === "recordReadiness"));
assert(repositoryCalls.some(([name]) => name === "applyTransition"));

await assert.rejects(
  () => lifecycleService.assessReadiness(BINDING_ID, { expectedRevision: 5 }, {
    tenantId: "different-tenant"
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_BINDING_SCOPE_FORBIDDEN" && error.status === 403
);

const domainSource = readFileSync("src/domain/growthControlPlane/activityBindingLifecycle.js", "utf8");
const serviceSource = readFileSync("src/application/growthControlPlane/activityBindingLifecycleService.js", "utf8");
for (const source of [domainSource, serviceSource]) {
  assert.equal(source.includes("providerCalls: true"), false);
  assert.equal(source.includes("externalWrites: true"), false);
  assert.equal(/(?:INSERT\s+INTO|UPDATE\s+[A-Za-z0-9_`]+\s+SET|DELETE\s+FROM)\s+/i.test(source), false);
}

console.log("activity binding lifecycle core tests passed");
