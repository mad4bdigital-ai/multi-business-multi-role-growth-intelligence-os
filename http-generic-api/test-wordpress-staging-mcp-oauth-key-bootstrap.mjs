import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWordpressStagingMcpOAuthKey } from "./scripts/staging-wordpress-mcp-oauth-key.mjs";

const root = mkdtempSync(join(tmpdir(), "mad4b-wp-oauth-key-"));
const keyFile = join(root, "wordpress-staging-rs256-private.pem");
const env = {
  REMOTE_MCP_ENVIRONMENT: "staging",
  REMOTE_MCP_OAUTH_ENABLED: "true",
  REMOTE_MCP_WORDPRESS_STAGING_OAUTH_ENABLED: "true",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://dev.mad4b.com/auth/mcp",
  REMOTE_MCP_RESOURCE_URL: "https://mcp-dev.mad4b.com",
  REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL: "https://staging.egypttourgates.com/wp-json/mcp/mad4b-read",
  REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_FILE: keyFile,
  REMOTE_MCP_WORDPRESS_RS256_ALLOW_TEST_KEY_PATH: "true",
};

const bootstrapScript = fileURLToPath(new URL("./scripts/staging-wordpress-mcp-oauth-key.mjs", import.meta.url));

function runBootstrap(childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bootstrapScript], {
      env: { ...process.env, ...childEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(`bootstrap child failed (${code}): ${stderr}`));
      try {
        return resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        return reject(new Error(`bootstrap child returned invalid JSON: ${stdout}; ${error.message}`));
      }
    });
  });
}

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

  const raceKeyFile = join(root, "wordpress-staging-race-rs256-private.pem");
  const raceEnv = { ...env, REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_FILE: raceKeyFile };
  const raceOutcomes = await Promise.all(Array.from({ length: 6 }, () => runBootstrap(raceEnv)));
  assert.equal(raceOutcomes.filter((outcome) => outcome.status === "generated").length, 1, "exactly one bootstrap may publish the canonical key");
  assert(raceOutcomes.every((outcome) => ["generated", "ready_existing", "ready_race_winner"].includes(outcome.status)));
  const racePem = readFileSync(raceKeyFile, "utf8");
  const raceKey = createPrivateKey(racePem);
  assert.equal(raceKey.asymmetricKeyType, "rsa");
  assert(Number(raceKey.asymmetricKeyDetails?.modulusLength || 0) >= 2048);

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
