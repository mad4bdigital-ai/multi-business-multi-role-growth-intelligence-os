import assert from "node:assert/strict";
import { evaluateProductionConfig } from "./productionConfigPreflight.js";

const base = {
  NODE_ENV: "production",
  RELEASE_TRIGGER_DEPLOYMENT_BRANCH: "Production",
  JWT_SECRET: "jwt_secret_fixture_32_characters_long_x",
  TENANT_GPT_SSO_SIGNING_SECRET: "sso_secret_fixture_32_characters_long_y",
  TENANT_GPT_OAUTH_CLIENT_SECRET: "oauth_client_fixture_32_characters_long_z",
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
  QUEUE_WORKER_ENABLED: "true",
  REDIS_URL: "redis://fixture:6379",
  CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
  CONTROL_PLANE_WRITE_DB_HOST: "db",
  CONTROL_PLANE_WRITE_DB_NAME: "growth_control_plane",
  CONTROL_PLANE_WRITE_DB_USER: "control_plane_writer",
  CONTROL_PLANE_WRITE_DB_PASSWORD: "writer_fixture_password",
  DB_USER: "runtime_reader",
};

const ready = evaluateProductionConfig(base);
assert.equal(ready.ok, true);
assert.equal(ready.status, "ready");
assert.equal(ready.secrets.every((item) => item.secrets_included === false), true);
assert.equal(ready.queue.status, "ready");
assert.equal(ready.control_plane_write.status, "configured");
assert.equal(ready.oauth_client.confidential_compat_enabled, false);
assert.equal(ready.oauth_client.confidential_compat_source, "secure_default_disabled");
assert.equal(ready.managed_google_oauth.enabled, false);
assert.equal(ready.managed_google_oauth.status, "disabled");
const explicitOauthCompat = evaluateProductionConfig({ ...base, TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED: "true" });
assert.equal(explicitOauthCompat.oauth_client.confidential_compat_enabled, true);
assert.equal(explicitOauthCompat.oauth_client.confidential_compat_source, "environment");
const strictOauthRollback = evaluateProductionConfig({ ...base, TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED: "false" });
assert.equal(strictOauthRollback.oauth_client.confidential_compat_enabled, false);
assert.equal(strictOauthRollback.oauth_client.confidential_compat_source, "environment");

const managedGoogleReady = evaluateProductionConfig({
  ...base,
  MANAGED_GOOGLE_OAUTH_ENABLED: "true",
  MANAGED_GOOGLE_OAUTH_CLIENT_ID: "managed-client.apps.googleusercontent.com",
  MANAGED_GOOGLE_OAUTH_CLIENT_SECRET: "managed_google_client_secret_fixture_32_chars_x",
  MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "managed_google_encryption_key_fixture_32_chars_y",
  MANAGED_GOOGLE_OAUTH_REDIRECT_URI: "https://auth.mad4b.com/v1/google/oauth/callback",
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([{
    site_uuid: "d745d81f-6fc4-5c6a-99dd-d953c92137bf",
    origin: "https://staging.egypttourgates.com",
    callback_uri: "https://staging.egypttourgates.com/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
    key_id: "etg-staging-v1",
    environment: "staging",
    status: "active",
  }]),
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: JSON.stringify({
    "etg-staging-v1": "managed_google_site_secret_fixture_32_chars_z",
  }),
});
assert.equal(managedGoogleReady.ok, true);
assert.equal(managedGoogleReady.managed_google_oauth.status, "configured");
assert.equal(managedGoogleReady.managed_google_oauth.site_binding_count, 1);
assert.deepEqual(managedGoogleReady.managed_google_oauth.site_key_ids, ["etg-staging-v1"]);
assert.equal(managedGoogleReady.managed_google_oauth.site_secret_key_count, 1);
assert.equal(managedGoogleReady.managed_google_oauth.site_secrets_valid, true);
assert.equal(managedGoogleReady.managed_google_oauth.site_secret_evidence[0].secrets_included, false);
assert.equal(managedGoogleReady.managed_google_oauth.client_secret.secrets_included, false);
assert.equal(managedGoogleReady.managed_google_oauth.encryption_key.secrets_included, false);

const managedGoogleMissing = evaluateProductionConfig({
  ...base,
  MANAGED_GOOGLE_OAUTH_ENABLED: "true",
  MANAGED_GOOGLE_OAUTH_CLIENT_ID: "",
  MANAGED_GOOGLE_OAUTH_CLIENT_SECRET: "",
  MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "",
  MANAGED_GOOGLE_OAUTH_REDIRECT_URI: "",
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: "",
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: "",
});
assert.equal(managedGoogleMissing.ok, false);
assert.equal(managedGoogleMissing.managed_google_oauth.status, "invalid");
assert.match(managedGoogleMissing.errors.join("\n"), /Managed Google OAuth is enabled but missing/);

