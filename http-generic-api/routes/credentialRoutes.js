import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { getEffectiveCredentialStatus } from "../credentialResolver.js";
import { maybeCreateCredentialIntakeRequirement } from "../credentialIntakeEnforcement.js";
import { getPool } from "../db.js";
import { decryptCredentials, encryptToken } from "../tokenEncryption.js";

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

function candidateEligibility(candidate = {}, context = {}) {
  const reasons = [];
  for (const [field, contextField, label] of [
    ["user_id", "userId", "user_context_required"],
    ["connection_id", "connectionId", "connection_context_required"],
    ["system_id", "systemId", "system_context_required"],
    ["installation_id", "installationId", "installation_context_required"],
    ["action_key", "actionKey", "action_context_required"],
    ["target_key", "targetKey", "target_context_required"],
  ]) {
    const requiredValue = str(candidate[field]);
    const suppliedValue = str(context[contextField]);
    if (requiredValue && !suppliedValue) reasons.push(label);
    if (requiredValue && suppliedValue && requiredValue !== suppliedValue) reasons.push(`${label}_mismatch`);
  }
  if (candidate.owner_type === "connection" && str(candidate.user_id) && !str(context.userId)) {
    reasons.push("private_connection_user_context_required");
  }
  return {
    eligible_for_request: reasons.length === 0,
    ineligibility_reasons: [...new Set(reasons)],
  };
}

