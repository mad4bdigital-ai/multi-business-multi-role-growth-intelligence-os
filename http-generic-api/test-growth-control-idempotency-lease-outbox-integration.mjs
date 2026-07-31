import assert from "node:assert/strict";

import { createDurableReceiptAwareExecutor } from "./durableExecutionControlService.js";
import { enqueuePlatformOutboxEvent, runPlatformOutboxWorker } from "./platformOutbox.js";

const CONSUMER_KEY = "growth_control_effects_v1";
const EVENT_TYPE = "growth_control.provider_effect.recorded";
const MASK_POLICY_KEY = "growth_control_effects_mask_v1";

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function due(value) {
  return value == null || new Date(value).getTime() <= Date.now();
}

function createIntegrationDatabase() {
  const state = {
    receipts: [],
    events: new Map(),
    deliveries: new Map(),
    nextEventSequence: 1,
    queries: [],
    eventTypes: new Map([[
      EVENT_TYPE,
      {
        event_type: EVENT_TYPE,
        current_schema_version: 1,
        payload_classification: "internal",
        contains_pii: 0,
        status: "active",
      },
    ]]),
    consumers: new Map([[
      CONSUMER_KEY,
      {
        consumer_key: CONSUMER_KEY,
        display_name: "Growth Control provider effect consumer",
        target_environment: "test",
        transport_key: "https_batch_v1",
        status: "shadow",
        endpoint_url: "https://shadow.example.internal/outbox/batch",
        auth_scheme: "none",
        credential_ref: null,
        mask_policy_key: MASK_POLICY_KEY,
        batch_size: 10,
        timeout_ms: 10000,
        max_attempts: 8,
        retry_base_seconds: 1,
        last_success_at: null,
        last_failure_at: null,
        last_error_code: null,
      },
    ]]),
    policies: new Map([[
      MASK_POLICY_KEY,
      {
        policy_key: MASK_POLICY_KEY,
        policy_json: JSON.stringify({
          deny_keys: [],
          mask_keys: [],
          maximum_event_bytes: 131072,
          secrets_allowed: false,
        }),
        checksum_sha256: "a".repeat(64),
        status: "active",
      },
    ]]),
  };

  const deliveryKey = (eventId, consumerKey) => `${eventId}:${consumerKey}`;

  function insertDelivery(eventId, consumerKey) {
    const key = deliveryKey(eventId, consumerKey);
    if (state.deliveries.has(key)) return false;
    state.deliveries.set(key, {
      event_id: eventId,
      consumer_key: consumerKey,
      status: "pending",
      attempt_count: 0,
      next_attempt_at: new Date(0),
      claim_token: null,
      claim_expires_at: null,
      response_status: null,
      delivered_at: null,
      last_error_code: null,
      last_error_message: null,
    });
    return true;
  }

  function eligibleRows(consumerKey, limit) {
    return [...state.deliveries.values()]
      .filter((delivery) => {
        if (delivery.consumer_key !== consumerKey) return false;
        if (!["pending", "failed"].includes(delivery.status)) return false;
        if (!due(delivery.next_attempt_at)) return false;
        if (!due(delivery.claim_expires_at)) return false;
        const event = state.events.get(delivery.event_id);
        return Boolean(event && due(event.available_at)
          && (event.retention_expires_at == null || !due(event.retention_expires_at)));
      })
      .sort((left, right) => {
        const leftEvent = state.events.get(left.event_id);
        const rightEvent = state.events.get(right.event_id);
        const timeDiff = new Date(leftEvent.occurred_at).getTime() - new Date(rightEvent.occurred_at).getTime();
        return timeDiff || leftEvent.id - rightEvent.id;
      })
      .slice(0, limit)
      .map((delivery) => {
        const event = state.events.get(delivery.event_id);
        return {
          event_id: delivery.event_id,
          consumer_key: delivery.consumer_key,
          attempt_count: delivery.attempt_count,
          tenant_id: event.tenant_id,
          workspace_id: event.workspace_id,
          aggregate_type: event.aggregate_type,
          aggregate_id: event.aggregate_id,
          event_type: event.event_type,
          schema_version: event.schema_version,
          payload_json: event.payload_json,
          metadata_json: event.metadata_json,
          payload_sha256: event.payload_sha256,
          payload_classification: event.payload_classification,
          contains_pii: event.contains_pii,
          source_environment: event.source_environment,
          occurred_at: event.occurred_at,
        };
      });
  }

  async function query(sql, params = []) {
    const normalized = normalizeSql(sql);
    state.queries.push({ sql: normalized, params });

    if (normalized.includes("SELECT * FROM execution_plan_mutation_receipts")) {
      const [planStepId, requestSha256] = params;
      return [state.receipts.filter((receipt) => (
        receipt.plan_step_id === planStepId && receipt.request_sha256 === requestSha256
      ))];
    }

    if (normalized.startsWith("INSERT INTO execution_plan_mutation_receipts")) {
      const [receiptId, planId, planStepId, tenantId, operationKey, idempotencyKey, requestSha256] = params;
      state.receipts.push({
        receipt_id: receiptId,
        plan_id: planId,
        plan_step_id: planStepId,
        tenant_id: tenantId,
        operation_key: operationKey,
        idempotency_key: idempotencyKey,
        request_sha256: requestSha256,
        dispatch_status: "pending",
        provider_status: null,
        provider_receipt_json: null,
        readback_json: null,
        recovered_from_transport: 0,
      });
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("UPDATE execution_plan_mutation_receipts")
      && normalized.includes("SET dispatch_status = 'pending'")) {
      const receipt = state.receipts.find((candidate) => candidate.receipt_id === params[0]);
      assert.ok(receipt, "receipt reset must resolve exactly one row");
      Object.assign(receipt, {
        dispatch_status: "pending",
        provider_status: null,
        provider_receipt_json: null,
        readback_json: null,
        recovered_from_transport: 0,
      });
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("UPDATE execution_plan_mutation_receipts")
      && normalized.includes("SET dispatch_status = ?")) {
      const [dispatchStatus, providerStatus, providerReceiptJson, recoveredFromTransport, receiptId] = params;
      const receipt = state.receipts.find((candidate) => candidate.receipt_id === receiptId);
      assert.ok(receipt, "receipt finalization must resolve exactly one row");
      Object.assign(receipt, {
        dispatch_status: dispatchStatus,
        provider_status: providerStatus,
        provider_receipt_json: providerReceiptJson,
        recovered_from_transport: recoveredFromTransport,
      });
      return [{ affectedRows: 1 }];
    }

    if (normalized.includes("FROM platform_outbox_event_types")
      && normalized.includes("WHERE event_type = ?")) {
      const definition = state.eventTypes.get(String(params[0]));
      return [[definition].filter(Boolean)];
    }

    if (normalized.includes("FROM platform_outbox_consumers WHERE consumer_key = ?")) {
      const consumer = state.consumers.get(String(params[0]));
      return [[consumer].filter(Boolean)];
    }

    if (normalized.includes("FROM platform_outbox_mask_policies")
      && normalized.includes("WHERE policy_key = ?")) {
      const policy = state.policies.get(String(params[0]));
      return [[policy].filter(Boolean)];
    }

    if (normalized.startsWith("INSERT INTO platform_outbox_events")) {
      const [
        eventId,
        tenantId,
        workspaceId,
        aggregateType,
        aggregateId,
        eventType,
        schemaVersion,
        payloadJson,
        metadataJson,
        payloadSha256,
        payloadClassification,
        containsPii,
        sourceEnvironment,
        occurredAt,
        availableAt,
        retentionExpiresAt,
      ] = params;
      if (state.events.has(eventId)) {
        const error = new Error(`Duplicate outbox event ${eventId}`);
        error.code = "ER_DUP_ENTRY";
        throw error;
      }
      state.events.set(eventId, {
        id: state.nextEventSequence++,
        event_id: eventId,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        aggregate_type: aggregateType,
        aggregate_id: aggregateId,
        event_type: eventType,
        schema_version: Number(schemaVersion),
        payload_json: payloadJson,
        metadata_json: metadataJson,
        payload_sha256: payloadSha256,
        payload_classification: payloadClassification,
        contains_pii: Number(containsPii || 0),
        source_environment: sourceEnvironment,
        occurred_at: occurredAt,
        available_at: availableAt,
        retention_expires_at: retentionExpiresAt,
      });
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("INSERT IGNORE INTO platform_outbox_deliveries")
      && normalized.includes("SELECT ?, consumer_key")) {
      const eventId = String(params[0]);
      let affectedRows = 0;
      for (const consumer of state.consumers.values()) {
        if (["shadow", "active"].includes(consumer.status) && insertDelivery(eventId, consumer.consumer_key)) {
          affectedRows += 1;
        }
      }
      return [{ affectedRows }];
    }

    if (normalized.startsWith("INSERT IGNORE INTO platform_outbox_deliveries")
      && normalized.includes("SELECT e.event_id, c.consumer_key")) {
      const consumerKey = String(params[0]);
      const consumer = state.consumers.get(consumerKey);
      let affectedRows = 0;
      if (consumer && ["shadow", "active"].includes(consumer.status)) {
        for (const event of state.events.values()) {
          if (due(event.available_at)
            && (event.retention_expires_at == null || !due(event.retention_expires_at))
            && insertDelivery(event.event_id, consumerKey)) {
            affectedRows += 1;
          }
        }
      }
      return [{ affectedRows }];
    }

    if (normalized.startsWith("UPDATE platform_outbox_deliveries")
      && normalized.includes("outbox_claim_expired")) {
      const [maxAttempts, , consumerKey] = params;
      let affectedRows = 0;
      for (const delivery of state.deliveries.values()) {
        if (delivery.consumer_key !== consumerKey
          || delivery.status !== "claimed"
          || !delivery.claim_expires_at
          || new Date(delivery.claim_expires_at).getTime() > Date.now()) continue;
        const nextAttempt = Number(delivery.attempt_count || 0) + 1;
        delivery.status = nextAttempt >= Number(maxAttempts) ? "dead_letter" : "failed";
        delivery.attempt_count = nextAttempt;
        delivery.next_attempt_at = nextAttempt >= Number(maxAttempts) ? null : new Date(0);
        delivery.claim_token = null;
        delivery.claim_expires_at = null;
        delivery.last_error_code = "outbox_claim_expired";
        delivery.last_error_message = "The worker claim expired before delivery acknowledgement.";
        affectedRows += 1;
      }
      return [{ affectedRows }];
    }

    if (normalized.includes("FROM platform_outbox_deliveries d")
      && normalized.includes("FOR UPDATE")) {
      const limitMatch = normalized.match(/ LIMIT (\d+) FOR UPDATE$/);
      const limit = Number(limitMatch?.[1] || 100);
      return [eligibleRows(String(params[0]), limit)];
    }

    if (normalized.startsWith("UPDATE platform_outbox_deliveries")
      && normalized.includes("SET status = 'claimed'")) {
      const [claimToken, consumerKey, eventIds] = params;
      let affectedRows = 0;
      for (const eventId of eventIds || []) {
        const delivery = state.deliveries.get(deliveryKey(eventId, consumerKey));
        if (!delivery || !["pending", "failed"].includes(delivery.status)) continue;
        delivery.status = "claimed";
        delivery.claim_token = claimToken;
        delivery.claim_expires_at = new Date(Date.now() + 5 * 60 * 1000);
        affectedRows += 1;
      }
      return [{ affectedRows }];
    }

    if (normalized.startsWith("UPDATE platform_outbox_deliveries")
      && normalized.includes("SET status = 'delivered'")) {
      const [responseStatus, consumerKey, claimToken, eventIds] = params;
      let affectedRows = 0;
      for (const eventId of eventIds || []) {
        const delivery = state.deliveries.get(deliveryKey(eventId, consumerKey));
        if (!delivery || delivery.claim_token !== claimToken) continue;
        Object.assign(delivery, {
          status: "delivered",
          response_status: responseStatus,
          delivered_at: new Date(),
          claim_token: null,
          claim_expires_at: null,
          last_error_code: null,
          last_error_message: null,
        });
        affectedRows += 1;
      }
      return [{ affectedRows }];
    }

    if (normalized.startsWith("UPDATE platform_outbox_consumers")
      && normalized.includes("SET last_success_at")) {
      const consumer = state.consumers.get(String(params[0]));
      if (consumer) {
        consumer.last_success_at = new Date();
        consumer.last_error_code = null;
      }
      return [{ affectedRows: consumer ? 1 : 0 }];
    }

    throw new Error(`Unexpected SQL in T505 integration fake: ${normalized}`);
  }

  const pool = {
    query,
    async getConnection() {
      return {
        query,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  return {
    state,
    pool,
    delivery(eventId, consumerKey = CONSUMER_KEY) {
      return state.deliveries.get(deliveryKey(eventId, consumerKey));
    },
  };
}

const integration = createIntegrationDatabase();
let providerEffectCount = 0;
const providerEventId = "11111111-1111-4111-8111-111111111111";
const executor = createDurableReceiptAwareExecutor({
  pool: integration.pool,
  executeStep: async () => {
    providerEffectCount += 1;
    const outbox = await enqueuePlatformOutboxEvent({
      pool: integration.pool,
      eventId: providerEventId,
      eventType: EVENT_TYPE,
      schemaVersion: 1,
      aggregateType: "growth_control_provider_effect",
      aggregateId: "effect-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      payload: {
        effect_id: "effect-1",
        plan_id: "plan-1",
        plan_step_id: "step-1",
        outcome: "confirmed_applied",
      },
      metadata: {
        producer_key: "growth_control_provider_effect_reconciliation",
        request_sha256: "b".repeat(64),
      },
      sourceEnvironment: "test",
      occurredAt: new Date("2026-07-31T03:00:00.000Z"),
      availableAt: new Date("2026-07-31T03:00:00.000Z"),
      secretsIncluded: false,
    });
    return {
      ok: true,
      provider_status: 200,
      provider_effect_id: "effect-1",
      outbox_event_id: outbox.event_id,
      secrets_included: false,
    };
  },
});

const workflowStep = {
  plan_id: "plan-1",
  plan_step_id: "step-1",
  tenant_id: "tenant-1",
  step_key: "provider_effect",
  step_type: "workflow",
  workflow_key: "growth_control.provider_effect.apply",
  workflow_id: null,
  idempotency_key: "growth-control-effect-1",
  input_json: JSON.stringify({
    plan_hash_sha256: "c".repeat(64),
    request_sha256: "b".repeat(64),
    action_ids: ["action.publish"],
    resource_ids: ["resource-1"],
  }),
};

const firstDispatch = await executor(workflowStep, {});
const replayDispatch = await executor(workflowStep, {});
assert.equal(firstDispatch.idempotent_replay, false);
assert.equal(replayDispatch.idempotent_replay, true);
assert.equal(providerEffectCount, 1, "duplicate dispatch must reuse the mutation receipt");
assert.equal(integration.state.receipts.length, 1);
assert.equal(integration.state.receipts[0].dispatch_status, "succeeded");
assert.equal(integration.state.events.size, 1, "idempotent replay must not enqueue a duplicate outbox event");
assert.equal(integration.state.deliveries.size, 1, "one event/consumer pair must create one delivery row");

const previousDeliveryFlag = process.env.OUTBOX_DELIVERY_ENABLED;
const previousAllowedHosts = process.env.OUTBOX_ALLOWED_HOSTS;
const previousFetch = globalThis.fetch;
process.env.OUTBOX_DELIVERY_ENABLED = "true";
process.env.OUTBOX_ALLOWED_HOSTS = "shadow.example.internal";

const receivedEventIds = new Set();
let consumerApplyCount = 0;
const transmittedBatches = [];
let releaseFirstFetch;
let firstFetchStartedResolve;
const firstFetchStarted = new Promise((resolve) => { firstFetchStartedResolve = resolve; });
const firstFetchGate = new Promise((resolve) => { releaseFirstFetch = resolve; });

globalThis.fetch = async (_url, options = {}) => {
  const batch = JSON.parse(String(options.body || "{}"));
  transmittedBatches.push(batch);
  for (const event of batch.events || []) {
    if (!receivedEventIds.has(event.event_id)) {
      receivedEventIds.add(event.event_id);
      consumerApplyCount += 1;
    }
  }
  firstFetchStartedResolve();
  await firstFetchGate;
  return { status: 202 };
};

try {
  const firstWorkerPromise = runPlatformOutboxWorker({
    pool: integration.pool,
    consumerKey: CONSUMER_KEY,
    limit: 10,
    dryRun: false,
  });
  await firstFetchStarted;

  const competingWorker = await runPlatformOutboxWorker({
    pool: integration.pool,
    consumerKey: CONSUMER_KEY,
    limit: 10,
    dryRun: false,
  });
  assert.equal(competingWorker.attempted_count, 0, "an active claim must exclude a competing worker");
  assert.equal(transmittedBatches.length, 1);

  releaseFirstFetch();
  const firstWorker = await firstWorkerPromise;
  assert.equal(firstWorker.delivered_count, 1);
  assert.equal(consumerApplyCount, 1);
  assert.equal(integration.delivery(providerEventId).status, "delivered");

  const postDeliveryReplay = await runPlatformOutboxWorker({
    pool: integration.pool,
    consumerKey: CONSUMER_KEY,
    limit: 10,
    dryRun: false,
  });
  assert.equal(postDeliveryReplay.attempted_count, 0);
  assert.equal(transmittedBatches.length, 1, "delivered rows must not be transmitted again");

  const expiredEventId = "22222222-2222-4222-8222-222222222222";
  await enqueuePlatformOutboxEvent({
    pool: integration.pool,
    eventId: expiredEventId,
    eventType: EVENT_TYPE,
    schemaVersion: 1,
    aggregateType: "growth_control_provider_effect",
    aggregateId: "effect-2",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    payload: {
      effect_id: "effect-2",
      plan_id: "plan-2",
      plan_step_id: "step-2",
      outcome: "confirmed_applied",
    },
    metadata: { producer_key: "growth_control_provider_effect_reconciliation" },
    sourceEnvironment: "test",
    occurredAt: new Date("2026-07-31T03:01:00.000Z"),
    availableAt: new Date("2026-07-31T03:01:00.000Z"),
    secretsIncluded: false,
  });

  const expiredDelivery = integration.delivery(expiredEventId);
  Object.assign(expiredDelivery, {
    status: "claimed",
    claim_token: "expired-claim-token",
    claim_expires_at: new Date(Date.now() - 1000),
  });

  receivedEventIds.add(expiredEventId);
  consumerApplyCount += 1;
  const applicationsBeforeReclaim = consumerApplyCount;
  const transmissionsBeforeReclaim = transmittedBatches.length;
  globalThis.fetch = async (_url, options = {}) => {
    const batch = JSON.parse(String(options.body || "{}"));
    transmittedBatches.push(batch);
    for (const event of batch.events || []) {
      if (!receivedEventIds.has(event.event_id)) {
        receivedEventIds.add(event.event_id);
        consumerApplyCount += 1;
      }
    }
    return { status: 200 };
  };

  const reclaimed = await runPlatformOutboxWorker({
    pool: integration.pool,
    consumerKey: CONSUMER_KEY,
    limit: 10,
    dryRun: false,
  });
  assert.equal(reclaimed.delivered_count, 1);
  assert.equal(transmittedBatches.length, transmissionsBeforeReclaim + 1, "expired claim must be reclaimed once");
  assert.equal(consumerApplyCount, applicationsBeforeReclaim, "consumer event-id dedupe must suppress replayed application");
  assert.equal(expiredDelivery.status, "delivered");
  assert.equal(expiredDelivery.attempt_count, 1);
  assert.equal(expiredDelivery.last_error_code, null);

  const afterReclaim = await runPlatformOutboxWorker({
    pool: integration.pool,
    consumerKey: CONSUMER_KEY,
    limit: 10,
    dryRun: false,
  });
  assert.equal(afterReclaim.attempted_count, 0);
  assert.equal(transmittedBatches.length, transmissionsBeforeReclaim + 1);
  assert.equal(integration.state.deliveries.size, 2, "INSERT IGNORE plus event identity must deduplicate deliveries");
  assert.equal(receivedEventIds.size, 2);
  assert.ok(transmittedBatches.every((batch) => batch.secrets_included === false));
} finally {
  if (previousDeliveryFlag === undefined) delete process.env.OUTBOX_DELIVERY_ENABLED;
  else process.env.OUTBOX_DELIVERY_ENABLED = previousDeliveryFlag;
  if (previousAllowedHosts === undefined) delete process.env.OUTBOX_ALLOWED_HOSTS;
  else process.env.OUTBOX_ALLOWED_HOSTS = previousAllowedHosts;
  globalThis.fetch = previousFetch;
}

console.log("growth control idempotency, lease, and outbox integration tests passed");
