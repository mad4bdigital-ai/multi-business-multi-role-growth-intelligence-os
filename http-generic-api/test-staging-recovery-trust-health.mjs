import assert from "node:assert/strict";
import { buildStagingRecoveryTrustedIngressHealth } from "./routes/healthRoutes.js";

const commit = "a".repeat(40);
const exactEnv = {
  NODE_ENV: "staging",
  REMOTE_MCP_ENVIRONMENT: "staging",
  REMOTE_MCP_TRUSTED_INGRESS_MODE: "signature",
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\\nPUBLIC-ONLY-FIXTURE\\n-----END PUBLIC KEY-----\\n",
  REMOTE_MCP_TRUSTED_INGRESS_KEY_ID: "staging-recovery-key-20260916",
  REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST: "activation-dev.mad4b.com",
  REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE: "https://dev.mad4b.com",
  REMOTE_MCP_TRUSTED_INGRESS_ISSUER: "https://activation-dev.mad4b.com",
  REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA: commit,
  RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: "/app/data/recovery-ingress",
};

const ready = buildStagingRecoveryTrustedIngressHealth(exactEnv);
assert.equal(ready.contract, "mad4b.staging-recovery-trusted-ingress-health.v1");
assert.equal(ready.environment, "staging");
assert.equal(ready.ready, true);
assert.equal(ready.runtime_identity_ok, true);
assert.equal(ready.attestation_mode, "signature");
assert.equal(ready.proxy_headers_enabled, true);
assert.equal(ready.caller_headers_stripped, true);
assert.equal(ready.signed_attestation_configured, true);
assert.equal(ready.canonical_host_exact, true);
assert.equal(ready.audience_exact, true);
assert.equal(ready.issuer_exact, true);
assert.equal(ready.key_id_configured, true);
assert.equal(ready.expected_deployment_sha, commit);
assert.equal(ready.replay_directory_exact, true);
assert.equal(ready.secrets_included, false);
assert.equal(JSON.stringify(ready).includes("BEGIN PUBLIC KEY"), false);
assert.equal(JSON.stringify(ready).includes("PUBLIC-ONLY-FIXTURE"), false);

const wrongReplay = buildStagingRecoveryTrustedIngressHealth({
  ...exactEnv,
  RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: "/tmp/recovery-ingress",
});
assert.equal(wrongReplay.ready, false);
assert.equal(wrongReplay.replay_directory_exact, false);

const wrongCommit = buildStagingRecoveryTrustedIngressHealth({
  ...exactEnv,
  REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA: "not-a-sha",
});
assert.equal(wrongCommit.ready, false);
assert.equal(wrongCommit.expected_deployment_sha, null);

assert.equal(buildStagingRecoveryTrustedIngressHealth({
  ...exactEnv,
  NODE_ENV: "production",
  REMOTE_MCP_ENVIRONMENT: "production",
}), null);

console.log("Staging recovery trust health evidence contract passed.");
