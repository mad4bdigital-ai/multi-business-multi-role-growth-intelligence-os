import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

export const USER_JWT_ALLOWED_ALGORITHMS = Object.freeze(["HS256"]);

function authFailure(status, code, message) {
  return { ok: false, status, code, message };
}

function bearerToken(authorization) {
  const match = String(authorization || "").match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

export function resolveUserJwtSecret(env = process.env) {
  return String(env?.JWT_SECRET || "").trim();
}

export function issueUserTenantContextJwt(
  {
    userId,
    tenantId,
    email = null,
    role = "member",
    parentExp = null,
    maxTtlSeconds = 60 * 60,
  } = {},
  {
    env = process.env,
    signToken = jwt.sign,
    nowSeconds = Math.floor(Date.now() / 1000),
    newId = randomUUID,
  } = {},
) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedTenantId = String(tenantId || "").trim();
  if (!normalizedUserId || !normalizedTenantId) {
    const error = new Error("Tenant context requires an authenticated user and active tenant.");
    error.code = "tenant_context_identity_required";
    error.status = 401;
    throw error;
  }

  const secret = resolveUserJwtSecret(env);
  if (secret.length < 32) {
    const error = new Error("Tenant context signing authority is unavailable.");
    error.code = "tenant_context_signing_unavailable";
    error.status = 503;
    throw error;
  }

  const configuredMax = Number(maxTtlSeconds);
  const maxTtl = Number.isFinite(configuredMax) && configuredMax > 0 ? Math.floor(configuredMax) : 60 * 60;
  const parsedParentExp = Number(parentExp);
  const parentRemaining = Number.isFinite(parsedParentExp)
    ? Math.max(1, Math.floor(parsedParentExp - nowSeconds))
    : maxTtl;
  const ttlSeconds = Math.max(1, Math.min(maxTtl, parentRemaining));

  return signToken(
    {
      user_id: normalizedUserId,
      tenant_id: normalizedTenantId,
      email: email ? String(email).trim() : undefined,
      purpose: "connect_tenant_context",
      context_role: String(role || "member").trim() || "member",
      context_version: newId(),
    },
    secret,
    { algorithm: "HS256", expiresIn: ttlSeconds, jwtid: newId() },
  );
}

export function verifyUserJwtAuthorization(
  authorization,
  {
    env = process.env,
    verifyToken = jwt.verify,
    algorithms = USER_JWT_ALLOWED_ALGORITHMS,
  } = {},
) {
  const token = bearerToken(authorization);
  if (!token) {
    return authFailure(401, "user_jwt_required", "Sign in required.");
  }

  const secret = resolveUserJwtSecret(env);
  if (!secret) {
    return authFailure(
      503,
      "user_jwt_verifier_unavailable",
      "User authentication is temporarily unavailable.",
    );
  }

  try {
    const claims = verifyToken(token, secret, { algorithms: [...algorithms] });
    const userId = String(claims?.user_id || "").trim();
    if (!claims || typeof claims !== "object" || !userId) {
      return authFailure(401, "user_jwt_required", "Sign in required.");
    }
    return { ok: true, claims: { ...claims, user_id: userId } };
  } catch {
    return authFailure(401, "user_jwt_required", "Sign in required.");
  }
}

export function createUserJwtMiddleware(options = {}) {
  return function requireUserJwt(req, res, next) {
    if (req.auth?.mode === "user_jwt" && String(req.auth.user_id || "").trim()) {
      return next();
    }

    const result = verifyUserJwtAuthorization(req.headers?.authorization, options);
    if (!result.ok) {
      return res.status(result.status).json({
        ok: false,
        error: { code: result.code, message: result.message },
        secrets_included: false,
      });
    }

    const claims = result.claims;
    req.auth = {
      mode: "user_jwt",
      principal_type: "user",
      is_admin: false,
      user_id: claims.user_id,
      tenant_id: claims.tenant_id || null,
      email: claims.email || null,
      claims,
    };
    return next();
  };
}