function sanitizeCredentialCandidate(candidate = {}, context = {}) {
  const eligibility = candidateEligibility(candidate, context);
  return {
    source: candidate.source || "unknown",
    owner_type: candidate.owner_type || null,
    owner_id: candidate.owner_id || null,
    binding_id: candidate.binding_id || null,
    user_id: candidate.user_id || null,
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
    eligible_for_request: eligibility.eligible_for_request,
    ineligibility_reasons: eligibility.ineligibility_reasons,
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
  const requestContext = { tenantId, userId, connectionId, actionKey, targetKey, credentialRole };
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
  ].map((candidate) => sanitizeCredentialCandidate(candidate, requestContext));
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
      const input = req.body || {};
      const credential = await getEffectiveCredentialStatus(input);
      const intake = await maybeCreateCredentialIntakeRequirement(input, credential, { req });
      res.json({ ok: true, credential, ...(intake ? { intake } : {}) });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "credential_status_failed", message: err.message } });
    }
  });

  // Credential resolution plan. This is a safe diagnostic/read model for
  // governance and promotion design. It returns pointer metadata and ordering,
  // never decrypted secret values.
  router.post("/credentials/effective/plan", async (req, res) => {
    try {
      const input = req.body || {};
      const plan = await buildCredentialResolutionPlan(input);
      const intake = await maybeCreateCredentialIntakeRequirement(input, plan.effective || {}, { req });
      res.json({ ...plan, ...(intake ? { intake } : {}) });
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

  // Promote a secure intake connection into platform_secrets. This route never
  // accepts raw secret values and never returns decrypted values; it decrypts
  // one active intake connection server-side and writes selected fields into
  // platform-scoped DB-encrypted secret slots.
  router.post("/credentials/intake/promote-platform-secrets", async (req, res) => {
    try {
      const body = req.body || {};
      const connectionId = str(body.connection_id || body.connectionId);
      const systemId = str(body.system_id || body.systemId || "98d6a18b-5578-11f1-9baf-8e76a7e1749f");
      const ownerId = str(body.owner_id || body.ownerId || "growth_intelligence_platform");
      const providerFamily = str(body.provider_family || body.providerFamily || "hostinger");
      const connectorFamily = str(body.connector_family || body.connectorFamily || "hostinger_ssh");
      const targetKey = str(body.target_key || body.targetKey || "hostinger_ssh_prod_platform");
      const approved = body.promotion_approved === true || body.promotionApproved === true;
      const promotionReason = str(body.promotion_reason || body.promotionReason);
      const createdBy = str(body.created_by || body.createdBy || "credential_intake_platform_secret_promotion");
      const mappings = Array.isArray(body.secret_mappings || body.secretMappings)
        ? (body.secret_mappings || body.secretMappings)
        : [
            { credential_field: "ssh_host", secret_key: "hostinger_ssh_prod_host", secret_type: "ssh_host" },
            { credential_field: "ssh_port", secret_key: "hostinger_ssh_prod_port", secret_type: "ssh_port" },
            { credential_field: "ssh_user", secret_key: "hostinger_ssh_prod_user", secret_type: "ssh_user" },
            { credential_field: "ssh_private_key", secret_key: "hostinger_ssh_prod_private_key", secret_type: "ssh_private_key" },
          ];

      if (!approved || promotionReason.length < 12) {
        return res.status(400).json({ ok: false, error: { code: "promotion_approval_required", message: "promotion_approved=true and a promotion_reason of at least 12 characters are required." }, secrets_included: false });
      }
      if (!connectionId) {
        return res.status(400).json({ ok: false, error: { code: "connection_id_required", message: "connection_id is required." }, secrets_included: false });
      }
      if (!mappings.length) {
        return res.status(400).json({ ok: false, error: { code: "secret_mappings_required", message: "At least one secret mapping is required." }, secrets_included: false });
      }

      const pool = getPool();
      const [connections] = await pool.query(
        `SELECT connection_id, user_id, tenant_id, app_key, auth_type, encrypted_credentials, status, validation_status
           FROM user_app_connections
          WHERE connection_id = ?
          LIMIT 1`,
        [connectionId]
      );
      const connection = connections[0];
      if (!connection || connection.status !== "active" || !connection.encrypted_credentials) {
        return res.status(400).json({ ok: false, error: { code: "active_intake_connection_required", message: "An active encrypted intake connection is required." }, secrets_included: false });
      }
      if (connection.auth_type !== "ssh_key_pair") {
        return res.status(400).json({ ok: false, error: { code: "ssh_key_pair_connection_required", message: "Only ssh_key_pair intake connections can be promoted to Hostinger SSH platform secrets." }, auth_type: connection.auth_type, secrets_included: false });
      }

      const credentials = decryptCredentials(connection.encrypted_credentials) || {};
      const normalizedMappings = mappings.map((mapping = {}) => ({
        credential_field: str(mapping.credential_field || mapping.field),
        secret_key: str(mapping.secret_key || mapping.secretKey),
        secret_type: str(mapping.secret_type || mapping.secretType || mapping.credential_role || mapping.credentialRole),
      })).filter((mapping) => mapping.credential_field && mapping.secret_key);
      const missingFields = normalizedMappings
        .filter((mapping) => !str(credentials[mapping.credential_field]))
        .map((mapping) => mapping.credential_field);
      if (!normalizedMappings.length || missingFields.length) {
        return res.status(400).json({
          ok: false,
          error: { code: "intake_secret_fields_missing", message: "The intake connection is missing one or more mapped fields." },
          missing_fields: [...new Set(missingFields)],
          secrets_included: false,
        });
      }

      const promoted = [];
      for (const mapping of normalizedMappings) {
        const value = str(credentials[mapping.credential_field]);
        const ciphertext = encryptToken(value);
        const hash = sha256(value);
        const secretType = mapping.secret_type || mapping.credential_field;
        const metadata = JSON.stringify({
          provisioning_status: "stored",
          stored_at: new Date().toISOString(),
          provider_family: providerFamily,
          connector_family: connectorFamily,
          credential_type: secretType,
          source: "credential_intake_platform_secret_promotion",
          connection_id: connectionId,
          target_key: targetKey,
          promotion_reason: promotionReason,
        });

        await pool.query(
          `INSERT INTO platform_secrets
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
          [mapping.secret_key, secretType, hash, ciphertext, metadata, createdBy]
        );

        await pool.query(
          `UPDATE secret_references
              SET owner_type = 'platform',
                  owner_id = ?,
                  system_id = ?,
                  provider_family = ?,
                  connector_family = ?,
                  credential_type = ?,
                  store_type = 'db_encrypted',
                  env_var_name = NULL,
                  vault_path = NULL,
                  validation_status = 'stored',
                  status = 'active'
            WHERE secret_key = ?
              AND owner_type = 'platform'`,
          [ownerId, systemId, providerFamily, connectorFamily, secretType, mapping.secret_key]
        );

        promoted.push({ secret_key: mapping.secret_key, credential_field: mapping.credential_field, value_sha256: hash });
      }

      await pool.query(
        `UPDATE user_app_connections
            SET validation_status = 'promoted_to_platform_secrets', last_used_at = NOW()
          WHERE connection_id = ?`,
        [connectionId]
      ).catch(() => {});

      return res.json({
        ok: true,
        owner_type: "platform",
        owner_id: ownerId,
        system_id: systemId,
        target_key: targetKey,
        connection_id: connectionId,
        promoted_count: promoted.length,
        promoted,
        secrets_included: false,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "platform_secret_promotion_failed", message: err.message }, secrets_included: false });
    }
  });

  // Promote an intake-created connection secret into the local connector registry.
  // This is intentionally narrow: it only writes connector_local_api_key for one
  // user/tenant/device config and never returns the decrypted secret.
  router.post("/credentials/intake/promote-local-connector-key", async (req, res) => {
    try {
      const body = req.body || {};
      const tenantId = str(body.tenant_id || body.tenantId);
      const userId = str(body.user_id || body.userId);
      const deviceId = str(body.device_id || body.deviceId);
      const connectionId = str(body.connection_id || body.connectionId);
      const credentialField = str(body.credential_field || body.credentialField || "api_key");
      const targetField = str(body.target_field || body.targetField || "connector_local_api_key");
      const createdBy = str(body.created_by || body.createdBy || "credential_intake_local_connector_key_promotion");

      if (targetField !== "connector_local_api_key") {
        return res.status(400).json({ ok: false, error: { code: "unsupported_target_field", message: "Only connector_local_api_key is supported." }, secrets_included: false });
      }
      if (!tenantId || !userId || !deviceId || !connectionId) {
        return res.status(400).json({ ok: false, error: { code: "promotion_fields_required", message: "tenant_id, user_id, device_id, and connection_id are required." }, secrets_included: false });
      }

      const pool = getPool();
      const [connections] = await pool.query(
        `SELECT connection_id, user_id, tenant_id, app_key, auth_type, encrypted_credentials, status, validation_status
           FROM user_app_connections
          WHERE connection_id = ? AND user_id = ? AND tenant_id = ?
          LIMIT 1`,
        [connectionId, userId, tenantId]
      );
      const connection = connections[0];
      if (!connection || connection.status !== "active" || !connection.encrypted_credentials) {
        return res.status(400).json({ ok: false, error: { code: "active_intake_connection_required", message: "An active encrypted intake connection is required." }, secrets_included: false });
      }

      const credentials = decryptCredentials(connection.encrypted_credentials) || {};
      const candidateFields = [credentialField, "connector_local_api_key", "api_key", "bearer_token", "token", "key"];
      const value = candidateFields.map((field) => str(credentials[field])).find(Boolean);
      if (!value) {
        return res.status(400).json({ ok: false, error: { code: "intake_secret_field_missing", message: "No usable secret field was found on the intake connection." }, fields_checked: [...new Set(candidateFields)], secrets_included: false });
      }

      const hash = sha256(value);
      const [updateResult] = await pool.query(
        `UPDATE local_connector_user_configs
            SET connector_local_api_key = ?, updated_at = NOW()
          WHERE user_id = ?
            AND tenant_id = ?
            AND device_id = ?
            AND is_enabled = 1
          LIMIT 1`,
        [value, userId, tenantId, deviceId]
      );
      if (!updateResult?.affectedRows) {
        return res.status(404).json({ ok: false, error: { code: "active_local_connector_config_not_found", message: "No enabled local connector config matched the requested user/tenant/device." }, secrets_included: false });
      }

      await pool.query(
        `UPDATE user_app_connections
            SET validation_status = 'promoted_to_local_connector_registry', last_used_at = NOW()
          WHERE connection_id = ?`,
        [connectionId]
      ).catch(() => {});

      return res.json({
        ok: true,
        target: "local_connector_user_configs.connector_local_api_key",
        user_id: userId,
        tenant_id: tenantId,
        device_id: deviceId,
        connection_id: connectionId,
        value_sha256: hash,
        promoted_by: createdBy,
        updated_rows: updateResult.affectedRows,
        next_actions: ["repair_or_restart_local_connector_to_materialize_CONNECTOR_LOCAL_API_KEY", "validate_connector_policy_local_api_key_alias_enabled", "validate_direct_connector_fallback"],
        secrets_included: false,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "local_connector_key_promotion_failed", message: err.message }, secrets_included: false });
    }
  });

  // Promote a private connection credential into a tenant-owned binding. This
  // creates a pointer binding only; it never copies, decrypts, or returns secret
  // values. V1 intentionally supports tenant-owned promotion only.
  router.post("/credentials/bindings/promote", async (req, res) => {
    try {
      const body = req.body || {};
      const tenantId = str(body.tenant_id || body.tenantId);
      const connectionId = str(body.connection_id || body.connectionId);
      const targetKey = str(body.target_key || body.targetKey);
      const actionKey = str(body.action_key || body.actionKey);
      const credentialRole = str(body.credential_role || body.credentialRole || body.role);
      const providerFamily = str(body.provider_family || body.providerFamily || "wordpress");
      const connectorFamily = str(body.connector_family || body.connectorFamily || "wordpress_rest");
      const promotedOwnerType = str(body.promoted_owner_type || body.promotedOwnerType || "tenant");
      const resolutionPriority = Number.parseInt(String(body.resolution_priority || body.resolutionPriority || 20), 10);
      const promotionApproved = body.promotion_approved === true || body.promotionApproved === true;
      const promotionReason = str(body.promotion_reason || body.promotionReason);
      const createdBy = str(body.created_by || body.createdBy || "credential_binding_promotion_v1");

      if (!promotionApproved || promotionReason.length < 8) {
        return res.status(400).json({ ok: false, error: { code: "promotion_approval_required", message: "promotion_approved=true and promotion_reason of at least 8 characters are required." }, secrets_included: false });
      }
      if (promotedOwnerType !== "tenant") {
        return res.status(400).json({ ok: false, error: { code: "unsupported_promotion_owner_type", message: "v1 supports promoted_owner_type=tenant only." }, secrets_included: false });
      }
      if (!tenantId || !connectionId || !credentialRole || (!targetKey && !actionKey)) {
        return res.status(400).json({ ok: false, error: { code: "promotion_fields_required", message: "tenant_id, connection_id, credential_role, and target_key or action_key are required." }, secrets_included: false });
      }

      const pool = getPool();
      const [connections] = await pool.query(
        `SELECT connection_id, user_id, tenant_id, app_key, auth_type, account_label, status, validation_status
           FROM user_app_connections
          WHERE connection_id = ? AND tenant_id = ?
          LIMIT 1`,
        [connectionId, tenantId]
      );
      const connection = connections[0];
      if (!connection || connection.status !== "active") {
        return res.status(400).json({ ok: false, error: { code: "active_connection_required", message: "An active user_app_connection in this tenant is required for promotion." }, secrets_included: false });
      }

      const preflight = await buildCredentialResolutionPlan({
        tenant_id: tenantId,
        user_id: connection.user_id,
        connection_id: connectionId,
        action_key: actionKey || undefined,
        target_key: targetKey || undefined,
        credential_role: credentialRole,
        allow_platform_fallback: false,
      });
      if (preflight.effective?.status !== "resolved" || preflight.effective?.owner_type !== "connection" || preflight.effective?.connection_id !== connectionId) {
        return res.status(409).json({
          ok: false,
          error: {
            code: "promotion_source_not_resolved",
            message: "Source connection credential must resolve with user+connection context before promotion.",
            details: {
              effective_status: preflight.effective?.status || null,
              effective_owner_type: preflight.effective?.owner_type || null,
              effective_connection_id: preflight.effective?.connection_id || null,
            },
          },
          secrets_included: false,
        });
      }

      const field = roleCandidateField(credentialRole, connection.auth_type);
      const credentialRef = preflight.effective.credential_ref || `user_app_connection:${connection.connection_id}:encrypted_credentials.${field}`;
      const [existing] = await pool.query(
        `SELECT binding_id FROM credential_bindings
          WHERE tenant_id = ?
            AND owner_type = 'tenant'
            AND owner_id = ?
            AND credential_role = ?
            AND credential_ref = ?
            AND COALESCE(target_key, '') = COALESCE(?, '')
            AND COALESCE(action_key, '') = COALESCE(?, '')
          ORDER BY updated_at DESC
          LIMIT 1`,
        [tenantId, tenantId, credentialRole, credentialRef, targetKey || null, actionKey || null]
      );
      const bindingId = existing[0]?.binding_id || randomUUID();

      if (existing[0]?.binding_id) {
        await pool.query(
          `UPDATE credential_bindings
              SET provider_family = ?, connector_family = ?, resolution_priority = ?, status = 'active', updated_at = NOW()
            WHERE binding_id = ?`,
          [providerFamily, connectorFamily, Number.isFinite(resolutionPriority) ? resolutionPriority : 20, bindingId]
        );
      } else {
        await pool.query(
          `INSERT INTO credential_bindings (
             binding_id, tenant_id, owner_type, owner_id, user_id, system_id, installation_id, connection_id,
             action_key, target_key, credential_role, credential_ref, provider_family, connector_family,
             resolution_priority, status, created_by, created_at, updated_at
           ) VALUES (?, ?, 'tenant', ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NOW(), NOW())`,
          [
            bindingId,
            tenantId,
            tenantId,
            actionKey || null,
            targetKey || null,
            credentialRole,
            credentialRef,
            providerFamily,
            connectorFamily,
            Number.isFinite(resolutionPriority) ? resolutionPriority : 20,
            createdBy,
          ]
        );
      }

      const plan = await buildCredentialResolutionPlan({
        tenant_id: tenantId,
        action_key: actionKey || undefined,
        target_key: targetKey || undefined,
        credential_role: credentialRole,
        allow_platform_fallback: body.allow_platform_fallback !== false,
      });

      res.status(existing[0]?.binding_id ? 200 : 201).json({
        ok: true,
        binding_id: bindingId,
        tenant_id: tenantId,
        promoted_owner_type: "tenant",
        credential_ref: credentialRef,
        target_key: targetKey || null,
        action_key: actionKey || null,
        credential_role: credentialRole,
        resolution_priority: Number.isFinite(resolutionPriority) ? resolutionPriority : 20,
        promotion_policy: {
          mode: "tenant_connection_binding_promotion_v1",
          promotion_approved: true,
          promotion_reason: promotionReason,
          source_preflight_status: preflight.effective?.status || null,
          source_connection_id: connectionId,
          source_user_id: connection.user_id,
          secret_copied: false,
          token_returned: false,
          secrets_included: false,
          platform_wide_promotion_enabled: false,
        },
        readback: {
          effective_status: plan.effective?.status || null,
          effective_source: plan.effective?.source || null,
          effective_binding_id: plan.effective?.binding_id || null,
          candidate_count: plan.total,
          secrets_included: false,
        },
        secrets_included: false,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: { code: err.code || "credential_binding_promotion_failed", message: err.message }, secrets_included: false });
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
