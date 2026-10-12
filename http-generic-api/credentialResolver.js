import { getPool } from "./db.js";
import {
  decryptCredentials as defaultDecryptCredentials,
  decryptToken as defaultDecryptToken
} from "./tokenEncryption.js";


export const CREDENTIAL_RESOLUTION_AUTHORITY = Object.freeze({
  credential_bindings: Object.freeze({ operations: Object.freeze(["SELECT"]), scope: "exact_tenant_role" }),
  user_app_connections: Object.freeze({ operations: Object.freeze(["SELECT"]), scope: "exact_tenant_user_connection" }),
  actions: Object.freeze({ operations: Object.freeze(["SELECT"]), scope: "exact_action" }),
  secret_references: Object.freeze({ operations: Object.freeze(["SELECT"]), scope: "exact_owner_tenant_secret_key" }),
  tenant_secrets: Object.freeze({ operations: Object.freeze(["SELECT"]), scope: "exact_tenant_secret_key" }),
  platform_secrets: Object.freeze({ operations: Object.freeze(["SELECT"]), scope: "platform_secret_key" }),
});

function str(value) {
  return String(value ?? "").trim();
}

function upperEnvKey(value) {
  return str(value).toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function roleCandidateFields(role = "", authType = "") {
  const normalizedRole = str(role).toLowerCase();
  const normalizedAuth = str(authType).toLowerCase();

  if (normalizedRole.includes("wordpress") || normalizedRole.includes("app_password")) {
    return ["application_password", "app_password", "password"];
  }
  if (normalizedRole.includes("mcp")) {
    return ["mcp_token", "mcp_bearer", "mcp_bearer_token", "bearer_token", "api_key", "token"];
  }
  if (normalizedRole.includes("oauth_refresh")) return ["refresh_token"];
  if (normalizedRole.includes("oauth_access")) return ["access_token"];
  if (normalizedRole.includes("webhook")) return ["webhook_secret", "secret"];
  if (normalizedRole.includes("api_key")) return ["api_key", "key", "token", "bearer_token"];

  if (normalizedAuth === "oauth2") return ["access_token", "refresh_token"];
  if (normalizedAuth === "mcp") return ["mcp_token", "mcp_bearer", "bearer_token", "api_key"];
  if (normalizedAuth === "bearer_token") return ["bearer_token", "token", "api_key"];
  if (normalizedAuth === "api_key") return ["api_key", "key"];
  if (normalizedAuth === "basic_auth") return ["password", "application_password"];

  return ["api_key", "token", "bearer_token", "access_token", "password"];
}

function pickCredentialField(credentials = {}, role = "", authType = "") {
  const candidates = roleCandidateFields(role, authType);
  for (const field of candidates) {
    if (str(credentials[field])) return { field, value: str(credentials[field]) };
  }
  return { field: candidates[0] || "secret", value: "" };
}

function safeResult(result = {}, includeSecret = false) {
  if (includeSecret) return result;
  const { secret: _secret, value: _value, ...safe } = result;
  return safe;
}

async function query(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function loadConnection(pool, connectionId, context = {}) {
  if (!connectionId) return null;
  const where = ["connection_id = ?"];
  const params = [connectionId];
  if (str(context.tenantId)) {
    where.push("tenant_id = ?");
    params.push(str(context.tenantId));
  }
  if (str(context.userId)) {
    where.push("user_id = ?");
    params.push(str(context.userId));
  }
  const rows = await query(
    pool,
    `SELECT * FROM \`user_app_connections\` WHERE ${where.join(" AND ")} LIMIT 2`,
    params
  );
  if (rows.length > 1) {
    const error = new Error("Credential connection identity is ambiguous.");
    error.code = "credential_connection_ambiguous";
    throw error;
  }
  return rows[0] || null;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function validateCredentialEnvironment(row, context, ref, source) {
  const requested = str(context.environmentKey).toLowerCase();
  const observed = str(parseMetadata(row?.metadata_json).environment).toLowerCase();
  if (requested && observed && requested !== observed) {
    return safeResult({
      status: "blocked_environment_mismatch",
      credential_ref: ref,
      source,
      error_code: "credential_environment_mismatch",
      requested_environment: requested,
      credential_environment: observed,
    }, Boolean(context.includeSecret));
  }
  return null;
}

function blockedScopeResult(ref, context, source, detail = {}) {
  return safeResult({
    status: "blocked_scope_mismatch",
    credential_ref: ref,
    source,
    error_code: "credential_reference_scope_mismatch",
    ...detail,
  }, Boolean(context.includeSecret));
}

function validateCandidateReferenceScope(candidate = {}, context = {}) {
  const ref = str(candidate.credential_ref);
  const ownerType = str(candidate.owner_type).toLowerCase();
  const tenantMatch = ref.match(/^tenant_secret:([^:]+):/);
  if (tenantMatch) {
    if (tenantMatch[1] !== str(context.tenantId) || (ownerType && ownerType !== "tenant")) {
      return blockedScopeResult(ref, context, "credential_bindings", {
        expected_tenant_id: str(context.tenantId),
        observed_tenant_id: tenantMatch[1],
        binding_owner_type: ownerType || null,
      });
    }
  }
  if (ref.startsWith("platform_secret:") && ownerType && ownerType !== "platform") {
    return blockedScopeResult(ref, context, "credential_bindings", {
      binding_owner_type: ownerType,
      expected_owner_type: "platform",
    });
  }
  const connectionMatch = ref.match(/^user_app_connection:([^:]+):/);
  if (connectionMatch) {
    if (str(candidate.connection_id) && str(candidate.connection_id) !== connectionMatch[1]) {
      return blockedScopeResult(ref, context, "credential_bindings", {
        binding_connection_id: str(candidate.connection_id),
        referenced_connection_id: connectionMatch[1],
      });
    }
    if (str(context.connectionId) && str(context.connectionId) !== connectionMatch[1]) {
      return blockedScopeResult(ref, context, "credential_bindings", {
        requested_connection_id: str(context.connectionId),
        referenced_connection_id: connectionMatch[1],
      });
    }
    if (ownerType && !["connection", "tenant"].includes(ownerType)) {
      return blockedScopeResult(ref, context, "credential_bindings", {
        binding_owner_type: ownerType,
        expected_owner_type: "connection_or_promoted_tenant",
      });
    }
  }
  if (ref.startsWith("ref:secret:") && ownerType === "connection") {
    return blockedScopeResult(ref, context, "credential_bindings", {
      binding_owner_type: ownerType,
      expected_owner_type: "tenant_user_or_platform",
    });
  }
  if (ownerType === "user" && (!str(context.userId) || str(candidate.owner_id) !== str(context.userId))) {
    return blockedScopeResult(ref, context, "credential_bindings", {
      binding_owner_type: ownerType,
      binding_owner_id: str(candidate.owner_id),
      requested_user_id: str(context.userId),
    });
  }
  if (ownerType === "tenant" && str(candidate.owner_id) && str(candidate.owner_id) !== str(context.tenantId)) {
    return blockedScopeResult(ref, context, "credential_bindings", {
      binding_owner_type: ownerType,
      binding_owner_id: str(candidate.owner_id),
      requested_tenant_id: str(context.tenantId),
    });
  }
  return null;
}

function externalReferenceResult(row, context, source) {
  const includeSecret = Boolean(context.includeSecret);
  return safeResult({
    status: "resolved_reference_only",
    credential_ref: row.secret_ref || "",
    owner_type: source === "platform_secrets" ? "platform" : "tenant",
    source,
    storage_backend: row.storage_backend || "",
    secret_present: Boolean(row.secret_ref || row.value_sha256 || row.value_ciphertext)
  }, includeSecret);
}

function encryptedSecretResult(row, context, source) {
  const includeSecret = Boolean(context.includeSecret);
  const secretKey = row.secret_key || context.secretKey || "";

  if (!row || row.status !== "active" || !str(row.value_ciphertext)) {
    return safeResult({
      status: "blocked_missing_secret",
      credential_ref: context.credentialRef || "",
      missing_secret_key: secretKey,
      owner_type: source === "platform_secrets" ? "platform" : "tenant",
      source,
      storage_backend: row?.storage_backend || "db_encrypted"
    }, includeSecret);
  }

  if (!includeSecret) {
    return {
      status: "resolved",
      credential_ref: context.credentialRef || "",
      owner_type: source === "platform_secrets" ? "platform" : "tenant",
      source,
      storage_backend: row.storage_backend || "db_encrypted",
      secret_present: true,
      value_sha256: row.value_sha256 || ""
    };
  }

  const decryptToken = context.decryptToken || defaultDecryptToken;
  const secret = decryptToken(row.value_ciphertext);
  if (!str(secret)) {
    return safeResult({
      status: "blocked_missing_secret",
      credential_ref: context.credentialRef || "",
      missing_secret_key: secretKey,
      owner_type: source === "platform_secrets" ? "platform" : "tenant",
      source,
      storage_backend: row.storage_backend || "db_encrypted"
    }, includeSecret);
  }

  return {
    status: "resolved",
    credential_ref: context.credentialRef || "",
    owner_type: source === "platform_secrets" ? "platform" : "tenant",
    source,
    storage_backend: row.storage_backend || "db_encrypted",
    secret,
    secret_present: true,
    value_sha256: row.value_sha256 || ""
  };
}

async function resolveUserAppConnectionRef(ref, context, deps) {
  const includeSecret = Boolean(context.includeSecret);
  const decryptCredentials = deps.decryptCredentials || defaultDecryptCredentials;
  const match = str(ref).match(/^user_app_connection:([^:]+):encrypted_credentials\.([A-Za-z0-9_]+)$/);
  if (!match) {
    return safeResult({
      status: "invalid_credential_ref",
      credential_ref: ref,
      source: "user_app_connections",
      error_code: "invalid_user_app_connection_ref"
    }, includeSecret);
  }

  const [, connectionId, requestedField] = match;
  const expectedOwnerType = str(context.expectedOwnerType).toLowerCase();
  if (expectedOwnerType === "connection" && !str(context.userId)) {
    return blockedScopeResult(ref, context, "user_app_connections", {
      error_code: "credential_user_context_required",
      connection_id: connectionId,
    });
  }
  if (expectedOwnerType === "connection" && str(context.expectedOwnerId) && str(context.expectedOwnerId) !== connectionId) {
    return blockedScopeResult(ref, context, "user_app_connections", {
      expected_owner_id: str(context.expectedOwnerId),
      referenced_connection_id: connectionId,
    });
  }
  const conn = await loadConnection(deps.pool, connectionId, context);
  if (!conn) {
    return safeResult({
      status: "blocked_missing_connection",
      credential_ref: ref,
      connection_id: connectionId,
      source: "user_app_connections"
    }, includeSecret);
  }

  if (conn.status !== "active") {
    return safeResult({
      status: "blocked_connection_not_active",
      credential_ref: ref,
      connection_id: connectionId,
      connection_status: conn.status,
      source: "user_app_connections"
    }, includeSecret);
  }

  if (!conn.encrypted_credentials) {
    return safeResult({
      status: "blocked_missing_secret",
      credential_ref: ref,
      connection_id: connectionId,
      missing_secret_key: requestedField,
      source: "user_app_connections"
    }, includeSecret);
  }

  if (!includeSecret) {
    return {
      status: "resolved",
      credential_ref: ref,
      connection_id: connectionId,
      owner_type: "connection",
      source: "user_app_connections",
      secret_present: true,
      account_label: conn.account_label || "",
      auth_type: conn.auth_type || "",
      app_key: conn.app_key || ""
    };
  }

  const credentials = decryptCredentials(conn.encrypted_credentials) || {};
  const value = str(credentials[requestedField]);
  if (!value) {
    return safeResult({
      status: "blocked_missing_secret",
      credential_ref: ref,
      connection_id: connectionId,
      missing_secret_key: requestedField,
      source: "user_app_connections"
    }, includeSecret);
  }

  return {
    status: "resolved",
    credential_ref: ref,
    connection_id: connectionId,
    owner_type: "connection",
    source: "user_app_connections",
    secret: value,
    secret_present: true,
    username: str(credentials.username || credentials.user || credentials.login || ""),
    account_label: conn.account_label || "",
    auth_type: conn.auth_type || "",
    app_key: conn.app_key || ""
  };
}

async function resolveLegacyEnvRef(ref, context, deps) {
  const includeSecret = Boolean(context.includeSecret);
  const env = deps.env || process.env;
  const secretKey = str(ref).slice("ref:secret:".length);
  const value = str(env[secretKey]);
  if (!secretKey) return safeResult({ status: "invalid_credential_ref", credential_ref: ref, source: "env" }, includeSecret);
  if (!value) {
    return safeResult({
      status: "blocked_missing_secret",
      credential_ref: ref,
      missing_secret_key: secretKey,
      source: "env_legacy_fallback"
    }, includeSecret);
  }
  return safeResult({
    status: "resolved",
    credential_ref: ref,
    source: "env_legacy_fallback",
    missing_secret_key: "",
    secret: value,
    secret_present: true
  }, includeSecret);
}

async function resolveSecretReferenceRef(ref, context, deps) {
  const secretKey = str(ref).slice("ref:secret:".length);
  if (!secretKey) {
    return safeResult({ status: "invalid_credential_ref", credential_ref: ref, source: "secret_references" }, Boolean(context.includeSecret));
  }

  const expectedOwnerType = str(context.expectedOwnerType).toLowerCase();
  const scopeTenantId = str(context.tenantId);
  if (expectedOwnerType !== "platform" && !scopeTenantId) {
    return blockedScopeResult(ref, context, "secret_references", {
      error_code: "credential_reference_scope_required",
    });
  }

  const rows = expectedOwnerType === "platform"
    ? await query(
        deps.pool,
        "SELECT * FROM `secret_references` WHERE owner_type = 'platform' AND secret_key = ? AND status = 'active' LIMIT 2",
        [secretKey]
      )
    : await query(
        deps.pool,
        "SELECT * FROM `secret_references` WHERE tenant_id = ? AND secret_key = ? AND status = 'active' LIMIT 2",
        [scopeTenantId, secretKey]
      );
  if (rows.length > 1) {
    return safeResult({
      status: "blocked_ambiguous_reference",
      credential_ref: ref,
      source: "secret_references",
      error_code: "credential_reference_ambiguous",
      tenant_id: expectedOwnerType === "platform" ? null : scopeTenantId,
      secret_key: secretKey,
    }, Boolean(context.includeSecret));
  }
  const row = rows[0];

  if (!row) {
    const legacyAllowed = expectedOwnerType === "platform"
      ? context.allowLegacyEnvFallback !== false
      : context.allowTenantLegacyEnvFallback === true;
    return legacyAllowed
      ? resolveLegacyEnvRef(ref, context, deps)
      : safeResult({
          status: "blocked_missing_secret",
          credential_ref: ref,
          missing_secret_key: secretKey,
          source: "secret_references",
        }, Boolean(context.includeSecret));
  }

  if (expectedOwnerType && str(row.owner_type).toLowerCase() !== expectedOwnerType) {
    return blockedScopeResult(ref, context, "secret_references", {
      expected_owner_type: expectedOwnerType,
      observed_owner_type: str(row.owner_type).toLowerCase(),
      tenant_id: expectedOwnerType === "platform" ? null : scopeTenantId,
    });
  }
  if (
    expectedOwnerType !== "platform"
    && str(context.expectedOwnerId)
    && str(row.owner_id)
    && str(row.owner_id) !== str(context.expectedOwnerId)
  ) {
    return blockedScopeResult(ref, context, "secret_references", {
      expected_owner_id: str(context.expectedOwnerId),
      observed_owner_id: str(row.owner_id),
      tenant_id: scopeTenantId,
    });
  }

  if (row.store_type === "db_encrypted") {
    if (row.owner_type === "platform") return resolvePlatformSecretRef(`platform_secret:${secretKey}`, context, deps);
    return resolveTenantSecretRef(
      `tenant_secret:${row.tenant_id}:${secretKey}`,
      { ...context, expectedOwnerType: "tenant", expectedOwnerId: row.tenant_id },
      deps,
    );
  }

  if (row.store_type === "vault" || row.store_type === "external") {
    return safeResult({
      status: "resolved_reference_only",
      credential_ref: ref,
      owner_type: row.owner_type,
      owner_id: row.owner_id || row.tenant_id,
      source: "secret_references",
      store_type: row.store_type,
      vault_path: row.vault_path || "",
      secret_present: Boolean(row.vault_path)
    }, Boolean(context.includeSecret));
  }

  // Env is now legacy compatibility, not the preferred source.
  return resolveLegacyEnvRef(ref, context, deps);
}

async function resolveTenantSecretRef(ref, context, deps) {
  const includeSecret = Boolean(context.includeSecret);
  const [, tenantId, secretKey] = str(ref).match(/^tenant_secret:([^:]+):(.+)$/) || [];
  if (!tenantId || !secretKey) {
    return safeResult({ status: "invalid_credential_ref", credential_ref: ref, source: "tenant_secrets" }, includeSecret);
  }
  if (str(context.tenantId) && tenantId !== str(context.tenantId)) {
    return blockedScopeResult(ref, context, "tenant_secrets", {
      expected_tenant_id: str(context.tenantId),
      observed_tenant_id: tenantId,
    });
  }
  if (str(context.expectedOwnerType) && str(context.expectedOwnerType).toLowerCase() !== "tenant") {
    return blockedScopeResult(ref, context, "tenant_secrets", {
      expected_owner_type: str(context.expectedOwnerType).toLowerCase(),
      observed_owner_type: "tenant",
    });
  }

  const rows = await query(
    deps.pool,
    "SELECT * FROM `tenant_secrets` WHERE tenant_id = ? AND secret_key = ? AND status = 'active' LIMIT 1",
    [tenantId, secretKey]
  );
  const row = rows[0];
  if (!row) {
    return safeResult({
      status: "blocked_missing_secret",
      credential_ref: ref,
      missing_secret_key: secretKey,
      owner_type: "tenant",
      source: "tenant_secrets"
    }, includeSecret);
  }
  const environmentFailure = validateCredentialEnvironment(row, context, ref, "tenant_secrets");
  if (environmentFailure) return environmentFailure;

  const storage = str(row.storage_backend);
  if (storage === "db_encrypted" || (storage === "manual" && str(row.value_ciphertext))) {
    return encryptedSecretResult(row, { ...context, credentialRef: ref, secretKey, decryptToken: deps.decryptToken }, "tenant_secrets");
  }
  if (storage === "env_ref" && str(row.secret_ref).startsWith("ref:secret:")) {
    return resolveLegacyEnvRef(row.secret_ref, context, deps);
  }
  if (["gcp_secret_manager", "external_vault", "mounted_file"].includes(storage)) {
    return externalReferenceResult(row, context, "tenant_secrets");
  }

  return safeResult({
    status: "blocked_missing_secret",
    credential_ref: ref,
    missing_secret_key: secretKey,
    owner_type: "tenant",
    source: "tenant_secrets",
    storage_backend: storage || "manual"
  }, includeSecret);
}

async function resolvePlatformSecretRef(ref, context, deps) {
  const includeSecret = Boolean(context.includeSecret);
  const [, secretKey] = str(ref).match(/^platform_secret:(.+)$/) || [];
  if (!secretKey) {
    return safeResult({ status: "invalid_credential_ref", credential_ref: ref, source: "platform_secrets" }, includeSecret);
  }
  if (str(context.expectedOwnerType) && str(context.expectedOwnerType).toLowerCase() !== "platform") {
    return blockedScopeResult(ref, context, "platform_secrets", {
      expected_owner_type: str(context.expectedOwnerType).toLowerCase(),
      observed_owner_type: "platform",
    });
  }

  const rows = await query(
    deps.pool,
    "SELECT * FROM `platform_secrets` WHERE secret_key = ? AND status = 'active' LIMIT 1",
    [secretKey]
  );
  const row = rows[0];
  if (!row) {
    return safeResult({
      status: "blocked_missing_secret",
      credential_ref: ref,
      missing_secret_key: secretKey,
      owner_type: "platform",
      source: "platform_secrets"
    }, includeSecret);
  }
  const environmentFailure = validateCredentialEnvironment(row, context, ref, "platform_secrets");
  if (environmentFailure) return environmentFailure;

  const storage = str(row.storage_backend);
  if (storage === "db_encrypted" || (storage === "manual" && str(row.value_ciphertext))) {
    return encryptedSecretResult(row, { ...context, credentialRef: ref, secretKey, decryptToken: deps.decryptToken }, "platform_secrets");
  }
  if (storage === "env_ref" && str(row.secret_ref).startsWith("ref:secret:")) {
    return resolveLegacyEnvRef(row.secret_ref, context, deps);
  }
  if (["gcp_secret_manager", "external_vault", "mounted_file"].includes(storage)) {
    return externalReferenceResult(row, context, "platform_secrets");
  }

  return safeResult({
    status: "blocked_missing_secret",
    credential_ref: ref,
    missing_secret_key: secretKey,
    owner_type: "platform",
    source: "platform_secrets",
    storage_backend: storage || "manual"
  }, includeSecret);
}

async function resolveCredentialRef(ref, context, deps) {
  const normalizedRef = str(ref);
  if (!normalizedRef) {
    return safeResult({ status: "blocked_missing_secret", credential_ref: "", source: "none" }, Boolean(context.includeSecret));
  }
  if (normalizedRef.startsWith("user_app_connection:")) return resolveUserAppConnectionRef(normalizedRef, context, deps);
  if (normalizedRef.startsWith("ref:secret:")) return resolveSecretReferenceRef(normalizedRef, context, deps);
  if (normalizedRef.startsWith("tenant_secret:")) return resolveTenantSecretRef(normalizedRef, context, deps);
  if (normalizedRef.startsWith("platform_secret:")) return resolvePlatformSecretRef(normalizedRef, context, deps);
  return safeResult({
    status: "unsupported_credential_ref",
    credential_ref: normalizedRef,
    source: "credential_bindings"
  }, Boolean(context.includeSecret));
}

export async function resolveCredentialReference(reference, options = {}, deps = {}) {
  const runtimeDeps = {
    pool: deps.pool || getPool(),
    decryptCredentials: deps.decryptCredentials || defaultDecryptCredentials,
    decryptToken: deps.decryptToken || defaultDecryptToken,
    env: deps.env || process.env
  };
  return resolveCredentialRef(reference, {
    includeSecret: options.includeSecret === true,
    tenantId: str(options.tenantId || options.tenant_id),
    userId: str(options.userId || options.user_id),
    expectedOwnerType: str(options.expectedOwnerType || options.expected_owner_type),
    expectedOwnerId: str(options.expectedOwnerId || options.expected_owner_id),
    environmentKey: str(options.environmentKey || options.environment_key),
    allowLegacyEnvFallback: options.allowLegacyEnvFallback !== false && options.allow_legacy_env_fallback !== false,
    allowTenantLegacyEnvFallback: options.allowTenantLegacyEnvFallback === true || options.allow_tenant_legacy_env_fallback === true,
  }, runtimeDeps);
}

function bindingSpecificityScore(binding = {}) {
  return [binding.connection_id, binding.user_id, binding.owner_id, binding.installation_id, binding.system_id, binding.action_key, binding.target_key].filter(Boolean).length;
}

function bindingMatches(binding = {}, context = {}) {
  const ownerType = str(binding.owner_type).toLowerCase();
  const ownerId = str(binding.owner_id);
  if (ownerType === "user" && (!str(context.userId) || ownerId !== str(context.userId))) return false;
  if (ownerType === "connection" && (!str(context.connectionId) || ownerId !== str(context.connectionId))) return false;
  if (ownerType === "tenant" && ownerId && ownerId !== str(context.tenantId)) return false;

  const tests = [
    [binding.user_id, context.userId],
    [binding.connection_id, context.connectionId],
    [binding.system_id, context.systemId],
    [binding.installation_id, context.installationId],
    [binding.action_key, context.actionKey],
    [binding.target_key, context.targetKey]
  ];
  return tests.every(([bindingValue, contextValue]) => !bindingValue || str(bindingValue) === str(contextValue));
}

async function loadCredentialBindings(context, deps) {
  const rows = await query(
    deps.pool,
    `SELECT * FROM \`credential_bindings\`
      WHERE tenant_id = ?
        AND credential_role = ?
        AND status = 'active'
      ORDER BY resolution_priority ASC, updated_at DESC
      LIMIT 100`,
    [context.tenantId, context.credentialRole]
  );

  return rows
    .filter(row => bindingMatches(row, context))
    .sort((a, b) => {
      const priorityDelta = Number(a.resolution_priority || 100) - Number(b.resolution_priority || 100);
      if (priorityDelta) return priorityDelta;
      return bindingSpecificityScore(b) - bindingSpecificityScore(a);
    });
}

async function fallbackUserConnection(context, deps) {
  if (!context.connectionId) return null;
  const conn = await loadConnection(deps.pool, context.connectionId, context);
  if (!conn || conn.status !== "active") return null;
  const fields = roleCandidateFields(context.credentialRole, conn.auth_type);
  return {
    credential_ref: `user_app_connection:${conn.connection_id}:encrypted_credentials.${fields[0]}`,
    owner_type: "connection",
    owner_id: conn.connection_id,
    source: "user_app_connections_fallback"
  };
}

async function fallbackActionSecret(context, deps) {
  if (!context.actionKey) return null;
  const rows = await query(
    deps.pool,
    "SELECT action_key, secret_store_ref, api_key_storage_mode, api_key_mode FROM `actions` WHERE action_key = ? LIMIT 1",
    [context.actionKey]
  );
  const action = rows[0];
  if (!action?.secret_store_ref) return null;
  return {
    credential_ref: action.secret_store_ref,
    owner_type: "platform",
    owner_id: "action_default",
    source: "actions.secret_store_ref",
    action_key: action.action_key
  };
}

function fallbackTargetSecret(context) {
  if (context.credentialRole !== "wordpress_app_password" || !context.targetKey) return null;
  // Prefer tenant_secret convention over env. The resolver will report missing
  // until a tenant secret row is provisioned.
  return {
    credential_ref: `tenant_secret:${context.tenantId}:${upperEnvKey(context.targetKey)}_APP_PASSWORD`,
    owner_type: "tenant",
    owner_id: context.tenantId,
    source: "target_tenant_secret_convention",
    target_key: context.targetKey
  };
}

export async function resolveEffectiveCredential(input = {}, deps = {}) {
  const context = {
    tenantId: str(input.tenantId || input.tenant_id),
    userId: str(input.userId || input.user_id),
    workspaceId: str(input.workspaceId || input.workspace_id),
    systemId: str(input.systemId || input.system_id),
    installationId: str(input.installationId || input.installation_id),
    connectionId: str(input.connectionId || input.connection_id),
    actionKey: str(input.actionKey || input.action_key),
    targetKey: str(input.targetKey || input.target_key),
    credentialRole: str(input.credentialRole || input.credential_role || input.role),
    includeSecret: Boolean(input.includeSecret || input.include_secret),
    environmentKey: str(input.environmentKey || input.environment_key),
    allowPlatformBinding: input.allowPlatformBinding !== false && input.allow_platform_binding !== false,
    allowPlatformFallback: input.allowPlatformFallback !== false && input.allow_platform_fallback !== false,
    allowLegacyEnvFallback: input.allowLegacyEnvFallback !== false && input.allow_legacy_env_fallback !== false,
    allowTenantLegacyEnvFallback: input.allowTenantLegacyEnvFallback === true || input.allow_tenant_legacy_env_fallback === true
  };

  if (!context.tenantId) return safeResult({ status: "missing_tenant_id", source: "credential_resolver" }, context.includeSecret);
  if (!context.credentialRole) return safeResult({ status: "missing_credential_role", source: "credential_resolver" }, context.includeSecret);

  const runtimeDeps = {
    pool: deps.pool || getPool(),
    decryptCredentials: deps.decryptCredentials || defaultDecryptCredentials,
    decryptToken: deps.decryptToken || defaultDecryptToken,
    env: deps.env || process.env
  };

  const bindings = await loadCredentialBindings(context, runtimeDeps);
  const candidates = [
    ...bindings.map(binding => ({ ...binding, source: "credential_bindings" })),
    await fallbackUserConnection(context, runtimeDeps),
    await fallbackActionSecret(context, runtimeDeps),
    fallbackTargetSecret(context)
  ].filter(Boolean);

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const platformCandidate = candidates[i]?.owner_type === "platform";
    if (platformCandidate && !context.allowPlatformBinding) {
      candidates.splice(i, 1);
      continue;
    }
    if (platformCandidate && !context.allowPlatformFallback && candidates[i]?.source !== "credential_bindings") {
      candidates.splice(i, 1);
    }
  }

  let firstMissing = null;
  for (const candidate of candidates) {
    const scopeFailure = validateCandidateReferenceScope(candidate, context);
    if (scopeFailure) return scopeFailure;

    const resolved = await resolveCredentialRef(candidate.credential_ref, {
      ...context,
      expectedOwnerType: candidate.owner_type || "",
      expectedOwnerId: candidate.owner_id || "",
    }, runtimeDeps);
    if (["blocked_scope_mismatch", "blocked_ambiguous_reference", "blocked_environment_mismatch"].includes(resolved.status)) {
      return resolved;
    }
    if (resolved.status === "resolved" || resolved.status === "resolved_reference_only") {
      return safeResult({
        ...resolved,
        credential_role: context.credentialRole,
        binding_owner_type: candidate.owner_type || "",
        binding_owner_id: candidate.owner_id || "",
        resolved_owner_type: resolved.owner_type || "",
        resolved_owner_id: resolved.owner_id || "",
        resolved_source: resolved.source || "",
        owner_type: candidate.owner_type || resolved.owner_type || "",
        owner_id: candidate.owner_id || resolved.owner_id || "",
        binding_id: candidate.binding_id || "",
        source: candidate.source || resolved.source,
        resolution_priority: candidate.resolution_priority ?? null
      }, context.includeSecret);
    }

    if ((resolved.status === "blocked_missing_secret" || resolved.status === "blocked_missing_connection") && !firstMissing) {
      firstMissing = {
        ...resolved,
        credential_role: context.credentialRole,
        binding_owner_type: candidate.owner_type || "",
        binding_owner_id: candidate.owner_id || "",
        resolved_owner_type: resolved.owner_type || "",
        resolved_owner_id: resolved.owner_id || "",
        resolved_source: resolved.source || "",
        owner_type: candidate.owner_type || resolved.owner_type || "",
        owner_id: candidate.owner_id || resolved.owner_id || "",
        binding_id: candidate.binding_id || "",
        source: candidate.source || resolved.source
      };
    }
  }

  if (firstMissing) return safeResult(firstMissing, context.includeSecret);

  return safeResult({
    status: "blocked_missing_secret",
    credential_role: context.credentialRole,
    missing_secret_key: context.credentialRole,
    source: "credential_resolver"
  }, context.includeSecret);
}

export async function getEffectiveCredentialStatus(input = {}, deps = {}) {
  return resolveEffectiveCredential({ ...input, includeSecret: false }, deps);
}

export const __test__ = {
  pickCredentialField,
  roleCandidateFields,
  resolveCredentialRef,
  validateCandidateReferenceScope,
  upperEnvKey
};
