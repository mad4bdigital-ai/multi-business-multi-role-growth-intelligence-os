import {
  cleanOptional,
  cleanRequired,
  freezeRecord,
  requireUniqueRow,
} from "./sqlRepositorySupport.js";

const REQUIRED_HANDOFF_CAPABILITIES = Object.freeze([
  "atomicCreate",
  "leaseCas",
  "checkpointCas",
  "oneTimeCompletion",
  "expiryEnforced",
  "payloadEncryption",
]);

const LOCK_OWNERSHIP_SQL = `
  SELECT
    connection_id,
    tenant_id,
    workspace_id,
    brand_id,
    owner_scope_type,
    owner_scope_ref,
    provider_key,
    authorization_revision,
    connection_revision,
    status
  FROM connection_ownership_scopes
  WHERE tenant_id = ?
    AND workspace_id = ?
    AND connection_id = ?
  LIMIT 2
  FOR UPDATE
`;

const LOCK_BASE_CONNECTION_SQL = `
  SELECT
    connection_id,
    tenant_id,
    app_key,
    status
  FROM user_app_connections
  WHERE tenant_id = ?
    AND connection_id = ?
  LIMIT 2
  FOR UPDATE
`;

const REVOKE_OWNERSHIP_SQL = `
  UPDATE connection_ownership_scopes
  SET status = 'revoked',
      authorization_revision = authorization_revision + 1,
      connection_revision = connection_revision + 1,
      updated_at = UTC_TIMESTAMP()
  WHERE tenant_id = ?
    AND workspace_id = ?
    AND connection_id = ?
    AND owner_scope_type = ?
    AND owner_scope_ref = ?
    AND (brand_id <=> ?)
    AND status = 'active'
    AND connection_revision = ?
`;

const REVOKE_BASE_CONNECTION_SQL = `
  UPDATE user_app_connections
  SET status = 'revoked',
      last_used_at = UTC_TIMESTAMP()
  WHERE tenant_id = ?
    AND connection_id = ?
    AND app_key = ?
    AND status = 'active'
`;

const READBACK_OWNERSHIP_SQL = `
  SELECT
    connection_id,
    tenant_id,
    workspace_id,
    brand_id,
    owner_scope_type,
    owner_scope_ref,
    provider_key,
    authorization_revision,
    connection_revision,
    status,
    updated_at
  FROM connection_ownership_scopes
  WHERE tenant_id = ?
    AND workspace_id = ?
    AND connection_id = ?
  LIMIT 2
`;

const READBACK_BASE_CONNECTION_SQL = `
  SELECT
    connection_id,
    tenant_id,
    app_key,
    status,
    last_used_at
  FROM user_app_connections
  WHERE tenant_id = ?
    AND connection_id = ?
  LIMIT 2
`;

