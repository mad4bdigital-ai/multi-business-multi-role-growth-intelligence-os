import { Router } from "express";
import { createHash } from "node:crypto";
import { getEffectiveCredentialStatus } from "../credentialResolver.js";
import { getPool } from "../db.js";
import { encryptToken } from "../tokenEncryption.js";

function str(value) {
  return String(value ?? "").trim();
}

function parseLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function metadataJson(input = {}) {
  return JSON.stringify({
    provisioning_status: "stored",
    stored_at: new Date().toISOString(),
    provider_family: str(input.provider_family),
    connector_family: str(input.connector_family),
    credential_type: str(input.credential_type || input.secret_type),
    source: "credential_routes.upsert"
  });
}

function upperEnvKey(value) {
  return str(value).toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function roleCandidateField(role = "", authType = "") {
  const normalizedRole = str(role).toLowerCase();
  const normalizedAuth = str(authType).toLowerCase();
  if (normalizedRole.includes("wordpress") || normalizedRole.includes("app_password")) return "application_password";
  if (normalizedRole.includes("mcp")) return "mcp_token";
  if (normalizedRole.includes("oauth_refresh")) return "refresh_token";
  if (normalizedRole.includes("oauth_access")) return "access_token";
  if (normalizedRole.includes("webhook")) return "webhook_secret";
  if (normalizedRole.includes("api_key")) return "api_key";
  if (normalizedAuth === "oauth2") return "access_token";
  if (normalizedAuth === "mcp") return "mcp_token";
  if (normalizedAuth === "bearer_token") return "bearer_token";
  if (normalizedAuth === "basic_auth") return "password";
  return "api_key";
}

function sanitizeCredentialCandidate(candidate = {}) {
  return {
    source: candidate.source || "unknown",
    owner_type: candidate.owner_type || null,
    owner_id: candidate.owner_id || null,
    binding_id: candidate.binding_id || null,
    connection_id: candidate.connection_id || null,
    system_id: candidate.system_id || null,
    installation_id: candidate.installation_id || null,
    action_key: candidate.action_key || null,
    target_key: candidate.target_key || null,
    credential_role: candidate.credential_role || null,
    credential_ref: candidate.credential_ref || null,
    provider_family: candidate.provider_family || null,
    connector_family: candidate.connector_family || null,
    resolution_priority: candidate.resolution_priority ?? null,
    status: candidate.status || null,
    secret_value_included: false,
  };
}

async function buildCredentialResolutionPlan(input = {}) {
  const tenantId = str(input.tenant_id || input.tenantId);
  const userId = str(input.user_id || input.userId);
  const connectionId = str(input.connection_id || input.connectionId);
  const actionKey = str(input.action_key || input.actionKey);
  const targetKey = str(input.target_key || input.targetKey);
  const credentialRole = str(input.credential_role || input.credentialRole || input.role);
  const allowPlatformFallback = input.allow_platform_fallback !== false && input.allowPlatformFallback !== false;
  if (!tenantId) {
    const err = new Error("tenant_id is required.");
    err.status = 400;
    err.code = "tenant_id_required";
    throw err;
  }
  if (!credentialRole) {
    const err = new Error("credential_role is required.");
    err.status = 400;
    err.code = "credential_role_required";
    throw err;
  }

  const pool = getPool();
  const [policies] = await pool.query(
    `SELECT tenant_id, app_key, source_mode, fallback_allowed, required_for_device_install, status
       FROM tenant_integration_policies
      WHERE tenant_id = ? AND status = 'active'
      ORDER BY app_key ASC`,
    [tenantId]
  ).catch(() => [[]]);

  const [bindings] = await pool.query(
    `SELECT binding_id, tenant_id, owner_type, owner_id, user_id, system_id, installation_id,
            connection_id, action_key, target_key, credential_role, credential_ref,
            provider_family, connector_family, resolution_priority, status, created_by,
            created_at, updated_at
       FROM credential_bindings
      WHERE tenant_id = ?
        AND credential_role = ?
        AND status = 'active'
      ORDER BY resolution_priority ASC, updated_at DESC
      LIMIT 100`,
    [tenantId, credentialRole]
  );

  const matchingBindings = bindings.filter((row) =>
    (!row.user_id || !userId || row.user_id === userId) &&
    (!row.connection_id || !connectionId || row.connection_id === connectionId) &&
    (!row.action_key || !actionKey || row.action_key === actionKey) &&
    (!row.target_key || !targetKey || row.target_key === targetKey)
  );

  const fallbackCandidates = [];
  if (connectionId) {
    const [connections] = await pool.query(
      `SELECT connection_id, user_id, tenant_id, app_key, auth_type, account_label, status, validation_status
         FROM user_app_connections
        WHERE connection_id = ? AND tenant_id = ?
        LIMIT 1`,
      [connectionId, tenantId]
    ).catch(() => [[]]);
    const connection = connections[0];
    if (connection?.status === "active") {
      fallbackCandidates.push({
        source: "user_app_connections_fallback",
        owner_type: "connection",
        owner_id: connection.connection_id,
        connection_id: connection.connection_id,
        credential_role: credentialRole,
        credential_ref: `user_app_connection:${connection.connection_id}:encrypted_credentials.${roleCandidateField(credentialRole, connection.auth_type)}`,
        status: connection.status,
        resolution_priority: 200,
      });
    }
  }

  if (actionKey && allowPlatformFallback) {
    const [actions] = await pool.query(
      `SELECT action_key, secret_store_ref, api_key_storage_mode, api_key_mode
         FROM actions
        WHERE action_key = ?
        LIMIT 1`,
      [actionKey]
    ).catch(() => [[]]);
    const action = actions[0];
    if (action?.secret_store_ref) {
      fallbackCandidates.push({
        source: "actions.secret_store_ref",
        owner_type: "platform",
        owner_id: "action_default",
        action_key: action.action_key,
        credential_role: credentialRole,
        credential_ref: action.secret_store_ref,
        status: "active",
        resolution_priority: 300,
      });
    }
  }

  if (credentialRole === "wordpress_app_password" && targetKey) {
    fallbackCandidates.push({
      source: "target_tenant_secret_convention",
      owner_type: "tenant",
      owner_id: tenantId,
      target_key: targetKey,
      credential_role: credentialRole,
      credential_ref: `tenant_secret:${tenantId}:${upperEnvKey(targetKey)}_APP_PASSWORD`,
      status: "expected",
      resolution_priority: 400,
    });
  }

  const candidates = [
    ...matchingBindings.map((row) => ({ ...row, source: "credential_bindings" })),
    ...fallbackCandidates,
  ].map(sanitizeCredentialCandidate);
  const effective = await getEffectiveCredentialStatus({
    tenant_id: tenantId,
    user_id: userId,
    connection_id: connectionId,
    action_key: actionKey,
    target_key: targetKey,
    credential_role: credentialRole,
    allow_platform_fallback: allowPlatformFallback,
  });

  return {
    ok: true,
    request: {
      tenant_id: tenantId,
      user_id: userId || null,
      connection_id: connectionId || null,
      action_key: actionKey || null,
      target_key: targetKey || null,
      credential_role: credentialRole,
      allow_platform_fallback: allowPlatformFallback,
    },
    policy: {
      tenant_integration_policies: policies,
      platform_fallback_allowed_by_request: allowPlatformFallback,
      credential_values_returned: false,
      secret_values_returned: false,
    },
    resolution_order: ["credential_bindings", "user_app_connections_fallback", "actions.secret_store_ref", "target_tenant_secret_convention"],
    candidates,
    effective,
    total: candidates.length,
    secrets_included: false,
  };
}

export function buildCredentialRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  // Safe status-only resolver. Never returns secret values; used by admin/GPT,
  // /connect wrappers, and governance diagnostics.
  router.post("/credentials/effective/status", async (req, res) => {
    try {
      const credential = await getEffectiveCredentialStatus(req.body || {});
      res.json({ ok: true, credential });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "credential_status_failed", message: err.message } });
    }
  });

  // Credential resolution plan. This is a safe diagnostic/read model for
  // governance and promotion design. It returns pointer metadata and ordering,
  // never decrypted secret values.
  router.post("/credentials/effective/plan", async (req, res) => {
    try {
      const plan = await buildCredentialResolutionPlan(req.body || {});
      res.json(plan);
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, error: { code: err.code || "credential_plan_failed", message: err.message }, secrets_included: false });
    }
  });

  // Store a platform or tenant secret as AES-256-GCM ciphertext in SQL. This is
  // backend/admin only. It never echoes the provided value and updates the
  // pointer registry to store_type=db_encrypted.
  router.post("/credentials/secrets/upsert", async (req, res) => {
    try {
      const body = req.body || {};
      const ownerType = str(body.owner_type || body.ownerType || "tenant");
      const tenantId = str(body.tenant_id || body.tenantId);
      const secretKey = str(body.secret_key || body.secretKey);
      const secretType = str(body.secret_type || body.secretType || body.credential_type || "text");
      const value = str(body.value || body.secret || body.secret_value);
      const providerFamily = str(body.provider_family || body.providerFamily);
      const connectorFamily = str(body.connector_family || body.connectorFamily);
      const credentialType = str(body.credential_type || body.credentialType || secretType);
      const createdBy = str(body.created_by || body.createdBy || "credential_routes.upsert");

      if (!["platform", "tenant"].includes(ownerType)) {
        return res.status(400).json({ ok: false, error: { code: "unsupported_owner_type", message: "owner_type must be platform or tenant" } });
      }
      if (ownerType === "tenant" && !tenantId) {
        return res.status(400).json({ ok: false, error: { code: "tenant_id_required", message: "tenant_id is required for tenant secrets" } });
      }
      if (!secretKey || !value) {
        return res.status(400).json({ ok: false, error: { code: "secret_key_and_value_required", message: "secret_key and value are required" } });
      }

      const ciphertext = encryptToken(value);
      const hash = sha256(value);
      const pool = getPool();

      if (ownerType === "platform") {
        await pool.query(
          `INSERT INTO \`platform_secrets\`
             (secret_key, secret_type, storage_backend, secret_ref, value_sha256, value_ciphertext, metadata_json, status, created_by)
           VALUES (?, ?, 'db_encrypted', NULL, ?, ?, ?, 'active', ?)
           ON DUPLICATE KEY UPDATE
             secret_type = VALUES(secret_type),
             storage_backend = 'db_encrypted',
             secret_ref = NULL,
             value_sha256 = VALUES(value_sha256),
             value_ciphertext = VALUES(value_ciphertext),
             metadata_json = VALUES(metadata_json),
             status = 'active',
             updated_at = CURRENT_TIMESTAMP`,
          [secretKey, secretType, hash, ciphertext, metadataJson(body), createdBy]
        );
      } else {
        await pool.query(
          `INSERT INTO \`tenant_secrets\`
             (tenant_id, secret_key, secret_type, storage_backend, secret_ref, value_sha256, value_ciphertext, metadata_json, status, created_by)
           VALUES (?, ?, ?, 'db_encrypted', NULL, ?, ?, ?, 'active', ?)
           ON DUPLICATE KEY UPDATE
             secret_type = VALUES(secret_type),
             storage_backend = 'db_encrypted',
             secret_ref = NULL,
             value_sha256 = VALUES(value_sha256),
             value_ciphertext = VALUES(value_ciphertext),
             metadata_json = VALUES(metadata_json),
             status = 'active',
             updated_at = CURRENT_TIMESTAMP`,
          [tenantId, secretKey, secretType, hash, ciphertext, metadataJson(body), createdBy]
        );
      }

      const referenceTenantId = ownerType === "tenant" ? tenantId : "f2795a7f-8d06-4053-8bee-35ca9af8b460";
      const referenceOwnerId = ownerType === "tenant" ? tenantId : "platform";
      const referenceDescription = str(body.description) || `${ownerType} ${secretKey} stored as db_encrypted credential`;
      const [existingReferences] = await pool.query(
        `SELECT id FROM \`secret_references\`
          WHERE tenant_id = ? AND owner_type = ? AND secret_key = ?
          ORDER BY id ASC LIMIT 1`,
        [referenceTenantId, ownerType, secretKey]
      );

      if (existingReferences[0]?.id) {
        await pool.query(
          `UPDATE \`secret_references\`
              SET owner_id = ?,
                  store_type = 'db_encrypted',
                  env_var_name = NULL,
                  vault_path = NULL,
                  description = ?,
                  provider_family = ?,
                  connector_family = ?,
                  credential_type = ?,
                  validation_status = 'stored',
                  status = 'active'
            WHERE id = ?`,
          [referenceOwnerId, referenceDescription, providerFamily, connectorFamily, credentialType, existingReferences[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO \`secret_references\`
             (ref_id, tenant_id, owner_type, owner_id, secret_key, store_type, env_var_name, vault_path,
              description, provider_family, connector_family, credential_type, consent_status, validation_status, status, created_at)
           VALUES (UUID(), ?, ?, ?, ?, 'db_encrypted', NULL, NULL, ?, ?, ?, ?, 'not_required', 'stored', 'active', NOW())`,
          [referenceTenantId, ownerType, referenceOwnerId, secretKey, referenceDescription, providerFamily, connectorFamily, credentialType]
        );
      }

      res.json({
        ok: true,
        owner_type: ownerType,
        tenant_id: ownerType === "tenant" ? tenantId : null,
        secret_key: secretKey,
        storage_backend: "db_encrypted",
        value_sha256: hash,
        status: "active"
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "credential_secret_upsert_failed", message: err.message } });
    }
  });

  // Read-only binding inventory. This exposes pointers and ownership metadata,
  // never secret values.
  router.get("/credentials/bindings", async (req, res) => {
    try {
      const {
        tenant_id,
        owner_type,
        action_key,
        target_key,
        credential_role,
        status = "active",
        limit = 100
      } = req.query || {};

      const clauses = [];
      const params = [];
      if (tenant_id) { clauses.push("tenant_id = ?"); params.push(str(tenant_id)); }
      if (owner_type) { clauses.push("owner_type = ?"); params.push(str(owner_type)); }
      if (action_key) { clauses.push("action_key = ?"); params.push(str(action_key)); }
      if (target_key) { clauses.push("target_key = ?"); params.push(str(target_key)); }
      if (credential_role) { clauses.push("credential_role = ?"); params.push(str(credential_role)); }
      if (status) { clauses.push("status = ?"); params.push(str(status)); }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const [rows] = await getPool().query(
        `SELECT binding_id, tenant_id, owner_type, owner_id, user_id, system_id,
                installation_id, connection_id, action_key, target_key,
                credential_role, credential_ref, provider_family, connector_family,
                resolution_priority, status, created_by, created_at, updated_at
           FROM \`credential_bindings\`
          ${where}
          ORDER BY resolution_priority ASC, updated_at DESC
          LIMIT ${parseLimit(limit)}`,
        params
      );

      res.json({ ok: true, bindings: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "credential_bindings_failed", message: err.message } });
    }
  });

  return router;
}
