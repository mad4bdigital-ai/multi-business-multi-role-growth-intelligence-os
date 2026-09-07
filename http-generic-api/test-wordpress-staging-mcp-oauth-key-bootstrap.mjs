import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWordpressStagingMcpOAuthKey } from "./scripts/ensure-wordpress-staging-mcp-oauth-key.mjs";

const root = mkdtempSync(join(tmpdir(), "mad4b-wp-oauth-key-"));
const keyFile = join(root, "wordpress-staging-rs256-private.pem");
const env = {
  REMOTE_MCP_ENVIRONMENT: "staging",
  REMOTE_MCP_OAUTH_ENABLED: "true",
  REMOTE_MCP_WORDPRESS_STAGING_OAUTH_ENABLED: "true",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://dev.example.test/auth/mcp",
  REMOTE_MCP_RESOURCE_URL: "https://mcp-dev.example.test",
  REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL: "https://staging.example.test/wp-json/mcp/mad4b-read",
  REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_FILE: keyFile,
  REMOTE_MCP_WORDPRESS_RS256_ALLOW_TEST_KEY_PATH: "true",
};

try {
  const first = ensureWordpressStagingMcpOAuthKey(env);
  assert.equal(first.status, "generated");
  assert.equal(first.generated, true);
  assert.equal(first.secrets_included, false);
  const firstPem = readFileSync(keyFile, "utf8");
  const firstKey = createPrivateKey(firstPem);
  assert.equal(firstKey.asymmetricKeyType, "rsa");
  assert(Number(firstKey.asymmetricKeyDetails?.modulusLength || 0) >= 2048);

  const second = ensureWordpressStagingMcpOAuthKey(env);
  assert.equal(second.status, "ready_existing");
  assert.equal(second.generated, false);
  assert.equal(readFileSync(keyFile, "utf8"), firstPem, "restart must preserve the same signing key");

  assert.throws(
    () => ensureWordpressStagingMcpOAuthKey({ ...env, REMOTE_MCP_ENVIRONMENT: "production" }),
    /forbidden outside Staging/u,
  );

  const disabled = ensureWordpressStagingMcpOAuthKey({ ...env, REMOTE_MCP_WORDPRESS_STAGING_OAUTH_ENABLED: "false" });
  assert.equal(disabled.status, "disabled");

  const invalidFile = join(root, "invalid.pem");
  writeFileSync(invalidFile, "not-a-private-key\n", "utf8");
  assert.throws(
    () => ensureWordpressStagingMcpOAuthKey({ ...env, REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_FILE: invalidFile }),
  );

  console.log("wordpress-staging-mcp-oauth-key-bootstrap: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
