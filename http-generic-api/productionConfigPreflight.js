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
const REQUIRED_MANAGED_GOOGLE_OAUTH_KEYS = [
  "MANAGED_GOOGLE_OAUTH_CLIENT_ID",
  "MANAGED_GOOGLE_OAUTH_CLIENT_SECRET",
  "MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY",
  "MANAGED_GOOGLE_OAUTH_REDIRECT_URI",
  "MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON",
  "MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON",
];

function text(value) {
  return String(value ?? "").trim();
}

function enabled(value) {
  return ["true", "1", "yes"].includes(text(value).toLowerCase());
}

const MANAGED_GOOGLE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGED_GOOGLE_KEY_ID_RE = /^[A-Za-z0-9._:-]{3,64}$/;

function normalizeManagedGoogleOrigin(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}`;
  } catch {
    return "";
  }
}

function normalizeManagedGoogleCallback(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return "";
    return url.toString();
  } catch {
    return "";
  }
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

  const managedGoogleEnabled = enabled(env.MANAGED_GOOGLE_OAUTH_ENABLED);
  const missingManagedGoogleKeys = managedGoogleEnabled
    ? REQUIRED_MANAGED_GOOGLE_OAUTH_KEYS.filter((key) => !text(env[key]))
    : [];
  if (missingManagedGoogleKeys.length) {
    errors.push(`Managed Google OAuth is enabled but missing: ${missingManagedGoogleKeys.join(", ")}.`);
  }

  const managedGoogleClientSecret = secretEvidence("MANAGED_GOOGLE_OAUTH_CLIENT_SECRET", env.MANAGED_GOOGLE_OAUTH_CLIENT_SECRET);
  const managedGoogleEncryptionKey = secretEvidence("MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY", env.MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY);
  if (managedGoogleEnabled && managedGoogleEncryptionKey.present && !managedGoogleEncryptionKey.length_ok) {
    errors.push(`MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters.`);
  }

  let managedGoogleRedirectValid = false;
  const managedGoogleRedirect = text(env.MANAGED_GOOGLE_OAUTH_REDIRECT_URI);
  if (managedGoogleRedirect) {
    try {
      const url = new URL(managedGoogleRedirect);
      managedGoogleRedirectValid =
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/v1/google/oauth/callback";
    } catch {
      managedGoogleRedirectValid = false;
    }
  }
  if (managedGoogleEnabled && !managedGoogleRedirectValid) {
    errors.push("MANAGED_GOOGLE_OAUTH_REDIRECT_URI must be an exact HTTPS broker callback ending in /v1/google/oauth/callback.");
  }

  let managedGoogleSiteBindingCount = 0;
  let managedGoogleSiteBindingsValid = false;
  let managedGoogleSiteKeyIds = [];
  let managedGoogleSiteBindingErrors = [];
  const managedGoogleBindingsRaw = text(env.MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON);
  if (managedGoogleBindingsRaw) {
    try {
      const parsed = JSON.parse(managedGoogleBindingsRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed.map((row, index) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) {
            managedGoogleSiteBindingErrors.push(`binding[${index}] must be an object`);
            return null;
          }
          const siteUuid = text(row.site_uuid);
          const origin = normalizeManagedGoogleOrigin(row.origin);
          const callbackUri = normalizeManagedGoogleCallback(row.callback_uri);
          const keyId = text(row.key_id);
          const status = text(row.status || "active").toLowerCase();
          if (!MANAGED_GOOGLE_UUID_RE.test(siteUuid)) managedGoogleSiteBindingErrors.push(`binding[${index}].site_uuid invalid`);
          if (!origin) managedGoogleSiteBindingErrors.push(`binding[${index}].origin invalid`);
          if (!callbackUri) managedGoogleSiteBindingErrors.push(`binding[${index}].callback_uri invalid`);
          if (!MANAGED_GOOGLE_KEY_ID_RE.test(keyId)) managedGoogleSiteBindingErrors.push(`binding[${index}].key_id invalid`);
          if (status !== "active") managedGoogleSiteBindingErrors.push(`binding[${index}].status must be active`);
          if (origin && callbackUri) {
            try {
              const callback = new URL(callbackUri);
              const originUrl = new URL(origin);
              if (callback.origin !== originUrl.origin) managedGoogleSiteBindingErrors.push(`binding[${index}] callback origin mismatch`);
            } catch {
              managedGoogleSiteBindingErrors.push(`binding[${index}] URL parsing failed`);
            }
          }
          if (managedGoogleSiteBindingErrors.length) return { site_uuid: siteUuid, origin, callback_uri: callbackUri, key_id: keyId, status };
          return { site_uuid: siteUuid, origin, callback_uri: callbackUri, key_id: keyId, status };
        });
        managedGoogleSiteBindingCount = normalized.length;
        managedGoogleSiteKeyIds = normalized.map((row) => row?.key_id || "");
        const exactBindingKeys = normalized.map((row) => row ? `${row.site_uuid}|\0${row.origin}|\0${row.callback_uri}` : "");
        if (new Set(managedGoogleSiteKeyIds).size !== managedGoogleSiteKeyIds.length) {
          managedGoogleSiteBindingErrors.push("binding key_id values must be unique");
        }
        if (new Set(exactBindingKeys).size !== exactBindingKeys.length) {
          managedGoogleSiteBindingErrors.push("exact site bindings must be unique");
        }
        managedGoogleSiteBindingsValid = managedGoogleSiteBindingErrors.length === 0;
      } else {
        managedGoogleSiteBindingErrors.push("registry must contain at least one binding");
      }
    } catch {
      managedGoogleSiteBindingErrors.push("registry JSON is invalid");
      managedGoogleSiteBindingsValid = false;
    }
  }
  if (managedGoogleEnabled && !managedGoogleSiteBindingsValid) {
    errors.push("MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON must contain only valid, unique, active exact HTTPS site bindings.");
  }

  let managedGoogleSiteSecretsValid = false;
  let managedGoogleSiteSecretKeyCount = 0;
  let managedGoogleSiteSecretEvidence = [];
  const managedGoogleSiteSecretsRaw = text(env.MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON);
  if (managedGoogleSiteSecretsRaw) {
    try {
      const parsed = JSON.parse(managedGoogleSiteSecretsRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed);
        managedGoogleSiteSecretKeyCount = entries.length;
        managedGoogleSiteSecretEvidence = entries.map(([keyId, secret]) => ({
          key_id: text(keyId),
          ...secretEvidence(`MANAGED_GOOGLE_OAUTH_SITE_SECRET:${text(keyId)}`, secret),
        }));
        const registryKeysValid = entries.length > 0 && entries.every(([keyId, secret]) =>
          /^[A-Za-z0-9._:-]{3,64}$/.test(text(keyId)) &&
          text(secret).length >= MIN_SECRET_LENGTH
        );
        const exactBindingCoverage =
          managedGoogleSiteKeyIds.length > 0 &&
          managedGoogleSiteKeyIds.every((keyId) => Object.prototype.hasOwnProperty.call(parsed, keyId));
        managedGoogleSiteSecretsValid = registryKeysValid && exactBindingCoverage;
      }
    } catch {
      managedGoogleSiteSecretsValid = false;
    }
  }
  if (managedGoogleEnabled && !managedGoogleSiteSecretsValid) {
    errors.push("MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON must provide a distinct >=32 character secret for every active site binding key_id.");
  }

  const managedGoogleSecretPrefixes = [
    managedGoogleClientSecret,
    managedGoogleEncryptionKey,
    ...managedGoogleSiteSecretEvidence,
    ...secrets,
  ].filter((item) => item.present).map((item) => item.sha256_prefix);
  if (managedGoogleEnabled && new Set(managedGoogleSecretPrefixes).size !== managedGoogleSecretPrefixes.length) {
    errors.push("Managed Google OAuth client/encryption secrets must be distinct from each other and from platform signing secrets.");
  }

  const managedGoogleOauth = {
    enabled: managedGoogleEnabled,
    required_keys: REQUIRED_MANAGED_GOOGLE_OAUTH_KEYS,
    missing_keys: missingManagedGoogleKeys,
    client_id_present: Boolean(text(env.MANAGED_GOOGLE_OAUTH_CLIENT_ID)),
    client_secret: managedGoogleClientSecret,
    encryption_key: managedGoogleEncryptionKey,
    redirect_uri_present: Boolean(managedGoogleRedirect),
    redirect_uri_valid: managedGoogleRedirectValid,
    site_binding_count: managedGoogleSiteBindingCount,
    site_bindings_valid: managedGoogleSiteBindingsValid,
    site_key_ids: managedGoogleSiteKeyIds,
    site_binding_errors: managedGoogleSiteBindingErrors,
    site_secret_key_count: managedGoogleSiteSecretKeyCount,
    site_secrets_valid: managedGoogleSiteSecretsValid,
    site_secret_evidence: managedGoogleSiteSecretEvidence,
    status: managedGoogleEnabled
      ? (missingManagedGoogleKeys.length || !managedGoogleRedirectValid || !managedGoogleSiteBindingsValid || !managedGoogleSiteSecretsValid || !managedGoogleClientSecret.present || !managedGoogleEncryptionKey.length_ok ? "invalid" : "configured")
      : "disabled",
    secrets_included: false,
  };

  const oauthClientSecret = secretEvidence("TENANT_GPT_OAUTH_CLIENT_SECRET", env.TENANT_GPT_OAUTH_CLIENT_SECRET);
  const oauthClientCompatConfigured = text(env.TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED);
  const oauthClient = {
    client_id: text(env.TENANT_GPT_OAUTH_CLIENT_ID || "mad4b-tenant-gpt"),
    confidential_compat_enabled: oauthClientCompatConfigured ? enabled(oauthClientCompatConfigured) : false,
    confidential_compat_source: oauthClientCompatConfigured ? "environment" : "secure_default_disabled",
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
    managed_google_oauth: managedGoogleOauth,
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
