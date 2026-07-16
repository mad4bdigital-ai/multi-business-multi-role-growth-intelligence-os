import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 500;
const DEFAULT_MAX_EVENT_BYTES = 128 * 1024;
const SENSITIVE_KEY_PATTERN = /(password|passphrase|access[_-]?token|refresh[_-]?token|token|secret|private[_-]?key|authorization|cookie|recovery[_-]?code|api[_-]?key|credential)/i;

function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function normalizedEnvironment(value = "") {
  const environment = String(value || "").trim().toLowerCase();
  if (["production", "staging", "development", "test"].includes(environment)) return environment;
  if (environment === "prod") return "production";
  if (environment === "dev") return "development";
  return "development";
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value = "") {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function findSensitivePayloadPaths(value, path = "$") {
  const findings = [];
  if (!value || typeof value !== "object") return findings;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SENSITIVE_KEY_PATTERN.test(key)) findings.push(childPath);
    if (child && typeof child === "object") findings.push(...findSensitivePayloadPaths(child, childPath));
  }
  return findings;
}

function normalizedPolicy(policyValue) {
  const policy = safeJsonParse(policyValue, {}) || {};
  return {
    denyKeys: new Set((policy.deny_keys || []).map((key) => String(key).toLowerCase())),
    maskKeys: new Set((policy.mask_keys || []).map((key) => String(key).toLowerCase())),
    maximumEventBytes: boundedInteger(policy.maximum_event_bytes, DEFAULT_MAX_EVENT_BYTES, 1024, 1024 * 1024),
    secretsAllowed: policy.secrets_allowed === true,
  };
}

export function sanitizeOutboxPayload(value, policyValue = {}) {
  const policy = normalizedPolicy(policyValue);
  const visit = (input) => {
    if (Array.isArray(input)) return input.map((item) => visit(item));
    if (!input || typeof input !== "object") return input;
    const output = {};
    for (const [key, child] of Object.entries(input)) {
      const normalizedKey = String(key).toLowerCase();
      if (policy.denyKeys.has(normalizedKey) || SENSITIVE_KEY_PATTERN.test(normalizedKey)) continue;
      if (policy.maskKeys.has(normalizedKey)) {
        output[key] = child === null || child === undefined ? child : "[masked]";
        continue;
      }
      output[key] = visit(child);
    }
    return output;
  };
  return visit(value);
}

