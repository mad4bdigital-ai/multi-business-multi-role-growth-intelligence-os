#!/usr/bin/env node
import crypto from "node:crypto";

const expectedSha = "5e5178bb7d5b86fe42a5eb97e647a5d65edaaceb";
const expectedBranch = "Production";
const expectedDeployedAfter = "2026-08-03T06:16:38Z";
const maxBytes = 64 * 1024;
const timeoutMs = 20_000;
const sensitiveKey = /(authorization|cookie|password|secret|token|api[_-]?key|private[_-]?key|credential)/iu;

function sanitize(value, depth = 0) {
  if (depth > 8) return "[MAX_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 200)
        .map(([key, item]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : sanitize(item, depth + 1)])
    );
  }
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED_JWT]")
      .slice(0, 12_000);
  }
  return value;
}

async function readBounded(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("response_too_large");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function fetchEndpoint(name, url) {
  const startedAt = Date.now();
  let response;
  let raw = Buffer.alloc(0);
  let body = null;
  let parseError = null;
  let error = null;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    raw = await readBounded(response);
    if (raw.length) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch (caught) {
        parseError = String(caught?.message || caught).slice(0, 500);
        body = { non_json_body: raw.toString("utf8").slice(0, 12_000) };
      }
    }
  } catch (caught) {
    error = String(caught?.message || caught).slice(0, 1_000);
  }
  return {
    name,
    url,
    http_status: response?.status || 0,
    http_ok: response?.ok === true,
    content_type: response?.headers?.get("content-type") || null,
    body_bytes: raw.length,
    body_sha256: raw.length ? crypto.createHash("sha256").update(raw).digest("hex") : null,
    duration_ms: Date.now() - startedAt,
    error,
    parse_error: parseError,
    body: sanitize(body),
  };
}

const definitions = {
  health: "https://auth.mad4b.com/health",
  version: "https://auth.mad4b.com/version",
  deployment_info: "https://auth.mad4b.com/deployment-info",
  connector_agent_version: "https://auth.mad4b.com/connector-agent/version",
};
const entries = await Promise.all(
  Object.entries(definitions).map(async ([name, url]) => [name, await fetchEndpoint(name, url)])
);
const endpoints = Object.fromEntries(entries);
const direct = endpoints.deployment_info?.body;
const deployment = direct && typeof direct === "object" && !Array.isArray(direct) ? direct : {};

function pick(keys) {
  for (const key of keys) {
    const value = deployment[key];
    if (typeof value === "string" && value.trim()) return { key, value: value.trim() };
  }
  return { key: null, value: null };
}

const branch = pick(["branch", "deployment_branch", "git_branch", "source_branch"]);
const sha = pick(["commit_sha", "deployed_commit_sha", "git_sha", "sha"]);
const deployedAt = pick([
  "deployed_at",
  "deployment_timestamp",
  "deployment_time",
  "manifest_generated_at",
  "generated_at",
  "updated_at",
]);
const releasePath = pick([
  "release_path",
  "release_directory",
  "deployment_path",
  "manifest_path",
  "deployment_manifest_path",
]);
const observedAt = deployedAt.value ? Date.parse(deployedAt.value) : Number.NaN;
const threshold = Date.parse(expectedDeployedAfter);
const checks = {
  health_http_ok: endpoints.health.http_status === 200,
  version_http_ok: endpoints.version.http_status === 200,
  deployment_info_http_ok: endpoints.deployment_info.http_status === 200,
  deployment_info_branch_exact: branch.value === expectedBranch,
  deployment_info_sha_exact: sha.value === expectedSha,
  deployment_timestamp_present: Boolean(deployedAt.value),
  deployment_timestamp_current: Number.isFinite(observedAt) && observedAt >= threshold,
  connector_agent_http_ok: endpoints.connector_agent_version.http_status === 200,
};
const orderedChecks = [
  ["health_http_ok", "health_http_failed"],
  ["version_http_ok", "version_http_failed"],
  ["deployment_info_http_ok", "deployment_info_http_failed"],
  ["deployment_info_branch_exact", "deployment_info_branch_mismatch"],
  ["deployment_info_sha_exact", "deployment_info_sha_mismatch"],
  ["deployment_timestamp_present", "deployment_timestamp_missing"],
  ["deployment_timestamp_current", "deployment_timestamp_stale"],
  ["connector_agent_http_ok", "connector_agent_http_failed"],
];
let firstFailure = null;
for (const [check, code] of orderedChecks) {
  if (!checks[check]) {
    firstFailure = { code, check };
    break;
  }
}

function excerpt(value, maxChars) {
  const serialized = JSON.stringify(value);
  return serialized.length <= maxChars ? serialized : `${serialized.slice(0, maxChars)}[TRUNCATED]`;
}

const diagnostic = {
  contract: "mad4b.production-deployment-info-diagnostic.v1",
  generated_at: new Date().toISOString(),
  expected_production_sha: expectedSha,
  expected_branch: expectedBranch,
  expected_deployed_after: expectedDeployedAfter,
  outcome: firstFailure ? "failed" : "passed",
  first_failure: firstFailure,
  coherent_direct_top_level_identity: {
    branch_key: branch.key,
    branch: branch.value,
    sha_key: sha.key,
    sha: sha.value,
    deployed_at_key: deployedAt.key,
    deployed_at: deployedAt.value,
    release_path_key: releasePath.key,
    release_path: releasePath.value,
  },
  checks,
  http_status: Object.fromEntries(Object.entries(endpoints).map(([name, item]) => [name, item.http_status])),
  endpoint_errors: Object.fromEntries(Object.entries(endpoints).map(([name, item]) => [name, item.error || item.parse_error || null])),
  version_excerpt: excerpt(endpoints.version.body, 2_000),
  deployment_info_excerpt: excerpt(endpoints.deployment_info.body, 6_000),
  connector_agent_excerpt: excerpt(endpoints.connector_agent_version.body, 1_500),
  side_effects: {
    repository_mutation_performed: false,
    provider_dispatch_performed: false,
    credential_access_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    restart_performed: false,
    sql_execution_performed: false,
    migration_apply_performed: false,
    database_mutation_performed: false,
    external_send_performed: false,
  },
  secrets_included: false,
  diagnostic_capture_intentional: true,
};

console.log(JSON.stringify(diagnostic));
console.error("DIAGNOSTIC_CAPTURE_COMPLETE: intentional nonzero exit so canonical E2E Artifact retains the bounded redacted stdout packet.");
process.exit(42);
