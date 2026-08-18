import { createHash } from "node:crypto";

export const TENANT_GPT_PKCE_METHOD = "S256";
export const TENANT_GPT_PKCE_VERIFIER_MIN_LENGTH = 43;
export const TENANT_GPT_PKCE_VERIFIER_MAX_LENGTH = 128;
export const TENANT_GPT_PKCE_CHALLENGE_LENGTH = 43;
export const TENANT_GPT_PKCE_MODE = Object.freeze({
  S256: "s256",
  CONFIDENTIAL_CLIENT: "confidential_client",
});

export const TENANT_GPT_PRODUCTION_CLIENT_ID = "mad4b-tenant-gpt";
export const TENANT_GPT_STAGING_CLIENT_ID = "mad4b-tenant-gpt-staging";

function pkceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalized(value, max = TENANT_GPT_PKCE_VERIFIER_MAX_LENGTH) {
  return String(value || "").trim().slice(0, max);
}

function isUnreserved(value) {
  return /^[A-Za-z0-9._~-]+$/u.test(value);
}

function flagEnabled(value, defaultValue = false) {
  const normalizedValue = String(value ?? "").trim().toLowerCase();
  if (!normalizedValue) return defaultValue;
  return normalizedValue === "true" || normalizedValue === "1" || normalizedValue === "yes";
}

export function validateTenantGptPkceChallenge({ codeChallenge, codeChallengeMethod } = {}) {
  const challenge = normalized(codeChallenge);
  const method = String(codeChallengeMethod || "").trim();
  if (!challenge || !method) {
    throw pkceError("oauth_pkce_required", "OAuth PKCE code_challenge and code_challenge_method are required.");
  }
  if (method !== TENANT_GPT_PKCE_METHOD) {
    throw pkceError("oauth_pkce_method_unsupported", "OAuth PKCE requires code_challenge_method=S256.");
  }
  if (challenge.length !== TENANT_GPT_PKCE_CHALLENGE_LENGTH || !isUnreserved(challenge)) {
    throw pkceError("oauth_pkce_challenge_invalid", "OAuth PKCE code_challenge is invalid.");
  }
  return { code_challenge: challenge, code_challenge_method: method };
}

export function validateTenantGptPkceVerifier(codeVerifier) {
  const verifier = normalized(codeVerifier);
  if (
    verifier.length < TENANT_GPT_PKCE_VERIFIER_MIN_LENGTH
    || verifier.length > TENANT_GPT_PKCE_VERIFIER_MAX_LENGTH
    || !isUnreserved(verifier)
  ) {
    throw pkceError("oauth_pkce_verifier_invalid", "OAuth PKCE code_verifier is invalid.");
  }
  return verifier;
}

export function deriveTenantGptPkceChallenge(codeVerifier) {
  const verifier = validateTenantGptPkceVerifier(codeVerifier);
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyTenantGptPkce({ codeChallenge, codeChallengeMethod, codeVerifier } = {}) {
  const expected = validateTenantGptPkceChallenge({ codeChallenge, codeChallengeMethod });
  const actual = deriveTenantGptPkceChallenge(codeVerifier);
  if (actual !== expected.code_challenge) {
    throw pkceError("oauth_pkce_verifier_mismatch", "OAuth PKCE code_verifier does not match the authorization request.");
  }
  return true;
}

function isStagingRuntime(env = process.env) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "staging"
    || String(env.REMOTE_MCP_ENVIRONMENT || "").trim().toLowerCase() === "staging";
}

function resolveExpectedTenantGptClientId(env = process.env) {
  return isStagingRuntime(env)
    ? TENANT_GPT_STAGING_CLIENT_ID
    : TENANT_GPT_PRODUCTION_CLIENT_ID;
}

function resolveConfiguredTenantGptClientId(env = process.env) {
  const configured = isStagingRuntime(env)
    ? env.TENANT_GPT_STAGING_OAUTH_CLIENT_ID
    : env.TENANT_GPT_OAUTH_CLIENT_ID;
  return String(configured || resolveExpectedTenantGptClientId(env)).trim();
}

export function isTenantGptConfidentialActionClient({ clientId, env = process.env } = {}) {
  const normalizedClientId = String(clientId || "").trim();
  const expectedClientId = resolveExpectedTenantGptClientId(env);
  const configuredClientId = resolveConfiguredTenantGptClientId(env);
  const compatibilityEnabled = flagEnabled(
    env.TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED,
    false,
  );

  // GPT Actions may use a confidential-client authorization-code request without
  // PKCE. Keep this compatibility path explicit and narrow: operators must opt in
  // for the current environment, and the configured client ID must be the
  // canonical ID for that environment. Absence of the flag is strict PKCE.
  return compatibilityEnabled
    && configuredClientId === expectedClientId
    && normalizedClientId === expectedClientId;
}

export function resolveTenantGptPkceMode({
  clientId,
  codeChallenge,
  codeChallengeMethod,
  env = process.env,
} = {}) {
  const challengePresent = Boolean(String(codeChallenge || "").trim());
  const methodPresent = Boolean(String(codeChallengeMethod || "").trim());
  if (challengePresent || methodPresent) {
    return {
      ...validateTenantGptPkceChallenge({ codeChallenge, codeChallengeMethod }),
      pkce_mode: TENANT_GPT_PKCE_MODE.S256,
      code_verifier_required: true,
      client_secret_required: false,
    };
  }

  if (isTenantGptConfidentialActionClient({ clientId, env })) {
    return {
      code_challenge: null,
      code_challenge_method: null,
      pkce_mode: TENANT_GPT_PKCE_MODE.CONFIDENTIAL_CLIENT,
      code_verifier_required: false,
      client_secret_required: true,
    };
  }

  throw pkceError("oauth_pkce_required", "OAuth PKCE code_challenge and code_challenge_method are required.");
}

export function verifyTenantGptAuthorizationBinding({
  clientId,
  pkceMode,
  codeChallenge,
  codeChallengeMethod,
  codeVerifier,
  clientSecretRequired = false,
  clientSecretValidated = false,
  env = process.env,
} = {}) {
  if (pkceMode === TENANT_GPT_PKCE_MODE.CONFIDENTIAL_CLIENT) {
    if (!isTenantGptConfidentialActionClient({ clientId, env })) {
      throw pkceError("oauth_confidential_client_not_allowed", "Confidential-client OAuth compatibility is not enabled for this client.");
    }
    if (clientSecretRequired !== true || clientSecretValidated !== true) {
      throw pkceError("oauth_confidential_client_required", "OAuth client_secret validation is required when PKCE is not supplied.");
    }
    return true;
  }

  return verifyTenantGptPkce({ codeChallenge, codeChallengeMethod, codeVerifier });
}
