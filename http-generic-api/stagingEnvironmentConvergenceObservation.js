import { getEnvironmentConvergenceProfile } from "./environmentConvergenceRegistry.js";

const SHA_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

function compact(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return compact(value).toLowerCase();
}

function failureObservation({ publicHost, httpStatus = 0, error = "fetch_failed" }) {
  return Object.freeze({
    reachable: false,
    httpStatus,
    publicHost,
    service: null,
    ok: false,
    sourceCommit: null,
    workerBuildSha: null,
    policyKey: null,
    policyHash: null,
    stale: null,
    error,
    secretsIncluded: false,
  });
}

export async function observeStagingActivationGateway({
  registry,
  expectedCommit,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  const commit = lower(expectedCommit);
  if (!SHA_RE.test(commit)) throw new Error("staging_gateway_observation_expected_commit_invalid");
  if (typeof fetchImpl !== "function") throw new Error("staging_gateway_observation_fetch_unavailable");

  const profile = getEnvironmentConvergenceProfile("staging", registry);
  const gateway = profile.activation_gateway || {};
  const publicHost = lower(gateway.public_host);
  const expectedPolicyKey = compact(gateway.policy_key);
  const expectedPolicyHash = lower(gateway.expected_policy_hash);

  if (!publicHost || publicHost.includes("/") || publicHost.includes("\\")) {
    throw new Error("staging_gateway_observation_public_host_invalid");
  }
  if (!expectedPolicyKey) throw new Error("staging_gateway_observation_policy_key_missing");
  if (!SHA256_RE.test(expectedPolicyHash)) throw new Error("staging_gateway_observation_policy_hash_invalid");

  const healthUrl = `https://${publicHost}/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(healthUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      return failureObservation({
        publicHost,
        error: error?.name === "AbortError" ? "fetch_timeout" : "fetch_failed",
      });
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return failureObservation({
        publicHost,
        httpStatus: Number(response?.status || 0),
        error: "gateway_health_invalid_json",
      });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return failureObservation({
        publicHost,
        httpStatus: Number(response?.status || 0),
        error: "gateway_health_invalid_json",
      });
    }

    return Object.freeze({
      reachable: true,
      httpStatus: Number(response?.status || 0),
      publicHost,
      service: compact(body.service) || null,
      ok: body.ok === true,
      sourceCommit: lower(body.sourceCommit) || null,
      workerBuildSha: lower(body.workerBuildSha) || null,
      policyKey: compact(body.policyKey) || null,
      policyHash: lower(body.policyHash) || null,
      stale: typeof body.stale === "boolean" ? body.stale : null,
      error: response?.ok === true ? null : "gateway_health_http_error",
      secretsIncluded: false,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function classifyStagingGatewayObservation({ registry, expectedCommit, observation } = {}) {
  const commit = lower(expectedCommit);
  if (!SHA_RE.test(commit)) throw new Error("staging_gateway_classification_expected_commit_invalid");

  const profile = getEnvironmentConvergenceProfile("staging", registry);
  const gateway = profile.activation_gateway || {};
  const expectedPolicyKey = compact(gateway.policy_key);
  const expectedPolicyHash = lower(gateway.expected_policy_hash);
  const reasons = [];

  if (!observation?.reachable) return Object.freeze(["gateway_health_reachable"]);
  if (observation.service !== "activation-gateway") reasons.push("gateway_environment_profile_current");
  if (observation.policyKey !== expectedPolicyKey) reasons.push("gateway_policy_key_current");
  if (!SHA256_RE.test(lower(observation.policyHash)) || lower(observation.policyHash) !== expectedPolicyHash) {
    reasons.push("gateway_policy_hash_current");
  }
  if (observation.stale !== false) reasons.push("gateway_policy_not_stale");
  if (lower(observation.sourceCommit) !== commit || lower(observation.workerBuildSha) !== commit) {
    reasons.push("gateway_exact_commit");
  }
  if (observation.ok !== true && observation.stale !== true) reasons.push("gateway_health_reachable");

  return Object.freeze([...new Set(reasons)]);
}

export async function observeStagingGatewayConvergence({
  registry,
  expectedCommit,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  const observation = await observeStagingActivationGateway({
    registry,
    expectedCommit,
    fetchImpl,
    timeoutMs,
  });
  const reasons = classifyStagingGatewayObservation({
    registry,
    expectedCommit,
    observation,
  });
  return Object.freeze({ observation, reasons, secretsIncluded: false });
}
