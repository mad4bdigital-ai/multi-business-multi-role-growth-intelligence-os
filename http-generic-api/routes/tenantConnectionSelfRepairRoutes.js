import { Router } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS } from "../tenantConnectionSelfRepairService.js";
import { resolveUserJwtSecret } from "../userJwtAuth.js";

const CONNECT_CONTEXT_TTL_SECONDS = 60 * 60;
const WORDPRESS_STAGING_ORIGIN = "https://staging.egypttourgates.com";
const WORDPRESS_STAGING_RESOURCE = `${WORDPRESS_STAGING_ORIGIN}/wp-json/mcp/mad4b-read`;
const WORDPRESS_STAGING_ISSUER = "https://dev.mad4b.com/auth/mcp/wordpress-staging";
const WORDPRESS_STAGING_RESOURCE_METADATA = `${WORDPRESS_STAGING_ORIGIN}/.well-known/oauth-protected-resource/wp-json/mcp/mad4b-read`;
const WORDPRESS_STAGING_AUTHORIZATION_METADATA = "https://dev.mad4b.com/.well-known/oauth-authorization-server/auth/mcp/wordpress-staging";

function expressPath(contractPath = "") {
  return String(contractPath).replace("{connection_id}", ":connection_id");
}

function disabledEnvelope(toolKey) {
  return {
    ok: false,
    error: {
      code: "tenant_connection_self_repair_capability_disabled",
      message: "This tenant connection self-repair capability is not enabled.",
      details: { tool_key: toolKey, rollout_mode: "catalog_disabled", retryable: false },
    },
    secrets_included: false,
  };
}

function text(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function safeObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function membershipView(row = {}) {
  const name = text(row.tenant_display_name || row.tenant_id, 120);
  const role = text(row.role || "member", 64) || "member";
  return {
    tenant_id: text(row.tenant_id, 64),
    name,
    display_name: name,
    role,
    role_label: role.charAt(0).toUpperCase() + role.slice(1),
    initial: (name || "T").charAt(0).toUpperCase(),
    type: "Company",
    secrets_included: false,
  };
}

async function listActiveMemberships(pool, userId) {
  if (!userId) return [];
  const [rows] = await pool.query(
    `SELECT m.tenant_id, m.role, t.display_name AS tenant_display_name
       FROM \`memberships\` m
       JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
      ORDER BY m.granted_at ASC`,
    [userId]
  );
  return Array.isArray(rows) ? rows : [];
}

async function readUserSummary(pool, userId, auth = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT user_id, email, display_name
         FROM \`users\`
        WHERE user_id = ? AND status = 'active'
        LIMIT 1`,
      [userId]
    );
    const row = rows?.[0] || null;
    if (row) return { user_id: row.user_id, email: row.email || null, display_name: row.display_name || row.email || row.user_id };
  } catch (error) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error;
  }
  return {
    user_id: userId,
    email: auth?.email || auth?.claims?.email || null,
    display_name: auth?.claims?.display_name || auth?.email || auth?.claims?.email || userId,
  };
}

function signedTenantId(req) {
  if (req.auth?.claims && typeof req.auth.claims === "object") {
    return text(req.auth.claims.tenant_id, 64);
  }
  // Tests and trusted upstream middleware may prehydrate req.auth without claims.
  return text(req.auth?.tenant_id, 64);
}

async function resolveMembershipContext(pool, req) {
  const memberships = await listActiveMemberships(pool, req.auth?.user_id);
  const selectedTenantId = signedTenantId(req);
  const selected = selectedTenantId
    ? memberships.find((membership) => membership.tenant_id === selectedTenantId) || null
    : null;
  return { memberships, selectedTenantId, selected };
}

function contextRequiredEnvelope(memberships) {
  return {
    ok: false,
    error: {
      code: "tenant_context_required",
      message: "Select an active workspace before using tenant-scoped connection tools.",
      details: {
        memberships: memberships.map(membershipView),
        membership_count: memberships.length,
      },
    },
    secrets_included: false,
  };
}

