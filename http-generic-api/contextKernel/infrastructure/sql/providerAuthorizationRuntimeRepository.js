import { createProviderAuthorizationStateRepository } from "./providerAuthorizationStateRepository.js";
import {
  cleanOptional,
  cleanRequired,
  freezeRecord,
  requireUniqueRow,
} from "./sqlRepositorySupport.js";

const LOCK_CLAIMED_AUTHORIZE_STATE_SQL = `
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
    requested_provider_scopes_json,
    redirect_target_ref,
    state_revision,
    claim_revision,
    status,
    expires_at
  FROM provider_authorization_states
  WHERE tenant_id = ?
    AND state_ref = ?
    AND flow_type = 'authorize'
    AND status = 'claimed'
    AND state_revision = ?
    AND claim_revision = ?
    AND claim_token_hash = ?
    AND target_connection_id IS NULL
    AND expected_connection_revision IS NULL
    AND expires_at > UTC_TIMESTAMP()
  LIMIT 2
  FOR UPDATE
`;

const INSERT_USER_CONNECTION_SQL = `
  INSERT INTO user_app_connections (
    connection_id,
    user_id,
    tenant_id,
    app_key,
    display_label,
    auth_type,
    encrypted_credentials,
    token_expires_at,
    scopes_granted,
    account_label,
    account_metadata,
    is_primary,
    status,
    connected_at
  ) VALUES (?, ?, ?, ?, ?, 'oauth2', ?, ?, ?, ?, ?, 0, 'active', UTC_TIMESTAMP())
`;

const INSERT_WORKSPACE_LINK_SQL = `
  INSERT INTO workspace_app_links (
    link_id,
    workspace_id,
    tenant_id,
    connection_id,
    app_key,
    linked_by,
    status,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP())
`;

const INSERT_CONNECTION_OWNERSHIP_SQL = `
  INSERT INTO connection_ownership_scopes (
    ownership_id,
    connection_id,
    tenant_id,
    workspace_id,
    brand_id,
    owner_scope_type,
    owner_scope_ref,
    owner_user_id,
    connected_by_user_id,
    provider_key,
    provider_account_ref,
    provider_account_binding_hash,
    provider_account_binding_version,
    authorization_revision,
    connection_revision,
    status,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
`;

const CONSUME_AUTHORIZE_STATE_SQL = `
  UPDATE provider_authorization_states
  SET status = 'consumed',
      consumed_at = UTC_TIMESTAMP(),
      completion_revision = completion_revision + 1,
      state_revision = state_revision + 1,
      claim_token_hash = NULL,
      updated_at = UTC_TIMESTAMP()
  WHERE tenant_id = ?
    AND state_ref = ?
    AND flow_type = 'authorize'
    AND status = 'claimed'
    AND state_revision = ?
    AND claim_revision = ?
    AND claim_token_hash = ?
`;

const AUTHORIZE_READBACK_SQL = `
  SELECT
    v.connection_id,
    v.tenant_id,
    v.workspace_id,
    v.provider_key,
    v.owner_scope_type,
    v.owner_scope_ref,
    v.brand_id,
    v.provider_account_ref,
    v.provider_account_binding_hash,
    v.provider_account_binding_version,
    v.authorization_revision,
    v.connection_revision,
    v.ownership_status,
    v.ownership_resolution_status
  FROM v_context_kernel_connection_ownership_compatibility v
  WHERE v.tenant_id = ?
    AND v.workspace_id = ?
    AND v.connection_id = ?
  LIMIT 2
`;

function repositoryError(code, message, details = {}, status = 409) {
  const error = new Error(message);
  error.name = "ProviderAuthorizationRuntimeRepositoryError";
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function activeMethod(executor) {
  if (typeof executor?.execute === "function") return executor.execute.bind(executor);
  if (typeof executor?.query === "function") return executor.query.bind(executor);
  throw new TypeError("Provider authorization runtime SQL executor is invalid.");
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

function normalizeRevision(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer.`);
  }
  return parsed;
}

function normalizeSha256(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = cleanRequired(value, fieldName).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a SHA-256 value.`);
  }
  return normalized;
}

function normalizeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new TypeError("JSON field is invalid.");
    }
  }
  return value;
}

function normalizeScopes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError("grantedScopes must be an array.");
  return [...new Set(value.map((scope) => cleanRequired(scope, "grantedScopes[]")))].sort();
}

