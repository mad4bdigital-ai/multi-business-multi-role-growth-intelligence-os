import { createHash, randomBytes } from "node:crypto";
import { getPool } from "./db.js";
import { encryptToken } from "./tokenEncryption.js";
import {
  remoteMcpClientConfigKey,
  remoteMcpScopeAuthority,
  REMOTE_MCP_SCOPES,
  REMOTE_MCP_SUPPORTED_SCOPES,
  getRemoteMcpEnvironmentProfile,
  generateRemoteMcpClientId,
  isRemoteMcpClientIdForEnvironment,
  normalizeRemoteMcpEnvironment,
  normalizeRemoteMcpRedirectUri,
  normalizeRemoteMcpScopes,
  normalizeTokenEndpointAuthMethod,
  remoteMcpDynamicRedirectUriAllowed,
  sha256,
} from "./remoteMcpOAuthProfile.js";

export const REMOTE_MCP_CLIENT_PROVISIONING_VERSION = "mad4b.remote-mcp-client-provisioning.v1";

function text(value, maximum = 255) {
  return String(value ?? "").trim().slice(0, maximum);
}

function parseJson(value, fallback = null) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function parseJsonArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function secretKeyFromRef(reference) {
  const normalized = text(reference, 255);
  const match = normalized.match(/^platform_secret:([A-Z0-9_]+)$/u);
  return match?.[1] || "";
}

function secretRefForEnvironment(environment) {
  return `platform_secret:REMOTE_MCP_${environment.toUpperCase()}_OAUTH_CLIENT_SECRET`;
}

function generateRemoteMcpOAuthClientSecret() {
  return `m4b_rmcp_${randomBytes(32).toString("base64url")}`;
}

function assertSecretLength(secret) {
  if (String(secret || "").length < 32) {
    const error = new Error("Remote MCP client secrets must be at least 32 characters.");
    error.code = "remote_mcp_client_secret_too_short";
    error.status = 400;
    throw error;
  }
}

function normalizeRedirectUris(value, env) {
  const supplied = Array.isArray(value) ? value : [];
  const normalized = [...new Set(supplied.map((uri) => normalizeRemoteMcpRedirectUri(uri, env)).filter(Boolean))];
  if (!normalized.length || normalized.length !== supplied.length || normalized.some((uri) => !remoteMcpDynamicRedirectUriAllowed(uri, env))) {
    const error = new Error("At least one exact approved HTTPS redirect URI is required for a Remote MCP client.");
    error.code = "remote_mcp_client_redirect_uri_invalid";
    error.status = 400;
    throw error;
  }
  return normalized;
}

function normalizeProvisioningInput(args = {}) {
  const inputEnv = args.env || process.env;
  const environment = normalizeRemoteMcpEnvironment(args.environment || inputEnv.REMOTE_MCP_ENVIRONMENT);
  if (environment === "unknown") {
    const error = new Error("Remote MCP provisioning requires environment=staging or environment=production.");
    error.code = "remote_mcp_environment_required";
    error.status = 400;
    throw error;
  }

  const env = { ...inputEnv, REMOTE_MCP_ENVIRONMENT: environment };
  const profile = getRemoteMcpEnvironmentProfile(env);
  if (!profile.resource || !profile.authorization_server) {
    const error = new Error("Remote MCP resource and authorization server must resolve before client provisioning.");
    error.code = "remote_mcp_environment_profile_invalid";
    error.status = 400;
    throw error;
  }

  const tokenEndpointAuthMethod = normalizeTokenEndpointAuthMethod(args.token_endpoint_auth_method || "client_secret_basic");
  if (tokenEndpointAuthMethod !== "client_secret_basic" && tokenEndpointAuthMethod !== "client_secret_post") {
    const error = new Error("Governed Remote MCP provisioning requires a confidential client authentication method.");
    error.code = "remote_mcp_confidential_client_required";
    error.status = 400;
    throw error;
  }

  const requestedClientId = text(args.client_id, 128);
  if (requestedClientId && !isRemoteMcpClientIdForEnvironment(requestedClientId, env)) {
    const error = new Error("The requested Remote MCP client ID does not belong to the selected environment.");
    error.code = "remote_mcp_client_environment_mismatch";
    error.status = 400;
    throw error;
  }

  const scopesExplicit = args.scopes !== undefined || args.scope !== undefined;
  const requestedScopes = scopesExplicit ? (args.scopes ?? args.scope) : REMOTE_MCP_SCOPES;
  const scopeResult = normalizeRemoteMcpScopes(requestedScopes, REMOTE_MCP_SUPPORTED_SCOPES, REMOTE_MCP_SCOPES);
  if (!scopeResult.ok || scopeResult.scopes.some((scope) => !REMOTE_MCP_SUPPORTED_SCOPES.includes(scope))) {
    const error = new Error("Remote MCP provisioning accepts only the active read-only scope catalog.");
    error.code = "remote_mcp_client_scope_invalid";
    error.status = 400;
    throw error;
  }

  return {
    env,
    profile,
    environment,
    clientId: requestedClientId,
    clientName: text(args.client_name || `MAD4B Remote MCP ${environment}`, 255),
    tokenEndpointAuthMethod,
    redirectUris: args.redirect_uris ? normalizeRedirectUris(args.redirect_uris, env) : [],
    allowedScopes: scopeResult.scopes,
    scopesExplicit,
    requestedSecret: String(args.client_secret || "").trim(),
    rotate: args.rotate === true,
    note: text(args.note || `remote_mcp_oauth_client_${environment}`, 255),
  };
}

