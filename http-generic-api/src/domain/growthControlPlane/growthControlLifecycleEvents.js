import {
  GROWTH_CONTROL_SCOPE_TYPES,
  GrowthControlPlaneError,
  assertNoSecretFields,
  requireCanonicalKey,
  stableSha256,
  stableSerialize,
} from "./growthControlPlane.js";

const EVENT_DEFINITIONS = Object.freeze({
  "growth_control.configuration.activated": Object.freeze({ operation: "activate" }),
  "growth_control.configuration.rolled_back": Object.freeze({ operation: "rollback" }),
});

const PAYLOAD_KEYS = Object.freeze([
  "contract",
  "operation",
  "configVersionId",
  "configKey",
  "scopeType",
  "scopeKey",
  "versionNumber",
  "versionRevision",
  "lifecycle",
  "previousActiveVersionIds",
  "approvalHoldId",
  "bindingSha256",
]);

const METADATA_KEYS = Object.freeze([
  "producer",
  "actorId",
  "requestId",
  "correlationId",
]);

const MAX_PREVIOUS_ACTIVE_VERSIONS = 100;
const MAX_INVALIDATION_ENTRIES = 110;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value, field) {
  if (plainObject(value)) return value;
  if (value == null || value === "") return {};
  try {
    const parsed = JSON.parse(String(value));
    if (!plainObject(parsed)) throw new Error("not_object");
    return parsed;
  } catch {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_JSON_INVALID",
      `${field} must be a JSON object.`,
      422,
      [{ field, issue: "invalid_json_object" }],
    );
  }
}

function requiredText(value, field, maxLength = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_FIELD_INVALID",
      `${field} is required and must be at most ${maxLength} characters.`,
      422,
      [{ field, issue: "required_or_too_long" }],
    );
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_FIELD_INVALID",
      `${field} must be a positive integer.`,
      422,
      [{ field, issue: "positive_integer_required" }],
    );
  }
  return normalized;
}

function exactKeys(value, allowedKeys, field) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  if (unknown.length) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_FIELD_UNSUPPORTED",
      `${field} contains unsupported fields.`,
      422,
      unknown.map((key) => ({ field: `${field}.${key}`, issue: "unsupported" })),
    );
  }
}

function sha256Text(value, field) {
  const normalized = requiredText(value, field, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_FIELD_INVALID",
      `${field} must be a SHA-256 hex digest.`,
      422,
      [{ field, issue: "sha256_required" }],
    );
  }
  return normalized;
}

function previousVersionIds(value) {
  if (!Array.isArray(value) || value.length > MAX_PREVIOUS_ACTIVE_VERSIONS) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_PREVIOUS_VERSIONS_INVALID",
      `previousActiveVersionIds must be an array with at most ${MAX_PREVIOUS_ACTIVE_VERSIONS} items.`,
      422,
    );
  }
  const normalized = value.map((item, index) => requiredText(item, `payload.previousActiveVersionIds[${index}]`, 64));
  if (new Set(normalized).size !== normalized.length) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_PREVIOUS_VERSIONS_INVALID",
      "previousActiveVersionIds must contain unique identifiers.",
      422,
    );
  }
  return Object.freeze(normalized);
}

function normalizeMetadata(value) {
  const metadata = parseJson(value, "metadata");
  exactKeys(metadata, METADATA_KEYS, "metadata");
  assertNoSecretFields(metadata, "$.metadata");
  const producer = requiredText(metadata.producer, "metadata.producer", 128);
  if (producer !== "growth_control_plane") {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_PRODUCER_INVALID",
      "metadata.producer must be growth_control_plane.",
      422,
    );
  }
  return Object.freeze({
    producer,
    actorId: metadata.actorId == null ? null : requiredText(metadata.actorId, "metadata.actorId", 128),
    requestId: metadata.requestId == null ? null : requiredText(metadata.requestId, "metadata.requestId", 191),
    correlationId: metadata.correlationId == null ? null : requiredText(metadata.correlationId, "metadata.correlationId", 191),
  });
}