function allowedHostsFromEnvironment() {
  return new Set(
    String(process.env.OUTBOX_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

function resolveCredentialReference(credentialRef = "") {
  const reference = String(credentialRef || "").trim();
  if (!reference) return "";
  if (!reference.startsWith("env:")) {
    const error = new Error("Only env: credential references are supported on the current Hostinger runtime.");
    error.code = "outbox_credential_reference_unsupported";
    throw error;
  }
  const key = reference.slice(4).trim();
  if (!key || !process.env[key]) {
    const error = new Error(`Outbox credential environment variable is unavailable: ${key || "<empty>"}`);
    error.code = "outbox_credential_unavailable";
    throw error;
  }
  return process.env[key];
}

export function validateConsumerReadiness(consumer = {}, policyValue = {}, options = {}) {
  const reasons = [];
  const deliveryEnabled = options.deliveryEnabled ?? process.env.OUTBOX_DELIVERY_ENABLED === "true";
  if (!deliveryEnabled) reasons.push("delivery_feature_flag_disabled");
  if (!["shadow", "active"].includes(String(consumer.status || ""))) reasons.push("consumer_not_enabled");
  if (consumer.transport_key !== "https_batch_v1") reasons.push("transport_not_https_batch_v1");

  let parsedUrl = null;
  try {
    parsedUrl = new URL(String(consumer.endpoint_url || ""));
    if (parsedUrl.protocol !== "https:") reasons.push("endpoint_https_required");
  } catch {
    reasons.push("endpoint_url_invalid");
  }
  if (parsedUrl) {
    const allowedHosts = options.allowedHosts || allowedHostsFromEnvironment();
    if (!allowedHosts.has(parsedUrl.hostname.toLowerCase())) reasons.push("endpoint_host_not_allowlisted");
    if (parsedUrl.username || parsedUrl.password) reasons.push("endpoint_embedded_credentials_forbidden");
    for (const key of parsedUrl.searchParams.keys()) {
      if (SENSITIVE_KEY_PATTERN.test(key)) reasons.push("endpoint_secret_query_parameter_forbidden");
    }
  }

  const policy = normalizedPolicy(policyValue);
  if (policy.secretsAllowed) reasons.push("mask_policy_allows_secrets");
  if (!consumer.mask_policy_key) reasons.push("mask_policy_missing");
  if (!["none", "bearer", "x_api_key"].includes(String(consumer.auth_scheme || ""))) reasons.push("auth_scheme_invalid");
  if (consumer.auth_scheme !== "none" && !consumer.credential_ref) reasons.push("credential_reference_missing");

  return { ready: reasons.length === 0, reasons };
}

export function buildOutboxBatch({ consumer = {}, rows = [], policy = {} } = {}) {
  return {
    contract: "mad4b.platform.outbox.batch.v1",
    consumer_key: consumer.consumer_key,
    source_environment: rows[0]?.source_environment || null,
    sent_at: new Date().toISOString(),
    events: rows.map((row) => ({
      event_id: row.event_id,
      event_type: row.event_type,
      schema_version: Number(row.schema_version || 1),
      aggregate_type: row.aggregate_type,
      aggregate_id: row.aggregate_id,
      tenant_id: row.tenant_id || null,
      workspace_id: row.workspace_id || null,
      occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
      payload: sanitizeOutboxPayload(safeJsonParse(row.payload_json, {}), policy),
      metadata: sanitizeOutboxPayload(safeJsonParse(row.metadata_json, {}), policy),
      payload_sha256: row.payload_sha256,
      payload_classification: row.payload_classification,
      contains_pii: Boolean(row.contains_pii),
    })),
    secrets_included: false,
  };
}

async function insertEventAndDeliveries(executor, event) {
  await executor.query(
    `INSERT INTO platform_outbox_events
      (event_id, tenant_id, workspace_id, aggregate_type, aggregate_id, event_type,
       schema_version, payload_json, metadata_json, payload_sha256, payload_classification,
       contains_pii, secrets_included, source_environment, occurred_at, available_at,
       retention_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
    [
      event.eventId,
      event.tenantId,
      event.workspaceId,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      event.schemaVersion,
      event.payloadJson,
      event.metadataJson,
      event.payloadSha256,
      event.payloadClassification,
      event.containsPii ? 1 : 0,
      event.sourceEnvironment,
      event.occurredAt,
      event.availableAt,
      event.retentionExpiresAt,
    ]
  );
  await executor.query(
    `INSERT IGNORE INTO platform_outbox_deliveries
      (event_id, consumer_key, status, attempt_count, next_attempt_at, created_at, updated_at)
     SELECT ?, consumer_key, 'pending', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
       FROM platform_outbox_consumers
      WHERE status IN ('shadow','active')`,
    [event.eventId]
  );
}

export async function enqueuePlatformOutboxEvent({
  pool = getPool(),
  connection = null,
  eventId = randomUUID(),
  eventType,
  schemaVersion = 1,
  aggregateType,
  aggregateId,
  payload = {},
  metadata = {},
  tenantId = null,
  workspaceId = null,
  sourceEnvironment = process.env.APP_ENV || process.env.NODE_ENV || "development",
  occurredAt = new Date(),
  availableAt = new Date(),
  retentionExpiresAt = null,
  secretsIncluded = false,
} = {}) {
  if (!eventType || !aggregateType || aggregateId === null || aggregateId === undefined || aggregateId === "") {
    const error = new Error("eventType, aggregateType, and aggregateId are required.");
    error.code = "outbox_event_identity_required";
    throw error;
  }
  if (secretsIncluded) {
    const error = new Error("Outbox events must not contain secrets.");
    error.code = "outbox_secrets_forbidden";
    throw error;
  }

  const queryExecutor = connection || pool;
  const [eventTypes] = await queryExecutor.query(
    `SELECT event_type, current_schema_version, payload_classification, contains_pii, status
       FROM platform_outbox_event_types
      WHERE event_type = ?
      LIMIT 1`,
    [eventType]
  );
  const definition = eventTypes?.[0];
  if (!definition || definition.status !== "active") {
    const error = new Error(`Outbox event type is not active: ${eventType}`);
    error.code = "outbox_event_type_not_active";
    throw error;
  }
  if (Number(schemaVersion) !== Number(definition.current_schema_version)) {
    const error = new Error(`Outbox schema version mismatch for ${eventType}.`);
    error.code = "outbox_schema_version_mismatch";
    throw error;
  }

  const sensitivePaths = [
    ...findSensitivePayloadPaths(payload),
    ...findSensitivePayloadPaths(metadata, "$.metadata"),
  ];
  if (sensitivePaths.length) {
    const error = new Error(`Sensitive outbox fields are blocked: ${sensitivePaths.slice(0, 10).join(", ")}`);
    error.code = "outbox_sensitive_fields_blocked";
    throw error;
  }

  const payloadJson = stableStringify(payload);
  const metadataJson = stableStringify(metadata);
  if (Buffer.byteLength(payloadJson, "utf8") > DEFAULT_MAX_EVENT_BYTES) {
    const error = new Error("Outbox payload exceeds the current 128 KiB event limit.");
    error.code = "outbox_payload_too_large";
    throw error;
  }

  const event = {
    eventId: String(eventId),
    tenantId,
    workspaceId,
    aggregateType: String(aggregateType),
    aggregateId: String(aggregateId),
    eventType: String(eventType),
    schemaVersion: Number(schemaVersion),
    payloadJson,
    metadataJson,
    payloadSha256: sha256(payloadJson),
    payloadClassification: definition.payload_classification,
    containsPii: Boolean(definition.contains_pii),
    sourceEnvironment: normalizedEnvironment(sourceEnvironment),
    occurredAt,
    availableAt,
    retentionExpiresAt,
  };

  if (connection) {
    await insertEventAndDeliveries(connection, event);
    return { ok: true, event_id: event.eventId, transaction_owner: "caller", secrets_included: false };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await insertEventAndDeliveries(conn, event);
    await conn.commit();
    return { ok: true, event_id: event.eventId, transaction_owner: "outbox_service", secrets_included: false };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

async function ensurePendingDeliveries(pool, consumerKey, limit) {
  await pool.query(
    `INSERT IGNORE INTO platform_outbox_deliveries
      (event_id, consumer_key, status, attempt_count, next_attempt_at, created_at, updated_at)
     SELECT e.event_id, c.consumer_key, 'pending', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
       FROM platform_outbox_events e
       JOIN platform_outbox_event_types t ON t.event_type = e.event_type AND t.status = 'active'
       JOIN platform_outbox_consumers c ON c.consumer_key = ? AND c.status IN ('shadow','active')
      WHERE e.available_at <= UTC_TIMESTAMP(6)
        AND (e.retention_expires_at IS NULL OR e.retention_expires_at > UTC_TIMESTAMP(6))
      ORDER BY e.id ASC
      LIMIT ${limit}`,
    [consumerKey]
  );
}

async function releaseExpiredClaims(pool, consumer) {
  const maxAttempts = Number(consumer.max_attempts || 8);
  await pool.query(
    `UPDATE platform_outbox_deliveries
        SET status = CASE WHEN attempt_count + 1 >= ? THEN 'dead_letter' ELSE 'failed' END,
            attempt_count = attempt_count + 1,
            next_attempt_at = CASE WHEN attempt_count + 1 >= ? THEN NULL ELSE UTC_TIMESTAMP(6) END,
            claim_token = NULL,
            claim_expires_at = NULL,
            last_error_code = 'outbox_claim_expired',
            last_error_message = 'The worker claim expired before delivery acknowledgement.',
            updated_at = UTC_TIMESTAMP(6)
      WHERE consumer_key = ?
        AND status = 'claimed'
        AND claim_expires_at IS NOT NULL
        AND claim_expires_at <= UTC_TIMESTAMP(6)`,
    [maxAttempts, maxAttempts, consumer.consumer_key]
  );
}

async function claimPendingRows(pool, consumerKey, limit) {
  const claimToken = randomUUID();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT d.event_id, d.consumer_key, d.attempt_count,
              e.tenant_id, e.workspace_id, e.aggregate_type, e.aggregate_id,
              e.event_type, e.schema_version, e.payload_json, e.metadata_json,
              e.payload_sha256, e.payload_classification, e.contains_pii,
              e.source_environment, e.occurred_at
         FROM platform_outbox_deliveries d
         JOIN platform_outbox_events e ON e.event_id = d.event_id
         JOIN platform_outbox_event_types t ON t.event_type = e.event_type AND t.status = 'active'
        WHERE d.consumer_key = ?
          AND d.status IN ('pending','failed')
          AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= UTC_TIMESTAMP(6))
          AND (d.claim_expires_at IS NULL OR d.claim_expires_at <= UTC_TIMESTAMP(6))
          AND e.available_at <= UTC_TIMESTAMP(6)
          AND (e.retention_expires_at IS NULL OR e.retention_expires_at > UTC_TIMESTAMP(6))
        ORDER BY e.occurred_at ASC, e.id ASC
        LIMIT ${limit}
        FOR UPDATE`,
      [consumerKey]
    );
    if (!rows.length) {
      await conn.commit();
      return { claimToken, rows: [] };
    }
    const eventIds = rows.map((row) => row.event_id);
    await conn.query(
      `UPDATE platform_outbox_deliveries
          SET status = 'claimed', claim_token = ?, claim_expires_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE), updated_at = UTC_TIMESTAMP(6)
        WHERE consumer_key = ? AND event_id IN (?)`,
      [claimToken, consumerKey, eventIds]
    );
    await conn.commit();
    return { claimToken, rows };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

async function markBatchDelivered(pool, consumer, claimToken, rows, responseStatus) {
  const eventIds = rows.map((row) => row.event_id);
  await pool.query(
    `UPDATE platform_outbox_deliveries
        SET status = 'delivered', response_status = ?, delivered_at = UTC_TIMESTAMP(6),
            claim_token = NULL, claim_expires_at = NULL, last_error_code = NULL,
            last_error_message = NULL, updated_at = UTC_TIMESTAMP(6)
      WHERE consumer_key = ? AND claim_token = ? AND event_id IN (?)`,
    [responseStatus, consumer.consumer_key, claimToken, eventIds]
  );
  await pool.query(
    `UPDATE platform_outbox_consumers
        SET last_success_at = UTC_TIMESTAMP(6), last_error_code = NULL, updated_at = UTC_TIMESTAMP(6)
      WHERE consumer_key = ?`,
    [consumer.consumer_key]
  );
}

async function markBatchFailed(pool, consumer, claimToken, rows, errorCode, errorMessage, responseStatus = null) {
  for (const row of rows) {
    const nextAttempt = Number(row.attempt_count || 0) + 1;
    const deadLetter = nextAttempt >= Number(consumer.max_attempts || 8);
    const delaySeconds = Math.min(Number(consumer.retry_base_seconds || 30) * (2 ** Math.min(nextAttempt - 1, 8)), 86400);
    await pool.query(
      `UPDATE platform_outbox_deliveries
          SET status = ?, attempt_count = ?, response_status = ?, last_error_code = ?,
              last_error_message = ?, next_attempt_at = ?, claim_token = NULL,
              claim_expires_at = NULL, updated_at = UTC_TIMESTAMP(6)
        WHERE consumer_key = ? AND event_id = ? AND claim_token = ?`,
      [
        deadLetter ? "dead_letter" : "failed",
        nextAttempt,
        responseStatus,
        String(errorCode || "outbox_delivery_failed").slice(0, 120),
        String(errorMessage || "Outbox delivery failed.").slice(0, 500),
        deadLetter ? null : new Date(Date.now() + delaySeconds * 1000),
        consumer.consumer_key,
        row.event_id,
        claimToken,
      ]
    );
  }
  await pool.query(
    `UPDATE platform_outbox_consumers
        SET last_failure_at = UTC_TIMESTAMP(6), last_error_code = ?, updated_at = UTC_TIMESTAMP(6)
      WHERE consumer_key = ?`,
    [String(errorCode || "outbox_delivery_failed").slice(0, 120), consumer.consumer_key]
  );
}

function buildDeliveryHeaders(consumer, payloadText) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "mad4b-platform-outbox/1.0",
    "X-MAD4B-Outbox-Contract": "mad4b.platform.outbox.batch.v1",
    "X-MAD4B-Consumer": consumer.consumer_key,
    "X-MAD4B-Batch-SHA256": sha256(payloadText),
  };
  if (consumer.auth_scheme === "bearer") headers.Authorization = `Bearer ${resolveCredentialReference(consumer.credential_ref)}`;
  if (consumer.auth_scheme === "x_api_key") headers["X-API-Key"] = resolveCredentialReference(consumer.credential_ref);
  return headers;
}

export async function getPlatformOutboxStatus({ pool = getPool() } = {}) {
  const [eventRows] = await pool.query(
    `SELECT COUNT(*) AS event_count, MAX(occurred_at) AS latest_event_at
       FROM platform_outbox_events`
  );
  const [deliveryRows] = await pool.query(
    `SELECT status, COUNT(*) AS count
       FROM platform_outbox_deliveries
      GROUP BY status
      ORDER BY status`
  );
  const [lagRows] = await pool.query(
    `SELECT TIMESTAMPDIFF(SECOND, MIN(e.occurred_at), UTC_TIMESTAMP(6)) AS oldest_pending_age_seconds
       FROM platform_outbox_deliveries d
       JOIN platform_outbox_events e ON e.event_id = d.event_id
      WHERE d.status IN ('pending','failed','claimed')`
  );
  const [consumers] = await pool.query(
    `SELECT consumer_key, display_name, target_environment, transport_key, status,
            endpoint_url IS NOT NULL AS endpoint_configured,
            credential_ref IS NOT NULL AS credential_reference_configured,
            mask_policy_key, batch_size, timeout_ms, max_attempts,
            last_success_at, last_failure_at, last_error_code, updated_at
       FROM platform_outbox_consumers
      ORDER BY consumer_key`
  );
  const [eventTypes] = await pool.query(
    `SELECT event_type, current_schema_version, producer_key, payload_classification,
            contains_pii, status, created_at, updated_at
       FROM platform_outbox_event_types
      ORDER BY event_type`
  );
  return {
    ok: true,
    event_count: Number(eventRows?.[0]?.event_count || 0),
    latest_event_at: eventRows?.[0]?.latest_event_at || null,
    delivery_counts: Object.fromEntries((deliveryRows || []).map((row) => [row.status, Number(row.count || 0)])),
    oldest_pending_age_seconds: lagRows?.[0]?.oldest_pending_age_seconds === null
      ? null
      : Number(lagRows?.[0]?.oldest_pending_age_seconds || 0),
    consumers,
    event_types: (eventTypes || []).map((row) => ({
      event_type: row.event_type,
      current_schema_version: Number(row.current_schema_version || 1),
      producer_key: row.producer_key,
      payload_classification: row.payload_classification,
      contains_pii: Boolean(row.contains_pii),
      status: row.status,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    })),
    delivery_feature_flag_enabled: process.env.OUTBOX_DELIVERY_ENABLED === "true",
    allowed_host_count: allowedHostsFromEnvironment().size,
    secrets_included: false,
  };
}

export async function runPlatformOutboxWorker({
  pool = getPool(),
  consumerKey = "prod_shadow_v1",
  limit = DEFAULT_BATCH_LIMIT,
  dryRun = true,
} = {}) {
  const safeLimit = boundedInteger(limit, DEFAULT_BATCH_LIMIT, 1, MAX_BATCH_LIMIT);
  const [consumerRows] = await pool.query(
    `SELECT * FROM platform_outbox_consumers WHERE consumer_key = ? LIMIT 1`,
    [consumerKey]
  );
  const consumer = consumerRows?.[0];
  if (!consumer) {
    const error = new Error(`Outbox consumer was not found: ${consumerKey}`);
    error.code = "outbox_consumer_not_found";
    throw error;
  }
  const [policyRows] = await pool.query(
    `SELECT policy_key, policy_json, checksum_sha256, status
       FROM platform_outbox_mask_policies
      WHERE policy_key = ?
      LIMIT 1`,
    [consumer.mask_policy_key]
  );
  const policyRow = policyRows?.[0] || null;
  const policy = safeJsonParse(policyRow?.policy_json, {});
  const readiness = validateConsumerReadiness(consumer, policy, {});
  if (!policyRow || policyRow.status !== "active") readiness.reasons.push("mask_policy_not_active");
  readiness.ready = readiness.reasons.length === 0;

  await releaseExpiredClaims(pool, consumer);
  await ensurePendingDeliveries(pool, consumerKey, safeLimit * 4);
  if (dryRun) {
    const [rows] = await pool.query(
      `SELECT d.event_id, d.status, d.attempt_count, e.event_type, e.aggregate_type,
              e.aggregate_id, e.occurred_at, e.payload_classification, e.contains_pii
         FROM platform_outbox_deliveries d
         JOIN platform_outbox_events e ON e.event_id = d.event_id
        WHERE d.consumer_key = ?
          AND d.status IN ('pending','failed')
          AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= UTC_TIMESTAMP(6))
        ORDER BY e.occurred_at ASC, e.id ASC
        LIMIT ${safeLimit}`,
      [consumerKey]
    );
    return {
      ok: true,
      mode: "dry_run",
      consumer_key: consumerKey,
      readiness,
      eligible_count: rows.length,
      events: rows,
      applies_delivery: false,
      secrets_included: false,
    };
  }

  if (!readiness.ready) {
    const error = new Error(`Outbox consumer is not ready: ${readiness.reasons.join(", ")}`);
    error.code = "outbox_consumer_not_ready";
    error.readiness = readiness;
    throw error;
  }

  const { claimToken, rows } = await claimPendingRows(pool, consumerKey, Math.min(safeLimit, Number(consumer.batch_size || safeLimit)));
  if (!rows.length) {
    return { ok: true, mode: "apply", consumer_key: consumerKey, attempted_count: 0, delivered_count: 0, secrets_included: false };
  }

  const batch = buildOutboxBatch({ consumer, rows, policy });
  const payloadText = JSON.stringify(batch);
  try {
    const response = await fetch(consumer.endpoint_url, {
      method: "POST",
      headers: buildDeliveryHeaders(consumer, payloadText),
      body: payloadText,
      redirect: "error",
      signal: AbortSignal.timeout(Number(consumer.timeout_ms || 10000)),
    });
    if (response.status < 200 || response.status >= 300) {
      await markBatchFailed(pool, consumer, claimToken, rows, `http_${response.status}`, `Shadow endpoint returned HTTP ${response.status}.`, response.status);
      return {
        ok: false,
        mode: "apply",
        consumer_key: consumerKey,
        attempted_count: rows.length,
        delivered_count: 0,
        response_status: response.status,
        error: { code: `http_${response.status}`, message: "Shadow endpoint rejected the outbox batch." },
        secrets_included: false,
      };
    }
    await markBatchDelivered(pool, consumer, claimToken, rows, response.status);
    return {
      ok: true,
      mode: "apply",
      consumer_key: consumerKey,
      attempted_count: rows.length,
      delivered_count: rows.length,
      response_status: response.status,
      event_ids: rows.map((row) => row.event_id),
      secrets_included: false,
    };
  } catch (error) {
    const code = error?.name === "TimeoutError" ? "outbox_delivery_timeout" : (error?.code || "outbox_delivery_failed");
    await markBatchFailed(pool, consumer, claimToken, rows, code, error?.message || "Outbox delivery failed.");
    throw Object.assign(new Error(error?.message || "Outbox delivery failed."), { code });
  }
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
}

export async function runPlatformOutboxLoop({
  pool = getPool(),
  consumerKey = "prod_shadow_v1",
  limit = DEFAULT_BATCH_LIMIT,
  intervalMs = 5000,
  signal = null,
  onIteration = null,
} = {}) {
  const safeInterval = boundedInteger(intervalMs, 5000, 1000, 300000);
  let iteration = 0;
  while (!signal?.aborted) {
    iteration += 1;
    let result;
    try {
      result = await runPlatformOutboxWorker({ pool, consumerKey, limit, dryRun: false });
    } catch (error) {
      result = { ok: false, error: { code: error.code || "outbox_loop_iteration_failed", message: error.message }, secrets_included: false };
    }
    if (onIteration) await onIteration({ iteration, result });
    if (!signal?.aborted) await sleep(safeInterval, signal);
  }
  return { ok: true, stopped: true, iterations: iteration, secrets_included: false };
}