function cleanTimestamp(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${fieldName} must be a valid date.`);
  return date;
}

function mapAuthorizeReadback(row, stateRef) {
  return freezeRecord({
    stateRef,
    status: "consumed",
    flowType: "authorize",
    connectionRef: row.connection_id,
    tenantRef: row.tenant_id,
    workspaceRef: row.workspace_id,
    brandRef: row.brand_id || null,
    ownerScopeType: row.owner_scope_type,
    ownerScopeRef: row.owner_scope_ref,
    providerKey: row.provider_key,
    providerAccountRef: row.provider_account_ref || null,
    providerAccountBindingHash: row.provider_account_binding_hash || null,
    providerAccountBindingVersion: row.provider_account_binding_version || null,
    authorizationRevision: Number(row.authorization_revision || 0),
    connectionRevision: Number(row.connection_revision || 0),
    secretsIncluded: false,
  });
}

export function createProviderAuthorizationRuntimeRepository({
  pool = null,
  resolvePool = null,
} = {}) {
  if (!pool && typeof resolvePool !== "function") {
    throw new TypeError(
      "Provider authorization runtime repository requires a SQL pool or lazy resolvePool function.",
    );
  }
  const baseRepository = createProviderAuthorizationStateRepository({ pool, resolvePool });

  async function activePool() {
    const executor = pool || await resolvePool();
    activeMethod(executor);
    return executor;
  }

  async function completeAuthorize(input = {}) {
    const tenantRef = cleanRequired(input.tenantRef, "tenantRef");
    const stateRef = cleanRequired(input.stateRef, "stateRef");
    const expectedStateRevision = normalizeRevision(
      input.expectedStateRevision,
      "expectedStateRevision",
    );
    const claimRevision = normalizeRevision(input.claimRevision, "claimRevision");
    const claimTokenHash = normalizeSha256(input.claimTokenHash, "claimTokenHash");
    const connectionRef = cleanRequired(input.connectionRef, "connectionRef");
    const linkRef = cleanRequired(input.linkRef, "linkRef");
    const ownershipRef = cleanRequired(input.ownershipRef, "ownershipRef");
    const encryptedCredentials = cleanRequired(
      input.encryptedCredentials,
      "encryptedCredentials",
    );
    const providerAccountRef = cleanOptional(input.providerAccountRef);
    const providerAccountBindingHash = normalizeSha256(
      input.providerAccountBindingHash,
      "providerAccountBindingHash",
      { nullable: true },
    );
    if (!providerAccountRef && !providerAccountBindingHash) {
      throw new TypeError(
        "providerAccountRef or providerAccountBindingHash is required for authorization completion.",
      );
    }
    const providerAccountBindingVersion = cleanOptional(input.providerAccountBindingVersion);
    const displayLabel = cleanOptional(input.displayLabel);
    const accountLabel = cleanOptional(input.accountLabel);
    const accountMetadata = normalizeJson(input.accountMetadata, {});
    const grantedScopes = normalizeScopes(input.grantedScopes);
    const tokenExpiresAt = cleanTimestamp(input.tokenExpiresAt, "tokenExpiresAt", {
      nullable: true,
    });

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
      const lockedState = requireUniqueRow(await queryRows(
        connection,
        LOCK_CLAIMED_AUTHORIZE_STATE_SQL,
        [tenantRef, stateRef, expectedStateRevision, claimRevision, claimTokenHash],
      ), {
        code: "oauth_state_claim_ambiguous",
        entityName: "Claimed provider authorization state",
        details: { tenant_ref: tenantRef, state_ref: stateRef },
      });
      if (!lockedState) {
        throw repositoryError(
          "oauth_state_claim_conflict",
          "Claimed authorize state or verifier no longer matches.",
          { tenant_ref: tenantRef, state_ref: stateRef },
        );
      }
      if (!lockedState.user_id) {
        throw repositoryError(
          "provider_authorization_user_missing",
          "Authorize completion requires the authenticated user identity.",
          { tenant_ref: tenantRef, state_ref: stateRef },
        );
      }
      const personalOwnerUserRef = lockedState.owner_scope_type === "personal_workspace"
        ? lockedState.user_id
        : null;

      const userConnection = await mutate(connection, INSERT_USER_CONNECTION_SQL, [
        connectionRef,
        lockedState.user_id,
        lockedState.tenant_id,
        lockedState.provider_key,
        displayLabel,
        encryptedCredentials,
        tokenExpiresAt,
        grantedScopes.join(" "),
        accountLabel,
        JSON.stringify(accountMetadata),
      ]);
      if (affectedRows(userConnection) !== 1) {
        throw repositoryError(
          "provider_authorization_connection_insert_conflict",
          "Provider connection was not inserted exactly once.",
          { tenant_ref: tenantRef, state_ref: stateRef },
        );
      }

      const workspaceLink = await mutate(connection, INSERT_WORKSPACE_LINK_SQL, [
        linkRef,
        lockedState.workspace_id,
        lockedState.tenant_id,
        connectionRef,
        lockedState.provider_key,
        lockedState.user_id,
      ]);
      if (affectedRows(workspaceLink) !== 1) {
        throw repositoryError(
          "provider_authorization_workspace_link_conflict",
          "Provider workspace link was not inserted exactly once.",
          { tenant_ref: tenantRef, state_ref: stateRef },
        );
      }

      const ownership = await mutate(connection, INSERT_CONNECTION_OWNERSHIP_SQL, [
        ownershipRef,
        connectionRef,
        lockedState.tenant_id,
        lockedState.workspace_id,
        lockedState.brand_id,
        lockedState.owner_scope_type,
        lockedState.owner_scope_ref,
        personalOwnerUserRef,
        lockedState.user_id,
        lockedState.provider_key,
        providerAccountRef,
        providerAccountBindingHash,
        providerAccountBindingVersion,
      ]);
      if (affectedRows(ownership) !== 1) {
        throw repositoryError(
          "provider_authorization_ownership_insert_conflict",
          "Provider connection ownership was not inserted exactly once.",
          { tenant_ref: tenantRef, state_ref: stateRef },
        );
      }

      const consumed = await mutate(connection, CONSUME_AUTHORIZE_STATE_SQL, [
        tenantRef,
        stateRef,
        expectedStateRevision,
        claimRevision,
        claimTokenHash,
      ]);
      if (affectedRows(consumed) !== 1) {
        throw repositoryError(
          "oauth_state_completion_conflict",
          "Authorize state moved during atomic completion.",
          { tenant_ref: tenantRef, state_ref: stateRef },
        );
      }

      const readback = requireUniqueRow(await queryRows(connection, AUTHORIZE_READBACK_SQL, [
        lockedState.tenant_id,
        lockedState.workspace_id,
        connectionRef,
      ]), {
        code: "provider_authorization_readback_ambiguous",
        entityName: "Provider authorization connection readback",
      });
      if (
        !readback
        || readback.ownership_resolution_status !== "classified"
        || readback.ownership_status !== "active"
        || readback.owner_scope_type !== lockedState.owner_scope_type
        || readback.owner_scope_ref !== lockedState.owner_scope_ref
        || (readback.brand_id || null) !== (lockedState.brand_id || null)
        || readback.provider_key !== lockedState.provider_key
        || Number(readback.connection_revision) !== 1
      ) {
        throw repositoryError(
          "provider_authorization_readback_failed",
          "Authorize completion failed exact connection ownership readback.",
          { tenant_ref: tenantRef, state_ref: stateRef, connection_ref: connectionRef },
          500,
        );
      }
      await connection.commit();
      committed = true;
      return mapAuthorizeReadback(readback, stateRef);
    } catch (error) {
      if (!committed) await connection.rollback();
      throw error;
    } finally {
      if (connection !== root && typeof connection.release === "function") connection.release();
    }
  }

  async function completeClaimedAuthorization(input = {}) {
    const tenantRef = cleanRequired(input.tenantRef, "tenantRef");
    const stateRef = cleanRequired(input.stateRef, "stateRef");
    const state = await baseRepository.findAuthorizationState({ tenantRef, stateRef });
    if (!state) {
      throw repositoryError(
        "oauth_state_not_found",
        "Provider authorization state was not found.",
        { tenant_ref: tenantRef, state_ref: stateRef },
        404,
      );
    }
    if (state.flowType === "authorize") return completeAuthorize(input);
    return baseRepository.completeClaimedAuthorization(input);
  }

  return Object.freeze({
    issueAuthorizationState: baseRepository.issueAuthorizationState,
    findAuthorizationState: baseRepository.findAuthorizationState,
    claimAuthorizationState: baseRepository.claimAuthorizationState,
    completeClaimedAuthorization,
  });
}

export const _testingProviderAuthorizationRuntimeRepository = Object.freeze({
  AUTHORIZE_READBACK_SQL,
  CONSUME_AUTHORIZE_STATE_SQL,
  INSERT_CONNECTION_OWNERSHIP_SQL,
  INSERT_USER_CONNECTION_SQL,
  INSERT_WORKSPACE_LINK_SQL,
  LOCK_CLAIMED_AUTHORIZE_STATE_SQL,
  affectedRows,
  mapAuthorizeReadback,
});
