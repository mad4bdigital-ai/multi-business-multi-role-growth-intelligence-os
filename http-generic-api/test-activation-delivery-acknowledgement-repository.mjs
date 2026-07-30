import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_ACKNOWLEDGEMENT_INITIAL_STATE,
  ACTIVATION_DELIVERY_INITIAL_STATE,
  appendActivationAcknowledgementRecord,
  appendActivationDeliveryRecord,
  createActivationDeliveryAcknowledgementRepository,
  createActivationDeliveryAcknowledgementService,
  hasScopedActivationAcknowledgement,
  nextActivationDeliveryAttemptNumber,
  readActivationAcknowledgement,
  readActivationDelivery,
} from "./activationDeliveryAcknowledgementRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const operationId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const deliveryId = "33333333-3333-4333-8333-333333333333";
const acknowledgementId = "44444444-4444-4444-8444-444444444444";
const actorRef = "tenant-user@example.test";

assert.equal(ACTIVATION_DELIVERY_INITIAL_STATE, "prepared");
assert.equal(ACTIVATION_ACKNOWLEDGEMENT_INITIAL_STATE, "pending");

const numberCalls = [];
const numberConnection = {
  async query(sql, params) {
    numberCalls.push({ sql, params });
    if (/FROM activation_operation_projections/.test(sql)) {
      return [[{ operation_id: operationId }]];
    }
    if (/FROM activation_deliveries/.test(sql)) {
      return [[{ next_attempt_number: 4 }]];
    }
    throw new Error(`unexpected numbering query: ${sql}`);
  },
};
assert.equal(
  await nextActivationDeliveryAttemptNumber(numberConnection, {
    operation_id: operationId,
    tenant_id: tenantId,
    channel_key: "tenant_gpt",
  }),
  4,
);
assert.equal(numberCalls.length, 2);
assert.match(numberCalls[0].sql, /FROM activation_operation_projections/);
assert.match(numberCalls[0].sql, /FOR UPDATE/);
assert.deepEqual(numberCalls[0].params, [operationId, tenantId]);
assert.match(numberCalls[1].sql, /MAX\(delivery_attempt_number\)/);
assert.match(numberCalls[1].sql, /channel_key = \?/);
assert.deepEqual(numberCalls[1].params, [operationId, tenantId, "tenant_gpt"]);

await assert.rejects(
  () =>
    nextActivationDeliveryAttemptNumber(
      {
        async query(sql) {
          if (/activation_operation_projections/.test(sql)) return [[]];
          throw new Error("delivery numbering must not continue without the parent lock");
        },
      },
      {
        operation_id: operationId,
        tenant_id: tenantId,
        channel_key: "tenant_gpt",
      },
    ),
  (error) => error?.code === "activation_operation_not_found" && error?.status === 404,
);

const appendCalls = [];
const appendConnection = {
  async query(sql, params) {
    appendCalls.push({ sql, params });
    if (/^\s*SELECT delivery_id/.test(sql) && /FOR UPDATE/.test(sql)) {
      return [[{ delivery_id: deliveryId }]];
    }
    return [{ affectedRows: 1 }];
  },
};
const delivery = await appendActivationDeliveryRecord(appendConnection, {
  delivery_id: deliveryId,
  operation_id: operationId,
  tenant_id: tenantId,
  channel_key: "tenant_gpt",
  delivery_attempt_number: 4,
  payload_sha256: "a".repeat(64),
});
assert.deepEqual(delivery, { delivery_id: deliveryId, affected_rows: 1 });
const deliveryInsert = appendCalls.find(({ sql }) =>
  /INSERT INTO activation_deliveries/.test(sql),
);
assert(deliveryInsert);
assert.equal(deliveryInsert.params[5], "prepared");
assert.equal(deliveryInsert.params[4], 4);
assert.equal(deliveryInsert.params.includes("sent"), false);
await assert.rejects(
  () =>
    appendActivationDeliveryRecord(appendConnection, {
      delivery_id: deliveryId,
      operation_id: operationId,
      tenant_id: tenantId,
      channel_key: "tenant_gpt",
      delivery_attempt_number: 4,
      delivery_status: "sent",
    }),
  (error) =>
    error?.code === "activation_delivery_initial_state_invalid" && error?.status === 409,
);

