import { getPool } from "./db.js";
import { createOrAppendSupportTicket } from "./supportTicketService.js";
import {
  computeSupportTicketDedupeKeyV2,
  deriveSupportTicketIntegrity,
} from "./supportTicketLifecycleIntegrityService.js";

const REQUIRED_INTEGRITY_COLUMNS = Object.freeze([
  "is_test",
  "environment",
  "visibility_class",
  "target_capability",
  "related_ticket_id",
  "parent_ticket_id",
  "supersedes_ticket_id",
  "first_response_at",
  "triaged_at",
]);

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function readIntegritySchema(connection) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tickets'
        AND COLUMN_NAME IN (?)`,
    [REQUIRED_INTEGRITY_COLUMNS],
  );
  const available = new Set(rows.map((row) => row.COLUMN_NAME || row.column_name));
  const missing = REQUIRED_INTEGRITY_COLUMNS.filter((column) => !available.has(column));
  return {
    ready: missing.length === 0,
    available_columns: [...available].sort(),
    missing_columns: missing,
    secrets_included: false,
  };
}

function schemaNotReadyError(schema) {
  const error = new Error("Support ticket integrity migration is required before ticket creation.");
  error.status = 409;
  error.code = "support_ticket_integrity_schema_not_ready";
  error.schema = schema;
  return error;
}

async function persistIntegrityFields(connection, ticketId, integrity) {
  const [result] = await connection.query(
    `UPDATE tickets
        SET is_test = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(is_test, 0) END,
            environment = CASE WHEN ? = 1 THEN ? ELSE COALESCE(NULLIF(environment, ''), ?) END,
            visibility_class = CASE WHEN ? = 1 THEN 'internal_test' ELSE COALESCE(NULLIF(visibility_class, ''), ?) END,
            target_capability = COALESCE(?, target_capability),
            parent_ticket_id = COALESCE(?, parent_ticket_id),
            related_ticket_id = COALESCE(?, related_ticket_id),
            supersedes_ticket_id = COALESCE(?, supersedes_ticket_id),
            updated_at = NOW()
      WHERE ticket_id = ?`,
    [
      integrity.is_test ? 1 : 0,
      integrity.is_test ? 1 : 0,
      integrity.environment,
      integrity.environment,
      integrity.is_test ? 1 : 0,
      integrity.visibility_class,
      integrity.target_capability,
      integrity.parent_ticket_id,
      integrity.related_ticket_id,
      integrity.supersedes_ticket_id,
      ticketId,
    ],
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    const error = new Error("Created support ticket could not be updated with the integrity contract.");
    error.status = 409;
    error.code = "support_ticket_integrity_persist_target_missing";
    throw error;
  }
}

export async function createOrAppendSupportTicketWithIntegrityAtomic(envelope = {}, options = {}) {
  const integrity = deriveSupportTicketIntegrity(envelope);
  const metadata = parseJsonObject(envelope.metadata_json || envelope.metadata, {});
  const normalizedEnvelope = {
    ...envelope,
    dedupe_key: computeSupportTicketDedupeKeyV2(envelope),
    metadata_json: {
      ...metadata,
      ticket_integrity_contract: "support-ticket-integrity-v2",
      is_test: integrity.is_test,
      environment: integrity.environment,
      visibility_class: integrity.visibility_class,
      target_capability: integrity.target_capability,
      intended_parent_ticket_id: integrity.parent_ticket_id,
      related_ticket_id: integrity.related_ticket_id,
      supersedes_ticket_id: integrity.supersedes_ticket_id,
      secrets_included: false,
    },
  };

  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const createTicket = options.createOrAppendSupportTicketFn || createOrAppendSupportTicket;
  const { createOrAppendSupportTicketFn: _injectedCreateTicket, ...baseOptions } = options;
  let transactionStarted = false;

  try {
    const schema = await readIntegritySchema(connection);
    if (!schema.ready) throw schemaNotReadyError(schema);

    if (ownsConnection) {
      await connection.beginTransaction();
      transactionStarted = true;
    }

    const result = await createTicket(normalizedEnvelope, {
      ...baseOptions,
      pool,
      connection,
    });
    await persistIntegrityFields(connection, result.ticket.ticket_id, integrity);

    if (ownsConnection) {
      await connection.commit();
      transactionStarted = false;
    }

    return {
      ...result,
      integrity: {
        ...integrity,
        dedupe_key: normalizedEnvelope.dedupe_key,
        schema_ready: true,
        schema_missing_columns: [],
        persisted: true,
        secrets_included: false,
      },
      secrets_included: false,
    };
  } catch (error) {
    if (ownsConnection && transactionStarted) {
      try { await connection.rollback(); } catch { /* preserve the primary failure */ }
    }
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export function _testingSupportTicketLifecycleIntegrityCreation() {
  return { REQUIRED_INTEGRITY_COLUMNS };
}
