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

export function verifyUserJwtAuthorization(
  authorization,
  {
    env = process.env,
    verifyToken = jwt.verify,
    algorithms = USER_JWT_ALLOWED_ALGORITHMS,
    issuer = null,
    audience = null,
    requiredPurpose = null,
    requiredScope = null,
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
    const verifyOptions = { algorithms: [...algorithms] };
    if (issuer) verifyOptions.issuer = issuer;
    if (audience) verifyOptions.audience = audience;
    const claims = verifyToken(token, secret, verifyOptions);
    const userId = String(claims?.user_id || "").trim();
    if (!claims || typeof claims !== "object" || !userId) {
      return authFailure(401, "user_jwt_required", "Sign in required.");
    }
    if (requiredPurpose && claims.purpose !== requiredPurpose) {
      return authFailure(403, "wrong_user_token_class", "This token is not valid for the requested user authority.");
    }
    if (requiredScope) {
      const scopes = String(claims.scope || "").split(/\s+/u).filter(Boolean);
      if (!scopes.includes(requiredScope)) {
        return authFailure(403, "wrong_user_token_scope", "This token does not grant the required user scope.");
      }
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