function repositoryError(code, message, details = {}, status = 409) {
  const error = new Error(message);
  error.name = "ProviderConsentActivationPilotRepositoryError";
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function normalizeRevision(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer.`);
  }
  return parsed;
}

function activeMethod(executor) {
  if (typeof executor?.execute === "function") return executor.execute.bind(executor);
  if (typeof executor?.query === "function") return executor.query.bind(executor);
  throw new TypeError("Provider-consent activation SQL executor is invalid.");
}

async function executeRaw(executor, statement, params = []) {
  return activeMethod(executor)(statement, params);
}

async function queryRows(executor, statement, params = []) {
  const result = await executeRaw(executor, statement, params);
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : [];
}

async function mutate(executor, statement, params = []) {
  const result = await executeRaw(executor, statement, params);
  if (!Array.isArray(result)) return result || {};
  return result[0] || {};
}

function affectedRows(result) {
  const count = Number(result?.affectedRows ?? result?.rowCount ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function requireMethod(value, name) {
  if (!value || typeof value !== "object" || typeof value[name] !== "function") {
    throw new TypeError(`Durable handoff store requires ${name}().`);
  }
}

function requireCipherMethod(value, name) {
  if (!value || typeof value !== "object" || typeof value[name] !== "function") {
    throw new TypeError(`Durable handoff payload cipher requires ${name}().`);
  }
}

function validateHandoffCertification(certification) {
  if (!certification || certification.status !== "certified") {
    throw repositoryError(
      "provider_consent_handoff_store_not_certified",
      "Durable handoff store is not certified.",
      {},
      503,
    );
  }
  const missing = REQUIRED_HANDOFF_CAPABILITIES.filter(
    (capability) => certification.capabilities?.[capability] !== true,
  );
  if (missing.length) {
    throw repositoryError(
      "provider_consent_handoff_capability_missing",
      "Durable handoff store lacks required atomic capabilities.",
      { missing_capability_count: missing.length },
      503,
    );
  }
  return freezeRecord({
    status: "certified",
    versionRef: cleanRequired(certification.versionRef, "certification.versionRef"),
    capabilities: Object.freeze({ ...certification.capabilities }),
    secretsIncluded: false,
  });
}

function normalizeDate(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${fieldName} must be a valid date.`);
  return date;
}

