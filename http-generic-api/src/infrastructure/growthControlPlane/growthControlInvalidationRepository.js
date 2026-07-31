import { randomUUID } from "node:crypto";
import { getPool } from "../../../db.js";
import {
  GROWTH_CONTROL_LIFECYCLE_EVENT_TYPES,
} from "../../domain/growthControlPlane/growthControlLifecycleEvents.js";

export const GROWTH_CONTROL_INVALIDATION_CONSUMER_KEY = "growth_control_invalidation_v1";

const MAX_BATCH_LIMIT = 100;
const CLAIM_MINUTES = 5;

function boundedLimit(value, fallback = 25) {
  const normalized = Number(value ?? fallback);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > MAX_BATCH_LIMIT) {
    const error = new Error(`limit must be an integer from 1 to ${MAX_BATCH_LIMIT}.`);
    error.code = "GROWTH_CONTROL_INVALIDATION_LIMIT_INVALID";
    error.status = 400;
    throw error;
  }
  return normalized;
}

function parseJson(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function eventRow(row) {
  if (!row) return null;
  return Object.freeze({
    eventId: row.event_id,
    eventType: row.event_type,
    schemaVersion: Number(row.schema_version),
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    tenantId: row.tenant_id || null,
    workspaceId: row.workspace_id || null,
    sourceEnvironment: row.source_environment,
    occurredAt: row.occurred_at || null,
    payload: parseJson(row.payload_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    payloadSha256: row.payload_sha256,
    deliveryStatus: row.delivery_status || row.status || null,
    attemptCount: Number(row.attempt_count || 0),
    claimToken: row.claim_token || null,
    secretsIncluded: false,
  });
}

function revisionRow(row) {
  if (!row) return null;
  return Object.freeze({
    invalidationKey: row.invalidation_key,
    invalidationType: row.invalidation_type,
    tenantId: row.tenant_id || null,
    workspaceId: row.workspace_id || null,
    configKey: row.config_key,
    scopeHash: row.scope_hash,
    sourceVersionId: row.source_version_id || null,
    revision: Number(row.revision),
    lastEventId: row.last_event_id,
    lastEventType: row.last_event_type,
    lastPayloadSha256: row.last_payload_sha256,
    lastPlanSha256: row.last_plan_sha256,
    invalidatedAt: row.invalidated_at || null,
    updatedAt: row.updated_at || null,
    secretsIncluded: false,
  });
}

function requireExecutor(value) {
  if (!value || typeof value.query !== "function") {
    throw new TypeError("Growth Control invalidation repository requires a SQL executor.");
  }
  return value;
}

export function createGrowthControlInvalidationRepository({
  pool = null,
  resolvePool = async () => getPool(),
  consumerKey = GROWTH_CONTROL_INVALIDATION_CONSUMER_KEY,
  uuid = randomUUID,
} = {}) {
  if (pool != null) requireExecutor(pool);
  if (typeof resolvePool !== "function") throw new TypeError("resolvePool must be a function.");

  async function executor() {
    return requireExecutor(pool || await resolvePool());
  }

  async function withTransaction(work) {
    const db = await executor();
    if (typeof db.getConnection !== "function") return work(db);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async function getConsumer(connection = null, forUpdate = false) {
    const db = connection || await executor();
    const [rows] = await db.query(
      `SELECT consumer_key,status,transport_key,batch_size,max_attempts,retry_base_seconds,
              last_success_at,last_failure_at,last_error_code
         FROM platform_outbox_consumers
        WHERE consumer_key=?
        LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [consumerKey],
    );
    const row = rows?.[0];
    if (!row) return null;
    return Object.freeze({
      consumerKey: row.consumer_key,
      status: row.status,
      transportKey: row.transport_key,
      batchSize: Number(row.batch_size || 25),
      maxAttempts: Number(row.max_attempts || 8),
      retryBaseSeconds: Number(row.retry_base_seconds || 30),
      lastSuccessAt: row.last_success_at || null,
      lastFailureAt: row.last_failure_at || null,
      lastErrorCode: row.last_error_code || null,
    });
  }

  async function previewEvents({ limit = 25 } = {}) {
    const safeLimit = boundedLimit(limit);
    const db = await executor();
    const placeholders = GROWTH_CONTROL_LIFECYCLE_EVENT_TYPES.map(() => "?").join(",");
    const [rows] = await db.query(
      `SELECT e.event_id,e.event_type,e.schema_version,e.aggregate_type,e.aggregate_id,
              e.tenant_id,e.workspace_id,e.source_environment,e.occurred_at,
              e.payload_json,e.metadata_json,e.payload_sha256,
              COALESCE(d.status,'unassigned') AS delivery_status,
              COALESCE(d.attempt_count,0) AS attempt_count,d.claim_token
         FROM platform_outbox_events e
         LEFT JOIN platform_outbox_deliveries d
           ON d.event_id=e.event_id AND d.consumer_key=?
        WHERE e.event_type IN (${placeholders})
          AND e.available_at<=UTC_TIMESTAMP(6)
          AND (e.retention_expires_at IS NULL OR e.retention_expires_at>UTC_TIMESTAMP(6))
          AND (d.status IS NULL OR d.status IN ('pending','failed','claimed'))
        ORDER BY e.occurred_at ASC,e.id ASC
        LIMIT ${safeLimit}`,
      [consumerKey, ...GROWTH_CONTROL_LIFECYCLE_EVENT_TYPES],
    );
    return rows.map(eventRow);
  }

  async function claimEvents({ limit = 25 } = {}) {
    const safeLimit = boundedLimit(limit);
    return withTransaction(async (connection) => {
      const consumer = await getConsumer(connection, true);
      if (!consumer) {
        const error = new Error(`Growth Control invalidation consumer was not found: ${consumerKey}.`);
        error.code = "GROWTH_CONTROL_INVALIDATION_CONSUMER_NOT_FOUND";
        throw error;
      }
      if (consumer.status !== "active" || consumer.transportKey !== "noop") {
        const error = new Error("Growth Control invalidation apply requires an active noop internal consumer.");
        error.code = "GROWTH_CONTROL_INVALIDATION_CONSUMER_NOT_ACTIVE";
        error.status = 409;
        error.readiness = {
          status: consumer.status,
          transportKey: consumer.transportKey,
          requiredStatus: "active",
          requiredTransportKey: "noop",
        };
        throw error;
      }

      const placeholders = GROWTH_CONTROL_LIFECYCLE_EVENT_TYPES.map(() => "?").join(",");
      await connection.query(
        `INSERT IGNORE INTO platform_outbox_deliveries
          (event_id,consumer_key,status,attempt_count,next_attempt_at,created_at,updated_at)
         SELECT e.event_id,?,'pending',0,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)
           FROM platform_outbox_events e
          WHERE e.event_type IN (${placeholders})
            AND e.available_at<=UTC_TIMESTAMP(6)
            AND (e.retention_expires_at IS NULL OR e.retention_expires_at>UTC_TIMESTAMP(6))
          ORDER BY e.id ASC
          LIMIT ${safeLimit * 4}`,
        [consumerKey, ...GROWTH_CONTROL_LIFECYCLE_EVENT_TYPES],
      );
      await connection.query(
        `UPDATE platform_outbox_deliveries
            SET status=CASE WHEN attempt_count+1>=? THEN 'dead_letter' ELSE 'failed' END,
                attempt_count=attempt_count+1,
                next_attempt_at=CASE WHEN attempt_count+1>=? THEN NULL ELSE UTC_TIMESTAMP(6) END,
                claim_token=NULL,claim_expires_at=NULL,
                last_error_code='growth_control_invalidation_claim_expired',
                last_error_message='The internal invalidation claim expired before transactional readback.',
                updated_at=UTC_TIMESTAMP(6)
          WHERE consumer_key=? AND status='claimed'
            AND claim_expires_at IS NOT NULL AND claim_expires_at<=UTC_TIMESTAMP(6)`,
        [consumer.maxAttempts, consumer.maxAttempts, consumerKey],
      );

      const [rows] = await connection.query(
        `SELECT d.event_id,d.status AS delivery_status,d.attempt_count,d.claim_token,
                e.event_type,e.schema_version,e.aggregate_type,e.aggregate_id,
                e.tenant_id,e.workspace_id,e.source_environment,e.occurred_at,
                e.payload_json,e.metadata_json,e.payload_sha256
           FROM platform_outbox_deliveries d
           JOIN platform_outbox_events e ON e.event_id=d.event_id
          WHERE d.consumer_key=?
            AND e.event_type IN (${placeholders})
            AND d.status IN ('pending','failed')
            AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=UTC_TIMESTAMP(6))
            AND e.available_at<=UTC_TIMESTAMP(6)
            AND (e.retention_expires_at IS NULL OR e.retention_expires_at>UTC_TIMESTAMP(6))
          ORDER BY e.occurred_at ASC,e.id ASC
          LIMIT ${Math.min(safeLimit, Math.max(1, consumer.batchSize))}
          FOR UPDATE`,
        [consumerKey, ...GROWTH_CONTROL_LIFECYCLE_EVENT_TYPES],
      );
      if (!rows.length) return Object.freeze({ claimToken: null, consumer, events: Object.freeze([]) });
      const claimToken = uuid();
      const eventIds = rows.map((row) => row.event_id);
      await connection.query(
        `UPDATE platform_outbox_deliveries
            SET status='claimed',claim_token=?,
                claim_expires_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL ${CLAIM_MINUTES} MINUTE),
                updated_at=UTC_TIMESTAMP(6)
          WHERE consumer_key=? AND event_id IN (?) AND status IN ('pending','failed')`,
        [claimToken, consumerKey, eventIds],
      );
      return Object.freeze({
        claimToken,
        consumer,
        events: Object.freeze(rows.map((row) => eventRow({ ...row, claim_token: claimToken }))),
      });
    });
  }

  async function readInvalidationRevisions(keys, connection = null) {
    const normalized = [...new Set((keys || []).map(String).filter(Boolean))].slice(0, MAX_BATCH_LIMIT + 10);
    if (!normalized.length) return Object.freeze([]);
    const db = connection || await executor();
    const [rows] = await db.query(
      `SELECT invalidation_key,invalidation_type,tenant_id,workspace_id,config_key,
              scope_hash,source_version_id,revision,last_event_id,last_event_type,
              last_payload_sha256,last_plan_sha256,invalidated_at,updated_at
         FROM growth_control_invalidation_revisions
        WHERE invalidation_key IN (?)
        ORDER BY invalidation_key`,
      [normalized],
    );
    return Object.freeze(rows.map(revisionRow));
  }

  async function applyInvalidationPlan({ eventId, claimToken, plan }) {
    if (!eventId || !claimToken || !plan || !Array.isArray(plan.entries)) {
      throw new TypeError("eventId, claimToken, and a typed invalidation plan are required.");
    }
    return withTransaction(async (connection) => {
      const [deliveryRows] = await connection.query(
        `SELECT status,claim_token,attempt_count
           FROM platform_outbox_deliveries
          WHERE consumer_key=? AND event_id=?
          LIMIT 1 FOR UPDATE`,
        [consumerKey, eventId],
      );
      const delivery = deliveryRows?.[0];
      if (!delivery) {
        const error = new Error("Growth Control invalidation delivery was not found.");
        error.code = "GROWTH_CONTROL_INVALIDATION_DELIVERY_NOT_FOUND";
        throw error;
      }
      if (delivery.status === "delivered") {
        const readback = await readInvalidationRevisions(plan.entries.map((entry) => entry.invalidationKey), connection);
        return Object.freeze({
          applied: false,
          idempotentReadback: true,
          eventId,
          planSha256: plan.planSha256,
          revisions: readback,
          secretsIncluded: false,
        });
      }
      if (delivery.status !== "claimed" || delivery.claim_token !== claimToken) {
        const error = new Error("Growth Control invalidation claim is stale or mismatched.");
        error.code = "GROWTH_CONTROL_INVALIDATION_CLAIM_MISMATCH";
        error.status = 409;
        throw error;
      }

      for (const entry of plan.entries) {
        await connection.query(
          `INSERT INTO growth_control_invalidation_revisions
            (invalidation_key,invalidation_type,tenant_id,workspace_id,config_key,scope_hash,
             source_version_id,revision,last_event_id,last_event_type,last_payload_sha256,
             last_plan_sha256,invalidated_at,secrets_included)
           VALUES (?,?,?,?,?,?,?,1,?,?,?,?,UTC_TIMESTAMP(6),0)
           ON DUPLICATE KEY UPDATE
             revision=IF(last_event_id=VALUES(last_event_id),revision,revision+1),
             invalidation_type=VALUES(invalidation_type),
             tenant_id=VALUES(tenant_id),
             workspace_id=VALUES(workspace_id),
             config_key=VALUES(config_key),
             scope_hash=VALUES(scope_hash),
             source_version_id=VALUES(source_version_id),
             last_event_id=VALUES(last_event_id),
             last_event_type=VALUES(last_event_type),
             last_payload_sha256=VALUES(last_payload_sha256),
             last_plan_sha256=VALUES(last_plan_sha256),
             invalidated_at=UTC_TIMESTAMP(6),
             secrets_included=0,
             updated_at=CURRENT_TIMESTAMP(6)`,
          [
            entry.invalidationKey,
            entry.invalidationType,
            entry.tenantId,
            entry.workspaceId,
            entry.configKey,
            entry.scopeHash,
            entry.sourceVersionId,
            plan.eventId,
            plan.eventType,
            plan.payloadSha256,
            plan.planSha256,
          ],
        );
      }
      await connection.query(
        `UPDATE platform_outbox_deliveries
            SET status='delivered',response_status=204,delivered_at=UTC_TIMESTAMP(6),
                claim_token=NULL,claim_expires_at=NULL,next_attempt_at=NULL,
                last_error_code=NULL,last_error_message=NULL,updated_at=UTC_TIMESTAMP(6)
          WHERE consumer_key=? AND event_id=? AND claim_token=?`,
        [consumerKey, eventId, claimToken],
      );
      await connection.query(
        `UPDATE platform_outbox_consumers
            SET last_success_at=UTC_TIMESTAMP(6),last_error_code=NULL,updated_at=UTC_TIMESTAMP(6)
          WHERE consumer_key=?`,
        [consumerKey],
      );
      const readback = await readInvalidationRevisions(plan.entries.map((entry) => entry.invalidationKey), connection);
      if (readback.length !== plan.entries.length
        || readback.some((row) => row.lastEventId !== eventId || row.lastPlanSha256 !== plan.planSha256)) {
        const error = new Error("Growth Control invalidation readback did not match the applied plan.");
        error.code = "GROWTH_CONTROL_INVALIDATION_READBACK_MISMATCH";
        throw error;
      }
      return Object.freeze({
        applied: true,
        idempotentReadback: false,
        eventId,
        planSha256: plan.planSha256,
        revisions: readback,
        secretsIncluded: false,
      });
    });
  }

  async function markDeliveryFailed({ eventId, claimToken, error, retryable = true }) {
    const db = await executor();
    const consumer = await getConsumer();
    const maxAttempts = consumer?.maxAttempts || 8;
    const [rows] = await db.query(
      `SELECT attempt_count FROM platform_outbox_deliveries
        WHERE consumer_key=? AND event_id=? AND claim_token=? LIMIT 1`,
      [consumerKey, eventId, claimToken],
    );
    if (!rows?.[0]) return Object.freeze({ updated: false, secretsIncluded: false });
    const attemptCount = Number(rows[0].attempt_count || 0) + 1;
    const deadLetter = !retryable || attemptCount >= maxAttempts;
    const delaySeconds = Math.min((consumer?.retryBaseSeconds || 30) * (2 ** Math.min(attemptCount - 1, 8)), 86400);
    const code = String(error?.code || "GROWTH_CONTROL_INVALIDATION_FAILED").slice(0, 120);
    const message = String(error?.message || "Growth Control invalidation failed.").slice(0, 500);
    await db.query(
      `UPDATE platform_outbox_deliveries
          SET status=?,attempt_count=?,next_attempt_at=?,claim_token=NULL,claim_expires_at=NULL,
              last_error_code=?,last_error_message=?,updated_at=UTC_TIMESTAMP(6)
        WHERE consumer_key=? AND event_id=? AND claim_token=?`,
      [deadLetter ? "dead_letter" : "failed", attemptCount,
       deadLetter ? null : new Date(Date.now() + delaySeconds * 1000),
       code, message, consumerKey, eventId, claimToken],
    );
    await db.query(
      `UPDATE platform_outbox_consumers
          SET last_failure_at=UTC_TIMESTAMP(6),last_error_code=?,updated_at=UTC_TIMESTAMP(6)
        WHERE consumer_key=?`,
      [code, consumerKey],
    );
    return Object.freeze({ updated: true, deadLetter, attemptCount, errorCode: code, secretsIncluded: false });
  }

  return Object.freeze({
    getConsumer,
    previewEvents,
    claimEvents,
    applyInvalidationPlan,
    markDeliveryFailed,
    readInvalidationRevisions,
  });
}

export const _testingGrowthControlInvalidationRepository = Object.freeze({
  MAX_BATCH_LIMIT,
  CLAIM_MINUTES,
  boundedLimit,
  parseJson,
  eventRow,
  revisionRow,
  requireExecutor,
});
