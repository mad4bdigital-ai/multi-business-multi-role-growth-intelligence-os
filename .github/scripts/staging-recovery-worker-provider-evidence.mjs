import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) {
    throw Object.assign(new Error(`${key} is required`), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_INPUT_MISSING",
    });
  }
  return value;
}

function normalizeSha256(value, label) {
  const normalized = String(value || "")
    .trim()
    .replace(/^W\//u, "")
    .replace(/^"/u, "")
    .replace(/"$/u, "")
    .toLowerCase();

  if (!SHA256.test(normalized)) {
    throw Object.assign(new Error(`${label} must be a 64-character SHA-256 value`), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_HASH_INVALID",
    });
  }

  return normalized;
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw Object.assign(new Error(`Non-JSON response from ${url}`), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_RESPONSE_INVALID",
    });
  }

  if (!response.ok || body?.success === false) {
    throw Object.assign(new Error(`Provider read failed for ${url}`), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_PROVIDER_READ_FAILED",
      status: response.status,
      details: {
        errors: Array.isArray(body?.errors)
          ? body.errors.map(({ code, message }) => ({ code, message }))
          : [],
      },
    });
  }

  return body;
}

function deploymentList(body) {
  if (Array.isArray(body?.result?.deployments)) {
    return body.result.deployments;
  }

  if (Array.isArray(body?.result)) {
    return body.result;
  }

  throw Object.assign(new Error("Cloudflare deployments response is missing deployments"), {
    code: "STAGING_WORKER_PROVIDER_EVIDENCE_DEPLOYMENTS_INVALID",
  });
}

function newestFullDeployment(body) {
  const deployments = [...deploymentList(body)]
    .sort((left, right) => {
      const a = Date.parse(left?.created_on || "");
      const b = Date.parse(right?.created_on || "");
      return b - a;
    });

  const deployment = deployments[0];

  if (!deployment?.id || !Array.isArray(deployment.versions)) {
    throw Object.assign(new Error("No active Worker deployment was observed"), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_DEPLOYMENT_MISSING",
    });
  }

  if (
    deployment.versions.length !== 1
    || Number(deployment.versions[0]?.percentage) !== 100
    || !deployment.versions[0]?.version_id
  ) {
    throw Object.assign(
      new Error("Staging Worker must be serving one exact version at 100 percent"),
      {
        code: "STAGING_WORKER_PROVIDER_EVIDENCE_TRAFFIC_SPLIT",
      },
    );
  }

  return {
    deployment_id: String(deployment.id),
    version_id: String(deployment.versions[0].version_id),
    created_on: deployment.created_on || null,
  };
}

