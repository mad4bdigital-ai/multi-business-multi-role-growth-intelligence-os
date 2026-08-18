#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT = "mad4b.staging-live-certification.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;
const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const repositoryRoot = path.resolve(apiRoot, "..");

function bool(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function normalizeUrl(value, fallback) {
  const url = new URL(String(value || fallback));
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url;
}

function readGatewayPolicy() {
  const configured = String(process.env.STAGING_CERT_GATEWAY_POLICY_PATH || "").trim();
  const candidates = [
    configured,
    path.join(repositoryRoot, "edge/activation-gateway/generated/route-policy.staging.json"),
    path.join(apiRoot, "staging-route-policy.json"),
    "/app/staging-route-policy.json",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return { path: candidate, policy: JSON.parse(fs.readFileSync(candidate, "utf8")) };
    } catch { }
  }
  return { path: null, policy: null };
}

async function fetchJson(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    let body = null;
    try { body = await response.json(); } catch { }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: String(error?.name || error?.code || "fetch_failed").slice(0, 128),
    };
  } finally {
    clearTimeout(timer);
  }
}

function check(key, ok, detail = null, severity = "blocking") {
  return { key, ok: ok === true, detail, severity };
}

const expectedCommit = String(
  process.env.STAGING_CERT_EXPECTED_COMMIT ||
  process.env.DEPLOYMENT_EXPECTED_COMMIT_SHA ||
  process.env.DEPLOY_COMMIT ||
  ""
).trim().toLowerCase();
const expectedBranch = String(process.env.STAGING_CERT_EXPECTED_BRANCH || process.env.DEPLOY_BRANCH || "main").trim();
const appBase = normalizeUrl(process.env.STAGING_CERT_APP_BASE_URL, "http://127.0.0.1:8080");
const requireReady = bool(process.env.STAGING_CERT_REQUIRE_READY, false);
const requireGateway = bool(
  process.env.STAGING_CERT_REQUIRE_GATEWAY,
  bool(process.env.ACTIVATION_STAGING_GATEWAY_ENABLED, false),
);
const requireGatewayUpstream = bool(process.env.STAGING_CERT_REQUIRE_GATEWAY_UPSTREAM, false);
const { path: gatewayPolicyPath, policy: gatewayPolicy } = readGatewayPolicy();

if (!SHA_RE.test(expectedCommit)) {
  console.error("STAGING_CERT_EXPECTED_COMMIT must be an exact lowercase 40-character SHA");
  process.exit(1);
}
if (!expectedBranch) {
  console.error("STAGING_CERT_EXPECTED_BRANCH is required");
  process.exit(1);
}

const deploymentUrl = new URL("/deployment-info", appBase);
deploymentUrl.searchParams.set("include_governance_db_readiness", "1");
deploymentUrl.searchParams.set("include_mcp_catalog_schema_readiness", "1");
deploymentUrl.searchParams.set("include_production_activation_readiness", "1");

const deployment = await fetchJson(deploymentUrl);
const body = deployment.body || {};
const combined = body.production_activation_readiness || null;
const runtimeIntegrity = body.runtime_integrity || null;
const mcpReadiness = body.mcp_catalog_schema_readiness || null;
const governanceReadiness = body.governance_db_privilege_readiness || null;

const integrityChecks = [
  check("deployment_info_reachable", deployment.ok, { status: deployment.status, error: deployment.error || null }),
  check("exact_commit", String(body.commit_sha || body.commit || "").toLowerCase() === expectedCommit, {
    expected: expectedCommit,
    observed: body.commit_sha || body.commit || null,
  }),
  check("exact_branch", String(body.branch || "") === expectedBranch, { expected: expectedBranch, observed: body.branch || null }),
  check("staging_app_environment", String(body.app_env || "").toLowerCase() === "staging", { observed: body.app_env || null }),
  check("runtime_integrity_verified", runtimeIntegrity?.verified === true, {
    state: runtimeIntegrity?.state || null,
    reason_codes: runtimeIntegrity?.reason_codes || [],
    provenance_verified: runtimeIntegrity?.provenance_verified === true,
  }),
  check("runtime_integrity_read_only", runtimeIntegrity?.read_only_check === true, runtimeIntegrity?.read_only_check ?? null),
  check("deployment_evidence_secret_free", body.evidence?.secrets_included === false, body.evidence?.secrets_included ?? null),
];