export function createDurableProviderConsentHandoffAdapter({
  store,
  payloadCipher,
  certification,
  clock = () => new Date(),
} = {}) {
  for (const method of ["insert", "acquire", "checkpoint", "release", "complete"]) {
    requireMethod(store, method);
  }
  for (const method of ["seal", "open"]) requireCipherMethod(payloadCipher, method);
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");
  const certified = validateHandoffCertification(certification);

  async function create({
    handoffRef,
    expiresAt,
    maxAttempts,
    payload,
  } = {}) {
    const ref = cleanRequired(handoffRef, "handoffRef");
    const expiry = normalizeDate(expiresAt, "expiresAt");
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("clock must return a valid Date.");
    }
    if (expiry.getTime() <= now.getTime()) {
      throw repositoryError(
        "provider_consent_handoff_expired_before_create",
        "Provider-consent handoff expiry must be in the future.",
      );
    }
    const attempts = Number.parseInt(String(maxAttempts), 10);
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 20) {
      throw new TypeError("maxAttempts must be a safe integer between 1 and 20.");
    }
    const sealedPayload = await payloadCipher.seal({
      purpose: "provider-consent-handoff.v1",
      plaintext: payload,
      context: { handoffRef: ref },
    });
    const created = await store.insert({
      handoffRef: ref,
      expiresAt: expiry.toISOString(),
      maxAttempts: attempts,
      sealedPayload,
      certificationVersionRef: certified.versionRef,
    });
    if (created?.created !== true || created?.handoffRef !== ref) {
      throw repositoryError(
        "provider_consent_handoff_create_conflict",
        "Provider-consent handoff was not inserted exactly once.",
        { handoff_ref: ref },
      );
    }
    return freezeRecord({
      handoffRef: ref,
      persisted: true,
      payloadSealed: true,
      expiresAt: expiry.toISOString(),
      certificationVersionRef: certified.versionRef,
      secretsIncluded: false,
    });
  }

  async function acquire({ handoffRef, leaseRef, leaseExpiresAt } = {}) {
    const ref = cleanRequired(handoffRef, "handoffRef");
    const lease = cleanRequired(leaseRef, "leaseRef");
    const leaseExpiry = normalizeDate(leaseExpiresAt, "leaseExpiresAt");
    const row = await store.acquire({
      handoffRef: ref,
      leaseRef: lease,
      leaseExpiresAt: leaseExpiry.toISOString(),
      now: clock().toISOString(),
    });
    if (!row || row.acquired !== true) return null;
    if (row.handoffRef !== ref || row.leaseRef !== lease || !row.sealedPayload) {
      throw repositoryError(
        "provider_consent_handoff_lease_mismatch",
        "Durable handoff lease escaped the exact CAS context.",
        { handoff_ref: ref },
      );
    }
    const payload = await payloadCipher.open({
      purpose: "provider-consent-handoff.v1",
      sealed: row.sealedPayload,
      context: { handoffRef: ref },
    });
    const credentialCheckpoint = row.sealedCredentialCheckpoint
      ? await payloadCipher.open({
        purpose: "provider-consent-credential-checkpoint.v1",
        sealed: row.sealedCredentialCheckpoint,
        context: { handoffRef: ref },
      })
      : null;
    const completionCheckpoint = row.sealedCompletionCheckpoint
      ? await payloadCipher.open({
        purpose: "provider-consent-completion-checkpoint.v1",
        sealed: row.sealedCompletionCheckpoint,
        context: { handoffRef: ref },
      })
      : null;
    return Object.freeze({
      handoffRef: ref,
      leaseRef: lease,
      acquired: true,
      attempt: Number(row.attempt || 1),
      payload,
      credentialCheckpoint,
      completionCheckpoint,
      secretsIncluded: false,
    });
  }

  async function checkpoint({
    handoffRef,
    leaseRef,
    stage,
    credentialCheckpoint = null,
    completionCheckpoint = null,
  } = {}) {
    const ref = cleanRequired(handoffRef, "handoffRef");
    const lease = cleanRequired(leaseRef, "leaseRef");
    if (!["provider_completed", "persistence_completed"].includes(stage)) {
      throw new TypeError("stage must be provider_completed or persistence_completed.");
    }
    const sealedCredentialCheckpoint = credentialCheckpoint
      ? await payloadCipher.seal({
        purpose: "provider-consent-credential-checkpoint.v1",
        plaintext: credentialCheckpoint,
        context: { handoffRef: ref },
      })
      : null;
    const sealedCompletionCheckpoint = completionCheckpoint
      ? await payloadCipher.seal({
        purpose: "provider-consent-completion-checkpoint.v1",
        plaintext: completionCheckpoint,
        context: { handoffRef: ref },
      })
      : null;
    const updated = await store.checkpoint({
      handoffRef: ref,
      leaseRef: lease,
      stage,
      sealedCredentialCheckpoint,
      sealedCompletionCheckpoint,
      now: clock().toISOString(),
    });
    if (updated?.checkpointed !== true) {
      throw repositoryError(
        "provider_consent_handoff_checkpoint_conflict",
        "Durable handoff checkpoint failed lease CAS.",
        { handoff_ref: ref, stage },
      );
    }
    return freezeRecord({
      handoffRef: ref,
      checkpointed: true,
      stage,
      payloadSealed: true,
      secretsIncluded: false,
    });
  }

  async function release({
    handoffRef,
    leaseRef,
    retryable,
    errorCode,
    retryAt = null,
  } = {}) {
    const ref = cleanRequired(handoffRef, "handoffRef");
    const lease = cleanRequired(leaseRef, "leaseRef");
    const released = await store.release({
      handoffRef: ref,
      leaseRef: lease,
      retryable: retryable === true,
      errorCode: cleanRequired(errorCode, "errorCode"),
      retryAt: cleanOptional(retryAt),
      now: clock().toISOString(),
    });
    if (released?.released !== true) {
      throw repositoryError(
        "provider_consent_handoff_release_conflict",
        "Durable handoff release failed lease CAS.",
        { handoff_ref: ref },
      );
    }
    return freezeRecord({
      handoffRef: ref,
      released: true,
      retryable: retryable === true,
      secretsIncluded: false,
    });
  }

  async function complete({ handoffRef, leaseRef } = {}) {
    const ref = cleanRequired(handoffRef, "handoffRef");
    const lease = cleanRequired(leaseRef, "leaseRef");
    const completed = await store.complete({
      handoffRef: ref,
      leaseRef: lease,
      now: clock().toISOString(),
    });
    if (completed?.completed !== true) {
      throw repositoryError(
        "provider_consent_handoff_completion_conflict",
        "Durable handoff completion failed one-time CAS.",
        { handoff_ref: ref },
      );
    }
    return freezeRecord({
      handoffRef: ref,
      completed: true,
      secretsIncluded: false,
    });
  }

  return Object.freeze({
    certification: certified,
    create,
    acquire,
    checkpoint,
    release,
    complete,
  });
}

