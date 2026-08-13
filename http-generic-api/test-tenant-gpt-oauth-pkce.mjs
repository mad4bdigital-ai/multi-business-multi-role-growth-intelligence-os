import assert from "node:assert/strict";
import {
  TENANT_GPT_PKCE_METHOD,
  deriveTenantGptPkceChallenge,
  validateTenantGptPkceChallenge,
  validateTenantGptPkceVerifier,
  verifyTenantGptPkce,
} from "./tenantGptOAuthPkce.js";

const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = deriveTenantGptPkceChallenge(verifier);

assert.equal(validateTenantGptPkceVerifier(verifier), verifier);
assert.equal(validateTenantGptPkceChallenge({ codeChallenge: challenge, codeChallengeMethod: TENANT_GPT_PKCE_METHOD }).code_challenge, challenge);
assert.equal(verifyTenantGptPkce({ codeChallenge: challenge, codeChallengeMethod: TENANT_GPT_PKCE_METHOD, codeVerifier: verifier }), true);
assert.throws(
  () => validateTenantGptPkceChallenge({ codeChallenge: challenge, codeChallengeMethod: "plain" }),
  (error) => error.code === "oauth_pkce_method_unsupported",
);
assert.throws(
  () => verifyTenantGptPkce({ codeChallenge: challenge, codeChallengeMethod: TENANT_GPT_PKCE_METHOD, codeVerifier: `${verifier}x` }),
  (error) => error.code === "oauth_pkce_verifier_mismatch",
);
assert.throws(
  () => verifyTenantGptPkce({ codeChallenge: challenge, codeChallengeMethod: TENANT_GPT_PKCE_METHOD }),
  (error) => error.code === "oauth_pkce_verifier_invalid",
);
assert.throws(
  () => validateTenantGptPkceChallenge({ codeChallenge: "", codeChallengeMethod: TENANT_GPT_PKCE_METHOD }),
  (error) => error.code === "oauth_pkce_required",
);

console.log("Tenant GPT OAuth PKCE tests passed.");
