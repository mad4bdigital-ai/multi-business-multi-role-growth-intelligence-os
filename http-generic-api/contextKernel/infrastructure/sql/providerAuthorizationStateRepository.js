import {
  cleanOptional,
  cleanRequired,
  freezeRecord,
  parseJsonValue,
  requireUniqueRow,
} from "./sqlRepositorySupport.js";

const ISSUE_AUTHORIZATION_STATE_SQL = `
  INSERT INTO provider_authorization_states (
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
    nonce_hash,
    state_signature_hash,
    signature_version,
    state_revision,
    claim_revision,
    status,
    issued_at,
    expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'issued', ?, ?)
`;

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

const CLAIM_AUTHORIZATION_STATE_SQL = `
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
    AND nonce_hash = ?
    AND state_signature_hash = ?
    AND signature_version = ?
    AND provider_key = ?
    AND principal_ref = ?
    AND workspace_id = ?
    AND (brand_id <=> ?)
    AND owner_scope_type = ?
    AND owner_scope_ref = ?
    AND (target_connection_id <=> ?)
    AND (expected_connection_revision <=> ?)
    AND (expected_provider_account_ref <=> ?)
    AND (expected_provider_account_binding_hash <=> ?)
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

const FLOW_TYPES = new Set(["authorize", "reconnect"]);
const OWNER_SCOPE_TYPES = new Set(["personal_workspace", "company_workspace", "brand"]);

function repositoryError(code, message, details = {}, status = 409) {
  const error = new Error(message);
  error.name = "ProviderAuthorizationStateRepositoryError";
  error.code = code;
  error.status = status;
  error.details = { ...details };
  return error;
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

function cleanRevision(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer.`);
  }
  return parsed;
}

function cleanSha256(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = cleanRequired(value, fieldName).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a 64-character hexadecimal SHA-256 value.`);
  }
  return normalized;
}

function cleanTimestamp(value, fieldName) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${fieldName} must be a valid date.`);
  return date;
}

function cleanScopes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError("requestedProviderScopes must be an array.");
  return [...new Set(value.map((scope) => cleanRequired(scope, "requestedProviderScopes[]")))].sort();
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

function normalizeAuthorizationContext(input = {}, { requireTimestamps = false } = {}) {
  const flowType = cleanRequired(input.flowType, "flowType");
  if (!FLOW_TYPES.has(flowType)) throw new TypeError("flowType must be authorize or reconnect.");
  const ownerScopeType = cleanRequired(input.ownerScopeType, "ownerScopeType");
  if (!OWNER_SCOPE_TYPES.has(ownerScopeType)) {
    throw new TypeError("ownerScopeType must be personal_workspace, company_workspace, or brand.");
  }
  const targetConnectionRef = cleanOptional(input.targetConnectionRef);
  const expectedConnectionRevision = cleanRevision(
    input.expectedConnectionRevision,
    "expectedConnectionRevision",
    { nullable: true },
  );
  const expectedProviderAccountRef = cleanOptional(input.expectedProviderAccountRef);
  const expectedProviderAccountBindingHash = cleanSha256(
    input.expectedProviderAccountBindingHash,
    "expectedProviderAccountBindingHash",
    { nullable: true },
  );
  if (flowType === "authorize") {
    if (targetConnectionRef || expectedConnectionRevision != null || expectedProviderAccountRef || expectedProviderAccountBindingHash) {
      throw repositoryError(
        "oauth_state_context_invalid",
        "Authorize flow cannot carry reconnect target or provider-account bindings.",
        {},
        422,
      );
    }
  } else if (
    !targetConnectionRef
    || expectedConnectionRevision == null
    || (!expectedProviderAccountRef && !expectedProviderAccountBindingHash)
  ) {
    throw repositoryError(
      "oauth_state_context_invalid",
      "Reconnect flow requires target connection, expected revision, and provider-account binding.",
      {},
      422,
    );
  }
  let issuedAt = null;
  let expiresAt = null;
  if (requireTimestamps) {
    issuedAt = cleanTimestamp(input.issuedAt, "issuedAt");
    expiresAt = cleanTimestamp(input.expiresAt, "expiresAt");
    if (expiresAt.getTime() <= issuedAt.getTime()) {
      throw repositoryError("oauth_state_expiry_invalid", "expiresAt must be later than issuedAt.", {}, 422);
    }
  }
  return Object.freeze({
    stateRef: cleanRequired(input.stateRef, "stateRef"),
    flowType,
    providerKey: cleanRequired(input.providerKey, "providerKey"),
    principalRef: cleanRequired(input.principalRef, "principalRef"),
    userRef: cleanOptional(input.userRef),
    tenantRef: cleanRequired(input.tenantRef, "tenantRef"),
    workspaceRef: cleanRequired(input.workspaceRef, "workspaceRef"),
    brandRef: cleanOptional(input.brandRef),
    ownerScopeType,
    ownerScopeRef: cleanRequired(input.ownerScopeRef, "ownerScopeRef"),
    targetConnectionRef,
    expectedConnectionRevision,
    expectedProviderAccountRef,
    expectedProviderAccountBindingHash,
    requestedProviderScopes: cleanScopes(input.requestedProviderScopes),
    redirectTargetRef: cleanRequired(input.redirectTargetRef, "redirectTargetRef"),
    nonceHash: cleanSha256(input.nonceHash, "nonceHash"),
    stateSignatureHash: cleanSha256(input.stateSignatureHash, "stateSignatureHash"),
    signatureVersion: cleanRequired(input.signatureVersion, "signatureVersion"),
    issuedAt,
    expiresAt,
  });
}

