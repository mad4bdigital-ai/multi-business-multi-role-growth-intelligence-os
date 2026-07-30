import {
  cleanOptional,
  cleanRequired,
  freezeRecord,
  parseJsonValue,
  requireUniqueRow,
} from "./sqlRepositorySupport.js";

const AUTHORIZATION_STATE_SQL = `
  SELECT
    state_ref,
    flow_type,
    provider_key,
    principal_ref,
    user_id,
    tenant_id,
    workspace_id,
    brand_id,
    owner_scope_type,
    owner_scope_ref,
    target_connection_id,
    expected_connection_revision,
    expected_provider_account_ref,
    expected_provider_account_binding_hash,
    requested_provider_scopes_json,
    redirect_target_ref,
    signature_version,
    state_revision,
    claim_revision,
    claim_token_hash IS NOT NULL AS claim_verifier_persisted,
    claimed_at,
    consumed_at,
    completion_revision,
    status,
    failure_code,
    issued_at,
    expires_at,
    updated_at
  FROM provider_authorization_states
  WHERE tenant_id = ?
    AND state_ref = ?
  ORDER BY state_ref ASC
  LIMIT 2
`;

const CLAIM_STATE_SQL = `
  UPDATE provider_authorization_states
  SET status = 'claimed',
      claimed_at = UTC_TIMESTAMP(),
      claim_revision = claim_revision + 1,
      claim_token_hash = ?,
      state_revision = state_revision + 1,
      updated_at = UTC_TIMESTAMP()
  WHERE tenant_id = ?
    AND state_ref = ?
    AND status = 'issued'
    AND state_revision = ?
    AND claim_token_hash IS NULL
    AND consumed_at IS NULL
    AND expires_at > UTC_TIMESTAMP()
`;

const LOCK_CLAIMED_STATE_SQL = `
  SELECT
    state_ref,
    flow_type,
    provider_key,
    tenant_id,
    workspace_id,
    brand_id,
    owner_scope_type,
    owner_scope_ref,
    target_connection_id,
    expected_connection_revision,
    expected_provider_account_ref,
    expected_provider_account_binding_hash,
    state_revision,
    claim_revision,
    status,
    expires_at
  FROM provider_authorization_states
  WHERE tenant_id = ?
    AND state_ref = ?
    AND status = 'claimed'
    AND state_revision = ?
    AND claim_revision = ?
    AND claim_token_hash = ?
    AND expires_at > UTC_TIMESTAMP()
  LIMIT 2
  FOR UPDATE
`;

const LOCK_CONNECTION_OWNERSHIP_SQL = `
  SELECT
    ownership_id,
    connection_id,
    tenant_id,
    workspace_id,
    brand_id,
    owner_scope_type,
    owner_scope_ref,
    provider_key,
    provider_account_ref,
    provider_account_binding_hash,
    provider_account_binding_version,
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

const UPDATE_CONNECTION_OWNERSHIP_SQL = `
  UPDATE connection_ownership_scopes
  SET provider_account_ref = ?,
      provider_account_binding_hash = ?,
      provider_account_binding_version = ?,
      authorization_revision = authorization_revision + 1,
      connection_revision = connection_revision + 1,
      status = 'active',
      updated_at = UTC_TIMESTAMP()
  WHERE tenant_id = ?
    AND workspace_id = ?
    AND connection_id = ?
    AND connection_revision = ?
`;

const CONSUME_STATE_SQL = `
  UPDATE provider_authorization_states
  SET status = 'consumed',
      consumed_at = UTC_TIMESTAMP(),
      completion_revision = completion_revision + 1,
      state_revision = state_revision + 1,
      claim_token_hash = NULL,
      updated_at = UTC_TIMESTAMP()
  WHERE tenant_id = ?
    AND state_ref = ?
    AND status = 'claimed'
    AND state_revision = ?
    AND claim_revision = ?
    AND claim_token_hash = ?
`;

function repositoryError(code, message, details = {}, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details };
  return error;
}

function cleanRevision(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer.`);
  }
  return parsed;
}

