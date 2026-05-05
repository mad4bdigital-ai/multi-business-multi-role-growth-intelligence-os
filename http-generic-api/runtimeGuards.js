import jwt from "jsonwebtoken";

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
  const jwtSecret = env?.JWT_SECRET || "development_fallback_secret_only";

  return function requireBackendApiKey(req, res, next) {
    if (!enabled) return next();

    const auth = req.headers.authorization || req.header("Authorization") || "";
    const headerApiKey = req.headers["x-api-key"] || req.header("x-api-key") || "";
    const bearerToken = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
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

    try {
      const payload = jwt.verify(bearerToken, jwtSecret);
      req.auth = {
        mode: "user_jwt",
        principal_type: "user",
        is_admin: false,
        user_id: payload.user_id || null,
        email: payload.email || null,
        claims: payload
      };
      return next();
    } catch {
      return res.status(403).json({
        ok: false,
        error: {
          code: "invalid_auth_token",
          message: "Invalid backend API key or user JWT.",
          status: 403
        }
      });
    }
  };
}
