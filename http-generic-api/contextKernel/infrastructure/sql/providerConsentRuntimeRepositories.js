import {
  clampLimit,
  cleanOptional,
  cleanRequired,
  createSqlExecutor,
  freezeRecord,
  requireUniqueRow,
} from "./sqlRepositorySupport.js";

const EXPECTED_MIGRATION = Object.freeze({
  resourceUri: "db-migration://growth_intelligence_platform/20260730_context_kernel_connection_ownership_persistence.sql",
  checksumSha256: "8689a9440be9224e1b19ee1d88c983feb10f4056cc7a83d59790e9230ed28faf",
});

const READINESS_SCHEMA_SQL = `
  SELECT
    EXISTS(
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'connection_ownership_scopes'
        AND table_type = 'BASE TABLE'
    ) AS ownership_table_ready,
    EXISTS(
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'provider_authorization_states'
        AND table_type = 'BASE TABLE'
    ) AS authorization_state_table_ready,
    EXISTS(
      SELECT 1 FROM information_schema.views
      WHERE table_schema = DATABASE()
        AND table_name = 'v_context_kernel_connection_ownership_compatibility'
    ) AS compatibility_view_ready,
    (
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'workspace_registry'
        AND column_name IN ('workspace_ownership_type', 'owner_user_id', 'ownership_revision')
    ) AS workspace_ownership_column_count
`;

const LIST_CONNECTIONS_SQL = `
  SELECT
    v.connection_id,
    v.tenant_id,
    v.workspace_id,
    v.provider_key,
    v.owner_scope_type,
    v.owner_scope_ref,
    v.brand_id,
    v.authorization_revision,
    v.connection_revision,
    v.ownership_status,
    o.updated_at
  FROM v_context_kernel_connection_ownership_compatibility v
  INNER JOIN connection_ownership_scopes o
    ON BINARY o.connection_id <=> BINARY v.connection_id
  WHERE v.tenant_id = ?
    AND v.workspace_id = ?
    AND v.owner_scope_type = ?
    AND v.owner_scope_ref = ?
    AND (v.brand_id <=> ?)
    AND v.ownership_resolution_status = 'classified'
    AND (
      ? IS NULL
      OR v.provider_key > ?
      OR (v.provider_key = ? AND v.connection_id > ?)
    )
  ORDER BY v.provider_key ASC, v.connection_id ASC
  LIMIT ?
`;

const LOCK_CONNECTION_SQL = `
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

const REVOKE_CONNECTION_SQL = `
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

const REVOKE_READBACK_SQL = `
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

const ALLOWED_BRAND_PERMISSIONS = new Set([
  "provider_connection.read",
  "provider_connection.manage",
]);

function repositoryError(code, message, details = {}, status = 409) {
  const error = new Error(message);
  error.name = "ProviderConsentRuntimeRepositoryError";
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function toBoolean(value) {
  return value === true || value === 1 || String(value || "").toLowerCase() === "true";
}

function normalizeSha256(value, fieldName) {
  const normalized = cleanRequired(value, fieldName).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a SHA-256 value.`);
  }
  return normalized;
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
  throw new TypeError("Provider connection access SQL executor is invalid.");
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

