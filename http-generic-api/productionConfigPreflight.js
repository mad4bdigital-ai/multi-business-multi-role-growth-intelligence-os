import { createHash } from "node:crypto";

const MIN_SECRET_LENGTH = 32;
const PRODUCTION_BRANCH = "Production";
const REQUIRED_TRUSTED_INGRESS_FLAGS = [
  "REMOTE_MCP_TRUST_PROXY_HOST_HEADERS",
  "REMOTE_MCP_TRUSTED_INGRESS_ATTESTED",
  "REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS",
];
const REQUIRED_CONTROL_PLANE_WRITE_DB_KEYS = [
  "CONTROL_PLANE_WRITE_DB_HOST",
  "CONTROL_PLANE_WRITE_DB_NAME",
  "CONTROL_PLANE_WRITE_DB_USER",
  "CONTROL_PLANE_WRITE_DB_PASSWORD",
];

function text(value) {
  return String(value ?? "").trim();
}

function enabled(value) {
  return ["true", "1", "yes"].includes(text(value).toLowerCase());
}

function secretEvidence(key, value) {
  const normalized = text(value);
  return {
    key,
    present: Boolean(normalized),
    length: normalized.length,
    min_length: MIN_SECRET_LENGTH,
    length_ok: normalized.length >= MIN_SECRET_LENGTH,
    sha256_prefix: normalized ? createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 12) : null,
    secrets_included: false,
  };
}

function checkBooleanFlag(env, key, errors) {
  const value = text(env[key]);
  const ok = enabled(value);
  if (!ok) errors.push(`${key}=true is required for Production trusted ingress.`);
  return { key, configured: Boolean(value), enabled: ok, required: true };
}

export function evaluateProductionConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const environment = text(env.RUNTIME_ENV || env.NODE_ENV).toLowerCase() || "unknown";
  const branch = text(env.RELEASE_TRIGGER_DEPLOYMENT_BRANCH || env.ACTIVATION_GITHUB_BRANCH || PRODUCTION_BRANCH).replace(/^refs\/heads\//, "");

  const secrets = [
    secretEvidence("JWT_SECRET", env.JWT_SECRET),
    secretEvidence("TENANT_GPT_SSO_SIGNING_SECRET", env.TENANT_GPT_SSO_SIGNING_SECRET),
  ];
  for (const item of secrets) {
    if (!item.present) errors.push(`${item.key} is missing.`);
    else if (!item.length_ok) errors.push(`${item.key} must be at least ${MIN_SECRET_LENGTH} characters.`);
  }
  if (secrets.every((item) => item.present) && secrets[0].sha256_prefix === secrets[1].sha256_prefix) {
    errors.push("JWT_SECRET and TENANT_GPT_SSO_SIGNING_SECRET must be distinct.");
  }

  const trustedIngress = REQUIRED_TRUSTED_INGRESS_FLAGS.map((key) => checkBooleanFlag(env, key, errors));
  if (branch !== PRODUCTION_BRANCH) {
    errors.push(`Production deployment branch must be ${PRODUCTION_BRANCH}; received ${branch || "missing"}.`);
  }

  const queueWorkerEnabled = enabled(env.QUEUE_WORKER_ENABLED);
  const queue = {
    worker_enabled: queueWorkerEnabled,
    redis_configured: Boolean(text(env.REDIS_URL)),
    required: queueWorkerEnabled,
    status: queueWorkerEnabled && !text(env.REDIS_URL) ? "invalid" : queueWorkerEnabled ? "ready" : "disabled",
  };
  if (queueWorkerEnabled && !queue.redis_configured) errors.push("REDIS_URL is required when QUEUE_WORKER_ENABLED=true.");
  if (!queueWorkerEnabled && !queue.redis_configured) warnings.push("Queue workers are disabled because REDIS_URL is not configured.");

  const controlPlaneWriteEnabled = enabled(env.CONTROL_PLANE_WRITE_AUTHORITY_ENABLED);
  const missingControlPlaneKeys = controlPlaneWriteEnabled
    ? REQUIRED_CONTROL_PLANE_WRITE_DB_KEYS.filter((key) => !text(env[key]))
    : [];
  if (missingControlPlaneKeys.length) errors.push(`Control Plane write authority is enabled but missing: ${missingControlPlaneKeys.join(", ")}.`);
  if (controlPlaneWriteEnabled && text(env.CONTROL_PLANE_WRITE_DB_USER) === text(env.DB_USER)) {
    errors.push("CONTROL_PLANE_WRITE_DB_USER must be distinct from DB_USER.");
  }
  if (!controlPlaneWriteEnabled) warnings.push("Control Plane write authority is disabled; dynamic audit and OpenAPI inventory may remain degraded.");
  const controlPlaneWrite = {
    enabled: controlPlaneWriteEnabled,
    missing_keys: missingControlPlaneKeys,
    dedicated_identity: controlPlaneWriteEnabled && text(env.CONTROL_PLANE_WRITE_DB_USER) !== text(env.DB_USER),
    status: controlPlaneWriteEnabled ? (missingControlPlaneKeys.length ? "invalid" : "configured") : "disabled",
  };

  const oauthClientSecret = secretEvidence("TENANT_GPT_OAUTH_CLIENT_SECRET", env.TENANT_GPT_OAUTH_CLIENT_SECRET);
  const oauthClientCompatConfigured = text(env.TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED);
  const oauthClient = {
    client_id: text(env.TENANT_GPT_OAUTH_CLIENT_ID || "mad4b-tenant-gpt"),
    confidential_compat_enabled: oauthClientCompatConfigured ? enabled(oauthClientCompatConfigured) : true,
    confidential_compat_source: oauthClientCompatConfigured ? "environment" : "canonical_client_default",
    env_secret: oauthClientSecret,
    secret_source: oauthClientSecret.present ? "server_env" : "platform_runtime_config_or_env",
    secrets_included: false,
  };
  if (oauthClient.confidential_compat_enabled && !oauthClientSecret.present) {
    warnings.push("TENANT_GPT_OAUTH_CLIENT_SECRET is not present in process.env; the governed platform secret source must be verified separately.");
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? "blocked" : warnings.length ? "ready_with_warnings" : "ready",
    environment,
    branch,
    secrets,
    trusted_ingress: trustedIngress,
    queue,
    control_plane_write: controlPlaneWrite,
    oauth_client: oauthClient,
    errors,
    warnings,
    secrets_included: false,
  };
}

export function assertProductionConfigReady(env = process.env) {
  const result = evaluateProductionConfig(env);
  if (!result.ok) {
    const error = new Error("Production configuration preflight failed.");
    error.code = "PRODUCTION_CONFIG_PREFLIGHT_FAILED";
    error.details = result;
    throw error;
  }
  return result;
}