export function validateGrowthControlLifecycleEvent(input = {}) {
  const eventType = requiredText(input.eventType ?? input.event_type, "eventType", 160);
  const definition = EVENT_DEFINITIONS[eventType];
  if (!definition) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_TYPE_UNSUPPORTED",
      `Unsupported Growth Control lifecycle event: ${eventType}.`,
      422,
    );
  }
  const schemaVersion = positiveInteger(input.schemaVersion ?? input.schema_version, "schemaVersion");
  if (schemaVersion !== 1) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_SCHEMA_VERSION_UNSUPPORTED",
      "Only Growth Control lifecycle schema version 1 is supported.",
      422,
    );
  }
  const aggregateType = requiredText(input.aggregateType ?? input.aggregate_type, "aggregateType", 100);
  if (aggregateType !== "growth_control_configuration") {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_AGGREGATE_INVALID",
      "aggregateType must be growth_control_configuration.",
      422,
    );
  }
  const eventId = requiredText(input.eventId ?? input.event_id, "eventId", 64);
  const aggregateId = requiredText(input.aggregateId ?? input.aggregate_id, "aggregateId", 191);
  const tenantId = input.tenantId ?? input.tenant_id ?? null;
  const workspaceId = input.workspaceId ?? input.workspace_id ?? null;
  const payload = parseJson(input.payload ?? input.payload_json, "payload");
  exactKeys(payload, PAYLOAD_KEYS, "payload");
  assertNoSecretFields(payload, "$.payload");

  if (payload.contract !== "mad4b.growth-control.configuration.lifecycle.v1") {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_CONTRACT_INVALID",
      "payload.contract is not the governed lifecycle event contract.",
      422,
    );
  }
  if (payload.operation !== definition.operation) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_OPERATION_MISMATCH",
      "payload.operation does not match eventType.",
      422,
    );
  }
  const configVersionId = requiredText(payload.configVersionId, "payload.configVersionId", 64);
  if (aggregateId !== configVersionId) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_AGGREGATE_MISMATCH",
      "aggregateId must equal payload.configVersionId.",
      422,
    );
  }
  const configKey = requireCanonicalKey(payload.configKey, "payload.configKey");
  const scopeType = requiredText(payload.scopeType, "payload.scopeType", 64);
  if (!GROWTH_CONTROL_SCOPE_TYPES.includes(scopeType)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_SCOPE_INVALID",
      "payload.scopeType is unsupported.",
      422,
    );
  }
  const scopeKey = requiredText(payload.scopeKey, "payload.scopeKey", 700);
  const versionNumber = positiveInteger(payload.versionNumber, "payload.versionNumber");
  const versionRevision = positiveInteger(payload.versionRevision, "payload.versionRevision");
  if (payload.lifecycle !== "active") {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_LIFECYCLE_INVALID",
      "Lifecycle invalidation events require payload.lifecycle=active.",
      422,
    );
  }
  const previousActiveVersionIds = previousVersionIds(payload.previousActiveVersionIds);
  if (previousActiveVersionIds.includes(configVersionId)) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_PREVIOUS_VERSIONS_INVALID",
      "The active target cannot appear in previousActiveVersionIds.",
      422,
    );
  }
  const approvalHoldId = requiredText(payload.approvalHoldId, "payload.approvalHoldId", 64);
  const bindingSha256 = sha256Text(payload.bindingSha256, "payload.bindingSha256");
  const metadata = normalizeMetadata(input.metadata ?? input.metadata_json);

  const normalizedPayload = Object.freeze({
    contract: payload.contract,
    operation: payload.operation,
    configVersionId,
    configKey,
    scopeType,
    scopeKey,
    versionNumber,
    versionRevision,
    lifecycle: "active",
    previousActiveVersionIds,
    approvalHoldId,
    bindingSha256,
  });
  const computedPayloadSha256 = stableSha256(normalizedPayload);
  const suppliedPayloadSha256 = input.payloadSha256 ?? input.payload_sha256 ?? null;
  if (suppliedPayloadSha256 != null && sha256Text(suppliedPayloadSha256, "payloadSha256") !== computedPayloadSha256) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_EVENT_PAYLOAD_HASH_MISMATCH",
      "The lifecycle event payload hash does not match the typed payload.",
      422,
    );
  }

  return Object.freeze({
    eventId,
    eventType,
    schemaVersion,
    aggregateType,
    aggregateId,
    tenantId: tenantId == null ? null : requiredText(tenantId, "tenantId", 64),
    workspaceId: workspaceId == null ? null : requiredText(workspaceId, "workspaceId", 64),
    sourceEnvironment: String(input.sourceEnvironment ?? input.source_environment ?? "development"),
    occurredAt: input.occurredAt ?? input.occurred_at ?? null,
    payload: normalizedPayload,
    metadata,
    payloadSha256: computedPayloadSha256,
    secretsIncluded: false,
  });
}

