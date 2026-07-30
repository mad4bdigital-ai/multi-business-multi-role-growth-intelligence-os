import { createHash } from "node:crypto";

export const DELEGATION_GRANT_MARIADB_REPOSITORY_VERSION =
  "spec011-delegation-grant-mariadb-repository-v1";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function adapterError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stableJson(value))
    .digest("hex");
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return structuredClone(value);
  try {
    return JSON.parse(value);
  } catch {
    throw adapterError(409, "DELEGATION_MARIADB_JSON_INVALID", "Persisted JSON could not be decoded.");
  }
}

function iso(value) {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw adapterError(409, "DELEGATION_MARIADB_DATE_INVALID", "Persisted date-time is invalid.");
  }
  return new Date(timestamp).toISOString();
}

function assertUuid(value, field) {
  const normalized = compact(value, 64).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw adapterError(400, "DELEGATION_MARIADB_UUID_INVALID", `${field} must be a UUID.`, { field });
  }
  return normalized;
}

function assertHash(value, field) {
  const normalized = compact(value, 64).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw adapterError(400, "DELEGATION_MARIADB_HASH_INVALID", `${field} must be a SHA-256 hash.`, { field });
  }
  return normalized;
}

function tenantOperationKey(tenantId, idempotencyKey) {
  return `spec011:delegation:${sha256(`${tenantId}\n${idempotencyKey}`)}`;
}

function normalizeRows(result) {
  if (!Array.isArray(result)) return [];
  const [rows] = result;
  return Array.isArray(rows) ? rows : [];
}

function normalizeMutationResult(result) {
  if (!Array.isArray(result)) return result || {};
  return result[0] || {};
}

function canonicalGrantFromRow(row) {
  if (!row) return null;
  return {
    schema_version: row.grant_schema_version,
    grant_id: row.delegation_id,
    delegated_by: row.user_id,
    delegated_to: row.agent_id,
    approval_mode: row.approval_mode,
    plan_id: row.plan_id,
    plan_hash: row.plan_hash,
    resource_scope: parseJson(row.resource_scope_json, []),
    allowed_intents: parseJson(row.allowed_intents_json, []),
    denied_intents: parseJson(row.denied_intents_json, []),
    max_risk_tier: row.max_risk_tier,
    limits: {
      max_mutations: Number(row.max_mutations),
      max_retries: Number(row.max_retries),
      max_pull_requests: Number(row.max_pull_requests),
    },
    require_readback: Boolean(row.require_readback),
    stop_on_drift: Boolean(row.stop_on_drift),
    policy_version: row.policy_version || null,
    status: row.canonical_status,
    created_at: iso(row.canonical_created_at),
    expires_at: iso(row.expires_at),
    revoked_at: iso(row.revoked_at),
    secrets_included: false,
  };
}

function receiptFromRow(row) {
  if (!row) return null;
  const receipt = parseJson(row.provider_receipt_json, {});
  const readback = parseJson(row.readback_json, null);
  return {
    ...receipt,
    receipt_id: row.receipt_id,
    operation_id: row.run_id,
    step_id: row.step_key,
    idempotency_key: row.idempotency_key,
    request_fingerprint: row.request_sha256,
    state: receipt.state || row.dispatch_status,
    readback_fingerprint: readback?.readback_fingerprint ?? receipt.readback_fingerprint ?? null,
    readback_complete: readback?.readback_complete ?? receipt.readback_complete ?? false,
    retry_allowed: readback?.retry_allowed ?? receipt.retry_allowed ?? false,
    outcome_classification:
      readback?.outcome_classification ?? receipt.outcome_classification ?? row.dispatch_status,
    secrets_included: false,
  };
}

function validatePool(pool) {
  if (!pool || typeof pool.getConnection !== "function") {
    throw adapterError(500, "DELEGATION_MARIADB_POOL_INVALID", "A transaction-capable MariaDB pool is required.");
  }
}

