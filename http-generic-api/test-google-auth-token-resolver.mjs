/**
 * Google auth token resolver tests
 * Run: node test-google-auth-token-resolver.mjs
 */
import assert from "node:assert/strict";

process.env.GOOGLE_AUTH_DISABLE_PREWARM = "true";

const {
  getGoogleAuthCredentialSourcesForEnv,
  buildGoogleTokenCacheKey,
  runGoogleTokenResolutionOnce
} = await import("./googleAuthTokenResolver.js");
const { buildGoogleClientContextKey } = await import("./googleSheets.js");
const { normalizeAuthContract } = await import("./authCredentialResolution.js");

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

{
  const action = {
    action_key: "google_drive_api",
    oauth_config_ref: "ref:user_app_connection:google_drive",
    runtime_binding_profile: JSON.stringify({
      auth_strategy: {
        required_scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"]
      }
    })
  };
  const baseOptions = {
    action,
    auth_context: {
      credential_scope: "user",
      user_id: "user-a",
      tenant_id: "tenant-a",
      connection_id: "connection-a",
      app_key: "google_drive"
    }
  };
  const sameKey = buildGoogleTokenCacheKey(baseOptions);
  assert.equal(sameKey, buildGoogleTokenCacheKey(baseOptions));
  assert.notEqual(
    sameKey,
    buildGoogleTokenCacheKey({
      ...baseOptions,
      auth_context: { ...baseOptions.auth_context, user_id: "user-b" }
    })
  );
  assert.notEqual(
    sameKey,
    buildGoogleTokenCacheKey({
      ...baseOptions,
      auth_context: { ...baseOptions.auth_context, connection_id: "connection-b" }
    })
  );
  pass("token cache identity isolates user and connection context");
}

{
  const action = { action_key: "google_sheets_api", oauth_config_ref: "ref:user_app_connection:google_sheets" };
  const first = buildGoogleClientContextKey({
    auth_context: {
      credential_scope: "tenant",
      tenant_id: "tenant-a",
      connection_id: "connection-a",
      app_key: "google_sheets"
    }
  }, action);
  const second = buildGoogleClientContextKey({
    auth_context: {
      credential_scope: "tenant",
      tenant_id: "tenant-b",
      connection_id: "connection-a",
      app_key: "google_sheets"
    }
  }, action);
  assert.notEqual(first, second);
  pass("Google client cache identity isolates tenant context");
}

{
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const resolver = async () => {
    calls += 1;
    await gate;
    return "token-shared";
  };
  const first = runGoogleTokenResolutionOnce("context-key", resolver);
  const second = runGoogleTokenResolutionOnce("context-key", resolver);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), ["token-shared", "token-shared"]);
  const third = await runGoogleTokenResolutionOnce("context-key", async () => {
    calls += 1;
    return "token-after-cleanup";
  });
  assert.equal(third, "token-after-cleanup");
  assert.equal(calls, 2);
  pass("same-context token resolution deduplicates only while inflight");
}

{
  let calls = 0;
  const results = await Promise.all([
    runGoogleTokenResolutionOnce("context-a", async () => {
      calls += 1;
      return "token-a";
    }),
    runGoogleTokenResolutionOnce("context-b", async () => {
      calls += 1;
      return "token-b";
    })
  ]);
  assert.deepEqual(results, ["token-a", "token-b"]);
  assert.equal(calls, 2);
  pass("different credential contexts resolve independently");
}

{
  process.env.AUTH_LIFECYCLE_TEST_SECRET = "must-not-be-materialized";
  try {
    const contract = await normalizeAuthContract({
      action: {
        action_key: "preview_bearer_action",
        api_key_mode: "bearer_token",
        api_key_storage_mode: "secret_reference",
        secret_store_ref: "ref:secret:AUTH_LIFECYCLE_TEST_SECRET"
      },
      endpoint: {},
      brand: null,
      resolve_credentials: false,
      auth_context: {
        credential_scope: "user",
        user_id: "user-a",
        tenant_id: "tenant-a",
        connection_id: "connection-a"
      }
    });
    assert.equal(contract.mode, "bearer_token");
    assert.equal(contract.secret, "");
    assert.equal(contract.credential_resolution_status, "deferred_until_authorized_execution");
    assert.equal(contract.materialized, false);
    assert.equal(contract.provider_call_made, false);
    assert.equal(contract.secret_read_performed, false);
    pass("passive auth preview does not materialize configured secrets");
  } finally {
    delete process.env.AUTH_LIFECYCLE_TEST_SECRET;
  }
}

console.log(`Results: ${passed} passed, 0 failed`);
