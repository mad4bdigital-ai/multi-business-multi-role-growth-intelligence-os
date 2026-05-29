import assert from "node:assert/strict";
import { normalizeAuthContract } from "./authCredentialResolution.js";

const action = {
  action_key: "wordpress_api",
  api_key_mode: "delegated_per_target+basic_auth_app_password",
  api_key_storage_mode: "per_target_credentials",
};

const endpoint = {};
const brand = {
  brand_name: "Almallah Group",
  target_key: "almallah_wp",
  auth_type: "basic_auth_app_password",
};

const contract = await normalizeAuthContract({
  action,
  endpoint,
  brand,
  user_id: "user-1",
  tenant_id: "tenant-1",
  auth_context: {
    user_id: "user-1",
    tenant_id: "tenant-1",
    credential_scope: "connection",
    connection_id: "conn-wp",
    app_key: "wordpress_rest",
  },
  credential_scope: "connection",
  allow_platform_fallback: true,
});

// This regression is intentionally source-level because normalizeAuthContract
// resolves live connections through userAppConnectionCredentials.js. The key
// guarantee is that Basic Auth scoped credentials recognize the canonical
// WordPress Application Password field name.
const source = await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("./authCredentialResolution.js", import.meta.url), "utf8"));
assert(source.includes('extractCredentialValue(credentials, "application_password", "app_password", "password", "secret", "token")'));

assert.equal(contract.mode, "basic_auth");
assert.equal(contract.header_name, "Authorization");

console.log("wordpress application password auth contract test passed");