function validateConnection(connection) {
  for (const method of ["beginTransaction", "execute", "commit", "rollback", "release"]) {
    if (typeof connection?.[method] !== "function") {
      throw adapterError(500, "DELEGATION_MARIADB_CONNECTION_INVALID", `MariaDB connection must expose ${method}.`, {
        missing_method: method,
      });
    }
  }
}

export function createDelegationGrantMariaDbRepository({ pool } = {}) {
  validatePool(pool);

  return Object.freeze({
    repository_version: DELEGATION_GRANT_MARIADB_REPOSITORY_VERSION,

    async beginTransaction({ tenant_id: tenantId, action, request_fingerprint: requestFingerprint } = {}) {
      const normalizedTenantId = assertUuid(tenantId, "tenant_id");
      const normalizedAction = compact(action, 32).toLowerCase();
      const normalizedRequestFingerprint = assertHash(requestFingerprint, "request_fingerprint");
      const connection = await pool.getConnection();
      validateConnection(connection);
      await connection.beginTransaction();

      const pendingReceipts = new Map();
      let closed = false;

      async function releaseOnce() {
        if (closed) return;
        closed = true;
        connection.release();
      }

      async function query(sql, params = []) {
        if (closed) {
          throw adapterError(409, "DELEGATION_MARIADB_TRANSACTION_CLOSED", "The transaction is already closed.");
        }
        return connection.execute(sql, params);
      }

      return {
        async findReceiptByIdempotencyKey({ tenant_id, idempotency_key: idempotencyKey }) {
          const requestedTenantId = assertUuid(tenant_id, "tenant_id");
          if (requestedTenantId !== normalizedTenantId) {
            throw adapterError(409, "DELEGATION_MARIADB_TENANT_MISMATCH", "Transaction tenant does not match receipt tenant.");
          }
          const normalizedIdempotencyKey = compact(idempotencyKey, 191);
          const operationKey = tenantOperationKey(normalizedTenantId, normalizedIdempotencyKey);
          const rows = normalizeRows(await query(
            `SELECT receipt_id, run_id, step_key, operation_key, idempotency_key,
                    request_sha256, dispatch_status, provider_status,
                    provider_receipt_json, readback_json, recovered_from_transport
               FROM repository_automation_receipts
              WHERE operation_key = ? AND idempotency_key = ?
              ORDER BY id DESC
              LIMIT 2
              FOR UPDATE`,
            [operationKey, normalizedIdempotencyKey],
          ));
          if (rows.length > 1) {
            throw adapterError(409, "DELEGATION_MARIADB_RECEIPT_AMBIGUOUS", "Multiple receipts matched one tenant-scoped idempotency binding.");
          }
          return receiptFromRow(rows[0] || null);
        },

        async insertPendingReceipt({ tenant_id, receipt }) {
          const requestedTenantId = assertUuid(tenant_id, "tenant_id");
          if (requestedTenantId !== normalizedTenantId) {
            throw adapterError(409, "DELEGATION_MARIADB_TENANT_MISMATCH", "Transaction tenant does not match receipt tenant.");
          }
          const canonicalReceipt = structuredClone(receipt);
          const receiptId = assertUuid(canonicalReceipt.receipt_id, "receipt.receipt_id");
          const operationId = assertUuid(canonicalReceipt.operation_id, "receipt.operation_id");
          const stepId = assertUuid(canonicalReceipt.step_id, "receipt.step_id");
          const idempotencyKey = compact(canonicalReceipt.idempotency_key, 191);
          const fingerprint = assertHash(canonicalReceipt.request_fingerprint, "receipt.request_fingerprint");
          if (fingerprint !== normalizedRequestFingerprint) {
            throw adapterError(409, "DELEGATION_MARIADB_RECEIPT_FINGERPRINT_MISMATCH", "Receipt fingerprint differs from the transaction fingerprint.");
          }
          const operationKey = tenantOperationKey(normalizedTenantId, idempotencyKey);
          await query(
            `INSERT INTO repository_automation_receipts
               (receipt_id, run_id, step_key, operation_key, idempotency_key,
                request_sha256, dispatch_status, provider_status,
                provider_receipt_json, readback_json, recovered_from_transport,
                secrets_included)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, 0, 0)`,
            [
              receiptId,
              operationId,
              stepId,
              operationKey,
              idempotencyKey,
              fingerprint,
              JSON.stringify({ ...canonicalReceipt, secrets_included: false }),
            ],
          );
          pendingReceipts.set(receiptId, {
            ...canonicalReceipt,
            receipt_id: receiptId,
            operation_id: operationId,
            step_id: stepId,
            idempotency_key: idempotencyKey,
            request_fingerprint: fingerprint,
            operation_key: operationKey,
            tenant_id: normalizedTenantId,
          });
        },

        async applyCreateGrant({ tenant_id, command, receipt_id: receiptId }) {
          const requestedTenantId = assertUuid(tenant_id, "tenant_id");
          const normalizedReceiptId = assertUuid(receiptId, "receipt_id");
          const receipt = pendingReceipts.get(normalizedReceiptId);
          if (!receipt || requestedTenantId !== normalizedTenantId) {
            throw adapterError(409, "DELEGATION_MARIADB_PENDING_RECEIPT_REQUIRED", "A tenant-bound pending receipt must exist before create.");
          }
          const grant = command?.grant || {};
          const allowedIntents = Array.isArray(grant.allowed_intents) ? grant.allowed_intents : [];
          if (allowedIntents.length === 0) {
            throw adapterError(400, "DELEGATION_MARIADB_ALLOWED_INTENT_REQUIRED", "At least one allowed intent is required.");
          }
          const createdAt = iso(grant.created_at || receipt.created_at);
          const expiresAt = iso(grant.expires_at);
          const grantHash = assertHash(command.canonical_grant_hash, "command.canonical_grant_hash");
          const resourceScopeJson = JSON.stringify(grant.resource_scope || []);
          const requestedBy = compact(command.requested_by, 191);
          await query(
            `INSERT INTO agent_delegations
               (delegation_id, grant_schema_version, approval_mode, user_id, tenant_id, agent_id,
                intent_key, brand_key, plan_id, plan_hash, resource_scope_json,
                resource_scope_hash, allowed_intents_json, denied_intents_json,
                max_risk_tier, max_mutations, consumed_mutations, max_retries,
                consumed_retries, max_pull_requests, consumed_pull_requests,
                require_readback, stop_on_drift, policy_version, grant_hash,
                idempotency_key, status, canonical_status, approval_hold_id,
                approved_by, approved_at, revoked_by, revoked_at,
                revocation_reason, runtime_policy_ready, canonical_created_at,
                canonical_updated_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0,
                     ?, 0, 1, 1, ?, ?, ?, 'pending', ?, NULL, ?, ?, NULL, NULL,
                     NULL, 0, ?, ?, ?)`,
            [
              assertUuid(grant.grant_id, "grant.grant_id"),
              compact(grant.schema_version, 64),
              compact(grant.approval_mode, 64),
              compact(grant.delegated_by, 36),
              normalizedTenantId,
              compact(grant.delegated_to, 36),
              compact(allowedIntents[0], 128),
              assertUuid(grant.plan_id, "grant.plan_id"),
              assertHash(grant.plan_hash, "grant.plan_hash"),
              resourceScopeJson,
              sha256(grant.resource_scope || []),
              JSON.stringify(allowedIntents),
              JSON.stringify(Array.isArray(grant.denied_intents) ? grant.denied_intents : []),
              compact(grant.max_risk_tier, 16),
              Number(grant.limits?.max_mutations),
              Number(grant.limits?.max_retries),
              Number(grant.limits?.max_pull_requests),
              compact(grant.policy_version, 64) || null,
              grantHash,
              receipt.idempotency_key,
              compact(command.proposed_status, 32),
              requestedBy,
              createdAt,
              createdAt,
              createdAt,
              expiresAt,
            ],
          );
        },

        async applyGrantTransition({ tenant_id, action: transitionAction, command, receipt_id: receiptId }) {
          const requestedTenantId = assertUuid(tenant_id, "tenant_id");
          const normalizedReceiptId = assertUuid(receiptId, "receipt_id");
          if (!pendingReceipts.has(normalizedReceiptId) || requestedTenantId !== normalizedTenantId) {
            throw adapterError(409, "DELEGATION_MARIADB_PENDING_RECEIPT_REQUIRED", "A tenant-bound pending receipt must exist before transition.");
          }
          const grantId = assertUuid(command.grant_id, "command.grant_id");
          const expectedHash = assertHash(command.expected_grant_hash, "command.expected_grant_hash");
          const requestedBy = compact(command.requested_by, 191);
          let result;
          if (transitionAction === "revoke") {
            result = normalizeMutationResult(await query(
              `UPDATE agent_delegations
                  SET canonical_status = 'revoked',
                      revoked_by = ?, revoked_at = ?, revocation_reason = ?,
                      runtime_policy_ready = 0, canonical_updated_at = ?
                WHERE tenant_id = ? AND delegation_id = ?
                  AND canonical_status = ? AND grant_hash = ?`,
              [
                requestedBy,
                iso(command.revoked_at),
                compact(command.revocation_reason, 500) || null,
                iso(command.revoked_at),
                normalizedTenantId,
                grantId,
                compact(command.expected_status, 32),
                expectedHash,
              ],
            ));
          } else if (transitionAction === "expire") {
            result = normalizeMutationResult(await query(
              `UPDATE agent_delegations
                  SET status = 'expired', canonical_status = 'expired',
                      completed_at = ?, runtime_policy_ready = 0,
                      canonical_updated_at = ?
                WHERE tenant_id = ? AND delegation_id = ?
                  AND canonical_status = ? AND grant_hash = ?`,
              [
                iso(command.expired_at),
                iso(command.expired_at),
                normalizedTenantId,
                grantId,
                compact(command.expected_status, 32),
                expectedHash,
              ],
            ));
          } else {
            throw adapterError(400, "DELEGATION_MARIADB_TRANSITION_INVALID", "Only revoke and expire transitions are supported.");
          }
          if (Number(result.affectedRows) !== 1) {
            throw adapterError(409, "DELEGATION_MARIADB_GRANT_TRANSITION_CONFLICT", "Grant transition did not match the expected status and hash.", {
              action: transitionAction,
              grant_id: grantId,
            });
          }
        },

        async inspectGrant({ tenant_id, grant_id: grantId }) {
          const requestedTenantId = assertUuid(tenant_id, "tenant_id");
          const rows = normalizeRows(await query(
            `SELECT delegation_id, grant_schema_version, user_id, tenant_id,
                    agent_id, approval_mode, plan_id, plan_hash,
                    resource_scope_json, allowed_intents_json, denied_intents_json,
                    max_risk_tier, max_mutations, max_retries, max_pull_requests,
                    require_readback, stop_on_drift, policy_version,
                    canonical_status, canonical_created_at, expires_at, revoked_at
               FROM agent_delegations
              WHERE tenant_id = ? AND delegation_id = ?
              LIMIT 2
              FOR UPDATE`,
            [requestedTenantId, assertUuid(grantId, "grant_id")],
          ));
          if (rows.length > 1) {
            throw adapterError(409, "DELEGATION_MARIADB_GRANT_AMBIGUOUS", "Multiple grant rows matched one tenant and grant id.");
          }
          return canonicalGrantFromRow(rows[0] || null);
        },

        async finalizeReceipt({ tenant_id, receipt_id: receiptId, ...updates }) {
          const requestedTenantId = assertUuid(tenant_id, "tenant_id");
          const normalizedReceiptId = assertUuid(receiptId, "receipt_id");
          const receipt = pendingReceipts.get(normalizedReceiptId);
          if (!receipt || requestedTenantId !== normalizedTenantId) {
            throw adapterError(409, "DELEGATION_MARIADB_PENDING_RECEIPT_REQUIRED", "Pending receipt context is missing for reconciliation.");
          }
          const reconciled = {
            ...receipt,
            state: compact(updates.state, 32),
            outcome_classification: compact(updates.outcome_classification, 64),
            readback_fingerprint: assertHash(updates.readback_fingerprint, "readback_fingerprint"),
            retry_allowed: updates.retry_allowed === true,
            readback_complete: updates.readback_complete === true,
            dispatched_at: iso(updates.dispatched_at),
            reconciled_at: iso(updates.reconciled_at),
            secrets_included: false,
          };
          const readback = {
            readback_fingerprint: reconciled.readback_fingerprint,
            outcome_classification: reconciled.outcome_classification,
            retry_allowed: reconciled.retry_allowed,
            readback_complete: reconciled.readback_complete,
            reconciled_at: reconciled.reconciled_at,
            secrets_included: false,
          };
          const result = normalizeMutationResult(await query(
            `UPDATE repository_automation_receipts
                SET dispatch_status = ?, provider_status = 200,
                    provider_receipt_json = ?, readback_json = ?,
                    recovered_from_transport = 0, secrets_included = 0
              WHERE receipt_id = ? AND operation_key = ?`,
            [
              reconciled.state,
              JSON.stringify(reconciled),
              JSON.stringify(readback),
              normalizedReceiptId,
              receipt.operation_key,
            ],
          ));
          if (Number(result.affectedRows) !== 1) {
            throw adapterError(409, "DELEGATION_MARIADB_RECEIPT_RECONCILE_CONFLICT", "Receipt reconciliation did not update exactly one row.");
          }
          pendingReceipts.set(normalizedReceiptId, reconciled);
        },

        async inspectReceipt({ tenant_id, receipt_id: receiptId }) {
          const requestedTenantId = assertUuid(tenant_id, "tenant_id");
          const normalizedReceiptId = assertUuid(receiptId, "receipt_id");
          const rows = normalizeRows(await query(
            `SELECT receipt_id, run_id, step_key, operation_key, idempotency_key,
                    request_sha256, dispatch_status, provider_status,
                    provider_receipt_json, readback_json, recovered_from_transport
               FROM repository_automation_receipts
              WHERE receipt_id = ?
              LIMIT 2
              FOR UPDATE`,
            [normalizedReceiptId],
          ));
          if (rows.length > 1) {
            throw adapterError(409, "DELEGATION_MARIADB_RECEIPT_AMBIGUOUS", "Multiple rows matched one receipt id.");
          }
          if (rows.length === 0) return null;
          const decoded = receiptFromRow(rows[0]);
          if (rows[0].operation_key !== tenantOperationKey(requestedTenantId, decoded.idempotency_key)) {
            throw adapterError(404, "DELEGATION_MARIADB_RECEIPT_NOT_FOUND", "Receipt is not bound to the requested tenant.");
          }
          return decoded;
        },

        async commit() {
          try {
            await connection.commit();
          } finally {
            await releaseOnce();
          }
        },

        async rollback() {
          try {
            await connection.rollback();
          } finally {
            await releaseOnce();
          }
        },

        adapter_contract: {
          action: normalizedAction,
          tenant_id: normalizedTenantId,
          request_fingerprint: normalizedRequestFingerprint,
          reused_tables: ["agent_delegations", "repository_automation_receipts"],
          runtime_policy_ready_written: false,
          secrets_included: false,
        },
      };
    },
  });
}

export const _testingDelegationGrantMariaDbRepository = {
  stableJson,
  sha256,
  parseJson,
  iso,
  tenantOperationKey,
  canonicalGrantFromRow,
  receiptFromRow,
};