const readinessChecks = [
  check("combined_database_readiness", combined?.ready === true && combined?.ok === true, {
    status: combined?.status || null,
    checks: combined?.checks || null,
  }, "readiness"),
  check("mcp_catalog_schema_ready", mcpReadiness?.ok === true, {
    status: mcpReadiness?.status || null,
    reason: mcpReadiness?.reason || mcpReadiness?.code || null,
    migration: mcpReadiness?.migration || mcpReadiness?.required_migration || null,
  }, "readiness"),
  check("governance_db_privilege_ready", governanceReadiness?.ready === true, {
    status: governanceReadiness?.status || null,
    reason: governanceReadiness?.reason || governanceReadiness?.code || null,
  }, "readiness"),
  check("combined_readiness_is_read_only", combined?.read_only_probe === true && combined?.sql_mutation_performed === false && combined?.migration_apply_performed === false && combined?.provider_mutation_performed === false, {
    read_only_probe: combined?.read_only_probe ?? null,
    sql_mutation_performed: combined?.sql_mutation_performed ?? null,
    migration_apply_performed: combined?.migration_apply_performed ?? null,
    provider_mutation_performed: combined?.provider_mutation_performed ?? null,
  }, "readiness"),
  check("combined_readiness_secret_free", combined?.secrets_included === false, combined?.secrets_included ?? null, "readiness"),
];

let gatewayEvidence = {
  required: requireGateway,
  policy_path: gatewayPolicyPath,
  expected_policy_hash: gatewayPolicy?.content_hash_sha256 || null,
  public_host: gatewayPolicy?.public_host || null,
  health: null,
  ready: null,
};

if (requireGateway) {
  if (!gatewayPolicy?.public_host || !gatewayPolicy?.content_hash_sha256) {
    readinessChecks.push(check("gateway_policy_source_available", false, { policy_path: gatewayPolicyPath }, "readiness"));
  } else {
    const gatewayBase = normalizeUrl(
      process.env.STAGING_CERT_GATEWAY_BASE_URL,
      `https://${gatewayPolicy.public_host}`,
    );
    const health = await fetchJson(new URL("/health", gatewayBase));
    gatewayEvidence.health = health.body || { status: health.status, error: health.error || null };
    readinessChecks.push(check("gateway_health_reachable", health.ok, { status: health.status, error: health.error || null }, "readiness"));
    readinessChecks.push(check("gateway_policy_not_stale", health.body?.ok === true && health.body?.stale === false, {
      stale: health.body?.stale ?? null,
      source_commit: health.body?.sourceCommit || null,
    }, "readiness"));
    readinessChecks.push(check("gateway_policy_hash_current", health.body?.policyHash === gatewayPolicy.content_hash_sha256, {
      expected: gatewayPolicy.content_hash_sha256,
      observed: health.body?.policyHash || null,
    }, "readiness"));
    readinessChecks.push(check("gateway_policy_key_current", health.body?.policyKey === gatewayPolicy.policy_key, {
      expected: gatewayPolicy.policy_key || null,
      observed: health.body?.policyKey || null,
    }, "readiness"));
    readinessChecks.push(check("gateway_health_secret_free", health.body?.secretsIncluded === false, health.body?.secretsIncluded ?? null, "readiness"));
    if (requireGatewayUpstream) {
      const ready = await fetchJson(new URL("/ready", gatewayBase));
      gatewayEvidence.ready = ready.body || { status: ready.status, error: ready.error || null };
      readinessChecks.push(check("gateway_upstream_ready", ready.ok && ready.body?.ok === true && ready.body?.upstreamReady === true, {
        status: ready.status,
        upstream_ready: ready.body?.upstreamReady ?? null,
        error: ready.error || ready.body?.error?.code || null,
      }, "readiness"));
    }
  }
}

const integrityFailed = integrityChecks.filter((entry) => !entry.ok);
const readinessFailed = readinessChecks.filter((entry) => !entry.ok);
const outcome = integrityFailed.length > 0 ? "blocked" : readinessFailed.length > 0 ? "degraded" : "ready";

const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  outcome,
  ready: outcome === "ready",
  expected: {
    branch: expectedBranch,
    commit_sha: expectedCommit,
    app_base_url: appBase.origin,
  },
  observed: {
    branch: body.branch || null,
    commit_sha: body.commit_sha || body.commit || null,
    app_env: body.app_env || null,
    runtime_integrity_state: runtimeIntegrity?.state || null,
    combined_database_status: combined?.status || null,
  },
  integrity_checks: integrityChecks,
  readiness_checks: readinessChecks,
  blocking_failures: integrityFailed.map((entry) => entry.key),
  degraded_reasons: readinessFailed.map((entry) => entry.key),
  gateway: gatewayEvidence,
  safety: {
    read_only_probe: true,
    database_mutation: false,
    migration_apply: false,
    provider_mutation: false,
    production_deploy: false,
    ruleset_mutation: false,
    secrets_included: false,
  },
};

console.log(JSON.stringify(report));
if (outcome === "blocked" || (requireReady && outcome !== "ready")) process.exitCode = 1;