const managedGoogleBadBinding = evaluateProductionConfig({
  ...base,
  MANAGED_GOOGLE_OAUTH_ENABLED: "true",
  MANAGED_GOOGLE_OAUTH_CLIENT_ID: "managed-client.apps.googleusercontent.com",
  MANAGED_GOOGLE_OAUTH_CLIENT_SECRET: "managed_google_client_secret_fixture_32_chars_x",
  MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "managed_google_encryption_key_fixture_32_chars_y",
  MANAGED_GOOGLE_OAUTH_REDIRECT_URI: "https://auth.mad4b.com/v1/google/oauth/callback",
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: "[]",
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: "{}",
});
assert.equal(managedGoogleBadBinding.ok, false);
assert.match(managedGoogleBadBinding.errors.join("\n"), /must contain at least one active HTTPS site binding/);

const managedGoogleMissingSigningSecret = evaluateProductionConfig({
  ...base,
  MANAGED_GOOGLE_OAUTH_ENABLED: "true",
  MANAGED_GOOGLE_OAUTH_CLIENT_ID: "managed-client.apps.googleusercontent.com",
  MANAGED_GOOGLE_OAUTH_CLIENT_SECRET: "managed_google_client_secret_fixture_32_chars_x",
  MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "managed_google_encryption_key_fixture_32_chars_y",
  MANAGED_GOOGLE_OAUTH_REDIRECT_URI: "https://auth.mad4b.com/v1/google/oauth/callback",
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([{
    site_uuid: "d745d81f-6fc4-5c6a-99dd-d953c92137bf",
    origin: "https://staging.egypttourgates.com",
    callback_uri: "https://staging.egypttourgates.com/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
    key_id: "etg-staging-v1",
    environment: "staging",
    status: "active",
  }]),
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: "{}",
});
assert.equal(managedGoogleMissingSigningSecret.ok, false);
assert.match(managedGoogleMissingSigningSecret.errors.join("\n"), /SITE_SECRETS_JSON must provide/);

const managedGoogleMissingBindingKey = evaluateProductionConfig({
  ...base,
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([{
    site_uuid: "d745d81f-6fc4-5c6a-99dd-d953c92137bf",
    origin: "https://staging.egypttourgates.com",
    callback_uri: "https://staging.egypttourgates.com/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
    environment: "staging",
    status: "active",
  }]),
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: JSON.stringify({
    "etg-staging-v1": "managed_google_site_secret_fixture_32_chars_z",
  }),
});
assert.equal(managedGoogleMissingBindingKey.ok, false);
assert.match(managedGoogleMissingBindingKey.errors.join("\n"), /site binding/);


const managedGoogleMalformedSiblingBinding = evaluateProductionConfig({
  ...base,
  MANAGED_GOOGLE_OAUTH_ENABLED: "true",
  MANAGED_GOOGLE_OAUTH_CLIENT_ID: "managed-client.apps.googleusercontent.com",
  MANAGED_GOOGLE_OAUTH_CLIENT_SECRET: "managed_google_client_secret_fixture_32_chars_x",
  MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "managed_google_encryption_key_fixture_32_chars_y",
  MANAGED_GOOGLE_OAUTH_REDIRECT_URI: "https://auth.mad4b.com/v1/google/oauth/callback",
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([
    {
      site_uuid: "d745d81f-6fc4-5c6a-99dd-d953c92137bf",
      origin: "https://staging.egypttourgates.com",
      callback_uri: "https://staging.egypttourgates.com/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
      key_id: "etg-staging-v1",
      status: "active",
    },
    {
      site_uuid: "not-a-uuid",
      origin: "http://invalid.example",
      callback_uri: "https://attacker.example/callback",
      key_id: "broken-site-v1",
      status: "active",
    },
  ]),
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: JSON.stringify({
    "etg-staging-v1": "managed_google_site_secret_fixture_32_chars_z",
    "broken-site-v1": "managed_google_site_secret_fixture_32_chars_q",
  }),
});
assert.equal(managedGoogleMalformedSiblingBinding.ok, false);
assert.equal(managedGoogleMalformedSiblingBinding.managed_google_oauth.site_bindings_valid, false);
assert.ok(managedGoogleMalformedSiblingBinding.managed_google_oauth.site_binding_errors.length > 0);

