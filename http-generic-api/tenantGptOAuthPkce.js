import { createHash } from "node:crypto";

export const TENANT_GPT_PKCE_METHOD = "S256";
export const TENANT_GPT_PKCE_VERIFIER_MIN_LENGTH = 43;
export const TENANT_GPT_PKCE_VERIFIER_MAX_LENGTH = 128;
export const TENANT_GPT_PKCE_CHALLENGE_LENGTH = 43;

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