async function readProvisionedState(connection, profile) {
  const [configRows] = await connection.query(
    `SELECT config_json, status, updated_at
       FROM platform_runtime_config
      WHERE config_key = ?
      LIMIT 1`,
    [profile.client_config_key],
  );
  const config = parseJson(Array.isArray(configRows) ? configRows[0]?.config_json : null, null);
  let client = null;
  if (config?.client_id) {
    const [clientRows] = await connection.query(
      `SELECT client_id, client_name, client_profile_key, token_endpoint_auth_method,
              client_secret_hash, redirect_uris_json, allowed_scopes_json, status, expires_at
         FROM remote_mcp_oauth_clients
        WHERE client_id = ?
        LIMIT 1`,
      [config.client_id],
    );
    client = Array.isArray(clientRows) ? clientRows[0] || null : null;
  }

  const secretKey = secretKeyFromRef(config?.client_secret_ref || profile.client_secret_ref);
  let secret = null;
  if (secretKey) {
    const [secretRows] = await connection.query(
      `SELECT secret_key, storage_backend, value_sha256, value_ciphertext, status, updated_at
         FROM platform_secrets
        WHERE secret_key = ?
        LIMIT 1`,
      [secretKey],
    );
    secret = Array.isArray(secretRows) ? secretRows[0] || null : null;
  }

  return {
    config,
    updatedAt: Array.isArray(configRows) ? configRows[0]?.updated_at || null : null,
    client,
    secret,
    secretKey,
  };
}

async function upsertPlatformSecret(connection, { secretKey, value, environment, note }) {
  if (!secretKey) throw new Error("remote_mcp_client_secret_ref_invalid");
  assertSecretLength(value);
  const valueSha256 = createHash("sha256").update(value, "utf8").digest("hex");
  const metadata = JSON.stringify({
    provisioning_status: "stored",
    environment,
    required_for: remoteMcpClientConfigKey(environment),
    source: REMOTE_MCP_CLIENT_PROVISIONING_VERSION,
  });
  await connection.query(
    `INSERT INTO platform_secrets
       (secret_key, secret_type, storage_backend, secret_ref, value_sha256, value_ciphertext, metadata_json, status, created_by)
     VALUES (?, 'oauth_client_secret', 'db_encrypted', NULL, ?, ?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       secret_type = VALUES(secret_type),
       storage_backend = 'db_encrypted',
       secret_ref = NULL,
       value_sha256 = VALUES(value_sha256),
       value_ciphertext = VALUES(value_ciphertext),
       metadata_json = VALUES(metadata_json),
       status = 'active',
       updated_at = CURRENT_TIMESTAMP`,
    [secretKey, valueSha256, encryptToken(value), metadata, note],
  );
  return { secret_key: secretKey, value_sha256: valueSha256 };
}

