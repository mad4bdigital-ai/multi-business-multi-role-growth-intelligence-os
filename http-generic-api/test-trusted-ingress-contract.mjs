import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadActivationGatewayProfilePolicy, readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";
import { assertTrustedIngressReadyForProduction, buildTrustedIngressReadiness } from "./trustedIngressContract.js";
import { buildStagingTrustedIngressCertificationEvidence } from "./stagingTrustedIngressCertificationEvidence.js";

const execFileAsync = promisify(execFile);

const pending = buildTrustedIngressReadiness({ NODE_ENV: "staging", REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true" });
assert.equal(pending.ready, false);
assert.equal(pending.failure_mode, "staging_attestation_pending");
assert.doesNotThrow(() => assertTrustedIngressReadyForProduction({ NODE_ENV: "staging" }));

const productionBlocked = buildTrustedIngressReadiness({ NODE_ENV: "production", REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true", REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true" });
assert.equal(productionBlocked.ready, false);
assert.throws(() => assertTrustedIngressReadyForProduction({ NODE_ENV: "production", REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true", REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true" }), /TRUSTED_INGRESS_ATTESTATION_REQUIRED|Trusted ingress attestation/iu);

const productionReadyEnv = {
  NODE_ENV: "production",
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
};
const productionReady = assertTrustedIngressReadyForProduction(productionReadyEnv);
assert.equal(productionReady.ready, true);
assert.equal(productionReady.failure_mode, "accepted");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const deploymentSha = "a".repeat(40);
const signedEnv = {
  NODE_ENV: "production",
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_MODE: "signature",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: publicKeyPem,
  REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST: "mcp.example.test",
  REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOSTS: "mcp.example.test,auth.example.test",
  REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE: "mad4b-production-origin",
  REMOTE_MCP_TRUSTED_INGRESS_ISSUER: "mad4b-edge",
  REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA: deploymentSha,
};
function signedRequest(host = "mcp.example.test", overrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "mad4b-edge",
    aud: "mad4b-production-origin",
    iat: now - 2,
    exp: now + 30,
    host,
    deployment_sha: deploymentSha,
    request_id: `request-${host}`,
    jti: `jti-${host}`,
    key_id: "edge-key-1",
    ...overrides,
  };
  const payloadBytes = Buffer.from(JSON.stringify(claims), "utf8");
  const encodedClaims = payloadBytes.toString("base64url");
  const signature = sign(null, payloadBytes, privateKey).toString("base64url");
  return {
    headers: {
      "x-forwarded-host": host,
      "x-mad4b-ingress-attestation": `${encodedClaims}.${signature}`,
      ...headerOverrides,
    },
  };
}

const signedReady = assertTrustedIngressReadyForProduction(signedEnv, signedRequest());
assert.equal(signedReady.ready, true);
assert.equal(signedReady.attestation_mode, "signature");
assert.equal(signedReady.signed_attestation.verified, true);
assert.equal(signedReady.signed_attestation.key_id, "edge-key-1");
assert.equal(signedReady.signed_attestation.canonical_host, "mcp.example.test");
assert.deepEqual(signedReady.canonical_host_policy.hosts, ["mcp.example.test", "auth.example.test"]);

const authReady = assertTrustedIngressReadyForProduction(signedEnv, signedRequest("auth.example.test"));
assert.equal(authReady.ready, true);
assert.equal(authReady.signed_attestation.canonical_host, "auth.example.test");

const ingressDenied = (error) => error?.code === "TRUSTED_INGRESS_ATTESTATION_REQUIRED";
const forged = signedRequest("mcp.example.test", {}, { "x-mad4b-ingress-attestation": `${Buffer.from("{}", "utf8").toString("base64url")}.forged` });
assert.throws(() => assertTrustedIngressReadyForProduction(signedEnv, forged), ingressDenied);
assert.throws(
  () => assertTrustedIngressReadyForProduction(
    signedEnv,
    signedRequest("mcp.example.test", {}, { "x-forwarded-host": "auth.example.test" }),
  ),
  ingressDenied,
);
assert.throws(
  () => assertTrustedIngressReadyForProduction(signedEnv, signedRequest("unknown.example.test")),
  ingressDenied,
);
const expired = signedRequest("mcp.example.test", { iat: Math.floor(Date.now() / 1000) - 200, exp: Math.floor(Date.now() / 1000) - 100 });
assert.throws(() => assertTrustedIngressReadyForProduction(signedEnv, expired), ingressDenied);

const legacySingleHostEnv = {
  ...signedEnv,
  REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOSTS: "",
  REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST: "mcp.example.test",
};
assert.equal(assertTrustedIngressReadyForProduction(legacySingleHostEnv, signedRequest()).ready, true);
assert.throws(() => assertTrustedIngressReadyForProduction(legacySingleHostEnv, signedRequest("auth.example.test")), ingressDenied);

const duplicateHostEnv = {
  ...signedEnv,
  REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOSTS: "mcp.example.test,mcp.example.test",
};
const duplicateHostReadiness = buildTrustedIngressReadiness(duplicateHostEnv);
assert.equal(duplicateHostReadiness.signed_attestation_configured, false);
assert.equal(duplicateHostReadiness.canonical_host_policy.valid, false);

const wildcardHostEnv = {
  ...signedEnv,
  REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOSTS: "*.example.test",
};
const wildcardHostReadiness = buildTrustedIngressReadiness(wildcardHostEnv);
assert.equal(wildcardHostReadiness.signed_attestation_configured, false);
assert.equal(wildcardHostReadiness.canonical_host_policy.valid, false);

const stagingKeyId = "staging-key-1234567890";
const stagingCertificationEvidence = buildStagingTrustedIngressCertificationEvidence({
  NODE_ENV: "staging",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  REMOTE_MCP_ENVIRONMENT: "staging",
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_MODE: "signature",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: publicKeyPem,
  REMOTE_MCP_TRUSTED_INGRESS_KEY_ID: stagingKeyId,
  REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST: "activation-dev.mad4b.com",
  REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE: "https://dev.mad4b.com",
  REMOTE_MCP_TRUSTED_INGRESS_ISSUER: "https://activation-dev.mad4b.com",
  REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA: deploymentSha,
  RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: "/app/data/recovery-ingress",
});
assert.equal(stagingCertificationEvidence.available, true);
assert.equal(stagingCertificationEvidence.configured, true);
assert.equal(stagingCertificationEvidence.environment, "staging");
assert.equal(stagingCertificationEvidence.runtime_identity_ok, true);
assert.equal(stagingCertificationEvidence.observed.attestation_mode, "signature");
assert.equal(stagingCertificationEvidence.observed.proxy_headers_enabled, true);
assert.equal(stagingCertificationEvidence.observed.caller_headers_stripped, true);
assert.deepEqual(stagingCertificationEvidence.observed.canonical_hosts, ["activation-dev.mad4b.com"]);
assert.equal(stagingCertificationEvidence.observed.public_key_ed25519, true);
assert.match(stagingCertificationEvidence.observed.public_key_sha256, /^[0-9a-f]{64}$/u);
assert.equal(stagingCertificationEvidence.observed.deployment_sha, deploymentSha);
assert.equal(stagingCertificationEvidence.observed.replay_directory, "/app/data/recovery-ingress");
assert.equal(stagingCertificationEvidence.raw_public_key_exposed, false);
assert.equal(stagingCertificationEvidence.read_only, true);
assert.equal(stagingCertificationEvidence.secrets_included, false);

const nonStagingCertificationEvidence = buildStagingTrustedIngressCertificationEvidence({ NODE_ENV: "production" });
assert.equal(nonStagingCertificationEvidence.available, false);
assert.equal(nonStagingCertificationEvidence.configured, false);
assert.equal(nonStagingCertificationEvidence.raw_public_key_exposed, false);
assert.equal(nonStagingCertificationEvidence.secrets_included, false);

async function listenJson(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

const convergenceRegistry = readEnvironmentConvergenceRegistry();
const stagingGatewayResolution = loadActivationGatewayProfilePolicy("staging", { registry: convergenceRegistry });
assert.equal(stagingGatewayResolution.validation.ok, true);
const stagingPolicyHash = stagingGatewayResolution.validation.expected_policy_hash;
const workerBundleSha = "b".repeat(64);
const appFixture = await listenJson((req, res) => {
  if (!req.url?.startsWith("/health")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    ok: true,
    staging_trusted_ingress_readiness: stagingCertificationEvidence,
  }));
});
const gatewayFixture = await listenJson((req, res) => {
  if (req.url !== "/ready") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    ok: true,
    upstreamReady: true,
    upstreamEvidenceVerified: true,
    policyHash: stagingPolicyHash,
    upstreamSourceCommit: deploymentSha,
    recoveryTrustedIngress: {
      contract: "mad4b.staging.activation-recovery-origin-trust.v2",
      deployment_sha: deploymentSha,
      source_commit: deploymentSha,
      worker_build_sha: deploymentSha,
      worker_bundle_sha256: workerBundleSha,
      policy_hash: stagingPolicyHash,
      gateway_host: "activation-dev.mad4b.com",
      canonical_host: "activation-dev.mad4b.com",
      audience: "https://dev.mad4b.com",
      issuer: "https://activation-dev.mad4b.com",
      key_id: stagingKeyId,
      public_key: publicKeyPem,
      trusted_ingress_mode: "signature",
      strip_caller_headers: true,
      replay_store_scope: "single_filesystem",
      provider_credentials_included: false,
      production_deploy: false,
      database_mutation: false,
      secrets_included: false,
    },
  }));
});
const binderRoot = await mkdtemp(join(tmpdir(), "staging-cert-trust-binder-"));
const binderEnvFile = join(binderRoot, "github-env.txt");
try {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/prepare-staging-cert-trust-evidence.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STAGING_CERT_EXPECTED_COMMIT: deploymentSha,
      STAGING_CERT_APP_BASE_URL: appFixture.url,
      STAGING_CERT_GATEWAY_BASE_URL: gatewayFixture.url,
      STAGING_CERT_SYNTHETIC_LOOPBACK_FIXTURE: "true",
      STAGING_CERT_TRUST_ENV_FILE: binderEnvFile,
    },
    maxBuffer: 1024 * 1024,
  });
  const binderReport = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
  assert.equal(binderReport.contract, "mad4b.staging-cert-trust-runtime-binding.v1");
  assert.equal(binderReport.ready, true);
  assert.equal(binderReport.environment_binding_written, true);
  assert.deepEqual(binderReport.blocking_failures, []);
  assert.equal(binderReport.safety.read_only_remote_probe, true);
  assert.equal(binderReport.safety.replay_claim_performed, false);
  assert.equal(binderReport.safety.database_mutation, false);
  assert.equal(binderReport.safety.provider_mutation, false);
  assert.equal(binderReport.safety.production_mutation, false);
  assert.equal(binderReport.safety.raw_public_key_reported, false);
  assert.doesNotMatch(stdout, /BEGIN PUBLIC KEY/u);
  const binderEnv = await readFile(binderEnvFile, "utf8");
  assert.match(binderEnv, /^REMOTE_MCP_TRUSTED_INGRESS_MODE=signature$/mu);
  assert.match(binderEnv, /^REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=true$/mu);
  assert.match(binderEnv, /^REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS=true$/mu);
  assert.match(binderEnv, new RegExp(`^REMOTE_MCP_TRUSTED_INGRESS_KEY_ID=${stagingKeyId}$`, "mu"));
  assert.match(binderEnv, new RegExp(`^REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA=${deploymentSha}$`, "mu"));
  assert.match(binderEnv, /^RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY=\/app\/data\/recovery-ingress$/mu);
  assert.match(binderEnv, /REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\\n/u);
  assert.doesNotMatch(binderEnv, /PRIVATE KEY/u);
} finally {
  await Promise.all([
    new Promise((resolve) => appFixture.server.close(resolve)),
    new Promise((resolve) => gatewayFixture.server.close(resolve)),
  ]);
  await rm(binderRoot, { recursive: true, force: true });
}

console.log("Trusted ingress contract tests passed.");