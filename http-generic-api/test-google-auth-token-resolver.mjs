/**
 * Google auth token resolver tests
 * Run: node test-google-auth-token-resolver.mjs
 */
import assert from "node:assert/strict";

process.env.GOOGLE_AUTH_DISABLE_PREWARM = "true";

const { getGoogleAuthCredentialSourcesForEnv } = await import("./googleAuthTokenResolver.js");

let passed = 0;

function pass(label) {
  console.log(`  [PASS] ${label}`);
  passed++;
}

{
  const sources = getGoogleAuthCredentialSourcesForEnv({});
  assert.deepEqual(sources, ["managed_service_account_adc"]);
  pass("managed service account ADC is the default source");
}

{
  const sources = getGoogleAuthCredentialSourcesForEnv({
    GOOGLE_REFRESH_TOKEN: "refresh-token"
  });
  assert.deepEqual(sources, ["managed_service_account_adc", "refresh_token"]);
  pass("refresh token remains fallback after ADC when auth mode is not forced");
}

{
  const sources = getGoogleAuthCredentialSourcesForEnv({
    GOOGLE_AUTH_MODE: "refresh_token",
    GOOGLE_REFRESH_TOKEN: "refresh-token"
  });
  assert.deepEqual(sources, ["refresh_token"]);
  pass("refresh-token mode is refresh-token only");
}

{
  const sources = getGoogleAuthCredentialSourcesForEnv({
    GOOGLE_AUTH_MODE: "refresh_token"
  });
  assert.deepEqual(sources, []);
  pass("refresh-token mode does not fall back to ADC when no refresh token is configured");
}

{
  const sources = getGoogleAuthCredentialSourcesForEnv({
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/service-account.json",
    GOOGLE_REFRESH_TOKEN: "refresh-token"
  });
  assert.deepEqual(sources, ["explicit_service_account", "refresh_token"]);
  pass("explicit service account remains first when auth mode is not forced");
}

{
  const sources = getGoogleAuthCredentialSourcesForEnv({
    GOOGLE_AUTH_MODE: "refresh_token",
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/service-account.json",
    GOOGLE_REFRESH_TOKEN: "refresh-token"
  });
  assert.deepEqual(sources, ["refresh_token"]);
  pass("refresh-token mode does not fall back to explicit service account");
}

{
  const raw = JSON.stringify({
    client_email: "svc@example.iam.gserviceaccount.com"
  });
  const sources = getGoogleAuthCredentialSourcesForEnv({
    GOOGLE_SA_JSON: Buffer.from(raw, "utf8").toString("base64")
  });
  assert.deepEqual(sources, ["explicit_service_account"]);
  pass("inline service account JSON is accepted as explicit service account");
}

{
  const raw = JSON.stringify({
    client_email: "svc@example.iam.gserviceaccount.com"
  });
  const sources = getGoogleAuthCredentialSourcesForEnv({
    GOOGLE_AUTH_MODE: "managed_service_account_adc",
    GOOGLE_SA_JSON: Buffer.from(raw, "utf8").toString("base64"),
    GOOGLE_REFRESH_TOKEN: "refresh-token"
  });
  assert.deepEqual(sources, ["explicit_service_account"]);
  pass("managed service account mode ignores refresh-token fallback");
}

console.log(`Results: ${passed} passed, 0 failed`);