export async function readRemoteMcpOAuthClientProvisioningStatus({ env = process.env, pool = getPool() } = {}) {
  try {
    const normalized = normalizeProvisioningInput({ env, environment: env.REMOTE_MCP_ENVIRONMENT });
    const connection = pool?.getConnection ? await pool.getConnection() : pool;
    try {
      const state = await readProvisionedState(connection, normalized.profile);
      return {
        ok: true,
        provisioning_version: REMOTE_MCP_CLIENT_PROVISIONING_VERSION,
        environment: normalized.environment,
        resource: normalized.profile.resource,
        authorization_server: normalized.profile.authorization_server,
        scope_authority: remoteMcpScopeAuthority(),
        config_key: normalized.profile.client_config_key,
        client_id: state.config?.client_id || null,
        client_id_prefix: normalized.profile.client_id_prefix,
        client_name: state.client?.client_name || state.config?.client_name || null,
        client_profile_key: state.client?.client_profile_key || null,
        token_endpoint_auth_method: state.client?.token_endpoint_auth_method || null,
        client_status: state.client?.status || "missing",
        registered_redirect_uri_count: parseJsonArray(state.client?.redirect_uris_json).length,
        allowed_scope_count: parseJsonArray(state.client?.allowed_scopes_json).length,
        client_secret_ref: state.config?.client_secret_ref || normalized.profile.client_secret_ref,
        secret_storage_backend: state.secret?.storage_backend || null,
        secret_present: Boolean(state.secret?.status === "active" && state.secret?.value_ciphertext),
        secret_value_sha256_present: Boolean(state.secret?.value_sha256),
        updated_at: state.updatedAt || null,
        secrets_included: false,
      };
    } finally {
      if (connection && connection !== pool && typeof connection.release === "function") connection.release();
    }
  } catch (error) {
    return {
      ok: false,
      error: error.code || "remote_mcp_client_provisioning_status_failed",
      message: error.message,
      secrets_included: false,
    };
  }
}

