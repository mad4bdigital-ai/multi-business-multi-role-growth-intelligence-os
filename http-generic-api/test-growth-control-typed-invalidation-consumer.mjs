import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { stableSha256 } from "./src/domain/growthControlPlane/growthControlPlane.js";
import {
  GROWTH_CONTROL_LIFECYCLE_EVENT_TYPES,
  buildGrowthControlInvalidationPlan,
  validateGrowthControlLifecycleEvent,
} from "./src/domain/growthControlPlane/growthControlLifecycleEvents.js";
import {
  createGrowthControlInvalidationConsumer,
} from "./src/application/growthControlPlane/growthControlInvalidationConsumer.js";
import {
  GROWTH_CONTROL_INVALIDATION_CONSUMER_KEY,
  _testingGrowthControlInvalidationRepository,
} from "./src/infrastructure/growthControlPlane/growthControlInvalidationRepository.js";

const payload = Object.freeze({
  contract: "mad4b.growth-control.configuration.lifecycle.v1",
  operation: "activate",
  configVersionId: "11111111-1111-4111-8111-111111111111",
  configKey: "growth.execution.policy",
  scopeType: "brand",
  scopeKey: "tenant:t1:workspace:w1:brand:b1",
  versionNumber: 4,
  versionRevision: 5,
  lifecycle: "active",
  previousActiveVersionIds: Object.freeze([
    "22222222-2222-4222-8222-222222222222",
  ]),
  approvalHoldId: "33333333-3333-4333-8333-333333333333",
  bindingSha256: "a".repeat(64),
});

const validEvent = Object.freeze({
  eventId: "44444444-4444-4444-8444-444444444444",
  eventType: "growth_control.configuration.activated",
  schemaVersion: 1,
  aggregateType: "growth_control_configuration",
  aggregateId: payload.configVersionId,
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  sourceEnvironment: "development",
  occurredAt: "2026-07-31T05:00:00.000Z",
  payload,
  metadata: Object.freeze({
    producer: "growth_control_plane",
    actorId: "platform_admin",
    requestId: "request-1",
    correlationId: "correlation-1",
  }),
  payloadSha256: stableSha256(payload),
});

assert.deepEqual(GROWTH_CONTROL_LIFECYCLE_EVENT_TYPES, [
  "growth_control.configuration.activated",
  "growth_control.configuration.rolled_back",
]);

const typed = validateGrowthControlLifecycleEvent(validEvent);
assert.equal(typed.eventId, validEvent.eventId);
assert.equal(typed.payload.operation, "activate");
assert.equal(typed.payloadSha256, stableSha256(payload));
assert.equal(typed.secretsIncluded, false);

const plan = buildGrowthControlInvalidationPlan(validEvent);
assert.equal(plan.contract, "mad4b.growth-control.invalidation-plan.v1");
assert.equal(plan.eventId, validEvent.eventId);
assert.equal(plan.payloadSha256, validEvent.payloadSha256);
assert.equal(plan.invalidationCount, 7);
assert.equal(plan.readbackRequired, true);
assert.equal(plan.providerCalls, false);
assert.equal(plan.externalWrites, false);
assert.equal(plan.secretsIncluded, false);
assert.match(plan.planSha256, /^[0-9a-f]{64}$/);
assert.deepEqual(
  plan.entries.map((entry) => entry.invalidationKey),
  [...plan.entries.map((entry) => entry.invalidationKey)].sort(),
  "invalidation entries must be deterministically ordered",
);
assert(plan.entries.some((entry) => entry.invalidationType === "configuration_definition"));
assert(plan.entries.some((entry) => entry.invalidationType === "effective_scope_resolution"));
assert(plan.entries.some((entry) => entry.invalidationType === "compiled_plan_dependencies"));
assert(plan.entries.some((entry) => entry.sourceVersionId === payload.configVersionId));
assert(plan.entries.some((entry) => entry.sourceVersionId === payload.previousActiveVersionIds[0]));
assert(plan.entries.every((entry) => entry.secretsIncluded === false));
assert.deepEqual(plan, buildGrowthControlInvalidationPlan(validEvent));

assert.throws(
  () => validateGrowthControlLifecycleEvent({
    ...validEvent,
    eventType: "growth_control.configuration.rolled_back",
  }),
  (error) => error?.code === "GROWTH_CONTROL_EVENT_OPERATION_MISMATCH",
);
assert.throws(
  () => validateGrowthControlLifecycleEvent({
    ...validEvent,
    aggregateId: "other-version",
  }),
  (error) => error?.code === "GROWTH_CONTROL_EVENT_AGGREGATE_MISMATCH",
);
assert.throws(
  () => validateGrowthControlLifecycleEvent({
    ...validEvent,
    payload: { ...payload, unsupported: true },
  }),
  (error) => error?.code === "GROWTH_CONTROL_EVENT_FIELD_UNSUPPORTED",
);
assert.throws(
  () => validateGrowthControlLifecycleEvent({
    ...validEvent,
    metadata: {
      ...validEvent.metadata,
      actorId: { token: "must-not-leak" },
    },
  }),
  (error) => error?.code === "GROWTH_CONTROL_SECRET_FIELD_FORBIDDEN",
);
assert.throws(
  () => validateGrowthControlLifecycleEvent({
    ...validEvent,
    payloadSha256: "b".repeat(64),
  }),
  (error) => error?.code === "GROWTH_CONTROL_EVENT_PAYLOAD_HASH_MISMATCH",
);
assert.throws(
  () => validateGrowthControlLifecycleEvent({
    ...validEvent,
    payload: {
      ...payload,
      previousActiveVersionIds: [
        payload.previousActiveVersionIds[0],
        payload.previousActiveVersionIds[0],
      ],
    },
  }),
  (error) => error?.code === "GROWTH_CONTROL_EVENT_PREVIOUS_VERSIONS_INVALID",
);