function invalidationEntry({ key, type, event, scopeHash, sourceVersionId = null }) {
  return Object.freeze({
    invalidationKey: requiredText(key, "invalidationKey", 255),
    invalidationType: requiredText(type, "invalidationType", 64),
    tenantId: event.tenantId,
    workspaceId: event.workspaceId,
    configKey: event.payload.configKey,
    scopeHash,
    sourceVersionId,
    secretsIncluded: false,
  });
}

export function buildGrowthControlInvalidationPlan(input = {}) {
  const event = input.payload ? validateGrowthControlLifecycleEvent(input) : validateGrowthControlLifecycleEvent(input.event || input);
  const scopeHash = stableSha256(event.payload.scopeKey);
  const tenantHash = event.tenantId ? stableSha256(event.tenantId).slice(0, 32) : null;
  const workspaceHash = event.workspaceId ? stableSha256(event.workspaceId).slice(0, 32) : null;
  const entries = [
    invalidationEntry({
      key: `growth-control:configuration:${event.payload.configKey}`,
      type: "configuration_definition",
      event,
      scopeHash,
    }),
    invalidationEntry({
      key: `growth-control:scope:${scopeHash}`,
      type: "effective_scope_resolution",
      event,
      scopeHash,
    }),
    invalidationEntry({
      key: `growth-control:version:${event.payload.configVersionId}`,
      type: "configuration_version",
      event,
      scopeHash,
      sourceVersionId: event.payload.configVersionId,
    }),
    invalidationEntry({
      key: `growth-control:compiled-plan:${event.payload.configKey}:${scopeHash.slice(0, 32)}`,
      type: "compiled_plan_dependencies",
      event,
      scopeHash,
    }),
    ...event.payload.previousActiveVersionIds.map((versionId) => invalidationEntry({
      key: `growth-control:version:${versionId}`,
      type: "configuration_version",
      event,
      scopeHash,
      sourceVersionId: versionId,
    })),
  ];
  if (tenantHash) {
    entries.push(invalidationEntry({
      key: `growth-control:tenant-projection:${tenantHash}`,
      type: "tenant_projection",
      event,
      scopeHash,
    }));
  }
  if (workspaceHash) {
    entries.push(invalidationEntry({
      key: `growth-control:workspace-projection:${workspaceHash}`,
      type: "workspace_projection",
      event,
      scopeHash,
    }));
  }
  const deduplicated = [...new Map(entries.map((entry) => [entry.invalidationKey, entry])).values()]
    .sort((left, right) => left.invalidationKey.localeCompare(right.invalidationKey));
  if (deduplicated.length > MAX_INVALIDATION_ENTRIES) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_INVALIDATION_LIMIT_EXCEEDED",
      `Invalidation plans are limited to ${MAX_INVALIDATION_ENTRIES} entries.`,
      422,
    );
  }
  const planBody = {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payloadSha256: event.payloadSha256,
    scopeHash,
    entries: deduplicated,
  };
  return Object.freeze({
    contract: "mad4b.growth-control.invalidation-plan.v1",
    ...planBody,
    planSha256: stableSha256(planBody),
    invalidationCount: deduplicated.length,
    entries: Object.freeze(deduplicated),
    readbackRequired: true,
    providerCalls: false,
    externalWrites: false,
    secretsIncluded: false,
  });
}

export const GROWTH_CONTROL_LIFECYCLE_EVENT_TYPES = Object.freeze(Object.keys(EVENT_DEFINITIONS));

export const _testingGrowthControlLifecycleEvents = Object.freeze({
  EVENT_DEFINITIONS,
  PAYLOAD_KEYS,
  METADATA_KEYS,
  MAX_PREVIOUS_ACTIVE_VERSIONS,
  MAX_INVALIDATION_ENTRIES,
  plainObject,
  parseJson,
  exactKeys,
  previousVersionIds,
  normalizeMetadata,
  invalidationEntry,
  stableSerialize,
});
