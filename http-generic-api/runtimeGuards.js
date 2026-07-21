import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { verifyUserJwtAuthorization } from "./userJwtAuth.js";

export function requireEnv(name, value) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function isBackendApiKeyEnabled(env) {
  return Boolean(env?.BACKEND_API_KEY);
}

export function isDebugEnabled(env) {
  return String(env?.EXECUTION_DEBUG || "").toLowerCase() === "true";
}

export function createDebugLog(env) {
  const enabled = isDebugEnabled(env);

  return function debugLog(...args) {
    if (!enabled) return;
    console.log(...args);
  };
}

export function createBackendApiKeyMiddleware(env) {
  const enabled = isBackendApiKeyEnabled(env);
  const expected = env?.BACKEND_API_KEY;

  return async function requireBackendApiKey(req, res, next) {
    if (!enabled) return next();

    const auth = req.headers.authorization || req.header("Authorization") || "";
    const headerApiKey = req.headers["x-api-key"] || req.header("x-api-key") || "";
    const bearerToken = String(auth).match(/^Bearer\s+([^\s]+)$/i)?.[1] || "";
    const apiKeyToken = String(headerApiKey || "");

    if (apiKeyToken) {
      if (apiKeyToken !== expected) {
        return res.status(403).json({
          ok: false,
          error: {
            code: "invalid_backend_api_key",
            message: "Invalid backend API key.",
            status: 403
          }
        });
      }

      req.auth = {
        mode: "backend_api_key",
        principal_type: "admin",
        is_admin: true
      };
      return next();
    }

    if (!bearerToken) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "missing_backend_api_key",
          message: "Missing authentication. Send x-api-key: <BACKEND_API_KEY> for admin/service access, or Authorization: Bearer <USER_JWT> after user sign-in.",
          status: 401
        }
      });
    }

    if (bearerToken === expected) {
      req.auth = {
        mode: "backend_api_key",
        principal_type: "admin",
        is_admin: true
      };
      return next();
    }

    const userJwt = verifyUserJwtAuthorization(auth, { env });
    if (userJwt.ok) {
      const payload = userJwt.claims;
      req.auth = {
        mode: "user_jwt",
        principal_type: "user",
        is_admin: false,
        user_id: payload.user_id || null,
        tenant_id: payload.tenant_id || null,
        email: payload.email || null,
        claims: payload
      };
      return next();
    }

    if (/^pk_[A-Za-z0-9]{8}_[A-Za-z0-9]+$/.test(String(bearerToken || "").trim())) {
      const apiCredential = await resolveApiCredentialAuth(bearerToken).catch(() => null);
      if (apiCredential) {
        req.auth = apiCredential;
        return next();
      }
    }

    if (userJwt.code === "user_jwt_verifier_unavailable") {
      return res.status(503).json({
        ok: false,
        error: {
          code: userJwt.code,
          message: userJwt.message,
          status: 503,
        },
        secrets_included: false,
      });
    }

    return res.status(403).json({
      ok: false,
      error: {
        code: "invalid_auth_token",
        message: "Invalid backend API key or user JWT.",
        status: 403
      }
    });
  };
}

async function resolveApiCredentialAuth(token) {
  const normalized = String(token || "").trim();
  const match = normalized.match(/^pk_([A-Za-z0-9]{8})_[A-Za-z0-9]+$/);
  if (!match) return null;

  const keyPrefix = match[1];
  const keyHash = createHash("sha256").update(normalized).digest("hex");
  const [rows] = await getPool().query(
    `SELECT ac.credential_id, ac.app_id, ac.tenant_id, ac.scopes, da.created_by
       FROM \`api_credentials\` ac
       LEFT JOIN \`developer_apps\` da ON da.app_id = ac.app_id
      WHERE ac.key_prefix = ?
        AND ac.key_hash = ?
        AND ac.status = 'active'
        AND (ac.expires_at IS NULL OR ac.expires_at > NOW())
      LIMIT 1`,
    [keyPrefix, keyHash]
  );
  const credential = rows[0];
  if (!credential) return null;

  await getPool().query(
    "UPDATE `api_credentials` SET last_used_at = NOW() WHERE credential_id = ?",
    [credential.credential_id]
  ).catch(() => {});

  return {
    mode: "api_credential",
    principal_type: "api_client",
    is_admin: false,
    tenant_id: credential.tenant_id,
    user_id: credential.created_by || null,
    app_id: credential.app_id,
    credential_id: credential.credential_id,
    scopes: String(credential.scopes || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
