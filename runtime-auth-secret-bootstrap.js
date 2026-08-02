const { createHash } = require("node:crypto");

const USER_JWT_SECRET_ENV_KEYS = Object.freeze([
  "JWT_SECRET",
  "USER_JWT_SECRET",
  "AUTH_JWT_SECRET",
]);
const USER_JWT_DERIVATION_CONTEXT = "mad4b:user-jwt-secret:v1";

function cleanSecret(value) {
  return String(value || "").trim();
}

function deriveBackendBoundJwtSecret(backendApiKey) {
  const normalized = cleanSecret(backendApiKey);
  if (!normalized) return "";
  return createHash("sha256")
    .update(USER_JWT_DERIVATION_CONTEXT, "utf8")
    .update("\0", "utf8")
    .update(normalized, "utf8")
    .digest("hex");
}

function resolveRuntimeAuthSecret(env = process.env) {
  for (const key of USER_JWT_SECRET_ENV_KEYS) {
    const secret = cleanSecret(env?.[key]);
    if (secret) {
      return {
        configured: true,
        secret,
        source: key,
        derived: false,
      };
    }
  }

  const derivedSecret = deriveBackendBoundJwtSecret(env?.BACKEND_API_KEY);
  if (derivedSecret) {
    return {
      configured: true,
      secret: derivedSecret,
      source: "BACKEND_API_KEY_DERIVED",
      derived: true,
    };
  }

  return {
    configured: false,
    secret: "",
    source: "unavailable",
    derived: false,
  };
}

function bootstrapRuntimeAuthSecrets(env = process.env) {
  const resolved = resolveRuntimeAuthSecret(env);
  if (resolved.configured && !cleanSecret(env.JWT_SECRET)) {
    env.JWT_SECRET = resolved.secret;
  }
  return {
    configured: resolved.configured,
    source: resolved.source,
    derived: resolved.derived,
    canonical_env_populated: Boolean(cleanSecret(env.JWT_SECRET)),
    secrets_included: false,
  };
}

module.exports = {
  USER_JWT_SECRET_ENV_KEYS,
  bootstrapRuntimeAuthSecrets,
  deriveBackendBoundJwtSecret,
  resolveRuntimeAuthSecret,
};