async function enforceUnambiguousTenantContext(pool, req, res, next) {
  try {
    const { memberships, selectedTenantId, selected } = await resolveMembershipContext(pool, req);
    if (selectedTenantId) {
      if (!selected) {
        return res.status(403).json({
          ok: false,
          error: {
            code: "tenant_context_inactive",
            message: "The selected workspace is no longer an active membership for this user.",
          },
          secrets_included: false,
        });
      }
      req.auth.tenant_id = selected.tenant_id;
      req.auth.tenant_role = selected.role;
      return next();
    }
    if (memberships.length > 1) {
      return res.status(409).json(contextRequiredEnvelope(memberships));
    }
    if (memberships.length === 1) {
      req.auth.tenant_id = memberships[0].tenant_id;
      req.auth.tenant_role = memberships[0].role;
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

function issueTenantContextToken(req, membership, env = process.env) {
  const secret = resolveUserJwtSecret(env);
  if (secret.length < 32) {
    const error = new Error("Tenant context signing authority is unavailable.");
    error.code = "tenant_context_signing_unavailable";
    error.status = 503;
    throw error;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const currentExp = Number(req.auth?.claims?.exp);
  const remaining = Number.isFinite(currentExp) && currentExp > nowSeconds
    ? currentExp - nowSeconds
    : CONNECT_CONTEXT_TTL_SECONDS;
  const ttlSeconds = Math.min(CONNECT_CONTEXT_TTL_SECONDS, Math.max(60, remaining));
  return jwt.sign(
    {
      user_id: req.auth.user_id,
      tenant_id: membership.tenant_id,
      email: req.auth?.email || req.auth?.claims?.email || undefined,
      purpose: "connect_tenant_context",
      context_role: membership.role || "member",
      context_version: randomUUID(),
    },
    secret,
    { algorithm: "HS256", expiresIn: ttlSeconds, jwtid: randomUUID() }
  );
}

function dateMs(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function userConnectionLifecycle(row, nowMs = Date.now()) {
  const status = text(row.status, 64).toLowerCase();
  const validationStatus = text(row.validation_status, 64).toLowerCase();
  const tokenExpiresAtMs = dateMs(row.token_expires_at);
  const lastUsedAtMs = dateMs(row.last_used_at);
  let lifecycleState = "active_pending_validation";
  let nextActions = ["validate"];

  if (status === "revoked") {
    lifecycleState = "revoked";
    nextActions = ["reconnect"];
  } else if (["expired", "error"].includes(status) || validationStatus === "reauth_required") {
    lifecycleState = "reauth_required";
    nextActions = ["reauthorize", "reconnect"];
  } else if (tokenExpiresAtMs !== null && tokenExpiresAtMs <= nowMs) {
    lifecycleState = "reauth_required";
    nextActions = ["reauthorize"];
  } else if (tokenExpiresAtMs !== null && tokenExpiresAtMs - nowMs <= 15 * 60 * 1000) {
    lifecycleState = "token_expiring";
    nextActions = ["refresh_or_reauthorize"];
  } else if (["validated", "ready", "healthy"].includes(validationStatus)) {
    lifecycleState = lastUsedAtMs ? "in_use" : "validated_ready";
    nextActions = ["use", "disconnect"];
  }

  const metadata = safeObject(row.account_metadata);
  const wordpressFederation = metadata.federation_profile === "wordpress_staging_mcp_rs256_v1"
    || text(row.mcp_endpoint, 512) === WORDPRESS_STAGING_RESOURCE;

  return {
    source_kind: "user_app_connection",
    connection_id: row.connection_id,
    app_key: row.app_key,
    display_label: row.display_label || row.account_label || row.app_key,
    auth_type: row.auth_type,
    status: row.status,
    validation_status: row.validation_status || null,
    lifecycle_state: lifecycleState,
    next_actions: nextActions,
    token_expires_at: row.token_expires_at || null,
    last_validated_at: row.last_validated_at || null,
    last_used_at: row.last_used_at || null,
    connected_at: row.connected_at || null,
    mcp_endpoint: row.mcp_endpoint || null,
    federation_profile: wordpressFederation ? "wordpress_staging_mcp_rs256_v1" : metadata.federation_profile || null,
    subject_binding_required: wordpressFederation ? metadata.subject_binding_required !== false : false,
    subject_binding_verified: wordpressFederation ? metadata.subject_binding_verified === true : null,
    secrets_included: false,
  };
}

function managedSystemLifecycle(row) {
  const status = text(row.status, 64).toLowerCase();
  const ready = status === "active";
  return {
    source_kind: "connected_system",
    connection_id: row.system_id,
    app_key: row.system_key,
    display_label: row.display_name || row.system_key,
    auth_type: row.auth_type || null,
    status: row.status,
    validation_status: ready ? "managed_runtime_active" : null,
    lifecycle_state: ready ? "managed_ready" : "needs_attention",
    next_actions: ready ? ["use", "inspect"] : ["inspect", "repair"],
    provider_family: row.provider_family || null,
    connector_family: row.connector_family || null,
    service_mode: row.service_mode || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

async function unifiedConnectionLifecycle(pool, userId, tenantId) {
  const [connectionRows] = await pool.query(
    `SELECT connection_id, app_key, display_label, auth_type, account_label, account_metadata,
            mcp_endpoint, status, validation_status, token_expires_at, last_validated_at,
            last_used_at, connected_at
       FROM \`user_app_connections\`
      WHERE user_id = ? AND tenant_id = ?
      ORDER BY COALESCE(last_used_at, last_validated_at, connected_at) DESC`,
    [userId, tenantId]
  );

  let systemRows = [];
  try {
    const [rows] = await pool.query(
      `SELECT system_id, system_key, display_name, provider_family, connector_family,
              auth_type, service_mode, status, updated_at
         FROM \`connected_systems\`
        WHERE tenant_id = ?
        ORDER BY updated_at DESC`,
      [tenantId]
    );
    systemRows = rows || [];
  } catch (error) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error;
  }

  const userItems = (connectionRows || []).map((row) => userConnectionLifecycle(row));
  const managedItems = systemRows.map(managedSystemLifecycle);
  const items = [...userItems, ...managedItems];
  return {
    items,
    counts: items.reduce((acc, item) => {
      acc.total += 1;
      acc[item.lifecycle_state] = (acc[item.lifecycle_state] || 0) + 1;
      return acc;
    }, { total: 0 }),
  };
}

async function fetchJsonExact(fetchImpl, url) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    headers: { accept: "application/json" },
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(5000) : undefined,
  });
  let body = null;
  try { body = await response.json(); } catch {}
  return { response, body };
}

async function validateWordpressStagingFederation(fetchImpl) {
  const blockers = [];
  let resourceMetadata = null;
  let authorizationMetadata = null;
  let challengeStatus = null;
  let challengeHeader = null;

  try {
    const result = await fetchJsonExact(fetchImpl, WORDPRESS_STAGING_RESOURCE_METADATA);
    resourceMetadata = result.body;
    if (!result.response.ok) blockers.push("protected_resource_metadata_unreachable");
  } catch {
    blockers.push("protected_resource_metadata_unreachable");
  }

  try {
    const result = await fetchJsonExact(fetchImpl, WORDPRESS_STAGING_AUTHORIZATION_METADATA);
    authorizationMetadata = result.body;
    if (!result.response.ok) blockers.push("authorization_server_metadata_unreachable");
  } catch {
    blockers.push("authorization_server_metadata_unreachable");
  }

  try {
    const response = await fetchImpl(WORDPRESS_STAGING_RESOURCE, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(5000) : undefined,
    });
    challengeStatus = response.status;
    challengeHeader = response.headers?.get?.("www-authenticate") || null;
  } catch {
    blockers.push("bearer_challenge_unreachable");
  }

  if (resourceMetadata?.resource !== WORDPRESS_STAGING_RESOURCE) blockers.push("protected_resource_exactness_unverified");
  if (!Array.isArray(resourceMetadata?.authorization_servers) || !resourceMetadata.authorization_servers.includes(WORDPRESS_STAGING_ISSUER)) {
    blockers.push("authorization_server_binding_unverified");
  }
  if (!Array.isArray(resourceMetadata?.scopes_supported) || !resourceMetadata.scopes_supported.includes("mad4b:read")) {
    blockers.push("read_scope_unverified");
  }
  if (authorizationMetadata?.issuer !== WORDPRESS_STAGING_ISSUER) blockers.push("issuer_exactness_unverified");
  if (!Array.isArray(authorizationMetadata?.protected_resources) || !authorizationMetadata.protected_resources.includes(WORDPRESS_STAGING_RESOURCE)) {
    blockers.push("authorization_resource_binding_unverified");
  }
  if (challengeStatus !== 401) blockers.push("bearer_challenge_status_unverified");
  if (!String(challengeHeader || "").includes("Bearer") || !String(challengeHeader || "").includes(WORDPRESS_STAGING_RESOURCE_METADATA)) {
    blockers.push("bearer_resource_metadata_challenge_unverified");
  }

  return {
    metadata_ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    protected_resource_metadata: {
      resource: resourceMetadata?.resource || null,
      authorization_servers: Array.isArray(resourceMetadata?.authorization_servers) ? resourceMetadata.authorization_servers : [],
      scopes_supported: Array.isArray(resourceMetadata?.scopes_supported) ? resourceMetadata.scopes_supported : [],
    },
    authorization_server_metadata: {
      issuer: authorizationMetadata?.issuer || null,
      protected_resources: Array.isArray(authorizationMetadata?.protected_resources) ? authorizationMetadata.protected_resources : [],
    },
    bearer_challenge: {
      status: challengeStatus,
      resource_metadata_bound: String(challengeHeader || "").includes(WORDPRESS_STAGING_RESOURCE_METADATA),
    },
    subject_binding_verified: false,
    live_oauth_canary_verified: false,
    ready: false,
    secrets_included: false,
  };
}

async function withTransaction(pool, work) {
  if (typeof pool.getConnection !== "function") return work(pool);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function revokeConnectionCascade(db, { connectionId, userId, tenantId }) {
  const [rows] = await db.query(
    `SELECT connection_id, app_key, status
       FROM \`user_app_connections\`
      WHERE connection_id = ? AND user_id = ? AND tenant_id = ?
      LIMIT 1`,
    [connectionId, userId, tenantId]
  );
  const connection = rows?.[0] || null;
  if (!connection) return null;

  await db.query(
    `UPDATE \`app_action_grants\` SET status = 'revoked'
      WHERE connection_id = ? AND status = 'active'`,
    [connectionId]
  );
  await db.query(
    `UPDATE \`app_action_requests\` SET status = 'expired'
      WHERE connection_id = ? AND status = 'pending'`,
    [connectionId]
  );
  await db.query(
    `UPDATE \`workspace_app_links\` SET status = 'removed'
      WHERE connection_id = ? AND tenant_id = ? AND status <> 'removed'`,
    [connectionId, tenantId]
  );
  await db.query(
    `UPDATE \`cms_site_access_grants\`
        SET status = 'revoked', updated_at = NOW()
      WHERE tenant_id = ?
        AND claim_id IN (
          SELECT claim_id FROM \`cms_account_claims\`
           WHERE connection_id = ? AND user_id = ? AND tenant_id = ?
        )
        AND status = 'active'`,
    [tenantId, connectionId, userId, tenantId]
  );
  await db.query(
    `UPDATE \`credential_bindings\`
        SET status = 'revoked', updated_at = NOW()
      WHERE tenant_id = ?
        AND (
          (connection_id = ? AND user_id = ?)
          OR credential_ref LIKE ?
        )`,
    [tenantId, connectionId, userId, `user_app_connection:${connectionId}:%`]
  );
  await db.query(
    `UPDATE \`cms_account_claims\`
        SET verification_status = 'revoked', updated_at = NOW()
      WHERE connection_id = ? AND user_id = ? AND tenant_id = ?`,
    [connectionId, userId, tenantId]
  );
  await db.query(
    `UPDATE \`user_app_connections\`
        SET status = 'revoked',
            encrypted_credentials = NULL,
            validation_status = 'revoked',
            last_used_at = NOW()
      WHERE connection_id = ? AND user_id = ? AND tenant_id = ?`,
    [connectionId, userId, tenantId]
  );
  return connection;
}

export function buildTenantConnectionSelfRepairRoutes(deps = {}) {
  const router = Router();
  const pool = deps.pool;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const env = deps.env || process.env;
  if (!pool || typeof pool.query !== "function") {
    throw new Error("tenant_connection_self_repair_pool_required");
  }

  // Identity is global; context is selected independently and revalidated on every switch.
  router.get("/connect/api/contexts", async (req, res, next) => {
    try {
      const memberships = await listActiveMemberships(pool, req.auth?.user_id);
      const selectedTenantId = signedTenantId(req);
      const selected = selectedTenantId
        ? memberships.find((membership) => membership.tenant_id === selectedTenantId) || null
        : null;
      const user = await readUserSummary(pool, req.auth?.user_id, req.auth);
      return res.json({
        ok: true,
        user,
        memberships: memberships.map(membershipView),
        membership_count: memberships.length,
        active_tenant_id: selected?.tenant_id || null,
        context_required: memberships.length > 1 && !selected,
        workspace_required: memberships.length === 0,
        secrets_included: false,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/connect/api/active-context", async (req, res, next) => {
    try {
      const tenantId = text(req.body?.tenant_id, 64);
      if (!tenantId) {
        return res.status(400).json({
          ok: false,
          error: { code: "tenant_id_required", message: "tenant_id is required." },
          secrets_included: false,
        });
      }
      const memberships = await listActiveMemberships(pool, req.auth?.user_id);
      const membership = memberships.find((item) => item.tenant_id === tenantId) || null;
      if (!membership) {
        return res.status(403).json({
          ok: false,
          error: { code: "tenant_context_not_authorized", message: "This workspace is not an active membership for the signed-in user." },
          secrets_included: false,
        });
      }
      const token = issueTenantContextToken(req, membership, env);
      return res.json({
        ok: true,
        token,
        tenant: membershipView(membership),
        expires_in: CONNECT_CONTEXT_TTL_SECONDS,
        context_revalidated: true,
        secrets_included: false,
      });
    } catch (error) {
      next(error);
    }
  });

  const contextGuard = (req, res, next) => enforceUnambiguousTenantContext(pool, req, res, next);
  router.use("/connect/api", contextGuard);
  router.use("/me/connections", contextGuard);

  // Canonical customer-facing read model across user app connections and managed systems.
  router.get("/connect/api/connections/lifecycle", async (req, res, next) => {
    try {
      if (!req.auth?.tenant_id) {
        return res.json({ ok: true, items: [], counts: { total: 0 }, workspace_required: true, secrets_included: false });
      }
      const lifecycle = await unifiedConnectionLifecycle(pool, req.auth.user_id, req.auth.tenant_id);
      return res.json({
        ok: true,
        tenant_id: req.auth.tenant_id,
        ...lifecycle,
        lifecycle_contract: "mad4b.tenant-connection-lifecycle.v1",
        secrets_included: false,
      });
    } catch (error) {
      next(error);
    }
  });

  // Product bridge: register the exact Staging WordPress MCP federation as a credentialless connection.
  router.post("/connect/api/wordpress-mcp/prepare", async (req, res, next) => {
    try {
      if (!req.auth?.tenant_id) {
        return res.status(409).json({ ok: false, error: { code: "workspace_required", message: "Select a workspace before connecting WordPress MCP." }, secrets_included: false });
      }
      const requestedSite = text(req.body?.site_url || WORDPRESS_STAGING_ORIGIN, 512).replace(/\/$/, "");
      if (requestedSite !== WORDPRESS_STAGING_ORIGIN && requestedSite !== WORDPRESS_STAGING_RESOURCE) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "wordpress_mcp_resource_not_allowed",
            message: "This federation profile is Staging-only and bound to the registered WordPress resource.",
          },
          secrets_included: false,
        });
      }

      const [existingRows] = await pool.query(
        `SELECT connection_id, account_metadata
           FROM \`user_app_connections\`
          WHERE user_id = ? AND tenant_id = ? AND app_key = 'mcp' AND mcp_endpoint = ? AND status <> 'revoked'
          ORDER BY connected_at DESC LIMIT 1`,
        [req.auth.user_id, req.auth.tenant_id, WORDPRESS_STAGING_RESOURCE]
      );
      const existing = existingRows?.[0] || null;
      const connectionId = existing?.connection_id || randomUUID();
      const metadata = {
        ...safeObject(existing?.account_metadata),
        federation_profile: "wordpress_staging_mcp_rs256_v1",
        wordpress_origin: WORDPRESS_STAGING_ORIGIN,
        authorization_server: WORDPRESS_STAGING_ISSUER,
        protected_resource: WORDPRESS_STAGING_RESOURCE,
        protected_resource_metadata: WORDPRESS_STAGING_RESOURCE_METADATA,
        authorization_server_metadata: WORDPRESS_STAGING_AUTHORIZATION_METADATA,
        required_scope: "mad4b:read",
        credential_storage: "none_external_bearer",
        subject_binding_required: true,
        subject_binding_verified: false,
        live_oauth_canary_verified: false,
      };

      if (existing) {
        await pool.query(
          `UPDATE \`user_app_connections\`
              SET display_label = 'WordPress Staging MCP',
                  auth_type = 'mcp',
                  encrypted_credentials = NULL,
                  account_label = 'staging.egypttourgates.com',
                  account_metadata = ?,
                  validation_status = 'pending_validation',
                  status = 'active'
            WHERE connection_id = ? AND user_id = ? AND tenant_id = ?`,
          [JSON.stringify(metadata), connectionId, req.auth.user_id, req.auth.tenant_id]
        );
      } else {
        await pool.query(
          `INSERT INTO \`user_app_connections\`
             (connection_id, user_id, tenant_id, app_key, display_label, auth_type,
              encrypted_credentials, account_label, account_metadata, mcp_endpoint,
              is_primary, status, validation_status)
           VALUES (?, ?, ?, 'mcp', 'WordPress Staging MCP', 'mcp', NULL,
                   'staging.egypttourgates.com', ?, ?, 1, 'active', 'pending_validation')`,
          [connectionId, req.auth.user_id, req.auth.tenant_id, JSON.stringify(metadata), WORDPRESS_STAGING_RESOURCE]
        );
      }

      return res.status(existing ? 200 : 201).json({
        ok: true,
        connection_id: connectionId,
        app_key: "mcp",
        federation_profile: metadata.federation_profile,
        lifecycle_state: "active_pending_validation",
        authorization_server: WORDPRESS_STAGING_ISSUER,
        protected_resource: WORDPRESS_STAGING_RESOURCE,
        protected_resource_metadata: WORDPRESS_STAGING_RESOURCE_METADATA,
        subject_binding_required: true,
        credentials_stored: false,
        next_action: "validate_wordpress_mcp_federation",
        secrets_included: false,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/connect/api/wordpress-mcp/validate", async (req, res, next) => {
    try {
      const connectionId = text(req.body?.connection_id, 64);
      const [rows] = await pool.query(
        `SELECT connection_id, account_metadata
           FROM \`user_app_connections\`
          WHERE connection_id = ? AND user_id = ? AND tenant_id = ?
            AND app_key = 'mcp' AND mcp_endpoint = ? AND status = 'active'
          LIMIT 1`,
        [connectionId, req.auth.user_id, req.auth.tenant_id, WORDPRESS_STAGING_RESOURCE]
      );
      const connection = rows?.[0] || null;
      if (!connection) {
        return res.status(404).json({ ok: false, error: { code: "wordpress_mcp_connection_not_found", message: "WordPress MCP connection was not found for this tenant user." }, secrets_included: false });
      }

      const readback = await validateWordpressStagingFederation(fetchImpl);
      const metadata = {
        ...safeObject(connection.account_metadata),
        metadata_ready: readback.metadata_ready,
        subject_binding_verified: false,
        live_oauth_canary_verified: false,
        last_readback_blockers: readback.blockers,
        last_readback_at: new Date().toISOString(),
      };
      const validationStatus = readback.metadata_ready
        ? "metadata_validated_subject_pending"
        : "pending_validation";
      await pool.query(
        `UPDATE \`user_app_connections\`
            SET validation_status = ?, account_metadata = ?, last_validated_at = NOW()
          WHERE connection_id = ? AND user_id = ? AND tenant_id = ?`,
        [validationStatus, JSON.stringify(metadata), connectionId, req.auth.user_id, req.auth.tenant_id]
      );
      return res.status(readback.metadata_ready ? 200 : 202).json({
        ok: true,
        connection_id: connectionId,
        validation_status: validationStatus,
        lifecycle_state: readback.metadata_ready ? "active_pending_validation" : "needs_attention",
        ...readback,
        next_action: readback.metadata_ready
          ? "complete_subject_binding_and_live_oauth_canary"
          : "deploy_or_repair_staging_federation_then_retry",
        secrets_included: false,
      });
    } catch (error) {
      next(error);
    }
  });

  // Canonical disconnect: revoke every derivative authority before zeroing credentials.
  router.delete("/connect/api/connections/:connection_id", async (req, res, next) => {
    try {
      const result = await withTransaction(pool, (db) => revokeConnectionCascade(db, {
        connectionId: req.params.connection_id,
        userId: req.auth.user_id,
        tenantId: req.auth.tenant_id,
      }));
      if (!result) {
        return res.status(404).json({ ok: false, error: { code: "tenant_connection_not_found", message: "Connection was not found for this tenant user." }, secrets_included: false });
      }
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  for (const contract of TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS) {
    const method = String(contract.method || "GET").toLowerCase();
    const path = expressPath(contract.path);
    if (typeof router[method] !== "function") {
      throw new Error(`tenant_connection_self_repair_method_unsupported:${contract.method}`);
    }

    router[method](path, async (req, res, next) => {
      try {
        const [toolRows] = await pool.query(
          `SELECT tool_key, is_enabled
             FROM \`tenant_platform_endpoint_tools\`
            WHERE tool_key = ?
            LIMIT 1`,
          [contract.tool_key]
        );
        const tool = toolRows?.[0] || null;

        if (!tool || Number(tool.is_enabled || 0) !== 1) {
          return res.status(503).json(disabledEnvelope(contract.tool_key));
        }

        const [connectionRows] = await pool.query(
          `SELECT connection_id, app_key, auth_type, status, validation_status
             FROM \`user_app_connections\`
            WHERE connection_id = ?
              AND user_id = ?
              AND tenant_id = ?
              AND status <> 'revoked'
            LIMIT 1`,
          [req.params.connection_id, req.auth?.user_id, req.auth?.tenant_id]
        );
        const connection = connectionRows?.[0] || null;
        if (!connection) {
          return res.status(404).json({
            ok: false,
            error: {
              code: "tenant_connection_not_found",
              message: "Connection was not found for the authenticated tenant user.",
            },
            secrets_included: false,
          });
        }

        return res.status(501).json({
          ok: false,
          error: {
            code: "tenant_connection_self_repair_handler_not_implemented",
            message: "The capability route is registered but its governed handler is not activated.",
            details: {
              tool_key: contract.tool_key,
              connection_id: connection.connection_id,
              provider_write_performed: false,
            },
          },
          secrets_included: false,
        });
      } catch (err) {
        next(err);
      }
    });
  }

  router.use(["/connect/api", "/me/connections"], (err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: {
        code: err?.code || "tenant_connection_lifecycle_route_failed",
        message: err?.message || "Tenant connection lifecycle route failed.",
      },
      secrets_included: false,
    });
  });

  return router;
}
