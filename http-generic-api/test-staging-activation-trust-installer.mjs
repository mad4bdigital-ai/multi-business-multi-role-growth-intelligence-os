import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildStagingActivationTrustInstallPlan,
  installStagingActivationTrust,
  STAGING_ACTIVATION_TRUST_ENV_ALLOWLIST,
} from "./stagingActivationTrustInstaller.js";
import { readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";

const registry = readEnvironmentConvergenceRegistry();
const gateway = registry.profiles.staging.activation_gateway;
const expectedSha = "b".repeat(40);
const { publicKey } = crypto.generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).replaceAll("\r", "");
const keyId = "activation-staging-test-key-20260911";
const trust = {
  contract: "mad4b.staging.activation-recovery-origin-trust.v2",
  deployment_sha: expectedSha,
  source_commit: expectedSha,
  worker_build_sha: expectedSha,
  worker_bundle_sha256: "c".repeat(64),
  policy_hash: gateway.expected_policy_hash,
  gateway_host: gateway.public_host,
  canonical_host: gateway.public_host,
  audience: "https://dev.mad4b.com",
  issuer: "https://activation-dev.mad4b.com",
  key_id: keyId,
  public_key: publicPem,
  trusted_ingress_mode: "signature",
  strip_caller_headers: true,
  replay_store_scope: "single_filesystem",
  provider_credentials_included: false,
  production_deploy: false,
  database_mutation: false,
  secrets_included: false,
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const calls = [];
const fetchImpl = async (url) => {
  calls.push(String(url));
  if (String(url).endsWith("/health")) {
    return response({
      ok: true,
      stale: false,
      policyKey: gateway.policy_key,
      policyHash: gateway.expected_policy_hash,
      sourceCommit: expectedSha,
      workerBuildSha: expectedSha,
      secretsIncluded: false,
    });
  }
  if (String(url).endsWith("/ready")) {
    return response({
      ok: true,
      service: "activation-gateway",
      upstreamReady: true,
      upstreamEvidenceVerified: true,
      policyHash: gateway.expected_policy_hash,
      upstreamPolicyHash: gateway.expected_policy_hash,
      upstreamSourceCommit: expectedSha,
      recoveryTrustedIngress: trust,
      secretsIncluded: false,
    });
  }
  throw new Error(`Unexpected URL: ${url}`);
};

const plan = await buildStagingActivationTrustInstallPlan({ expectedSha, fetchImpl, registry });
assert.equal(plan.status, "ready");
assert.equal(plan.ready, true);
assert.equal(plan.expected_sha, expectedSha);
assert.equal(plan.public_host, "activation-dev.mad4b.com");
assert.equal(plan.policy_hash, gateway.expected_policy_hash);
assert.equal(plan.key_id, keyId);
assert.match(plan.public_key_sha256, /^[a-f0-9]{64}$/u);
assert.deepEqual([...plan.allowed_env_keys].sort(), [...STAGING_ACTIVATION_TRUST_ENV_ALLOWLIST].sort());
assert.equal(plan.provider_mutation, false);
assert.equal(plan.cloudflare_mutation, false);
assert.equal(plan.workflow_dispatch, false);
assert.equal(plan.production_mutation, false);
assert.equal(plan.database_mutation, false);
assert.equal(plan.provider_credentials_included, false);
assert.equal(plan.secrets_included, false);
assert.deepEqual(calls.sort(), ["https://activation-dev.mad4b.com/health", "https://activation-dev.mad4b.com/ready"].sort());

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mad4b-staging-trust-"));
const envFile = path.join(directory, ".env.staging");
const original = [
  "PORT=8080",
  "REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=true",
  "REMOTE_MCP_TRUSTED_INGRESS_MODE=signature",
  "REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS=true",
  "REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY=OLD_PUBLIC_KEY",
  "REMOTE_MCP_TRUSTED_INGRESS_KEY_ID=old-key-0000000001",
  "REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST=activation-dev.mad4b.com",
  "REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE=https://dev.mad4b.com",
  "REMOTE_MCP_TRUSTED_INGRESS_ISSUER=https://activation-dev.mad4b.com",
  `REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA=${"d".repeat(40)}`,
  "RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY=/app/data/recovery-ingress",
  "DATABASE_MUTATED=false",
  "PRODUCTION_MUTATION_AUTHORIZED=false",
  "CLOUDFLARE_TUNNEL_TOKEN=must-stay-unchanged",
  "",
].join("\n");
await fs.writeFile(envFile, original, "utf8");

const installed = await installStagingActivationTrust({ expectedSha, envFile, mode: "apply", fetchImpl, registry });
assert.equal(installed.ready, true);
assert.equal(installed.mutated, true);
assert.equal(installed.mutation_scope, "local_staging_trust_allowlist_only");
assert.equal(installed.values_returned, false);
assert.equal(Object.hasOwn(installed, "env_values"), true);
assert.equal(installed.env_values, undefined);
assert.match(installed.env_file_sha256_before, /^[a-f0-9]{64}$/u);
assert.match(installed.env_file_sha256_after, /^[a-f0-9]{64}$/u);
assert.notEqual(installed.env_file_sha256_before, installed.env_file_sha256_after);

const after = await fs.readFile(envFile, "utf8");
assert.match(after, /^PORT=8080$/mu);
assert.match(after, /^REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=true$/mu);
assert.match(after, /^RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY=\/app\/data\/recovery-ingress$/mu);
assert.match(after, /^DATABASE_MUTATED=false$/mu);
assert.match(after, /^PRODUCTION_MUTATION_AUTHORIZED=false$/mu);
assert.match(after, /^CLOUDFLARE_TUNNEL_TOKEN=must-stay-unchanged$/mu);
assert.match(after, new RegExp(`^REMOTE_MCP_TRUSTED_INGRESS_KEY_ID=${keyId}$`, "mu"));
assert.match(after, new RegExp(`^REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA=${expectedSha}$`, "mu"));
assert.match(after, /^REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\\n/mu);
assert.match(after, /\\n-----END PUBLIC KEY-----\\n$/mu);

const beforeFailedApply = await fs.readFile(envFile, "utf8");
const mismatchedFetch = async (url) => {
  if (String(url).endsWith("/health")) return response({ ok: true, stale: false, policyKey: gateway.policy_key, policyHash: gateway.expected_policy_hash, sourceCommit: "e".repeat(40), workerBuildSha: "e".repeat(40) });
  return response({ ok: true, policyHash: gateway.expected_policy_hash, upstreamSourceCommit: "e".repeat(40), recoveryTrustedIngress: { ...trust, deployment_sha: "e".repeat(40), source_commit: "e".repeat(40), worker_build_sha: "e".repeat(40) } });
};
await assert.rejects(
  installStagingActivationTrust({ expectedSha, envFile, mode: "apply", fetchImpl: mismatchedFetch, registry }),
  (error) => error?.code === "staging_trust_install_not_ready",
);
assert.equal(await fs.readFile(envFile, "utf8"), beforeFailedApply);

const duplicateFile = path.join(directory, ".env.duplicate");
await fs.writeFile(duplicateFile, `${original}REMOTE_MCP_TRUSTED_INGRESS_KEY_ID=duplicate-key-00000001\n`, "utf8");
await assert.rejects(
  installStagingActivationTrust({ expectedSha, envFile: duplicateFile, mode: "apply", fetchImpl, registry }),
  (error) => error?.code === "staging_trust_env_duplicate_key",
);

await fs.rm(directory, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging.activation-trust-installer.test.v1",
  exact_public_evidence_required: true,
  ed25519_public_key_required: true,
  env_allowlist_enforced: true,
  unrelated_env_preserved: true,
  mismatch_no_mutation: true,
  provider_mutation: false,
  production_mutation: false,
  secrets_included: false,
}));