export async function provisionRemoteMcpOAuthClient(args = {}) {
  const input = normalizeProvisioningInput(args);
  if (!input.redirectUris.length) {
    const error = new Error("redirect_uris are required when creating or rotating a governed Remote MCP client.");
    error.code = "remote_mcp_client_redirect_uris_required";
    error.status = 400;
    throw error;
  }

  const pool = args.pool || getPool();
  if (!pool?.getConnection) throw new Error("remote_mcp_client_provisioning_connection_required");
  const connection = await pool.getConnection();
  let oneTimeSecret = "";
  let secretEvidence = null;
  let created = false;
  let stored = null;
  let clientId = input.clientId;
  let effectiveRedirectUris = [];
  let effectiveAllowedScopes = [];
  const now = new Date().toISOString();

  try {
    await connection.beginTransaction();
    const state = await readProvisionedState(connection, input.profile);
    stored = state.config;

    if (stored?.client_id) {
      if (clientId && clientId !== stored.client_id) {
        const error = new Error("Changing a governed Remote MCP client ID requires an explicit separate identity migration.");
        error.code = "remote_mcp_client_id_change_requires_migration";
        error.status = 409;
        throw error;
      }
      clientId = stored.client_id;
    } else {
      clientId = clientId || generateRemoteMcpClientId(input.env);
    }
    if (!isRemoteMcpClientIdForEnvironment(clientId, input.env)) {
      const error = new Error("The Remote MCP client ID is not valid for the selected environment.");
      error.code = "remote_mcp_client_environment_mismatch";
      error.status = 400;
      throw error;
    }

    const redirectUris = input.redirectUris.length
      ? input.redirectUris
      : parseJsonArray(state.client?.redirect_uris_json);
    const allowedScopes = input.scopesExplicit || !state.client
      ? input.allowedScopes
      : parseJsonArray(state.client?.allowed_scopes_json);
    effectiveRedirectUris = redirectUris;
    effectiveAllowedScopes = allowedScopes;
    const clientName = input.clientName || stored?.client_name || state.client?.client_name || `MAD4B Remote MCP ${input.environment}`;
    const secretRef = input.profile.client_secret_ref;
    const secretKey = secretKeyFromRef(secretRef);
    const needsSecret = input.rotate
      || Boolean(input.requestedSecret)
      || !state.client
      || !state.client.client_secret_hash
      || !state.secret?.value_ciphertext
      || state.secret.status !== "active";

    if (input.requestedSecret) assertSecretLength(input.requestedSecret);
    if (needsSecret) {
      oneTimeSecret = input.requestedSecret || generateRemoteMcpOAuthClientSecret();
      secretEvidence = await upsertPlatformSecret(connection, {
        secretKey,
        value: oneTimeSecret,
        environment: input.environment,
        note: input.note,
      });
      created = true;
    } else {
      secretEvidence = {
        secret_key: secretKey,
        value_sha256: state.secret?.value_sha256 || null,
      };
    }

    const clientSecretHash = needsSecret
      ? sha256(oneTimeSecret)
      : state.client.client_secret_hash;
    if (!clientSecretHash) throw new Error("remote_mcp_client_secret_hash_missing");

    if (state.client) {
      await connection.query(
        `UPDATE remote_mcp_oauth_clients
            SET client_name = ?,
                client_profile_key = ?,
                token_endpoint_auth_method = ?,
                client_secret_hash = ?,
                redirect_uris_json = ?,
                allowed_scopes_json = ?,
                status = 'active',
                updated_at = CURRENT_TIMESTAMP
          WHERE client_id = ?`,
        [clientName, "generic_remote_mcp_client", input.tokenEndpointAuthMethod, clientSecretHash, JSON.stringify(redirectUris), JSON.stringify(allowedScopes), clientId],
      );
    } else {
      await connection.query(
        `INSERT INTO remote_mcp_oauth_clients
          (client_id, client_name, client_profile_key, token_endpoint_auth_method,
           client_secret_hash, redirect_uris_json, allowed_scopes_json,
           registration_access_token_hash, status)
         VALUES (?, ?, 'generic_remote_mcp_client', ?, ?, ?, ?, NULL, 'active')`,
        [clientId, clientName, input.tokenEndpointAuthMethod, clientSecretHash, JSON.stringify(redirectUris), JSON.stringify(allowedScopes)],
      );
    }

    const config = {
      provisioning_version: REMOTE_MCP_CLIENT_PROVISIONING_VERSION,
      environment: input.environment,
      client_id: clientId,
      client_name: clientName,
      client_secret_ref: secretRef,
      resource: input.profile.resource,
      authorization_server: input.profile.authorization_server,
      scope_authority: remoteMcpScopeAuthority(),
      allowed_scopes: allowedScopes,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: input.tokenEndpointAuthMethod,
      created_at: stored?.created_at || now,
      rotated_at: created && stored?.client_id ? now : stored?.rotated_at || null,
    };
    await connection.query(
      [
        "INSERT INTO platform_runtime_",
        "config (config_key, config_json, status, note)",
        " VALUES (?, ?, 'active', ?)",
        " ON DUPLICATE KEY UPDATE config_json = VALUES(config_json),",
        " status = 'active', note = VALUES(note), updated_at = CURRENT_TIMESTAMP",
      ].join(""),
      [input.profile.client_config_key, JSON.stringify(config), input.note],
    );
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }

  return {
    ok: true,
    provisioning_version: REMOTE_MCP_CLIENT_PROVISIONING_VERSION,
    environment: input.environment,
    client_id: clientId,
    client_secret: oneTimeSecret || null,
    client_secret_created: created,
    client_secret_ref: input.profile.client_secret_ref,
    secret_value_sha256: secretEvidence?.value_sha256 || null,
    resource: input.profile.resource,
    authorization_server: input.profile.authorization_server,
    scope_authority: remoteMcpScopeAuthority(),
    allowed_scopes: effectiveAllowedScopes,
    redirect_uris: effectiveRedirectUris,
    token_endpoint_auth_method: input.tokenEndpointAuthMethod,
    one_time_secret_notice: created ? "The client_secret is returned once only. Store it in the approved client configuration; it is never returned by readback." : "No new secret was generated. The existing secret remains in platform_secrets and is not returned.",
    secrets_included: Boolean(oneTimeSecret),
  };
}

export { generateRemoteMcpOAuthClientSecret };

export default {
  provisionRemoteMcpOAuthClient,
  readRemoteMcpOAuthClientProvisioningStatus,
};
