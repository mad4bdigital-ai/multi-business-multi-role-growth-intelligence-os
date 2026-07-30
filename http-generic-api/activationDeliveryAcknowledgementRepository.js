import {
  appendActivationAcknowledgement,
  appendActivationDelivery,
  transitionActivationAcknowledgement,
  transitionActivationDelivery,
} from "./activationOperationProjectionRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const INITIAL_DELIVERY_STATE = "prepared";
const INITIAL_ACKNOWLEDGEMENT_STATE = "pending";

function fail(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function requireConnection(connection) {
  if (!connection || typeof connection.query !== "function") {
    fail(
      "activation_delivery_connection_required",
      "A transaction-bound database connection with query() is required.",
      500,
    );
  }
}

function normalizeText(value, field, max, { required = true } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    if (required) fail(`activation_${field}_required`, `${field} is required.`);
    return null;
  }
  if (normalized.length > max) {
    fail(`activation_${field}_too_long`, `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function normalizeUuid(value, field) {
  const normalized = normalizeText(value, field, 36);
  if (!UUID_PATTERN.test(normalized)) {
    fail(`activation_${field}_invalid`, `${field} must be a UUID.`);
  }
  return normalized;
}

function normalizeState(value, field) {
  const normalized = normalizeText(value, field, 80).toLowerCase();
  if (!STATE_PATTERN.test(normalized)) {
    fail(`activation_${field}_invalid`, `${field} must use lowercase state-key syntax.`);
  }
  return normalized;
}

function normalizeStates(values) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.length === 0) {
    fail(
      "activation_acknowledgement_states_invalid",
      "acknowledgement_states must be a non-empty array when supplied.",
    );
  }
  const normalized = [
    ...new Set(values.map((value) => normalizeState(value, "acknowledgement_state"))),
  ];
  if (normalized.length > 16) {
    fail(
      "activation_acknowledgement_states_too_many",
      "No more than 16 acknowledgement states may be queried at once.",
    );
  }
  return normalized;
}

async function readSingle(connection, sql, params) {
  requireConnection(connection);
  const [rows] = await connection.query(sql, params);
  return rows?.[0] || null;
}

async function lockActivationOperationScope(connection, operationId, tenantId) {
  const row = await readSingle(
    connection,
    `SELECT operation_id
       FROM activation_operation_projections
      WHERE operation_id = ?
        AND tenant_id = ?
      FOR UPDATE`,
    [operationId, tenantId],
  );
  if (!row?.operation_id) {
    fail(
      "activation_operation_not_found",
      "Activation operation was not found in the authorized tenant scope.",
      404,
    );
  }
}

async function lockActivationDeliveryScope(
  connection,
  deliveryId,
  operationId,
  tenantId,
) {
  const row = await readSingle(
    connection,
    `SELECT delivery_id
       FROM activation_deliveries
      WHERE delivery_id = ?
        AND operation_id = ?
        AND tenant_id = ?
      FOR UPDATE`,
    [deliveryId, operationId, tenantId],
  );
  if (!row?.delivery_id) {
    fail(
      "activation_delivery_not_found",
      "Activation delivery was not found in the authorized tenant and operation scope.",
      404,
    );
  }
}

function validateAttemptNumber(value) {
  const number = Number(value || 1);
  if (!Number.isSafeInteger(number) || number < 1) {
    fail(
      "activation_delivery_attempt_number_invalid",
      "The next delivery-attempt number could not be determined.",
      500,
    );
  }
  return number;
}

export async function nextActivationDeliveryAttemptNumber(
  connection,
  { operation_id, tenant_id, channel_key } = {},
) {
  requireConnection(connection);
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  const channelKey = normalizeState(channel_key, "channel_key");
  await lockActivationOperationScope(connection, operationId, tenantId);
  const row = await readSingle(
    connection,
    `SELECT COALESCE(MAX(delivery_attempt_number), 0) + 1 AS next_attempt_number
       FROM activation_deliveries
      WHERE operation_id = ?
        AND tenant_id = ?
        AND channel_key = ?`,
    [operationId, tenantId, channelKey],
  );
  return validateAttemptNumber(row?.next_attempt_number);
}

export async function appendActivationDeliveryRecord(connection, input = {}) {
  const deliveryStatus = input.delivery_status
    ? normalizeState(input.delivery_status, "delivery_status")
    : INITIAL_DELIVERY_STATE;
  if (deliveryStatus !== INITIAL_DELIVERY_STATE) {
    fail(
      "activation_delivery_initial_state_invalid",
      `A delivery record must start in ${INITIAL_DELIVERY_STATE}.`,
      409,
      { delivery_status: deliveryStatus },
    );
  }
  return appendActivationDelivery(connection, {
    ...input,
    delivery_status: INITIAL_DELIVERY_STATE,
  });
}

export async function readActivationDelivery(
  connection,
  { delivery_id, operation_id, tenant_id } = {},
) {
  const deliveryId = normalizeUuid(delivery_id, "delivery_id");
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  return readSingle(
    connection,
    `SELECT delivery_id, operation_id, tenant_id, channel_key,
            delivery_attempt_number, delivery_status, payload_sha256,
            response_status_code, error_code, delivered_at, created_at
       FROM activation_deliveries
      WHERE delivery_id = ?
        AND operation_id = ?
        AND tenant_id = ?
      LIMIT 1`,
    [deliveryId, operationId, tenantId],
  );
}

export async function appendActivationAcknowledgementRecord(connection, input = {}) {
  const acknowledgementState = input.acknowledgement_state
    ? normalizeState(input.acknowledgement_state, "acknowledgement_state")
    : INITIAL_ACKNOWLEDGEMENT_STATE;
  if (acknowledgementState !== INITIAL_ACKNOWLEDGEMENT_STATE) {
    fail(
      "activation_acknowledgement_initial_state_invalid",
      `An acknowledgement record must start in ${INITIAL_ACKNOWLEDGEMENT_STATE}.`,
      409,
      { acknowledgement_state: acknowledgementState },
    );
  }
  const operationId = normalizeUuid(input.operation_id, "operation_id");
  const tenantId = normalizeText(input.tenant_id, "tenant_id", 36);
  const deliveryId = input.delivery_id
    ? normalizeUuid(input.delivery_id, "delivery_id")
    : null;
  if (deliveryId) {
    await lockActivationDeliveryScope(connection, deliveryId, operationId, tenantId);
  }
  return appendActivationAcknowledgement(connection, {
    ...input,
    operation_id: operationId,
    tenant_id: tenantId,
    delivery_id: deliveryId,
    acknowledgement_state: INITIAL_ACKNOWLEDGEMENT_STATE,
  });
}

export async function readActivationAcknowledgement(
  connection,
  { acknowledgement_id, operation_id, tenant_id } = {},
) {
  const acknowledgementId = normalizeUuid(acknowledgement_id, "acknowledgement_id");
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  return readSingle(
    connection,
    `SELECT acknowledgement_id, operation_id, delivery_id, tenant_id,
            actor_type, actor_ref_sha256, acknowledgement_key_sha256,
            acknowledgement_state, acknowledged_at, created_at
       FROM activation_acknowledgements
      WHERE acknowledgement_id = ?
        AND operation_id = ?
        AND tenant_id = ?
      LIMIT 1`,
    [acknowledgementId, operationId, tenantId],
  );
}

export async function hasScopedActivationAcknowledgement(
  connection,
  {
    acknowledgement_id,
    operation_id,
    tenant_id,
    acknowledgement_states = null,
  } = {},
) {
  requireConnection(connection);
  const acknowledgementId = normalizeUuid(acknowledgement_id, "acknowledgement_id");
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36);
  const states = normalizeStates(acknowledgement_states);
  const stateSql = states.length
    ? ` AND acknowledgement_state IN (${states.map(() => "?").join(",")})`
    : "";
  const row = await readSingle(
    connection,
    `SELECT acknowledgement_id
       FROM activation_acknowledgements
      WHERE acknowledgement_id = ?
        AND operation_id = ?
        AND tenant_id = ?${stateSql}
      LIMIT 1`,
    [acknowledgementId, operationId, tenantId, ...states],
  );
  return Boolean(row?.acknowledgement_id);
}

export function createActivationDeliveryAcknowledgementRepository() {
  return Object.freeze({
    nextDeliveryAttemptNumber: nextActivationDeliveryAttemptNumber,
    appendDelivery: appendActivationDeliveryRecord,
    readDelivery: readActivationDelivery,
    transitionDelivery: transitionActivationDelivery,
    appendAcknowledgement: appendActivationAcknowledgementRecord,
    readAcknowledgement: readActivationAcknowledgement,
    hasAcknowledgement: hasScopedActivationAcknowledgement,
    transitionAcknowledgement: transitionActivationAcknowledgement,
  });
}

export const activationDeliveryAcknowledgementRepository =
  createActivationDeliveryAcknowledgementRepository();

export function createActivationDeliveryAcknowledgementService({
  repository = activationDeliveryAcknowledgementRepository,
} = {}) {
  const requiredMethods = [
    "nextDeliveryAttemptNumber",
    "appendDelivery",
    "readDelivery",
    "transitionDelivery",
    "appendAcknowledgement",
    "readAcknowledgement",
    "hasAcknowledgement",
    "transitionAcknowledgement",
  ];
  for (const method of requiredMethods) {
    if (typeof repository?.[method] !== "function") {
      fail(
        "activation_delivery_repository_invalid",
        `The delivery repository must implement ${method}().`,
        500,
      );
    }
  }

  return Object.freeze({
    async prepareDelivery(connection, input = {}) {
      const deliveryAttemptNumber = await repository.nextDeliveryAttemptNumber(
        connection,
        input,
      );
      return repository.appendDelivery(connection, {
        ...input,
        delivery_attempt_number: deliveryAttemptNumber,
        delivery_status: INITIAL_DELIVERY_STATE,
      });
    },
    async requestAcknowledgement(connection, input = {}) {
      return repository.appendAcknowledgement(connection, {
        ...input,
        acknowledgement_state: INITIAL_ACKNOWLEDGEMENT_STATE,
      });
    },
    readDelivery(connection, input = {}) {
      return repository.readDelivery(connection, input);
    },
    transitionDelivery(connection, input = {}) {
      return repository.transitionDelivery(connection, input);
    },
    readAcknowledgement(connection, input = {}) {
      return repository.readAcknowledgement(connection, input);
    },
    hasAcknowledgement(connection, input = {}) {
      return repository.hasAcknowledgement(connection, input);
    },
    transitionAcknowledgement(connection, input = {}) {
      return repository.transitionAcknowledgement(connection, input);
    },
  });
}

export const activationDeliveryAcknowledgementService =
  createActivationDeliveryAcknowledgementService();

export const ACTIVATION_DELIVERY_INITIAL_STATE = INITIAL_DELIVERY_STATE;
export const ACTIVATION_ACKNOWLEDGEMENT_INITIAL_STATE =
  INITIAL_ACKNOWLEDGEMENT_STATE;