const managedGoogleCrossOriginCallback = evaluateProductionConfig({
  ...base,
  MANAGED_GOOGLE_OAUTH_ENABLED: "true",
  MANAGED_GOOGLE_OAUTH_CLIENT_ID: "managed-client.apps.googleusercontent.com",
  MANAGED_GOOGLE_OAUTH_CLIENT_SECRET: "managed_google_client_secret_fixture_32_chars_x",
  MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "managed_google_encryption_key_fixture_32_chars_y",
  MANAGED_GOOGLE_OAUTH_REDIRECT_URI: "https://auth.mad4b.com/v1/google/oauth/callback",
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([{
    site_uuid: "d745d81f-6fc4-5c6a-99dd-d953c92137bf",
    origin: "https://staging.egypttourgates.com",
    callback_uri: "https://attacker.example/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
    key_id: "etg-staging-v1",
    status: "active",
  }]),
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: JSON.stringify({
    "etg-staging-v1": "managed_google_site_secret_fixture_32_chars_z",
  }),
});
assert.equal(managedGoogleCrossOriginCallback.ok, false);
assert.match(managedGoogleCrossOriginCallback.managed_google_oauth.site_binding_errors.join("\n"), /callback origin mismatch/);

const managedGoogleRedirectWithQuery = evaluateProductionConfig({
  ...base,
  MANAGED_GOOGLE_OAUTH_ENABLED: "true",
  MANAGED_GOOGLE_OAUTH_CLIENT_ID: "managed-client.apps.googleusercontent.com",
  MANAGED_GOOGLE_OAUTH_CLIENT_SECRET: "managed_google_client_secret_fixture_32_chars_x",
  MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "managed_google_encryption_key_fixture_32_chars_y",
  MANAGED_GOOGLE_OAUTH_REDIRECT_URI: "https://auth.mad4b.com/v1/google/oauth/callback?unexpected=1",
  MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON: JSON.stringify([{
    site_uuid: "d745d81f-6fc4-5c6a-99dd-d953c92137bf",
    origin: "https://staging.egypttourgates.com",
    callback_uri: "https://staging.egypttourgates.com/wp-admin/admin-post.php?action=mad4b_context_google_managed_callback",
    key_id: "etg-staging-v1",
    status: "active",
  }]),
  MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON: JSON.stringify({
    "etg-staging-v1": "managed_google_site_secret_fixture_32_chars_z",
  }),
});
assert.equal(managedGoogleRedirectWithQuery.ok, false);
assert.equal(managedGoogleRedirectWithQuery.managed_google_oauth.redirect_uri_valid, false);

const missingSso = evaluateProductionConfig({ ...base, TENANT_GPT_SSO_SIGNING_SECRET: "" });
assert.equal(missingSso.ok, false);
assert.match(missingSso.errors.join("\n"), /TENANT_GPT_SSO_SIGNING_SECRET is missing/);

const shortJwt = evaluateProductionConfig({ ...base, JWT_SECRET: "short" });
assert.equal(shortJwt.ok, false);
assert.match(shortJwt.errors.join("\n"), /JWT_SECRET must be at least 32 characters/);

const duplicateSecrets = evaluateProductionConfig({
  ...base,
  TENANT_GPT_SSO_SIGNING_SECRET: base.JWT_SECRET,
});
assert.equal(duplicateSecrets.ok, false);
assert.match(duplicateSecrets.errors.join("\n"), /must be distinct/);

const ingressNotAttested = evaluateProductionConfig({
  ...base,
  REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "false",
});
assert.equal(ingressNotAttested.ok, false);
assert.match(ingressNotAttested.errors.join("\n"), /REMOTE_MCP_TRUSTED_INGRESS_ATTESTED=true/);

const queueMissingRedis = evaluateProductionConfig({ ...base, QUEUE_WORKER_ENABLED: "true", REDIS_URL: "" });
assert.equal(queueMissingRedis.ok, false);
assert.match(queueMissingRedis.errors.join("\n"), /REDIS_URL is required/);

const writerMissingConfig = evaluateProductionConfig({
  ...base,
  CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
  CONTROL_PLANE_WRITE_DB_HOST: "",
  CONTROL_PLANE_WRITE_DB_NAME: "",
  CONTROL_PLANE_WRITE_DB_USER: "",
  CONTROL_PLANE_WRITE_DB_PASSWORD: "",
});
assert.equal(writerMissingConfig.ok, false);
assert.match(writerMissingConfig.errors.join("\n"), /Control Plane write authority is enabled/);

const writerReusesRuntimeIdentity = evaluateProductionConfig({
  ...base,
  CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
  CONTROL_PLANE_WRITE_DB_HOST: "db",
  CONTROL_PLANE_WRITE_DB_NAME: "growth",
  CONTROL_PLANE_WRITE_DB_USER: "runtime_user",
  CONTROL_PLANE_WRITE_DB_PASSWORD: "writer_password",
  DB_USER: "runtime_user",
});
assert.equal(writerReusesRuntimeIdentity.ok, false);
assert.match(writerReusesRuntimeIdentity.errors.join("\n"), /distinct from DB_USER/);

console.log("test-production-config-preflight: ok");
