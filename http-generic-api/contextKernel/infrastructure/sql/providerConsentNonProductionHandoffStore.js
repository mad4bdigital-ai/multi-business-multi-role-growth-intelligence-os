const NON_PRODUCTION_ENVIRONMENTS = new Set([
  "test",
  "development",
  "staging",
  "non_production",
]);

function adapterError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.name = "ProviderConsentNonProductionHandoffStoreError";
  error.code = code;
  error.status = status;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value == null || value === "") return null;
  return requiredString(value, "value");
}

function assertNonProduction(environment) {
  const normalized = requiredString(environment, "environment").toLowerCase();
  if (!NON_PRODUCTION_ENVIRONMENTS.has(normalized)) {
    throw adapterError(
      "provider_consent_nonprod_adapter_environment_forbidden",
      "Provider-consent handoff adapters cannot be constructed for Production.",
      403,
      { environment: normalized },
    );
  }
  return normalized;
}

function validateIdentifier(value, fieldName) {
  const identifier = requiredString(value, fieldName);
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
    throw new TypeError(`${fieldName} must be a safe SQL identifier.`);
  }
  return identifier;
}

function executorMethod(executor) {
  if (typeof executor?.execute === "function") return executor.execute.bind(executor);
  if (typeof executor?.query === "function") return executor.query.bind(executor);
  throw new TypeError("SQL executor must provide execute() or query().");
}

async function execute(executor, statement, params = []) {
  return executorMethod(executor)(statement, params);
}

function mutationResult(result) {
  if (Array.isArray(result)) return result[0] || {};
  return result || {};
}

function rowResult(result) {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : [];
}

function affectedRows(result) {
  const value = Number(
    mutationResult(result)?.affectedRows
    ?? mutationResult(result)?.rowCount
    ?? 0,
  );
  return Number.isFinite(value) ? value : 0;
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, freeze(entry)]),
  ));
}

