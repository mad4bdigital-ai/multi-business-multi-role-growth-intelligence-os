import jwt from "jsonwebtoken";
import runtimeAuthSecretBootstrap from "../runtime-auth-secret-bootstrap.js";

export const USER_JWT_ALLOWED_ALGORITHMS = Object.freeze(["HS256"]);

const { resolveRuntimeAuthSecret } = runtimeAuthSecretBootstrap;

function authFailure(status, code, message) {
  return { ok: false, status, code, message };
}

function bearerToken(authorization) {
  const match = String(authorization || "").match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

export function resolveUserJwtSecret(env = process.env) {
  return resolveRuntimeAuthSecret(env).secret;
}

export function resolveUserJwtSecretStatus(env = process.env) {
  const resolved = resolveRuntimeAuthSecret(env);
  return {
    configured: resolved.configured,
    source: resolved.source,
    derived: resolved.derived,
    secrets_included: false,
  };
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
