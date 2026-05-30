/**
 * User-safe /connect/api/* routes.
 *
 * Mount behind user JWT/session auth. Do not expose these with BACKEND_API_KEY-only
 * access to browsers — the backend key would let any caller create user-owned
 * connections, defeating the per-user ownership contract.
 */
import { Router } from "express";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  assessHybridIntegrationReadiness,
  hybridIntegrationCatalog,
  upsertTenantIntegrationPolicies,
} from "../hybridIntegrationPolicy.js";
import { getPool } from "../db.js";
import { encryptCredentials } from "../tokenEncryption.js";
import {
  createWordPressAccountClaim,
  toErrorEnvelope,
} from "../cmsAccountClaimResolver.js";

function verifyUserJwt(authorization) {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  try {
    const token = authorization.slice(7);
    return jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
  } catch {
    return null;
  }
}

function requireUserJwt(req, res, next) {
  if (req.auth?.mode === "user_jwt") return next();
  const payload = verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({
      ok: false,
      error: { code: "user_jwt_required", message: "Sign in required." },
    });
  }
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id, is_admin: false };
  return next();
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function clampTtlMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(parsed, 1), 24 * 60);
}

function absoluteBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "auth.mad4b.com").split(",")[0].trim();
  return `${proto}://${host}`;
}

function defaultCredentialSchema(authType) {
  if (authType === "api_key") return { fields: [
    { name: "api_key", label: "API key", type: "password", target: "credentials", required: true, secret: true },
    { name: "api_base_url", label: "API base URL", type: "url", target: "connection", required: false, secret: false },
  ] };
  if (authType === "bearer_token") return { fields: [
    { name: "bearer_token", label: "Bearer token", type: "password", target: "credentials", required: true, secret: true },
    { name: "api_base_url", label: "API base URL", type: "url", target: "connection", required: false, secret: false },
  ] };
  if (authType === "basic_auth") return { fields: [
    { name: "username", label: "Username", type: "text", target: "credentials", required: true, secret: false },
    { name: "password", label: "Password", type: "password", target: "credentials", required: true, secret: true },
    { name: "api_base_url", label: "API base URL", type: "url", target: "connection", required: false, secret: false },
  ] };
  if (authType === "mcp") return { fields: [
    { name: "mcp_endpoint", label: "MCP endpoint URL", type: "url", target: "connection", required: true, secret: false },
    { name: "mcp_bearer", label: "MCP bearer/API key", type: "password", target: "credentials", required: true, secret: true },
  ] };
  if (authType === "webhook") return { fields: [
    { name: "webhook_url", label: "Webhook URL", type: "url", target: "connection", required: true, secret: false },
    { name: "webhook_secret", label: "Webhook secret", type: "password", target: "credentials", required: false, secret: true },
  ] };
  if (authType === "custom_headers") return { fields: [
    { name: "header_name", label: "Header name", type: "text", target: "metadata", required: true, secret: false },
    { name: "header_value", label: "Header value", type: "password", target: "credentials", required: true, secret: true },
    { name: "api_base_url", label: "API base URL", type: "url", target: "connection", required: false, secret: false },
  ] };
  return { fields: [] };
}

function normalizeCredentialSchema(authType, requestedSchema) {
  if (requestedSchema && typeof requestedSchema === "object") return requestedSchema;
  return defaultCredentialSchema(authType);
}

async function resolveActiveTenantId(pool, userId) {
  if (!userId) return null;
  const [rows] = await pool.query(
    `SELECT tenant_id
       FROM \`memberships\`
      WHERE user_id = ? AND status = 'active'
      ORDER BY granted_at ASC
      LIMIT 1`,
    [userId]
  );
  return rows?.[0]?.tenant_id || null;
}