async function cloudflareRead({
  fetchImpl,
  accountId,
  token,
  pathname,
}) {
  return fetchJson(
    fetchImpl,
    `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}${pathname}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
  );
}

async function readVersionEtag({
  fetchImpl,
  accountId,
  token,
  workerName,
  versionId,
}) {
  const body = await cloudflareRead({
    fetchImpl,
    accountId,
    token,
    pathname:
      `/workers/scripts/${encodeURIComponent(workerName)}`
      + `/versions/${encodeURIComponent(versionId)}`,
  });

  return normalizeSha256(
    body?.result?.resources?.script?.etag,
    "Cloudflare Worker version resources.script.etag",
  );
}

export async function captureStagingWorkerProviderEvidence({
  env = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID");
  const token = required(env, "CLOUDFLARE_API_TOKEN");
  const workerName = required(env, "WORKER_NAME");
  const sourceSha = required(env, "SOURCE_SHA").toLowerCase();
  const expectedPolicyHash = required(env, "EXPECTED_POLICY_HASH").toLowerCase();
  const publicHealthUrl = required(env, "PUBLIC_HEALTH_URL");
  const outputFile = path.resolve(
    required(env, "STAGING_WORKER_PROVIDER_OBSERVATION_FILE"),
  );

  if (!SHA40.test(sourceSha) || !SHA256.test(expectedPolicyHash)) {
    throw Object.assign(new Error("Exact SHA or policy hash is invalid"), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_IDENTITY_INVALID",
    });
  }

  const health = await fetchJson(fetchImpl, publicHealthUrl);

  if (
    health?.ok !== true
    || health?.stale !== false
    || health?.sourceCommit !== sourceSha
    || health?.workerBuildSha !== sourceSha
    || health?.policyHash !== expectedPolicyHash
  ) {
    throw Object.assign(new Error("Public Gateway health does not match exact Staging identity"), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_HEALTH_MISMATCH",
    });
  }

  const workerBundleSha256 = normalizeSha256(
    health?.workerBundleSha256,
    "Gateway workerBundleSha256",
  );

  const expectedWorkerBundle = String(
    env.EXPECTED_WORKER_BUNDLE_SHA256 || "",
  ).trim().toLowerCase();

  if (
    expectedWorkerBundle
    && (
      !SHA256.test(expectedWorkerBundle)
      || expectedWorkerBundle !== workerBundleSha256
    )
  ) {
    throw Object.assign(new Error("Public Worker source-set digest differs from expected bundle"), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_SOURCE_BUNDLE_MISMATCH",
    });
  }

  const deploymentsPath =
    `/workers/scripts/${encodeURIComponent(workerName)}/deployments`;

  const firstDeployment = newestFullDeployment(
    await cloudflareRead({
      fetchImpl,
      accountId,
      token,
      pathname: deploymentsPath,
    }),
  );

  const releaseBundleSha256 = await readVersionEtag({
    fetchImpl,
    accountId,
    token,
    workerName,
    versionId: firstDeployment.version_id,
  });

  /*
   * Re-read provider state independently.  The first read identifies the
   * release version.  The second proves that the same version remains the
   * currently deployed 100% traffic target.
   */
  const secondDeployment = newestFullDeployment(
    await cloudflareRead({
      fetchImpl,
      accountId,
      token,
      pathname: deploymentsPath,
    }),
  );

  if (
    secondDeployment.deployment_id !== firstDeployment.deployment_id
    || secondDeployment.version_id !== firstDeployment.version_id
  ) {
    throw Object.assign(new Error("Worker deployment changed during evidence capture"), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_RACE",
    });
  }

  const deployedBundleSha256 = await readVersionEtag({
    fetchImpl,
    accountId,
    token,
    workerName,
    versionId: secondDeployment.version_id,
  });

  if (deployedBundleSha256 !== releaseBundleSha256) {
    throw Object.assign(new Error("Release and deployed Worker content hashes differ"), {
      code: "STAGING_WORKER_PROVIDER_EVIDENCE_DEPLOYED_HASH_MISMATCH",
    });
  }

  const evidence = Object.freeze({
    contract: "mad4b.staging.worker-provider-observation.v1",
    environment: "staging",
    provider: "cloudflare_workers",
    observed_in: "cloudflare_workers",
    deployment_verified: true,
    deployment_sha: sourceSha,
    gateway_host: new URL(publicHealthUrl).hostname,
    policy_hash: expectedPolicyHash,
    worker_build_sha: sourceSha,
    policy_source_sha: sourceSha,
    worker_bundle_sha256: workerBundleSha256,
    release_bundle_sha256: releaseBundleSha256,
    deployed_bundle_sha256: deployedBundleSha256,
    provider_deployment_id: firstDeployment.deployment_id,
    provider_version_id: firstDeployment.version_id,
    provider_deployment_created_on: firstDeployment.created_on,
    observed_at: new Date(now()).toISOString(),
    provider_mutation_performed: false,
    production_mutation_performed: false,
    database_mutation_performed: false,
    secrets_included: false,
  });

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });

  return evidence;
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await captureStagingWorkerProviderEvidence();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
