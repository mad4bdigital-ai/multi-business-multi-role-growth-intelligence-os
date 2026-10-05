#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { evaluateImmutableStagingArtifactIntegrity } from "../../http-generic-api/stagingImmutableArtifactIntegrity.js";
import {
  signStagingRuntimeArtifactAttestation,
} from "../../http-generic-api/stagingRuntimeArtifactAttestation.js";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u;

function fail(code, message) {
  throw Object.assign(new Error(message), {
    code,
    details: { secrets_included: false },
  });
}

function required(name, pattern = null) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value || (pattern && !pattern.test(value))) {
    fail(
      "STAGING_RUNTIME_ATTESTATION_INPUT_INVALID",
      `${name} is required and must use the canonical exact format.`,
    );
  }
  return value;
}

async function fetchJson(url, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      // handled below
    }
    if (!response.ok || !body || typeof body !== "object") {
      fail(
        "STAGING_RUNTIME_ATTESTATION_REMOTE_PROBE_FAILED",
        `Remote probe failed: ${url} status=${response.status}`,
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const expectedSha = required("EXPECTED_SHA", SHA40);
const expectedTree = required("EXPECTED_TREE", SHA40);
const expectedContext = required("EXPECTED_CONTEXT_FILE_SET_SHA256", SHA256);
const expectedPolicyHash = required("EXPECTED_POLICY_HASH", SHA256);

const appBase = String(
  process.env.STAGING_APP_BASE_URL || "https://dev.mad4b.com",
).replace(/\/$/u, "");
const gatewayBase = String(
  process.env.STAGING_GATEWAY_BASE_URL || "https://activation-dev.mad4b.com",
).replace(/\/$/u, "");
const outputDirectory = path.resolve(
  process.env.STAGING_RUNTIME_ATTESTATION_OUTPUT_DIRECTORY ||
    path.join(process.cwd(), ".artifacts", "staging-runtime-artifact-attestation"),
);

const deploymentUrl = new URL("/deployment-info", appBase);
deploymentUrl.searchParams.set("include_staging_trusted_ingress_readiness", "1");

const [deployment, gatewayHealth, gatewayReady] = await Promise.all([
  fetchJson(deploymentUrl),
  fetchJson(new URL("/health", gatewayBase)),
  fetchJson(new URL("/ready", gatewayBase)),
]);

const observedCommit = String(
  deployment.commit_sha || deployment.commit || "",
).trim().toLowerCase();
const appManifest = deployment.deployment || {};
const observedImageDigest = String(appManifest.image_digest || "")
  .trim()
  .toLowerCase();

if (
  observedCommit !== expectedSha ||
  String(deployment.branch || "") !== "main" ||
  String(deployment.app_env || "").toLowerCase() !== "staging"
) {
  fail(
    "STAGING_RUNTIME_ATTESTATION_APP_IDENTITY_MISMATCH",
    "Public Staging app identity is not bound to exact main.",
  );
}

if (
  String(appManifest.commit_sha || "").toLowerCase() !== expectedSha ||
  String(appManifest.tree_sha || "").toLowerCase() !== expectedTree ||
  String(appManifest.context_file_set_sha256 || "").toLowerCase() !==
    expectedContext ||
  !IMAGE_DIGEST.test(observedImageDigest) ||
  appManifest.secrets_included !== false
) {
  fail(
    "STAGING_RUNTIME_ATTESTATION_APP_ARTIFACT_MISMATCH",
    "Public Staging app artifact identity is incomplete or mismatched.",
  );
}

const runtimeIntegrity = deployment.runtime_integrity || null;
const immutableIntegrity = evaluateImmutableStagingArtifactIntegrity({
  runtimeIntegrity,
  appManifest,
  expectedCommit: expectedSha,
  expectedTree,
  expectedContextFileSet: expectedContext,
  expectedImageDigest: observedImageDigest,
});
const runtimeIntegrityVerified =
  runtimeIntegrity?.verified === true || immutableIntegrity.verified === true;

if (!runtimeIntegrityVerified) {
  fail(
    "STAGING_RUNTIME_ATTESTATION_RUNTIME_INTEGRITY_INVALID",
    "Staging runtime integrity is not independently verified.",
  );
}

if (
  gatewayHealth.ok !== true ||
  gatewayHealth.stale !== false ||
  gatewayHealth.sourceCommit !== expectedSha ||
  gatewayHealth.workerBuildSha !== expectedSha ||
  !SHA256.test(String(gatewayHealth.workerBundleSha256 || "")) ||
  gatewayHealth.policyHash !== expectedPolicyHash ||
  gatewayHealth.secretsIncluded !== false
) {
  fail(
    "STAGING_RUNTIME_ATTESTATION_GATEWAY_HEALTH_MISMATCH",
    "Activation Gateway health is not exact-main/policy bound.",
  );
}

const gatewayTrust = gatewayReady.recoveryTrustedIngress || {};
const gatewayUpstreamSource = String(
  gatewayReady.upstreamSourceCommit ||
    gatewayTrust.source_commit ||
    gatewayTrust.deployment_sha ||
    "",
).trim().toLowerCase();

if (
  gatewayReady.ok !== true ||
  gatewayReady.upstreamReady !== true ||
  gatewayReady.upstreamEvidenceVerified !== true ||
  gatewayUpstreamSource !== expectedSha ||
  gatewayReady.policyHash !== expectedPolicyHash ||
  gatewayTrust.deployment_sha !== expectedSha ||
  gatewayTrust.source_commit !== expectedSha ||
  gatewayTrust.worker_build_sha !== expectedSha ||
  gatewayTrust.provider_credentials_included !== false ||
  gatewayTrust.secrets_included !== false
) {
  fail(
    "STAGING_RUNTIME_ATTESTATION_GATEWAY_READY_MISMATCH",
    "Activation Gateway ready evidence is not exact-upstream trusted-ingress evidence.",
  );
}

const issuer = String(
  process.env.RECOVERY_STAGING_CERTIFICATION_ISSUER || "",
).trim();
const keyId = String(
  process.env.RECOVERY_STAGING_CERTIFICATION_KEY_ID || "",
).trim();
if (!issuer || !keyId) {
  fail(
    "STAGING_RUNTIME_ATTESTATION_SIGNER_IDENTITY_MISSING",
    "Governed Staging signing identity is unavailable.",
  );
}

const now = Date.now();
const payload = Object.freeze({
  contract: "mad4b.staging-runtime-artifact-attestation-payload.v1",
  environment: "staging",
  branch: "main",
  deployment_sha: expectedSha,
  tree_sha: expectedTree,
  context_file_set_sha256: expectedContext,
  app_image_digest: observedImageDigest,
  runtime_integrity_verified: true,
  activation_gateway: {
    source_commit: gatewayHealth.sourceCommit,
    worker_build_sha: gatewayHealth.workerBuildSha,
    worker_bundle_sha256: gatewayHealth.workerBundleSha256,
    policy_hash: gatewayHealth.policyHash,
    upstream_source_commit: gatewayUpstreamSource,
    upstream_ready: true,
    upstream_evidence_verified: true,
    stale: false,
  },
  trusted_ingress: {
    key_id: String(gatewayTrust.key_id || ""),
    public_key_sha256: String(gatewayTrust.public_key_sha256 || ""),
  },
  issuer,
  key_id: keyId,
  generated_at: new Date(now).toISOString(),
  expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
  production_mutation_performed: false,
  provider_mutation_performed: false,
  database_mutation_performed: false,
  secrets_included: false,
});

const record = signStagingRuntimeArtifactAttestation({
  payload,
  env: process.env,
});

fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
const signedFile = path.join(
  outputDirectory,
  "signed-runtime-artifact-attestation.json",
);
const observationFile = path.join(outputDirectory, "runtime-observation.json");

fs.writeFileSync(
  signedFile,
  JSON.stringify(record, null, 2) + "\n",
  { mode: 0o600 },
);
fs.writeFileSync(
  observationFile,
  JSON.stringify(
    {
      contract: "mad4b.staging-runtime-artifact-observation.v1",
      deployment_sha: expectedSha,
      tree_sha: expectedTree,
      context_file_set_sha256: expectedContext,
      app_image_digest: observedImageDigest,
      gateway_source_commit: gatewayHealth.sourceCommit,
      gateway_worker_build_sha: gatewayHealth.workerBuildSha,
      gateway_worker_bundle_sha256: gatewayHealth.workerBundleSha256,
      gateway_policy_hash: gatewayHealth.policyHash,
      gateway_upstream_source_commit: gatewayUpstreamSource,
      runtime_integrity_verified: true,
      read_only_remote_probe: true,
      production_mutation_performed: false,
      provider_mutation_performed: false,
      database_mutation_performed: false,
      secrets_included: false,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);

process.stdout.write(
  JSON.stringify({
    ok: true,
    contract: record.contract,
    deployment_sha: expectedSha,
    app_image_digest: observedImageDigest,
    payload_sha256: record.payload_sha256,
    artifact_name:
      `staging-runtime-artifact-attestation-${expectedSha}-${record.payload_sha256}`,
    output_directory: outputDirectory,
    read_only_remote_probe: true,
    production_mutation_performed: false,
    provider_mutation_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  }) + "\n",
);