export function buildConnectApiRoutes(deps = {}) {
  const router = Router();
  const pool = deps.pool || { query: (...args) => getPool().query(...args) };
  const encrypt = deps.encryptCredentials || encryptCredentials;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;

  router.use("/connect/api", requireUserJwt);
  router.use("/connect/api", async (req, _res, next) => {
    try {
      if (!req.auth?.tenant_id && req.auth?.user_id) {
        req.auth.tenant_id = await resolveActiveTenantId(pool, req.auth.user_id);
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  // GET /connect/api/app-integrations — discover apps the user can connect.
  router.get("/connect/api/app-integrations", async (_req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT app_key, display_name, category, auth_type, status
           FROM \`app_integrations\`
          WHERE status = 'active'
          ORDER BY display_name ASC`
      );
      res.json({ ok: true, items: rows || [] });
    } catch (err) {
      next(err);
    }
  });

  // GET /connect/api/connections — list user's own connections (no secrets).
  router.get("/connect/api/connections", async (req, res, next) => {
    try {
      if (!req.auth.tenant_id) {
        return res.json({
          ok: true,
          items: [],
          workspace_required: true,
          next_actions: ["connect_workspace_create", "connect_escalate"],
        });
      }
      const [rows] = await pool.query(
        `SELECT connection_id, app_key, auth_type, display_label, status,
                validation_status, last_validated_at,
                connected_at AS created_at,
                COALESCE(last_used_at, last_validated_at, connected_at) AS updated_at
           FROM \`user_app_connections\`
          WHERE user_id = ?
            AND tenant_id = ?
            AND status <> 'revoked'
          ORDER BY COALESCE(last_used_at, last_validated_at, connected_at) DESC`,
        [req.auth.user_id, req.auth.tenant_id]
      );
      res.json({ ok: true, items: rows || [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /connect/api/integration-policy — update per-app managed/dedicated source modes.
  router.post("/connect/api/integration-policy", async (req, res, next) => {
    try {
      const integrationModes = req.body?.integration_modes || {};
      if (!integrationModes || typeof integrationModes !== "object" || Array.isArray(integrationModes) || !Object.keys(integrationModes).length) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "integration_modes_required",
            message: "integration_modes object is required. Example: { cloudflare: 'dedicated', google_drive: 'managed' }.",
          },
        });
      }

      const result = await upsertTenantIntegrationPolicies({
        tenantId: req.auth.tenant_id,
        userId: req.auth.user_id,
        integrationModes,
        source: "connect_api_policy_update",
      });
      const [connectionRows] = await pool.query(
        `SELECT * FROM \`tenant_connections\` WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [req.auth.tenant_id]
      );
      const readiness = await assessHybridIntegrationReadiness({
        tenantId: req.auth.tenant_id,
        userId: req.auth.user_id,
        connection: connectionRows?.[0] || null,
      });
      return res.json({
        ok: true,
        update: result,
        hybrid_integration_catalog: hybridIntegrationCatalog(),
        hybrid_integration_readiness: readiness,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /connect/api/credential-intake/sessions — create a short-lived secure secret-entry link.
  router.post("/connect/api/credential-intake/sessions", async (req, res, next) => {
    try {
      const {
        app_key,
        auth_type,
        display_label,
        mcp_endpoint,
        webhook_url,
        api_base_url,
        workspace_id,
        credential_schema,
        metadata,
        expires_in_minutes,
      } = req.body || {};

      if (!app_key || !auth_type) {
        return res.status(400).json({ ok: false, error: { code: "missing_required_fields", message: "app_key and auth_type are required." } });
      }

      const [apps] = await pool.query(
        `SELECT app_key, display_name, auth_type, status
           FROM \`app_integrations\`
          WHERE app_key = ? AND status IN ('active','beta')
          LIMIT 1`,
        [app_key]
      );
      const app = apps?.[0];
      if (!app) return res.status(404).json({ ok: false, error: { code: "app_not_found", message: `App ${app_key} was not found.` } });
      if (app.auth_type !== auth_type) {
        return res.status(400).json({ ok: false, error: { code: "auth_type_mismatch", message: `App ${app_key} expects auth_type ${app.auth_type}.` } });
      }
      if (auth_type === "oauth2") {
        return res.status(400).json({ ok: false, error: { code: "oauth_flow_required", message: "OAuth apps must use their authorization flow, not manual credential intake." } });
      }

      const sessionId = randomUUID();
      const token = randomToken();
      const tokenHash = sha256(token);
      const ttl = clampTtlMinutes(expires_in_minutes);
      const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString().slice(0, 19).replace("T", " ");
      const schema = normalizeCredentialSchema(auth_type, credential_schema || null);

      await pool.query(
        `INSERT INTO credential_intake_sessions
           (session_id, token_hash, user_id, tenant_id, app_key, auth_type, display_label,
            mcp_endpoint, webhook_url, api_base_url, workspace_id, credential_schema_json,
            metadata_json, status, expires_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
        [
          sessionId,
          tokenHash,
          req.auth.user_id,
          req.auth.tenant_id,
          app_key,
          auth_type,
          display_label || null,
          mcp_endpoint || null,
          webhook_url || null,
          api_base_url || null,
          workspace_id || null,
          JSON.stringify(schema),
          JSON.stringify({ ...((metadata && typeof metadata === "object" && !Array.isArray(metadata)) ? metadata : {}), source: "connect_api_user_jwt" }),
          expiresAt,
          req.auth.user_id,
        ]
      );

      const intakeUrl = `${absoluteBaseUrl(req)}/credential-intake/${encodeURIComponent(token)}`;
      return res.status(201).json({
        ok: true,
        session_id: sessionId,
        intake_url: intakeUrl,
        expires_at: expiresAt,
        app_key,
        auth_type,
        secret_exposed: false,
        next_action: "open_intake_url_and_submit_credentials",
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /connect/api/cms/claims — verify WordPress credentials + create claim.
  router.post("/connect/api/cms/claims", async (req, res) => {
    try {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "user_id")) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "user_id must come from the authenticated session, not the request body.",
            details: [{ field: "user_id", issue: "forbidden_body_field" }],
          },
        });
      }

      const result = await createWordPressAccountClaim({
        db: pool,
        fetchImpl,
        encryptCredentials: encrypt,
        tenantId: req.auth.tenant_id,
        userId: req.auth.user_id,
        siteUrl: req.body?.site_url,
        username: req.body?.username,
        applicationPassword: req.body?.application_password,
        requestedScope: req.body?.requested_scope || "personal",
      });

      return res.status(201).json({ ok: true, ...result });
    } catch (err) {
      const envelope = toErrorEnvelope(err, null);
      return res.status(envelope.status).json({ ok: false, ...envelope.body });
    }
  });

  // GET /connect/api/cms/claims — list user's claims (no secret fields).
  router.get("/connect/api/cms/claims", async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT claim_id, connection_id, app_key, site_url, wp_json_base,
                normalized_domain, claimed_username, claimed_email, cms_user_id,
                cms_roles_json, matched_brand_key, matched_target_key,
                match_confidence, verification_status, requested_scope,
                approval_required, approved_by, approved_at, created_at, updated_at
           FROM \`cms_account_claims\`
          WHERE user_id = ?
            AND tenant_id = ?
          ORDER BY created_at DESC`,
        [req.auth.user_id, req.auth.tenant_id]
      );
      res.json({ ok: true, items: rows || [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /connect/api/cms/claims/:claim_id/approve — owner/admin approves sharing.
  router.post("/connect/api/cms/claims/:claim_id/approve", async (req, res, next) => {
    try {
      const [claims] = await pool.query(
        `SELECT claim_id, tenant_id, user_id, connection_id, matched_target_key, normalized_domain, requested_scope, verification_status
           FROM \`cms_account_claims\`
          WHERE claim_id = ?
            AND tenant_id = ?
          LIMIT 1`,
        [req.params.claim_id, req.auth.tenant_id]
      );
      const claim = claims?.[0];
      if (!claim) return res.status(404).json({ ok: false, error: { code: "cms_claim_not_found", message: "CMS claim was not found." }, secrets_included: false });

      const [result] = await pool.query(
        `UPDATE \`cms_account_claims\`
            SET verification_status = 'approved',
                approved_by = ?,
                approved_at = NOW(),
                updated_at = NOW()
          WHERE claim_id = ?
            AND tenant_id = ?
            AND verification_status IN ('verified', 'pending')`,
        [req.auth.user_id, req.params.claim_id, req.auth.tenant_id]
      );

      let grantPromotion = null;
      if (result?.affectedRows) {
        const [grantRows] = await pool.query(
          `SELECT grant_id, site_id, scope, status
             FROM \`cms_site_access_grants\`
            WHERE claim_id = ?
              AND tenant_id = ?
            ORDER BY updated_at DESC
            LIMIT 1`,
          [req.params.claim_id, req.auth.tenant_id]
        );
        const grant = grantRows?.[0] || null;
        if (grant) {
          await pool.query(
            `UPDATE \`cms_site_access_grants\`
                SET status = 'active',
                    approved_by = ?,
                    approved_at = NOW(),
                    updated_at = NOW()
              WHERE grant_id = ?
                AND tenant_id = ?`,
            [req.auth.user_id, grant.grant_id, req.auth.tenant_id]
          );
          grantPromotion = {
            grant_id: grant.grant_id,
            site_id: grant.site_id,
            scope: grant.scope,
            status: "active",
            secrets_included: false,
          };
        }
      }

      let grantPromotion = null;
      if (result?.affectedRows) {
        const [grantRows] = await pool.query(
          `SELECT grant_id, site_id, scope, status
             FROM \`cms_site_access_grants\`
            WHERE claim_id = ?
              AND tenant_id = ?
            ORDER BY updated_at DESC
            LIMIT 1`,
          [req.params.claim_id, req.auth.tenant_id]
        );
        const grant = grantRows?.[0] || null;
        if (grant) {
          await pool.query(
            `UPDATE \`cms_site_access_grants\`
                SET status = 'active',
                    approved_by = ?,
                    approved_at = NOW(),
                    updated_at = NOW()
              WHERE grant_id = ?
                AND tenant_id = ?`,
            [req.auth.user_id, grant.grant_id, req.auth.tenant_id]
          );
          grantPromotion = {
            grant_id: grant.grant_id,
            site_id: grant.site_id,
            scope: grant.scope,
            status: "active",
            secrets_included: false,
          };
        }
      }

      let promotion = null;
      if (result?.affectedRows && claim.connection_id) {
        const targetKey = claim.matched_target_key || claim.normalized_domain;
        const credentialRef = `user_app_connection:${claim.connection_id}:encrypted_credentials.application_password`;
        const [existing] = await pool.query(
          `SELECT binding_id
             FROM \`credential_bindings\`
            WHERE tenant_id = ?
              AND owner_type = 'tenant'
              AND owner_id = ?
              AND user_id IS NULL
              AND connection_id IS NULL
              AND target_key = ?
              AND credential_role = 'wordpress_app_password'
              AND credential_ref = ?
            ORDER BY updated_at DESC
            LIMIT 1`,
          [claim.tenant_id, claim.tenant_id, targetKey, credentialRef]
        );
        const bindingId = existing?.[0]?.binding_id || randomUUID();
        if (existing?.[0]?.binding_id) {
          await pool.query(
            `UPDATE \`credential_bindings\`
                SET provider_family = 'wordpress',
                    connector_family = 'wordpress_rest',
                    resolution_priority = 20,
                    status = 'active',
                    updated_at = NOW()
              WHERE binding_id = ?`,
            [bindingId]
          );
        } else {
          await pool.query(
            `INSERT INTO \`credential_bindings\` (
               binding_id, tenant_id, owner_type, owner_id, user_id, system_id, installation_id, connection_id,
               action_key, target_key, credential_role, credential_ref, provider_family, connector_family,
               resolution_priority, status, created_by, created_at, updated_at
             ) VALUES (?, ?, 'tenant', ?, NULL, NULL, NULL, NULL, NULL, ?, 'wordpress_app_password', ?, 'wordpress', 'wordpress_rest', 20, 'active', ?, NOW(), NOW())`,
            [bindingId, claim.tenant_id, claim.tenant_id, targetKey, credentialRef, `cms_claim_approval:${req.auth.user_id}`]
          );
        }
        promotion = {
          binding_id: bindingId,
          target_key: targetKey,
          credential_role: "wordpress_app_password",
          credential_ref: credentialRef,
          secret_copied: false,
          token_returned: false,
          secrets_included: false,
        };
      }

      res.json({
        ok: true,
        status: result?.affectedRows ? "approved" : "not_modified",
        promotion,
        grant_promotion: grantPromotion,
        secrets_included: false,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /connect/api/cms/claims/:claim_id/reject — owner/admin rejects.
  router.post("/connect/api/cms/claims/:claim_id/reject", async (req, res, next) => {
    try {
      const [result] = await pool.query(
        `UPDATE \`cms_account_claims\`
            SET verification_status = 'rejected',
                approved_by = ?,
                approved_at = NOW(),
                updated_at = NOW()
          WHERE claim_id = ?
            AND tenant_id = ?
            AND verification_status IN ('verified', 'pending')`,
        [req.auth.user_id, req.params.claim_id, req.auth.tenant_id]
      );
      res.json({ ok: true, status: result?.affectedRows ? "rejected" : "not_modified" });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /connect/api/connections/:connection_id — revoke and zero credentials.
  router.delete("/connect/api/connections/:connection_id", async (req, res, next) => {
    try {
      if (!req.auth.tenant_id) {
        return res.status(409).json({
          ok: false,
          error: { code: "workspace_required", message: "Create or select a workspace before revoking app connections." },
        });
      }
      await pool.query(
        `UPDATE \`user_app_connections\`
            SET status = 'revoked',
                encrypted_credentials = NULL,
                last_used_at = NOW()
          WHERE connection_id = ?
            AND user_id = ?
            AND tenant_id = ?`,
        [req.params.connection_id, req.auth.user_id, req.auth.tenant_id]
      );

      await pool.query(
        `UPDATE \`credential_bindings\`
            SET status = 'revoked',
                updated_at = NOW()
          WHERE connection_id = ?
            AND user_id = ?
            AND tenant_id = ?`,
        [req.params.connection_id, req.auth.user_id, req.auth.tenant_id]
      );

      await pool.query(
        `UPDATE \`cms_account_claims\`
            SET verification_status = 'revoked',
                updated_at = NOW()
          WHERE connection_id = ?
            AND user_id = ?
            AND tenant_id = ?`,
        [req.params.connection_id, req.auth.user_id, req.auth.tenant_id]
      );

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.use("/connect/api", (err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: {
        code: err?.code || "connect_api_failed",
        message: err?.message || "Connect API request failed.",
        sql_state: err?.sqlState || undefined,
      },
      secrets_included: false,
    });
  });

  return router;
}
