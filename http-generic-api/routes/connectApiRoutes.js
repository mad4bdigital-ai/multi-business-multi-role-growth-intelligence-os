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

export function buildConnectApiRoutes(deps = {}) {
  const router = Router();
  const pool = deps.pool || { query: (...args) => getPool().query(...args) };
  const encrypt = deps.encryptCredentials || encryptCredentials;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;

  router.use("/connect/api", requireUserJwt);

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
      const [rows] = await pool.query(
        `SELECT connection_id, app_key, auth_type, display_label, status,
                validation_status, last_validated_at, created_at, updated_at
           FROM \`user_app_connections\`
          WHERE user_id = ?
            AND tenant_id = ?
            AND status <> 'deleted'
          ORDER BY updated_at DESC`,
        [req.auth.user_id, req.auth.tenant_id]
      );
      res.json({ ok: true, items: rows || [] });
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
      res.json({ ok: true, status: result?.affectedRows ? "approved" : "not_modified" });
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
      await pool.query(
        `UPDATE \`user_app_connections\`
            SET status = 'revoked',
                encrypted_credentials = NULL,
                updated_at = NOW()
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

  return router;
}