function providerBindingMatches({ expectedRef, expectedHash, actualRef, actualHash }) {
  if (expectedRef) return expectedRef === actualRef;
  if (expectedHash) return expectedHash === actualHash;
  return false;
}

function sameOptionalValue(left, right) {
  return (left || null) === (right || null);
}

function validateLockedOwnershipContext(ownership, state) {
  if (!ownership) return false;
  return ownership.provider_key === state.provider_key
    && ownership.owner_scope_type === state.owner_scope_type
    && ownership.owner_scope_ref === state.owner_scope_ref
    && sameOptionalValue(ownership.brand_id, state.brand_id);
}

function assertCredentialMutationStatement(statement, params, { tenantRef, connectionRef }) {
  const sql = String(statement || "").replace(/\s+/g, " ").trim();
  const allowed = /^UPDATE\s+user_app_connections\s+SET\s+/i.test(sql)
    && /\bencrypted_credentials\s*=\s*\?/i.test(sql)
    && /\bWHERE\b/i.test(sql)
    && /\btenant_id\s*=\s*\?/i.test(sql)
    && /\bconnection_id\s*=\s*\?/i.test(sql)
    && Array.isArray(params)
    && params.includes(tenantRef)
    && params.includes(connectionRef);
  if (!allowed) {
    throw repositoryError(
      "credential_mutation_statement_forbidden",
      "Reconnect completion may mutate only the exact encrypted credential row.",
      { tenant_ref: tenantRef, connection_ref: connectionRef },
      400,
    );
  }
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

  async function issueAuthorizationState(input) {
    const normalized = normalizeAuthorizationContext(input, { requireTimestamps: true });
    try {
      const result = await mutate(await activePool(), ISSUE_AUTHORIZATION_STATE_SQL, [
        normalized.stateRef,
        normalized.flowType,
        normalized.providerKey,
        normalized.principalRef,
        normalized.userRef,
        normalized.tenantRef,
        normalized.workspaceRef,
        normalized.brandRef,
        normalized.ownerScopeType,
        normalized.ownerScopeRef,
        normalized.targetConnectionRef,
        normalized.expectedConnectionRevision,
        normalized.expectedProviderAccountRef,
        normalized.expectedProviderAccountBindingHash,
        JSON.stringify(normalized.requestedProviderScopes),
        normalized.redirectTargetRef,
        normalized.nonceHash,
        normalized.stateSignatureHash,
        normalized.signatureVersion,
        normalized.issuedAt,
        normalized.expiresAt,
      ]);
      if (affectedRows(result) !== 1) {
        throw repositoryError(
          "oauth_state_issue_conflict",
          "Provider authorization state was not inserted exactly once.",
          { tenant_ref: normalized.tenantRef, state_ref: normalized.stateRef },
        );
      }
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        throw repositoryError(
          "oauth_state_nonce_conflict",
          "Provider authorization state or nonce already exists.",
          { tenant_ref: normalized.tenantRef, state_ref: normalized.stateRef },
        );
      }
      throw error;
    }
    const issued = await findAuthorizationState({
      tenantRef: normalized.tenantRef,
      stateRef: normalized.stateRef,
    });
    if (!issued || issued.status !== "issued" || issued.stateRevision !== 1) {
      throw repositoryError(
        "oauth_state_issue_readback_failed",
        "Issued provider authorization state failed same-cycle readback.",
        { tenant_ref: normalized.tenantRef, state_ref: normalized.stateRef },
        500,
      );
    }
    return issued;
  }

  async function claimAuthorizationState(input = {}) {
    const normalized = normalizeAuthorizationContext(input);
    const expectedStateRevision = cleanRevision(input.expectedStateRevision, "expectedStateRevision");
    const claimTokenHash = cleanSha256(input.claimTokenHash, "claimTokenHash");
    const result = await mutate(await activePool(), CLAIM_AUTHORIZATION_STATE_SQL, [
      claimTokenHash,
      normalized.tenantRef,
      normalized.stateRef,
      expectedStateRevision,
      normalized.nonceHash,
      normalized.stateSignatureHash,
      normalized.signatureVersion,
      normalized.providerKey,
      normalized.principalRef,
      normalized.workspaceRef,
      normalized.brandRef,
      normalized.ownerScopeType,
      normalized.ownerScopeRef,
      normalized.targetConnectionRef,
      normalized.expectedConnectionRevision,
      normalized.expectedProviderAccountRef,
      normalized.expectedProviderAccountBindingHash,
    ]);
    if (affectedRows(result) !== 1) {
      throw repositoryError(
        "oauth_state_claim_conflict",
        "Provider authorization state could not be claimed atomically with the signed context.",
        {
          tenant_ref: normalized.tenantRef,
          state_ref: normalized.stateRef,
          expected_state_revision: expectedStateRevision,
        },
      );
    }
    const claimed = await findAuthorizationState({
      tenantRef: normalized.tenantRef,
      stateRef: normalized.stateRef,
    });
    if (
      !claimed
      || claimed.status !== "claimed"
      || claimed.stateRevision !== expectedStateRevision + 1
      || claimed.claimRevision <= 0
      || !claimed.claimedAt
      || !claimed.claimVerifierPersisted
    ) {
      throw repositoryError(
        "oauth_state_claim_readback_failed",
        "Claimed provider authorization state failed same-cycle verifier readback.",
        { tenant_ref: normalized.tenantRef, state_ref: normalized.stateRef },
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
    const connectionRevision = cleanRevision(expectedConnectionRevision, "expectedConnectionRevision");
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
      if (!validateLockedOwnershipContext(ownership, lockedState)) {
        throw repositoryError(
          "oauth_state_context_mismatch",
          "Reconnect state no longer matches the exact connection owner scope.",
          { tenant_ref: tenant, connection_ref: lockedState.target_connection_id },
        );
      }
      if (!new Set(["active", "expired", "revoked"]).has(ownership.status)) {
        throw repositoryError(
          "connection_ownership_inactive",
          "Connection ownership status does not permit reconnect.",
          {
            tenant_ref: tenant,
            connection_ref: lockedState.target_connection_id,
            ownership_status: ownership.status,
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

      let credentialMutationApplied = false;
      const executeCredentialMutation = async (statement, params = []) => {
        assertCredentialMutationStatement(statement, params, {
          tenantRef: tenant,
          connectionRef: lockedState.target_connection_id,
        });
        const result = await mutate(connection, statement, params);
        if (affectedRows(result) !== 1) {
          throw repositoryError(
            "credential_mutation_conflict",
            "Encrypted credential row was not updated exactly once.",
            { tenant_ref: tenant, connection_ref: lockedState.target_connection_id },
          );
        }
        credentialMutationApplied = true;
        return result;
      };

      await mutateConnection(Object.freeze({
        state: freezeRecord({
          stateRef: lockedState.state_ref,
          tenantRef: lockedState.tenant_id,
          workspaceRef: lockedState.workspace_id,
          connectionRef: lockedState.target_connection_id,
          providerKey: lockedState.provider_key,
          ownerScopeType: lockedState.owner_scope_type,
          ownerScopeRef: lockedState.owner_scope_ref,
        }),
        execute: executeCredentialMutation,
        executeCredentialMutation,
      }));
      if (!credentialMutationApplied) {
        throw repositoryError(
          "credential_mutation_not_applied",
          "Reconnect callback did not execute the guarded credential mutation.",
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
    issueAuthorizationState,
    findAuthorizationState,
    claimAuthorizationState,
    completeClaimedAuthorization,
  });
}

export const _testingProviderAuthorizationStateRepository = Object.freeze({
  ISSUE_AUTHORIZATION_STATE_SQL,
  AUTHORIZATION_STATE_SQL,
  CLAIM_AUTHORIZATION_STATE_SQL,
  LOCK_CLAIMED_STATE_SQL,
  LOCK_CONNECTION_OWNERSHIP_SQL,
  UPDATE_CONNECTION_OWNERSHIP_SQL,
  CONSUME_STATE_SQL,
  affectedRows,
  assertCredentialMutationStatement,
  cleanScopes,
  mapAuthorizationState,
  normalizeAuthorizationContext,
  providerBindingMatches,
  validateLockedOwnershipContext,
});