export function createSqlProviderConsentHandoffStore({
  executor,
  tableName = "provider_consent_handoffs",
  environment = "non_production",
  schemaDigestSha256,
  adapterVersionRef = "provider-consent-handoff-sql.v2",
  maxLeaseSeconds = 60,
  maxAttempts = 4,
} = {}) {
  executorMethod(executor);
  const normalizedEnvironment = assertNonProduction(environment);
  const table = validateIdentifier(tableName, "tableName");
  const schemaDigest = requiredString(
    schemaDigestSha256,
    "schemaDigestSha256",
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(schemaDigest)) {
    throw new TypeError("schemaDigestSha256 must be a SHA-256 value.");
  }
  if (
    !Number.isSafeInteger(maxLeaseSeconds)
    || maxLeaseSeconds < 1
    || maxLeaseSeconds > 300
  ) {
    throw new TypeError("maxLeaseSeconds must be between 1 and 300.");
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new TypeError("maxAttempts must be between 1 and 20.");
  }

  const statements = Object.freeze({
    insert: `
      INSERT INTO ${table} (
        handoff_ref,
        status,
        stage,
        expires_at,
        max_attempts,
        attempt_count,
        sealed_payload,
        certification_version_ref,
        created_at,
        updated_at
      ) VALUES (
        ?, 'ready', 'claimed_handoff_ready', ?, ?, 0, ?, ?,
        UTC_TIMESTAMP(), UTC_TIMESTAMP()
      )
    `,
    acquire: `
      UPDATE ${table}
      SET status = 'leased',
          lease_ref = ?,
          lease_expires_at = ?,
          attempt_count = attempt_count + 1,
          updated_at = UTC_TIMESTAMP()
      WHERE handoff_ref = ?
        AND expires_at > ?
        AND attempt_count < max_attempts
        AND (lease_ref IS NULL OR lease_expires_at <= ?)
        AND (
          status = 'ready'
          OR (
            status = 'retryable'
            AND (retry_at IS NULL OR retry_at <= ?)
          )
        )
    `,
    readLease: `
      SELECT
        handoff_ref,
        lease_ref,
        stage,
        attempt_count AS attempt,
        sealed_payload,
        sealed_credential_checkpoint,
        sealed_completion_checkpoint,
        expires_at
      FROM ${table}
      WHERE handoff_ref = ?
        AND lease_ref = ?
        AND status = 'leased'
      LIMIT 2
    `,
    checkpointProvider: `
      UPDATE ${table}
      SET stage = 'provider_completed',
          sealed_credential_checkpoint = ?,
          updated_at = UTC_TIMESTAMP()
      WHERE handoff_ref = ?
        AND lease_ref = ?
        AND status = 'leased'
        AND stage = 'claimed_handoff_ready'
        AND sealed_credential_checkpoint IS NULL
        AND sealed_completion_checkpoint IS NULL
    `,
    checkpointPersistence: `
      UPDATE ${table}
      SET stage = 'persistence_completed',
          sealed_completion_checkpoint = ?,
          updated_at = UTC_TIMESTAMP()
      WHERE handoff_ref = ?
        AND lease_ref = ?
        AND status = 'leased'
        AND stage = 'provider_completed'
        AND sealed_credential_checkpoint IS NOT NULL
        AND sealed_completion_checkpoint IS NULL
    `,
    release: `
      UPDATE ${table}
      SET status = ?,
          lease_ref = NULL,
          lease_expires_at = NULL,
          retry_at = ?,
          last_error_code = ?,
          updated_at = UTC_TIMESTAMP()
      WHERE handoff_ref = ?
        AND lease_ref = ?
        AND status = 'leased'
        AND stage IN (
          'claimed_handoff_ready',
          'provider_completed',
          'persistence_completed'
        )
    `,
    complete: `
      UPDATE ${table}
      SET status = 'completed',
          stage = 'completed',
          completed_at = UTC_TIMESTAMP(),
          lease_ref = NULL,
          lease_expires_at = NULL,
          updated_at = UTC_TIMESTAMP()
      WHERE handoff_ref = ?
        AND lease_ref = ?
        AND status = 'leased'
        AND stage = 'persistence_completed'
        AND sealed_completion_checkpoint IS NOT NULL
    `,
    readStatus: `
      SELECT
        handoff_ref,
        status,
        stage,
        attempt_count,
        max_attempts,
        expires_at,
        retry_at,
        last_error_code,
        sealed_credential_checkpoint IS NOT NULL
          AS provider_checkpoint_present,
        sealed_completion_checkpoint IS NOT NULL
          AS completion_checkpoint_present
      FROM ${table}
      WHERE handoff_ref = ?
      LIMIT 2
    `,
  });

  async function insert(input = {}) {
    const handoffRef = requiredString(input.handoffRef, "handoffRef");
    const attempts = Number.parseInt(
      String(input.maxAttempts ?? maxAttempts),
      10,
    );
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > maxAttempts) {
      throw new TypeError(`maxAttempts must be between 1 and ${maxAttempts}.`);
    }
    const result = await execute(executor, statements.insert, [
      handoffRef,
      requiredString(input.expiresAt, "expiresAt"),
      attempts,
      requiredString(input.sealedPayload, "sealedPayload"),
      requiredString(
        input.certificationVersionRef,
        "certificationVersionRef",
      ),
    ]);
    return Object.freeze({ created: affectedRows(result) === 1, handoffRef });
  }

  async function acquire(input = {}) {
    const handoffRef = requiredString(input.handoffRef, "handoffRef");
    const leaseRef = requiredString(input.leaseRef, "leaseRef");
    const now = requiredString(input.now, "now");
    const update = await execute(executor, statements.acquire, [
      leaseRef,
      requiredString(input.leaseExpiresAt, "leaseExpiresAt"),
      handoffRef,
      now,
      now,
      now,
    ]);
    if (affectedRows(update) !== 1) return null;
    const rows = rowResult(await execute(
      executor,
      statements.readLease,
      [handoffRef, leaseRef],
    ));
    if (rows.length !== 1) {
      throw adapterError(
        "provider_consent_handoff_lease_readback_ambiguous",
        "Provider-consent handoff lease did not have an exact readback.",
        500,
        { row_count: rows.length },
      );
    }
    const row = rows[0];
    return freeze({
      acquired: true,
      handoffRef,
      leaseRef,
      attempt: Number(row.attempt || 0),
      sealedPayload: row.sealed_payload,
      sealedCredentialCheckpoint: row.sealed_credential_checkpoint || null,
      sealedCompletionCheckpoint: row.sealed_completion_checkpoint || null,
    });
  }

  async function checkpoint(input = {}) {
    const handoffRef = requiredString(input.handoffRef, "handoffRef");
    const leaseRef = requiredString(input.leaseRef, "leaseRef");
    const stage = requiredString(input.stage, "stage");
    let result;
    if (stage === "provider_completed") {
      result = await execute(executor, statements.checkpointProvider, [
        requiredString(
          input.sealedCredentialCheckpoint,
          "sealedCredentialCheckpoint",
        ),
        handoffRef,
        leaseRef,
      ]);
    } else if (stage === "persistence_completed") {
      result = await execute(executor, statements.checkpointPersistence, [
        requiredString(
          input.sealedCompletionCheckpoint,
          "sealedCompletionCheckpoint",
        ),
        handoffRef,
        leaseRef,
      ]);
    } else {
      throw new TypeError(
        "stage must be provider_completed or persistence_completed.",
      );
    }
    return Object.freeze({ checkpointed: affectedRows(result) === 1 });
  }

  async function release(input = {}) {
    const retryable = input.retryable === true;
    const result = await execute(executor, statements.release, [
      retryable ? "retryable" : "failed",
      retryable ? optionalString(input.retryAt) : null,
      requiredString(input.errorCode, "errorCode"),
      requiredString(input.handoffRef, "handoffRef"),
      requiredString(input.leaseRef, "leaseRef"),
    ]);
    return Object.freeze({ released: affectedRows(result) === 1 });
  }

  async function complete(input = {}) {
    const result = await execute(executor, statements.complete, [
      requiredString(input.handoffRef, "handoffRef"),
      requiredString(input.leaseRef, "leaseRef"),
    ]);
    return Object.freeze({ completed: affectedRows(result) === 1 });
  }

  async function readStatus({ handoffRef } = {}) {
    const ref = requiredString(handoffRef, "handoffRef");
    const rows = rowResult(await execute(executor, statements.readStatus, [ref]));
    if (rows.length > 1) {
      throw adapterError(
        "provider_consent_handoff_status_ambiguous",
        "Provider-consent handoff status readback was ambiguous.",
        500,
        { row_count: rows.length },
      );
    }
    if (!rows.length) return null;
    const row = rows[0];
    return freeze({
      handoffRef: ref,
      status: row.status,
      stage: row.stage,
      attemptCount: Number(row.attempt_count || 0),
      maxAttempts: Number(row.max_attempts || 0),
      expiresAt: row.expires_at,
      retryAt: row.retry_at || null,
      lastErrorCode: row.last_error_code || null,
      providerCheckpointPresent: Boolean(row.provider_checkpoint_present),
      completionCheckpointPresent: Boolean(row.completion_checkpoint_present),
      secretsIncluded: false,
    });
  }

  return Object.freeze({
    certification: freeze({
      status: "certified",
      versionRef: requiredString(adapterVersionRef, "adapterVersionRef"),
      environment: normalizedEnvironment,
      schemaRef: `db-schema://${table}`,
      schemaDigestSha256: schemaDigest,
      capabilities: {
        atomicCreate: true,
        leaseCas: true,
        checkpointCas: true,
        monotonicStages: true,
        retryAtEnforced: true,
        oneTimeCompletion: true,
        expiryEnforced: true,
        payloadEncryption: true,
      },
      maxLeaseSeconds,
      maxAttempts,
      secretsIncluded: false,
    }),
    insert,
    acquire,
    checkpoint,
    release,
    complete,
    readStatus,
  });
}

export const _testingProviderConsentNonProductionHandoffStore = Object.freeze({
  assertNonProduction,
});