function encodeCursor(record) {
  return Buffer.from(JSON.stringify({
    providerKey: record.providerKey,
    connectionRef: record.connectionRef,
  }), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (value == null || value === "") return null;
  const raw = cleanRequired(value, "cursor");
  if (raw.length > 512) throw new TypeError("cursor is too long.");
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new TypeError("cursor is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("cursor is invalid.");
  }
  return Object.freeze({
    providerKey: cleanRequired(parsed.providerKey, "cursor.providerKey"),
    connectionRef: cleanRequired(parsed.connectionRef, "cursor.connectionRef"),
  });
}

function mapConnection(row) {
  return freezeRecord({
    connectionRef: row.connection_id,
    tenantRef: row.tenant_id,
    workspaceRef: row.workspace_id,
    brandRef: row.brand_id || null,
    ownerScopeType: row.owner_scope_type,
    ownerScopeRef: row.owner_scope_ref,
    providerKey: row.provider_key,
    status: row.ownership_status || row.status,
    authorizationRevision: Number(row.authorization_revision || 0),
    connectionRevision: Number(row.connection_revision || 0),
    updatedAt: row.updated_at || null,
    secretsIncluded: false,
  });
}

function exactContextMatches(row, input) {
  return row.tenant_id === input.tenantRef
    && row.workspace_id === input.workspaceRef
    && row.connection_id === input.connectionRef
    && row.owner_scope_type === input.ownerScopeType
    && row.owner_scope_ref === input.ownerScopeRef
    && (row.brand_id || null) === (input.brandRef || null);
}

export function createProviderConsentReadinessRepository({
  pool = null,
  resolvePool = null,
  enablementResolver = null,
  migrationIdentity = EXPECTED_MIGRATION,
} = {}) {
  const sql = createSqlExecutor({ pool, resolvePool, adapterName: "Provider consent readiness" });
  const expected = Object.freeze({
    resourceUri: cleanRequired(migrationIdentity?.resourceUri, "migrationIdentity.resourceUri"),
    checksumSha256: normalizeSha256(
      migrationIdentity?.checksumSha256,
      "migrationIdentity.checksumSha256",
    ),
  });
  if (enablementResolver != null && typeof enablementResolver !== "function") {
    throw new TypeError("enablementResolver must be a function when provided.");
  }

  async function findProviderConsentReadiness({ operation } = {}) {
    const operationKey = cleanRequired(operation, "operation");
    const row = requireUniqueRow(await sql.execute(READINESS_SCHEMA_SQL), {
      code: "provider_consent_readiness_schema_ambiguous",
      entityName: "Provider consent readiness schema",
    });
    const schemaReady = Boolean(row)
      && toBoolean(row.ownership_table_ready)
      && toBoolean(row.authorization_state_table_ready)
      && toBoolean(row.compatibility_view_ready)
      && Number(row.workspace_ownership_column_count) === 3;

    let enablement = null;
    if (enablementResolver) {
      enablement = await enablementResolver(Object.freeze({
        operation: operationKey,
        migrationResourceUri: expected.resourceUri,
        migrationChecksumSha256: expected.checksumSha256,
      }));
    }
    const checksumMatches = enablement?.migrationChecksumSha256 === expected.checksumSha256;
    const migrationReadbackVerified = schemaReady
      && enablement?.migrationReadbackVerified === true
      && checksumMatches;
    const applicationUseCasesEnabled = migrationReadbackVerified
      && enablement?.applicationUseCasesEnabled === true;

    return freezeRecord({
      status: applicationUseCasesEnabled ? "ready" : "blocked",
      versionRef: cleanOptional(enablement?.versionRef),
      migrationResourceUri: expected.resourceUri,
      migrationChecksumSha256: expected.checksumSha256,
      migrationReadbackVerified,
      applicationUseCasesEnabled,
      schemaReady,
      reasonCode: applicationUseCasesEnabled
        ? null
        : cleanOptional(enablement?.reasonCode) || (schemaReady
          ? "provider_consent_enablement_not_authorized"
          : "provider_consent_schema_not_ready"),
      operation: operationKey,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ findProviderConsentReadiness });
}

export function createBrandManagementAuthorityRepository({ authorityResolver } = {}) {
  const resolve = typeof authorityResolver === "function"
    ? authorityResolver
    : authorityResolver?.resolveBrandManagementAuthority;
  if (typeof resolve !== "function") {
    throw new TypeError(
      "Brand management authority repository requires a canonical authority resolver.",
    );
  }

  async function findBrandManagementAuthority({
    tenantRef,
    workspaceRef,
    brandRef,
    principalRef,
  }) {
    const request = Object.freeze({
      tenantRef: cleanRequired(tenantRef, "tenantRef"),
      workspaceRef: cleanRequired(workspaceRef, "workspaceRef"),
      brandRef: cleanRequired(brandRef, "brandRef"),
      principalRef: cleanRequired(principalRef, "principalRef"),
      requiredCapability: "provider_connection.manage",
    });
    const resolved = await resolve(request);
    if (!resolved) return null;
    if (
      resolved.tenantRef !== request.tenantRef
      || resolved.workspaceRef !== request.workspaceRef
      || resolved.brandRef !== request.brandRef
      || resolved.principalRef !== request.principalRef
    ) {
      throw repositoryError(
        "brand_management_authority_context_mismatch",
        "Canonical brand authority escaped the exact provider-consent context.",
        {
          tenant_ref: request.tenantRef,
          workspace_ref: request.workspaceRef,
          brand_ref: request.brandRef,
          principal_ref: request.principalRef,
        },
      );
    }
    const permissions = Array.isArray(resolved.permissions)
      ? [...new Set(resolved.permissions
        .map((permission) => cleanRequired(permission, "authority.permissions[]"))
        .filter((permission) => ALLOWED_BRAND_PERMISSIONS.has(permission)))]
        .sort()
      : [];
    return freezeRecord({
      tenantRef: request.tenantRef,
      workspaceRef: request.workspaceRef,
      brandRef: request.brandRef,
      principalRef: request.principalRef,
      status: resolved.status === "active" ? "active" : "inactive",
      permissions,
      versionRef: cleanOptional(resolved.versionRef),
      authorityEpoch: cleanOptional(resolved.authorityEpoch),
      secretsIncluded: false,
    });
  }

  return Object.freeze({ findBrandManagementAuthority });
}

export function createProviderConnectionAccessRepository({
  pool = null,
  resolvePool = null,
} = {}) {
  if (!pool && typeof resolvePool !== "function") {
    throw new TypeError(
      "Provider connection access repository requires a SQL pool or lazy resolvePool function.",
    );
  }

  async function activePool() {
    const executor = pool || await resolvePool();
    activeMethod(executor);
    return executor;
  }

  async function listProviderConnections({
    tenantRef,
    workspaceRef,
    brandRef = null,
    ownerScopeType,
    ownerScopeRef,
    limit = 50,
    cursor = null,
  }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const workspace = cleanRequired(workspaceRef, "workspaceRef");
    const brand = cleanOptional(brandRef);
    const scopeType = cleanRequired(ownerScopeType, "ownerScopeType");
    const scopeRef = cleanRequired(ownerScopeRef, "ownerScopeRef");
    const pageLimit = clampLimit(limit, { defaultValue: 50, maximum: 100 });
    const decoded = decodeCursor(cursor);
    const cursorProvider = decoded?.providerKey || null;
    const cursorConnection = decoded?.connectionRef || null;
    const rows = await queryRows(await activePool(), LIST_CONNECTIONS_SQL, [
      tenant,
      workspace,
      scopeType,
      scopeRef,
      brand,
      cursorProvider,
      cursorProvider,
      cursorProvider,
      cursorConnection,
      pageLimit + 1,
    ]);
    const mapped = rows.map(mapConnection);
    const hasMore = mapped.length > pageLimit;
    const connections = mapped.slice(0, pageLimit);
    return freezeRecord({
      connections,
      nextCursor: hasMore ? encodeCursor(connections.at(-1)) : null,
      secretsIncluded: false,
    });
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
  }) {
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
      throw new TypeError("Provider connection revocation requires a transactional SQL connection.");
    }
    let committed = false;
    try {
      await connection.beginTransaction();
      const locked = requireUniqueRow(await queryRows(connection, LOCK_CONNECTION_SQL, [
        input.tenantRef,
        input.workspaceRef,
        input.connectionRef,
      ]), {
        code: "provider_connection_revoke_ambiguous",
        entityName: "Provider connection revocation target",
        details: {
          tenant_ref: input.tenantRef,
          workspace_ref: input.workspaceRef,
          connection_ref: input.connectionRef,
        },
      });
      if (!locked || !exactContextMatches(locked, input)) {
        throw repositoryError(
          "provider_connection_revoke_context_mismatch",
          "Provider connection does not match the exact authorized owner scope.",
          {
            tenant_ref: input.tenantRef,
            workspace_ref: input.workspaceRef,
            connection_ref: input.connectionRef,
          },
        );
      }
      if (locked.status !== "active") {
        throw repositoryError(
          "provider_connection_revoke_not_active",
          "Only an active provider connection can be revoked.",
          { connection_status: locked.status || null },
        );
      }
      if (Number(locked.connection_revision) !== input.expectedConnectionRevision) {
        throw repositoryError(
          "provider_connection_revoke_revision_conflict",
          "Provider connection revision moved before revocation.",
          {
            expected_connection_revision: input.expectedConnectionRevision,
            observed_connection_revision: Number(locked.connection_revision || 0),
          },
        );
      }
      const update = await mutate(connection, REVOKE_CONNECTION_SQL, [
        input.tenantRef,
        input.workspaceRef,
        input.connectionRef,
        input.ownerScopeType,
        input.ownerScopeRef,
        input.brandRef,
        input.expectedConnectionRevision,
      ]);
      if (affectedRows(update) !== 1) {
        throw repositoryError(
          "provider_connection_revoke_conflict",
          "Provider connection was not revoked exactly once.",
          { connection_ref: input.connectionRef },
        );
      }
      const readback = requireUniqueRow(await queryRows(connection, REVOKE_READBACK_SQL, [
        input.tenantRef,
        input.workspaceRef,
        input.connectionRef,
      ]), {
        code: "provider_connection_revoke_readback_ambiguous",
        entityName: "Provider connection revocation readback",
      });
      if (
        !readback
        || !exactContextMatches(readback, input)
        || readback.status !== "revoked"
        || Number(readback.connection_revision) !== input.expectedConnectionRevision + 1
      ) {
        throw repositoryError(
          "provider_connection_revoke_readback_failed",
          "Provider connection revocation failed same-cycle revision readback.",
          { connection_ref: input.connectionRef },
          500,
        );
      }
      await connection.commit();
      committed = true;
      return freezeRecord({
        ...mapConnection({ ...readback, ownership_status: readback.status }),
        revokedByPrincipalRef: input.principalRef,
        revokedByUserRef: input.userRef,
        reasonCode: input.reasonCode,
      });
    } catch (error) {
      if (!committed) await connection.rollback();
      throw error;
    } finally {
      if (connection !== root && typeof connection.release === "function") connection.release();
    }
  }

  return Object.freeze({ listProviderConnections, revokeProviderConnection });
}

export const _testingProviderConsentRuntimeRepositories = Object.freeze({
  EXPECTED_MIGRATION,
  LIST_CONNECTIONS_SQL,
  LOCK_CONNECTION_SQL,
  READINESS_SCHEMA_SQL,
  REVOKE_CONNECTION_SQL,
  REVOKE_READBACK_SQL,
  decodeCursor,
  encodeCursor,
  exactContextMatches,
  mapConnection,
});