function cleanSha256(value, fieldName) {
  const normalized = cleanRequired(value, fieldName).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a 64-character hexadecimal SHA-256 value.`);
  }
  return normalized;
}

function mapAuthorizationState(row) {
  return freezeRecord({
    stateRef: row.state_ref,
    flowType: row.flow_type,
    providerKey: row.provider_key,
    principalRef: row.principal_ref,
    userRef: row.user_id || null,
    tenantRef: row.tenant_id,
    workspaceRef: row.workspace_id,
    brandRef: row.brand_id || null,
    ownerScopeType: row.owner_scope_type,
    ownerScopeRef: row.owner_scope_ref,
    targetConnectionRef: row.target_connection_id || null,
    expectedConnectionRevision: row.expected_connection_revision == null
      ? null
      : Number(row.expected_connection_revision),
    expectedProviderAccountRef: row.expected_provider_account_ref || null,
    expectedProviderAccountBindingHash: row.expected_provider_account_binding_hash || null,
    requestedProviderScopes: parseJsonValue(row.requested_provider_scopes_json, []),
    redirectTargetRef: row.redirect_target_ref,
    signatureVersion: row.signature_version,
    stateRevision: Number(row.state_revision || 0),
    claimRevision: Number(row.claim_revision || 0),
    claimedAt: row.claimed_at || null,
    consumedAt: row.consumed_at || null,
    completionRevision: Number(row.completion_revision || 0),
    status: row.status,
    failureCode: row.failure_code || null,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at || null,
    claimVerifierPersisted: Boolean(row.claim_verifier_persisted),
    secretsIncluded: false,
  });
}

function activeMethod(executor) {
  if (typeof executor?.execute === "function") return executor.execute.bind(executor);
  if (typeof executor?.query === "function") return executor.query.bind(executor);
  throw new TypeError("Provider authorization state SQL executor is invalid.");
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

function providerBindingMatches({ expectedRef, expectedHash, actualRef, actualHash }) {
  if (expectedRef) return expectedRef === actualRef;
  if (expectedHash) return expectedHash === actualHash;
  return false;
}

export function createProviderAuthorizationStateRepository({ pool = null, resolvePool = null } = {}) {
  if (!pool && typeof resolvePool !== "function") {
    throw new TypeError(
      "Provider authorization state repository requires a SQL pool or lazy resolvePool function.",
    );
  }

  async function activePool() {
    const executor = pool || await resolvePool();
    activeMethod(executor);
    return executor;
  }

  async function findAuthorizationState({ tenantRef, stateRef }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const state = cleanRequired(stateRef, "stateRef");
    const rows = await queryRows(await activePool(), AUTHORIZATION_STATE_SQL, [tenant, state]);
    const row = requireUniqueRow(rows, {
      code: "provider_authorization_state_ambiguous",
      entityName: "Provider authorization state",
      details: { tenant_ref: tenant, state_ref: state },
    });
    return row ? mapAuthorizationState(row) : null;
  }

  async function claimAuthorizationState({
    tenantRef,
    stateRef,
    expectedStateRevision,
    claimTokenHash,
  }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const state = cleanRequired(stateRef, "stateRef");
    const stateRevision = cleanRevision(expectedStateRevision, "expectedStateRevision");
    const verifier = cleanSha256(claimTokenHash, "claimTokenHash");
    const executor = await activePool();
    const result = await mutate(executor, CLAIM_STATE_SQL, [verifier, tenant, state, stateRevision]);
    if (affectedRows(result) !== 1) {
      throw repositoryError(
        "oauth_state_claim_conflict",
        "OAuth authorization state could not be claimed atomically.",
        { tenant_ref: tenant, state_ref: state, expected_state_revision: stateRevision },
      );
    }
    const claimed = await findAuthorizationState({ tenantRef: tenant, stateRef: state });
    if (
      !claimed
      || claimed.status !== "claimed"
      || !claimed.claimedAt
      || claimed.claimRevision <= 0
      || !claimed.claimVerifierPersisted
    ) {
      throw repositoryError(
        "oauth_state_claim_readback_failed",
        "Claimed OAuth authorization state failed same-cycle verifier readback.",
        { tenant_ref: tenant, state_ref: state },
        500,
      );
    }
    return claimed;
  }

  async function completeClaimedAuthorization({
    tenantRef,
    stateRef,
    expectedStateRevision,
    claimRevision,
    claimTokenHash,
    expectedConnectionRevision,
    providerAccountRef = null,
    providerAccountBindingHash = null,
    providerAccountBindingVersion = null,
    mutateConnection,
  }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const state = cleanRequired(stateRef, "stateRef");
    const stateRevision = cleanRevision(expectedStateRevision, "expectedStateRevision");
    const claim = cleanRevision(claimRevision, "claimRevision");
    const connectionRevision = cleanRevision(
      expectedConnectionRevision,
      "expectedConnectionRevision",
    );
    const verifier = cleanSha256(claimTokenHash, "claimTokenHash");
    const accountRef = cleanOptional(providerAccountRef);
    const accountHash = providerAccountBindingHash == null
      ? null
      : cleanSha256(providerAccountBindingHash, "providerAccountBindingHash");
    const accountBindingVersion = cleanOptional(providerAccountBindingVersion);
    if (!accountRef && !accountHash) {
      throw new TypeError(
        "providerAccountRef or providerAccountBindingHash is required for authorization completion.",
      );
    }
    if (typeof mutateConnection !== "function") {
      throw new TypeError("mutateConnection transaction callback is required.");
    }

    const root = await activePool();
    const connection = typeof root.getConnection === "function" ? await root.getConnection() : root;
    if (
      typeof connection.beginTransaction !== "function"
      || typeof connection.commit !== "function"
      || typeof connection.rollback !== "function"
    ) {
      throw new TypeError("Provider authorization completion requires a transactional SQL connection.");
    }

    let committed = false;
    try {
      await connection.beginTransaction();
      const stateRows = await queryRows(connection, LOCK_CLAIMED_STATE_SQL, [
        tenant,
        state,
        stateRevision,
        claim,
        verifier,
      ]);
      const lockedState = requireUniqueRow(stateRows, {
        code: "oauth_state_claim_ambiguous",
        entityName: "Claimed provider authorization state",
        details: { tenant_ref: tenant, state_ref: state },
      });
      if (!lockedState) {
        throw repositoryError(
          "oauth_state_claim_conflict",
          "Claimed OAuth authorization state or verifier no longer matches.",
          { tenant_ref: tenant, state_ref: state },
        );
      }
      if (lockedState.flow_type !== "reconnect" || !lockedState.target_connection_id) {
        throw repositoryError(
          "provider_authorization_completion_unsupported",
          "This persistence slice supports atomic completion for reconnect flows only.",
          { tenant_ref: tenant, state_ref: state, flow_type: lockedState.flow_type },
          501,
        );
      }
      if (Number(lockedState.expected_connection_revision) !== connectionRevision) {
        throw repositoryError(
          "oauth_state_context_mismatch",
          "Signed expected connection revision does not match the completion request.",
          { tenant_ref: tenant, state_ref: state },
        );
      }
      if (!providerBindingMatches({
        expectedRef: lockedState.expected_provider_account_ref,
        expectedHash: lockedState.expected_provider_account_binding_hash,
        actualRef: accountRef,
        actualHash: accountHash,
      })) {
        throw repositoryError(
          "provider_account_mismatch",
          "Returned provider account does not match the signed reconnect binding.",
          { tenant_ref: tenant, state_ref: state },
        );
      }

      const ownershipRows = await queryRows(connection, LOCK_CONNECTION_OWNERSHIP_SQL, [
        tenant,
        lockedState.workspace_id,
        lockedState.target_connection_id,
      ]);
      const ownership = requireUniqueRow(ownershipRows, {
        code: "connection_ownership_ambiguous",
        entityName: "Reconnect connection ownership",
        details: {
          tenant_ref: tenant,
          workspace_ref: lockedState.workspace_id,
          connection_ref: lockedState.target_connection_id,
        },
      });
      if (!ownership || Number(ownership.connection_revision) !== connectionRevision) {
        throw repositoryError(
          "connection_revision_conflict",
          "Connection revision moved before credential replacement.",
          {
            tenant_ref: tenant,
            connection_ref: lockedState.target_connection_id,
            expected_connection_revision: connectionRevision,
          },
        );
      }
      if (!providerBindingMatches({
        expectedRef: lockedState.expected_provider_account_ref,
        expectedHash: lockedState.expected_provider_account_binding_hash,
        actualRef: ownership.provider_account_ref,
        actualHash: ownership.provider_account_binding_hash,
      })) {
        throw repositoryError(
          "provider_account_binding_stale",
          "Persisted provider-account binding moved before reconnect completion.",
          { tenant_ref: tenant, connection_ref: lockedState.target_connection_id },
        );
      }

      const callbackResult = await mutateConnection(Object.freeze({
        connection,
        state: freezeRecord({
          stateRef: lockedState.state_ref,
          tenantRef: lockedState.tenant_id,
          workspaceRef: lockedState.workspace_id,
          connectionRef: lockedState.target_connection_id,
          providerKey: lockedState.provider_key,
          ownerScopeType: lockedState.owner_scope_type,
          ownerScopeRef: lockedState.owner_scope_ref,
        }),
        execute: (statement, params = []) => mutate(connection, statement, params),
      }));
      if (!callbackResult || callbackResult.credentialMutationApplied !== true) {
        throw repositoryError(
          "credential_mutation_not_applied",
          "Reconnect callback did not prove an in-transaction credential mutation.",
          { tenant_ref: tenant, state_ref: state },
          500,
        );
      }

      const ownershipUpdate = await mutate(connection, UPDATE_CONNECTION_OWNERSHIP_SQL, [
        accountRef,
        accountHash,
        accountBindingVersion,
        tenant,
        lockedState.workspace_id,
        lockedState.target_connection_id,
        connectionRevision,
      ]);
      if (affectedRows(ownershipUpdate) !== 1) {
        throw repositoryError(
          "connection_revision_conflict",
          "Connection ownership revision moved during atomic reconnect completion.",
          { tenant_ref: tenant, connection_ref: lockedState.target_connection_id },
        );
      }

      const stateUpdate = await mutate(connection, CONSUME_STATE_SQL, [
        tenant,
        state,
        stateRevision,
        claim,
        verifier,
      ]);
      if (affectedRows(stateUpdate) !== 1) {
        throw repositoryError(
          "oauth_state_completion_conflict",
          "OAuth authorization state moved during atomic reconnect completion.",
          { tenant_ref: tenant, state_ref: state },
        );
      }

      await connection.commit();
      committed = true;
      const consumed = await findAuthorizationState({ tenantRef: tenant, stateRef: state });
      if (!consumed || consumed.status !== "consumed") {
        throw repositoryError(
          "oauth_state_completion_readback_failed",
          "Consumed OAuth authorization state failed same-cycle readback.",
          { tenant_ref: tenant, state_ref: state },
          500,
        );
      }
      return consumed;
    } catch (error) {
      if (!committed) await connection.rollback();
      throw error;
    } finally {
      if (connection !== root && typeof connection.release === "function") connection.release();
    }
  }

  return Object.freeze({
    findAuthorizationState,
    claimAuthorizationState,
    completeClaimedAuthorization,
  });
}

export const _testingProviderAuthorizationStateRepository = Object.freeze({
  AUTHORIZATION_STATE_SQL,
  CLAIM_STATE_SQL,
  LOCK_CLAIMED_STATE_SQL,
  LOCK_CONNECTION_OWNERSHIP_SQL,
  UPDATE_CONNECTION_OWNERSHIP_SQL,
  CONSUME_STATE_SQL,
  affectedRows,
  mapAuthorizationState,
  providerBindingMatches,
});