const acknowledgement = await appendActivationAcknowledgementRecord(appendConnection, {
  acknowledgement_id: acknowledgementId,
  operation_id: operationId,
  delivery_id: deliveryId,
  tenant_id: tenantId,
  actor_type: "tenant_user",
  actor_ref: actorRef,
  client_event_id: "event-1",
});
assert.equal(acknowledgement.acknowledgement_id, acknowledgementId);
assert.match(acknowledgement.acknowledgement_key_sha256, /^[0-9a-f]{64}$/);
const deliveryScopeLock = appendCalls.find(
  ({ sql }) => /^\s*SELECT delivery_id/.test(sql) && /FOR UPDATE/.test(sql),
);
assert(deliveryScopeLock);
assert.deepEqual(deliveryScopeLock.params, [deliveryId, operationId, tenantId]);
const acknowledgementInsert = appendCalls.find(({ sql }) =>
  /INSERT INTO activation_acknowledgements/.test(sql),
);
assert(acknowledgementInsert);
assert.equal(acknowledgementInsert.params[7], "pending");
assert.equal(acknowledgementInsert.params.includes(actorRef), false);
assert.equal(JSON.stringify(acknowledgementInsert.params).includes(actorRef), false);
await assert.rejects(
  () =>
    appendActivationAcknowledgementRecord(
      {
        async query(sql) {
          if (/^\s*SELECT delivery_id/.test(sql)) return [[]];
          throw new Error("acknowledgement insert must not run for a cross-scope delivery");
        },
      },
      {
        acknowledgement_id: acknowledgementId,
        operation_id: operationId,
        delivery_id: deliveryId,
        tenant_id: tenantId,
        actor_type: "tenant_user",
        actor_ref: actorRef,
      },
    ),
  (error) => error?.code === "activation_delivery_not_found" && error?.status === 404,
);
await assert.rejects(
  () =>
    appendActivationAcknowledgementRecord(appendConnection, {
      acknowledgement_id: acknowledgementId,
      operation_id: operationId,
      tenant_id: tenantId,
      actor_type: "tenant_user",
      actor_ref: actorRef,
      acknowledgement_state: "acknowledged",
    }),
  (error) =>
    error?.code === "activation_acknowledgement_initial_state_invalid" &&
    error?.status === 409,
);

const deliveryRow = {
  delivery_id: deliveryId,
  operation_id: operationId,
  tenant_id: tenantId,
  channel_key: "tenant_gpt",
  delivery_attempt_number: 4,
  delivery_status: "prepared",
};
const deliveryReadCalls = [];
const deliveryReadConnection = {
  async query(sql, params) {
    deliveryReadCalls.push({ sql, params });
    return [[deliveryRow]];
  },
};
assert.deepEqual(
  await readActivationDelivery(deliveryReadConnection, {
    delivery_id: deliveryId,
    operation_id: operationId,
    tenant_id: tenantId,
  }),
  deliveryRow,
);
assert.match(deliveryReadCalls[0].sql, /FROM activation_deliveries/);
assert.doesNotMatch(deliveryReadCalls[0].sql, /error_message/);
assert.deepEqual(deliveryReadCalls[0].params, [deliveryId, operationId, tenantId]);

const acknowledgementRow = {
  acknowledgement_id: acknowledgementId,
  operation_id: operationId,
  delivery_id: deliveryId,
  tenant_id: tenantId,
  actor_type: "tenant_user",
  actor_ref_sha256: "b".repeat(64),
  acknowledgement_key_sha256: "c".repeat(64),
  acknowledgement_state: "pending",
};
const acknowledgementReadCalls = [];
const acknowledgementReadConnection = {
  async query(sql, params) {
    acknowledgementReadCalls.push({ sql, params });
    return [[acknowledgementRow]];
  },
};
assert.deepEqual(
  await readActivationAcknowledgement(acknowledgementReadConnection, {
    acknowledgement_id: acknowledgementId,
    operation_id: operationId,
    tenant_id: tenantId,
  }),
  acknowledgementRow,
);
assert.match(acknowledgementReadCalls[0].sql, /FROM activation_acknowledgements/);
assert.doesNotMatch(acknowledgementReadCalls[0].sql, /acknowledgement_reason/);
assert.doesNotMatch(acknowledgementReadCalls[0].sql, /actor_ref,/);
assert.deepEqual(acknowledgementReadCalls[0].params, [
  acknowledgementId,
  operationId,
  tenantId,
]);

const existenceCalls = [];
const existenceConnection = {
  async query(sql, params) {
    existenceCalls.push({ sql, params });
    return [[{ acknowledgement_id: acknowledgementId }]];
  },
};
assert.equal(
  await hasScopedActivationAcknowledgement(existenceConnection, {
    acknowledgement_id: acknowledgementId,
    operation_id: operationId,
    tenant_id: tenantId,
    acknowledgement_states: ["pending", "acknowledged"],
  }),
  true,
);
assert.match(existenceCalls[0].sql, /acknowledgement_state IN \(\?,\?\)/);
assert.deepEqual(existenceCalls[0].params, [
  acknowledgementId,
  operationId,
  tenantId,
  "pending",
  "acknowledged",
]);
await assert.rejects(
  () =>
    hasScopedActivationAcknowledgement(existenceConnection, {
      acknowledgement_id: acknowledgementId,
      operation_id: operationId,
      tenant_id: tenantId,
      acknowledgement_states: [],
    }),
  (error) => error?.code === "activation_acknowledgement_states_invalid",
);