const invalidEvent = Object.freeze({
  ...validEvent,
  eventId: "55555555-5555-4555-8555-555555555555",
  payload: Object.freeze({ ...payload, operation: "rollback" }),
  payloadSha256: stableSha256({ ...payload, operation: "rollback" }),
});

const calls = [];
const repository = {
  async previewEvents({ limit }) {
    calls.push(["previewEvents", limit]);
    return [validEvent, invalidEvent];
  },
  async claimEvents({ limit }) {
    calls.push(["claimEvents", limit]);
    return {
      claimToken: "claim-token",
      consumer: { consumerKey: GROWTH_CONTROL_INVALIDATION_CONSUMER_KEY },
      events: [validEvent, invalidEvent],
    };
  },
  async applyInvalidationPlan({ eventId, claimToken, plan: appliedPlan }) {
    calls.push(["applyInvalidationPlan", eventId, claimToken, appliedPlan.planSha256]);
    return {
      applied: true,
      idempotentReadback: false,
      revisions: appliedPlan.entries.map((entry, index) => ({
        invalidationKey: entry.invalidationKey,
        revision: index + 1,
        lastEventId: eventId,
      })),
    };
  },
  async markDeliveryFailed({ eventId, claimToken, error, retryable }) {
    calls.push(["markDeliveryFailed", eventId, claimToken, error.code, retryable]);
    return { updated: true, deadLetter: !retryable, attemptCount: 1 };
  },
};

const consumer = createGrowthControlInvalidationConsumer({ repository });
const preview = await consumer.preview({ limit: 10 });
assert.equal(preview.ok, false);
assert.equal(preview.mode, "dry_run");
assert.equal(preview.eligibleCount, 2);
assert.equal(preview.validCount, 1);
assert.equal(preview.blockedCount, 1);
assert.equal(preview.appliesInvalidation, false);
assert.equal(preview.providerCalls, false);
assert.equal(preview.externalWrites, false);
assert.equal(preview.secretsIncluded, false);

const applied = await consumer.apply({ limit: 10 });
assert.equal(applied.ok, false);
assert.equal(applied.claimedCount, 2);
assert.equal(applied.appliedCount, 1);
assert.equal(applied.failedCount, 1);
assert.equal(applied.results[0].revisionCount, plan.invalidationCount);
assert.equal(applied.results[1].deadLetter, true);
assert(calls.some(([name]) => name === "applyInvalidationPlan"));
assert(calls.some(([name, eventId, claimToken, code, retryable]) => (
  name === "markDeliveryFailed"
  && eventId === invalidEvent.eventId
  && claimToken === "claim-token"
  && code === "GROWTH_CONTROL_EVENT_OPERATION_MISMATCH"
  && retryable === false
)));

assert.equal(_testingGrowthControlInvalidationRepository.boundedLimit("25"), 25);
assert.throws(
  () => _testingGrowthControlInvalidationRepository.boundedLimit(101),
  (error) => error?.code === "GROWTH_CONTROL_INVALIDATION_LIMIT_INVALID",
);
const mappedEvent = _testingGrowthControlInvalidationRepository.eventRow({
  event_id: validEvent.eventId,
  event_type: validEvent.eventType,
  schema_version: 1,
  aggregate_type: validEvent.aggregateType,
  aggregate_id: validEvent.aggregateId,
  tenant_id: validEvent.tenantId,
  workspace_id: validEvent.workspaceId,
  source_environment: "development",
  occurred_at: validEvent.occurredAt,
  payload_json: JSON.stringify(payload),
  metadata_json: JSON.stringify(validEvent.metadata),
  payload_sha256: validEvent.payloadSha256,
  delivery_status: "pending",
  attempt_count: 0,
});
assert.equal(mappedEvent.eventId, validEvent.eventId);
assert.deepEqual(mappedEvent.payload, payload);
assert.equal(mappedEvent.secretsIncluded, false);

const migrationSource = await fs.readFile(
  new URL("./migrations/20260731_growth_control_typed_invalidation_consumer.sql", import.meta.url),
  "utf8",
);
assert.match(migrationSource, /growth_control_invalidation_revisions/);
assert.match(migrationSource, /growth_control_invalidation_v1/);
assert.match(migrationSource, /'shadow'/);
assert.match(migrationSource, /CHECK \(`secrets_included` = 0\)/);
assert.match(migrationSource, /provider_writes',FALSE/);
assert.match(migrationSource, /external_sends',FALSE/);

const repositorySource = await fs.readFile(
  new URL("./src/infrastructure/growthControlPlane/growthControlInvalidationRepository.js", import.meta.url),
  "utf8",
);
assert.match(repositorySource, /consumer\.status !== "active"/);
assert.match(repositorySource, /transportKey !== "noop"/);
assert.match(repositorySource, /status='claimed'/);
assert.match(repositorySource, /ON DUPLICATE KEY UPDATE/);
assert.match(repositorySource, /GROWTH_CONTROL_INVALIDATION_READBACK_MISMATCH/);

const cliSource = await fs.readFile(
  new URL("./scripts/growth-control-invalidation-consumer.mjs", import.meta.url),
  "utf8",
);
assert.match(cliSource, /GROWTH_CONTROL_INVALIDATION_APPLY !== "true"/);
assert.match(cliSource, /consumer\.preview/);
assert.match(cliSource, /consumer\.apply/);

console.log("growth control typed invalidation consumer tests passed");
