import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("./routes/credentialRoutes.js", import.meta.url), "utf8");

assert.ok(
  routes.includes('/credentials/intake/promote-platform-secrets'),
  "credential routes must expose governed platform secret promotion endpoint"
);
assert.ok(
  routes.includes("decryptCredentials"),
  "platform promotion must decrypt intake credentials only server-side"
);
assert.ok(
  routes.includes("encrypted_credentials"),
  "platform promotion must read encrypted intake credentials from user_app_connections"
);
assert.ok(
  routes.includes("promotion_approved") && routes.includes("promotion_reason"),
  "platform promotion must require explicit approval and reason"
);
assert.ok(
  routes.includes("secret_mappings") || routes.includes("secretMappings"),
  "platform promotion must support explicit credential-to-secret mappings"
);
assert.ok(
  routes.includes("platform_secrets"),
  "platform promotion must upsert encrypted platform_secrets rows"
);
assert.ok(
  routes.includes("value_ciphertext") && routes.includes("value_sha256"),
  "platform promotion must store ciphertext and hash, not plaintext readback"
);
assert.ok(
  routes.includes("secret_references"),
  "platform promotion must keep secret_references aligned with promoted secrets"
);
assert.ok(
  routes.includes("store_type = 'db_encrypted'") || routes.includes("'db_encrypted'"),
  "platform promotion must mark secret references as db_encrypted"
);
assert.ok(
  routes.includes("promoted_to_platform_secrets"),
  "platform promotion must mark source intake connection as promoted"
);
assert.ok(
  routes.includes("secrets_included: false"),
  "platform promotion responses must explicitly exclude secret values"
);
assert.doesNotMatch(
  routes,
  /res\.json\([\s\S]{0,500}(value_ciphertext|encrypted_credentials|credentials)\s*[,}]/,
  "platform promotion response must not serialize decrypted credentials or ciphertext"
);

console.log("credential intake platform secret promotion route tests passed");