const transitionCalls = [];
const transitionConnection = {
  async query(sql, params) {
    transitionCalls.push({ sql, params });
    return [{ affectedRows: 1 }];
  },
};
const repository = createActivationDeliveryAcknowledgementRepository();
assert.deepEqual(
  await repository.transitionDelivery(transitionConnection, {
    delivery_id: deliveryId,
    operation_id: operationId,
    tenant_id: tenantId,
    from_status: "prepared",
    to_status: "sent",
    response_status_code: 202,
  }),
  { updated: true, idempotent: false, state: "sent" },
);
assert.deepEqual(
  await repository.transitionAcknowledgement(transitionConnection, {
    acknowledgement_id: acknowledgementId,
    operation_id: operationId,
    tenant_id: tenantId,
    from_status: "pending",
    to_status: "acknowledged",
  }),
  { updated: true, idempotent: false, state: "acknowledged" },
);
for (const { sql, params } of transitionCalls) {
  assert.match(sql, /operation_id = \?/);
  assert.match(sql, /tenant_id = \?/);
  assert(params.includes(operationId));
  assert(params.includes(tenantId));
}

const serviceCalls = [];
const serviceConnection = { query() {} };
const serviceRepository = {
  async nextDeliveryAttemptNumber(connection, input) {
    serviceCalls.push({ method: "next", connection, input });
    return 7;
  },
  async appendDelivery(connection, input) {
    serviceCalls.push({ method: "appendDelivery", connection, input });
    return { delivery_id: deliveryId, delivery_attempt_number: input.delivery_attempt_number };
  },
  async readDelivery() {
    return deliveryRow;
  },
  async transitionDelivery() {
    return { updated: true };
  },
  async appendAcknowledgement(connection, input) {
    serviceCalls.push({ method: "appendAcknowledgement", connection, input });
    return { acknowledgement_id: acknowledgementId };
  },
  async readAcknowledgement() {
    return acknowledgementRow;
  },
  async hasAcknowledgement() {
    return true;
  },
  async transitionAcknowledgement() {
    return { updated: true };
  },
};
const service = createActivationDeliveryAcknowledgementService({
  repository: serviceRepository,
});
assert.equal(Object.isFrozen(service), true);
assert.deepEqual(
  await service.prepareDelivery(serviceConnection, {
    operation_id: operationId,
    tenant_id: tenantId,
    channel_key: "tenant_gpt",
    delivery_attempt_number: 99,
    delivery_status: "sent",
  }),
  { delivery_id: deliveryId, delivery_attempt_number: 7 },
);
assert.equal(serviceCalls[0].connection, serviceConnection);
assert.equal(serviceCalls[1].connection, serviceConnection);
assert.equal(serviceCalls[1].input.delivery_attempt_number, 7);
assert.equal(serviceCalls[1].input.delivery_status, "prepared");
await service.requestAcknowledgement(serviceConnection, {
  operation_id: operationId,
  tenant_id: tenantId,
  actor_type: "tenant_user",
  actor_ref: actorRef,
  acknowledgement_state: "rejected",
});
assert.equal(serviceCalls[2].connection, serviceConnection);
assert.equal(serviceCalls[2].input.acknowledgement_state, "pending");
assert.throws(
  () => createActivationDeliveryAcknowledgementService({ repository: {} }),
  (error) => error?.code === "activation_delivery_repository_invalid" && error?.status === 500,
);
assert.equal(Object.isFrozen(repository), true);
for (const method of [
  "nextDeliveryAttemptNumber",
  "appendDelivery",
  "readDelivery",
  "transitionDelivery",
  "appendAcknowledgement",
  "readAcknowledgement",
  "hasAcknowledgement",
  "transitionAcknowledgement",
]) {
  assert.equal(typeof repository[method], "function", `${method} must be available`);
}

for (const runtimeFile of [
  "server.js",
  "activationSessionLifecycleService.js",
  "activationHardResponseService.js",
]) {
  const source = fs.readFileSync(path.join(__dirname, runtimeFile), "utf8");
  assert.doesNotMatch(
    source,
    /activationDeliveryAcknowledgementRepository/,
    `${runtimeFile} must not wire T022 before migration apply/readback`,
  );
}
const migration = fs.readFileSync(
  path.join(__dirname, "migrations", "20260724_activation_operation_projection_foundation.sql"),
  "utf8",
);
assert.match(migration, /not authorized for apply by this PR/i);
assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE|ALTER)\b/im);

console.log("activation delivery and acknowledgement repository tests passed");
