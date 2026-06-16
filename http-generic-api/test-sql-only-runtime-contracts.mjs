import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOAuthConfigured } from "./authInjection.js";
import { resolveDelegatedGoogleScopes } from "./auth.js";
import { getGoogleScopesFromAction } from "./googleAuthTokenResolver.js";

const authSource = readFileSync(new URL("./auth.js", import.meta.url), "utf8");
const authInjectionSource = readFileSync(new URL("./authInjection.js", import.meta.url), "utf8");
const preparationSource = readFileSync(new URL("./executionPreparation.js", import.meta.url), "utf8");
const tokenResolverSource = readFileSync(new URL("./googleAuthTokenResolver.js", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("./migrations/1012_sprint69_sql_only_runtime_auth_schema.sql", import.meta.url),
  "utf8"
);

assert.doesNotMatch(authSource, /fetchOAuthConfigContract/,
  "runtime Google scope resolution must not load OAuth configuration from Drive");
assert.doesNotMatch(preparationSource, /fetchSchemaContract\s*\(\s*drive/,
  "runtime schema resolution must not load action schema files from Drive");
assert.match(preparationSource, /schema_contract_missing/,
  "missing SQL endpoint schemas must fail with a stable structured error code");
assert.match(preparationSource, /required_surface:\s*"endpoints\.schema_json"/,
  "schema failure must identify the SQL authority surface");
assert.doesNotMatch(authInjectionSource, /oauth_config_file_id/,
  "OAuth mode detection must not depend on a Google file id");
assert.doesNotMatch(tokenResolverSource, /GOOGLE_WORKSPACE_SCOPES/,
  "Google token scopes must not be hardcoded in the runtime resolver");
assert.doesNotMatch(tokenResolverSource, /fetchGlobalGoogleToken\(\)\.catch/,
  "actionless Google token prewarm must remain disabled");

const driveAction = {
  action_key: "google_drive_api",
  runtime_binding_profile: JSON.stringify({
    auth_strategy: {
      allowed_auth_types: ["oauth2"],
      required_scopes: ["https://www.googleapis.com/auth/drive"]
    }
  }),
  oauth_config_ref: "ref:config:sql_runtime_google_oauth_v2",
  oauth_client_id_ref: "ref:secret:GOOGLE_CLIENT_ID",
  oauth_client_secret_ref: "ref:secret:GOOGLE_CLIENT_SECRET"
};

assert.equal(isOAuthConfigured(driveAction), true);
assert.deepEqual(getGoogleScopesFromAction(driveAction), [
  "https://www.googleapis.com/auth/drive"
]);

const resolved = await resolveDelegatedGoogleScopes({
  policies: [],
  action: driveAction,
  endpoint: { endpoint_key: "getFileMetadata", runtime_binding_profile: null }
});
assert.deepEqual(resolved.explicitScopes, ["https://www.googleapis.com/auth/drive"]);
assert.match(resolved.scopeSource, /^sql:action\.runtime_binding_profile:/);

await assert.rejects(
  () => resolveDelegatedGoogleScopes({
    policies: [],
    action: { action_key: "google_drive_api", runtime_binding_profile: "{}" },
    endpoint: { endpoint_key: "getFileMetadata", runtime_binding_profile: "{}" }
  }),
  error => error?.code === "auth_scope_contract_missing" && error?.status === 500
);

assert.match(migration, /secret_references/);
assert.match(migration, /credential_bindings/);
assert.match(migration, /GOOGLE_CLIENT_ID/);
assert.match(migration, /GOOGLE_CLIENT_SECRET/);
assert.match(migration, /sql_only_runtime_contracts_v1/);
assert.match(migration, /v_sql_only_runtime_contract_readiness/);
assert.match(migration, /external_file_reads_allowed',false/);
assert.match(migration, /cb\.action_key COLLATE utf8mb4_unicode_ci=a\.action_key COLLATE utf8mb4_unicode_ci/,
  "readiness view joins mixed-collation action keys explicitly");
for (const marker of [
  "no_provider_call",
  "no_credential_payload_read",
  "no_raw_secrets",
  "no_external_send",
  "no_external_write",
  "secrets_included=false"
]) {
  assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\assert.match(migration, /v_sql_only_runtime_contract_readiness/);
assert.match(migration, /external_file_reads_allowed',false/);
assert.doesNotMatch(migration, /BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY/i);
")));
}
assert.doesNotMatch(migration, /BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY/i);
assert.doesNotMatch(migration, /client_secret\s*[=:]\s*["'][^"']+/i);

console.log("SQL-only runtime auth/schema contract tests passed.");