export function createCertifiedProviderConnectionRevocationRepository({
  pool = null,
  resolvePool = null,
} = {}) {
  if (!pool && typeof resolvePool !== "function") {
    throw new TypeError(
      "Certified provider connection revocation requires a SQL pool or resolvePool.",
    );
  }

  async function activePool() {
    const executor = pool || await resolvePool();
    activeMethod(executor);
    return executor;
  }

  async function revokeProviderConnection({
    tenantRef,
    workspaceRef,
    brandRef = null,
    ownerScopeType,
    ownerScopeRef,
    connectionRef,
    expectedConnectionRevision,
    principalRef,
    userRef,
    reasonCode,
  } = {}) {
    const input = Object.freeze({
      tenantRef: cleanRequired(tenantRef, "tenantRef"),
      workspaceRef: cleanRequired(workspaceRef, "workspaceRef"),
      brandRef: cleanOptional(brandRef),
      ownerScopeType: cleanRequired(ownerScopeType, "ownerScopeType"),
      ownerScopeRef: cleanRequired(ownerScopeRef, "ownerScopeRef"),
      connectionRef: cleanRequired(connectionRef, "connectionRef"),
      expectedConnectionRevision: normalizeRevision(
        expectedConnectionRevision,
        "expectedConnectionRevision",
      ),
      principalRef: cleanRequired(principalRef, "principalRef"),
      userRef: cleanRequired(userRef, "userRef"),
      reasonCode: cleanRequired(reasonCode, "reasonCode"),
    });
    const root = await activePool();
    const connection = typeof root.getConnection === "function" ? await root.getConnection() : root;
    if (
      typeof connection.beginTransaction !== "function"
      || typeof connection.commit !== "function"
      || typeof connection.rollback !== "function"
    ) {
      throw new TypeError("Certified provider connection revocation requires a transaction.");
    }
    let committed = false;
    try {
      await connection.beginTransaction();
      const ownership = requireUniqueRow(await queryRows(connection, LOCK_OWNERSHIP_SQL, [
        input.tenantRef,
        input.workspaceRef,
        input.connectionRef,
      ]), {
        code: "provider_connection_revoke_ownership_ambiguous",
        entityName: "Provider connection ownership",
      });
      if (
        !ownership
        || ownership.tenant_id !== input.tenantRef
        || ownership.workspace_id !== input.workspaceRef
        || ownership.connection_id !== input.connectionRef
        || ownership.owner_scope_type !== input.ownerScopeType
        || ownership.owner_scope_ref !== input.ownerScopeRef
        || (ownership.brand_id || null) !== input.brandRef
      ) {
        throw repositoryError(
          "provider_connection_revoke_context_mismatch",
          "Provider connection ownership does not match the exact authorized context.",
        );
      }
      if (
        ownership.status !== "active"
        || Number(ownership.connection_revision) !== input.expectedConnectionRevision
      ) {
        throw repositoryError(
          "provider_connection_revoke_revision_conflict",
          "Provider connection ownership is not active at the expected revision.",
          {
            expected_connection_revision: input.expectedConnectionRevision,
            observed_connection_revision: Number(ownership.connection_revision || 0),
          },
        );
      }

      const base = requireUniqueRow(await queryRows(connection, LOCK_BASE_CONNECTION_SQL, [
        input.tenantRef,
        input.connectionRef,
      ]), {
        code: "provider_connection_revoke_base_ambiguous",
        entityName: "Base provider connection",
      });
      if (
        !base
        || base.connection_id !== input.connectionRef
        || base.tenant_id !== input.tenantRef
        || base.app_key !== ownership.provider_key
        || base.status !== "active"
      ) {
        throw repositoryError(
          "provider_connection_revoke_base_mismatch",
          "Base provider connection does not match active ownership.",
          { connection_ref: input.connectionRef },
        );
      }

      const ownershipUpdate = await mutate(connection, REVOKE_OWNERSHIP_SQL, [
        input.tenantRef,
        input.workspaceRef,
        input.connectionRef,
        input.ownerScopeType,
        input.ownerScopeRef,
        input.brandRef,
        input.expectedConnectionRevision,
      ]);
      const baseUpdate = await mutate(connection, REVOKE_BASE_CONNECTION_SQL, [
        input.tenantRef,
        input.connectionRef,
        ownership.provider_key,
      ]);
      if (affectedRows(ownershipUpdate) !== 1 || affectedRows(baseUpdate) !== 1) {
        throw repositoryError(
          "provider_connection_revoke_atomic_conflict",
          "Provider connection ownership and base status were not revoked exactly once.",
        );
      }

      const ownershipReadback = requireUniqueRow(await queryRows(
        connection,
        READBACK_OWNERSHIP_SQL,
        [input.tenantRef, input.workspaceRef, input.connectionRef],
      ), {
        code: "provider_connection_revoke_ownership_readback_ambiguous",
        entityName: "Provider connection ownership readback",
      });
      const baseReadback = requireUniqueRow(await queryRows(
        connection,
        READBACK_BASE_CONNECTION_SQL,
        [input.tenantRef, input.connectionRef],
      ), {
        code: "provider_connection_revoke_base_readback_ambiguous",
        entityName: "Base provider connection readback",
      });
      if (
        !ownershipReadback
        || ownershipReadback.status !== "revoked"
        || Number(ownershipReadback.connection_revision)
          !== input.expectedConnectionRevision + 1
        || !baseReadback
        || baseReadback.status !== "revoked"
        || baseReadback.app_key !== ownership.provider_key
      ) {
        throw repositoryError(
          "provider_connection_revoke_consistency_readback_failed",
          "Provider connection revoke failed same-cycle dual readback.",
          { connection_ref: input.connectionRef },
          500,
        );
      }

      await connection.commit();
      committed = true;
      return freezeRecord({
        connectionRef: input.connectionRef,
        tenantRef: input.tenantRef,
        workspaceRef: input.workspaceRef,
        brandRef: input.brandRef,
        ownerScopeType: input.ownerScopeType,
        ownerScopeRef: input.ownerScopeRef,
        providerKey: ownership.provider_key,
        status: "revoked",
        ownershipStatus: "revoked",
        baseConnectionStatus: "revoked",
        authorizationRevision: Number(ownershipReadback.authorization_revision || 0),
        connectionRevision: Number(ownershipReadback.connection_revision || 0),
        revokedByPrincipalRef: input.principalRef,
        revokedByUserRef: input.userRef,
        reasonCode: input.reasonCode,
        secretsIncluded: false,
      });
    } catch (error) {
      if (!committed) await connection.rollback();
      throw error;
    } finally {
      if (connection !== root && typeof connection.release === "function") connection.release();
    }
  }

  return Object.freeze({ revokeProviderConnection });
}

export const _testingProviderConsentActivationPilotRepositories = Object.freeze({
  LOCK_BASE_CONNECTION_SQL,
  LOCK_OWNERSHIP_SQL,
  READBACK_BASE_CONNECTION_SQL,
  READBACK_OWNERSHIP_SQL,
  REQUIRED_HANDOFF_CAPABILITIES,
  REVOKE_BASE_CONNECTION_SQL,
  REVOKE_OWNERSHIP_SQL,
  validateHandoffCertification,
});
