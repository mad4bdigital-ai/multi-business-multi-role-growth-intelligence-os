import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) {
    throw Object.assign(new Error(`${key} is required`), {
      code: "RECOVERY_STAGING_RUNTIME_EVIDENCE_INPUT_MISSING",
    });
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function hashObject(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

async function json(file) {
  const value = JSON.parse(await readFile(path.resolve(file), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`JSON object required: ${file}`), {
      code: "RECOVERY_STAGING_RUNTIME_EVIDENCE_INVALID",
    });
  }
  return value;
}

function assertProviderObservation(value, expectedSha) {
  if (
    value?.contract !== "mad4b.staging.worker-provider-observation.v1"
    || value?.environment !== "staging"
    || value?.provider !== "cloudflare_workers"
    || value?.observed_in !== "cloudflare_workers"
    || value?.deployment_verified !== true
    || value?.deployment_sha !== expectedSha
    || value?.worker_build_sha !== expectedSha
    || value?.policy_source_sha !== expectedSha
    || !SHA256.test(value?.policy_hash || "")
    || !SHA256.test(value?.worker_bundle_sha256 || "")
    || !SHA256.test(value?.release_bundle_sha256 || "")
    || value?.deployed_bundle_sha256 !== value?.release_bundle_sha256
    || value?.gateway_host !== "activation-dev.mad4b.com"
    || value?.secrets_included !== false
  ) {
    throw Object.assign(new Error("Worker provider observation is not exact-current-Staging evidence"), {
      code: "RECOVERY_STAGING_WORKER_PROVIDER_OBSERVATION_INVALID",
    });
  }
}

function sanitizeIngress(value) {
  const identity = {
    deployment_sha: String(value?.deployment_sha || "").trim().toLowerCase(),
    worker_build_sha: String(value?.worker_build_sha || "").trim().toLowerCase(),
    worker_bundle_sha256: String(value?.worker_bundle_sha256 || "").trim().toLowerCase(),
    policy_hash: String(value?.policy_hash || "").trim().toLowerCase(),
    gateway_host: String(value?.gateway_host || "").trim().toLowerCase(),
    expires_at: value?.expires_at,
  };

  if (
    !SHA40.test(identity.deployment_sha)
    || !SHA40.test(identity.worker_build_sha)
    || !SHA256.test(identity.worker_bundle_sha256)
    || !SHA256.test(identity.policy_hash)
    || identity.gateway_host !== "activation-dev.mad4b.com"
    || !Number.isInteger(identity.expires_at)
    || identity.expires_at <= Date.now() / 1000
  ) {
    throw Object.assign(new Error("Fresh Gateway ingress build identity is invalid or expired"), {
      code: "RECOVERY_STAGING_LIVE_INGRESS_IDENTITY_INVALID",
    });
  }

  return identity;
}

export async function bindLiveRuntimeEvidence({
  env = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  const expectedSha = required(env, "RECOVERY_STAGING_EXPECTED_SHA").toLowerCase();

  if (!SHA40.test(expectedSha)) {
    throw Object.assign(new Error("RECOVERY_STAGING_EXPECTED_SHA is invalid"), {
      code: "RECOVERY_STAGING_RUNTIME_EVIDENCE_SHA_INVALID",
    });
  }

  const providerFile = required(
    env,
    "RECOVERY_STAGING_WORKER_PROVIDER_OBSERVATION_FILE",
  );

  const workerOutput = path.resolve(
    required(env, "RECOVERY_STAGING_WORKER_EVIDENCE_OUTPUT_FILE"),
  );

  const ingressOutput = path.resolve(
    required(env, "RECOVERY_STAGING_INGRESS_BUILD_IDENTITY_OUTPUT_FILE"),
  );

  const readinessUrl = String(
    env.RECOVERY_STAGING_READINESS_URL
      || "https://activation-dev.mad4b.com/admin/recovery/staging/readiness",
  ).trim();

  const backendApiKey = required(env, "BACKEND_API_KEY");

  const provider = await json(providerFile);
  assertProviderObservation(provider, expectedSha);

  const response = await fetchImpl(readinessUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${backendApiKey}`,
      Accept: "application/json",
      "X-Request-Id": `staging-recovery-runtime-evidence-${expectedSha.slice(0, 12)}`,
    },
  });

  const body = await response.json();

  if (response.status !== 200) {
    throw Object.assign(new Error("Staging Recovery readiness request failed"), {
      code: "RECOVERY_STAGING_RUNTIME_EVIDENCE_READINESS_FAILED",
      status: response.status,
    });
  }

  const targetFingerprint = String(body?.target_fingerprint || "")
    .trim()
    .toLowerCase();

  if (!SHA256.test(targetFingerprint)) {
    throw Object.assign(new Error("Readiness did not return a server-managed target fingerprint"), {
      code: "RECOVERY_STAGING_TARGET_FINGERPRINT_MISSING",
    });
  }

  if (body?.deployment_attestation?.sha !== expectedSha) {
    throw Object.assign(new Error("Readiness deployment attestation differs from exact main"), {
      code: "RECOVERY_STAGING_RUNTIME_DEPLOYMENT_MISMATCH",
    });
  }

  const ingress = sanitizeIngress(body?.ingress_build_identity);

  if (
    ingress.deployment_sha !== expectedSha
    || ingress.worker_build_sha !== expectedSha
    || ingress.worker_bundle_sha256 !== provider.worker_bundle_sha256
    || ingress.policy_hash !== provider.policy_hash
    || ingress.gateway_host !== provider.gateway_host
  ) {
    throw Object.assign(new Error("Gateway ingress proof differs from provider-observed Worker identity"), {
      code: "RECOVERY_STAGING_RUNTIME_BINDING_MISMATCH",
    });
  }

  const generatedAt = new Date(now()).toISOString();
  const expiresAt = new Date(now() + 60 * 60 * 1000).toISOString();

  const workerBase = {
    deployment_sha: expectedSha,
    target_fingerprint: targetFingerprint,
    observed_in: "cloudflare_workers",
    deployment_verified: true,
    gateway_host: provider.gateway_host,
    policy_hash: provider.policy_hash,
    worker_build_sha: provider.worker_build_sha,
    policy_source_sha: provider.policy_source_sha,
    worker_bundle_sha256: provider.worker_bundle_sha256,
    release_bundle_sha256: provider.release_bundle_sha256,
    deployed_bundle_sha256: provider.deployed_bundle_sha256,
    provider_deployment_id: provider.provider_deployment_id,
    provider_version_id: provider.provider_version_id,
    generated_at: generatedAt,
    expires_at: expiresAt,
    secrets_included: false,
  };

  const worker = {
    ...workerBase,
    evidence_hash: hashObject(workerBase),
  };

  await mkdir(path.dirname(workerOutput), { recursive: true });
  await mkdir(path.dirname(ingressOutput), { recursive: true });

  await writeFile(workerOutput, `${JSON.stringify(worker, null, 2)}\n`, {
    mode: 0o600,
  });

  await writeFile(ingressOutput, `${JSON.stringify(ingress, null, 2)}\n`, {
    mode: 0o600,
  });

  return {
    deployment_sha: expectedSha,
    target_fingerprint: targetFingerprint,
    worker_evidence_file: workerOutput,
    ingress_build_identity_file: ingressOutput,
    ingress_expires_at: ingress.expires_at,
    secrets_included: false,
  };
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await bindLiveRuntimeEvidence();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
