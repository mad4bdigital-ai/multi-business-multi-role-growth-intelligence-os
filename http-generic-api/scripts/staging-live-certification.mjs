#!/usr/bin/env node
import { createPublicKey } from "node:crypto";
import {
  classifyEnvironmentCertification,
  loadActivationGatewayProfilePolicy,
  readEnvironmentConvergenceRegistry,
} from "../environmentConvergenceRegistry.js";

const CONTRACT = "mad4b.staging-live-certification.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;
const convergenceRegistry = readEnvironmentConvergenceRegistry();

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

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function resolveGatewayProbeTarget(env, gatewayPolicy) {
  const canonical = normalizeUrl(null, `https://${gatewayPolicy.public_host}`);
  const overrideValue = String(env.STAGING_CERT_GATEWAY_BASE_URL || "").trim();
  if (!overrideValue) {
    return {
      ok: true,
      url: canonical,
      source: "environment_profile",
      profile_origin: canonical.origin,
      resolved_origin: canonical.origin,
      override_present: false,
      synthetic_loopback_fixture: false,
      caller_override_allowed: false,
      reason: null,
      secrets_included: false,
    };
  }

  let candidate = null;
  try {
    candidate = normalizeUrl(overrideValue);
  } catch {
    return {
      ok: false,
      url: null,
      source: "rejected_override",
      profile_origin: canonical.origin,
      resolved_origin: null,
      override_present: true,
      synthetic_loopback_fixture: false,
      caller_override_allowed: false,
      reason: "gateway_override_invalid_url",
      secrets_included: false,
    };
  }

  const explicitFixture = bool(env.STAGING_CERT_SYNTHETIC_LOOPBACK_FIXTURE, false);
  const loopback = isLoopbackHost(candidate.hostname);
  const allowed = explicitFixture && loopback && ["http:", "https:"].includes(candidate.protocol);
  if (!allowed) {
    return {
      ok: false,
      url: null,
      source: "rejected_override",
      profile_origin: canonical.origin,
      resolved_origin: candidate.origin,
      override_present: true,
      synthetic_loopback_fixture: false,
      caller_override_allowed: false,
      reason: explicitFixture ? "gateway_fixture_override_must_be_loopback" : "gateway_live_override_forbidden",
      secrets_included: false,
    };
  }

  return {
    ok: true,
    url: candidate,
    source: "synthetic_loopback_fixture",
    profile_origin: canonical.origin,
    resolved_origin: candidate.origin,
    override_present: true,
    synthetic_loopback_fixture: true,
    caller_override_allowed: true,
    reason: null,
    secrets_included: false,
  };
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

function inspectStagingRecoveryTrustedIngress(env, { expectedCommit, gatewayPolicy }) {
  const mode = String(env.REMOTE_MCP_TRUSTED_INGRESS_MODE || "").trim().toLowerCase();
  const proxyHeadersEnabled = bool(env.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS, false);
  const callerHeadersStripped = bool(env.REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS, false);
  const rawPublicKey = String(env.REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY || "").trim();
  const publicKeyPem = rawPublicKey.includes("\\n") ? rawPublicKey.replaceAll("\\n", "\n") : rawPublicKey;
  let publicKeyEd25519 = false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    publicKeyEd25519 = publicKey.asymmetricKeyType === "ed25519";
  } catch { }
  const keyId = String(env.REMOTE_MCP_TRUSTED_INGRESS_KEY_ID || "").trim();
  const canonicalHost = String(env.REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST || "").trim().toLowerCase();
  const audience = String(env.REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE || "").trim();
  const issuer = String(env.REMOTE_MCP_TRUSTED_INGRESS_ISSUER || "").trim();
  const deploymentSha = String(env.REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA || "").trim().toLowerCase();
  const replayDirectory = String(env.RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY || "").trim();
  const expectedHost = String(gatewayPolicy?.public_host || "").trim().toLowerCase();
  const expectedAudience = String(gatewayPolicy?.upstream_origin || "").trim();
  const expectedIssuer = expectedHost ? `https://${expectedHost}` : "";
  const checks = {
    signature_mode: mode === "signature",
    proxy_headers_enabled: proxyHeadersEnabled,
    caller_headers_stripped: callerHeadersStripped,
    public_key_ed25519: publicKeyEd25519,
    key_id_valid: /^[A-Za-z0-9._:-]{16,128}$/u.test(keyId),
    canonical_host_exact: Boolean(expectedHost) && canonicalHost === expectedHost,
    audience_exact: Boolean(expectedAudience) && audience === expectedAudience,
    issuer_exact: Boolean(expectedIssuer) && issuer === expectedIssuer,
    deployment_sha_exact: SHA_RE.test(deploymentSha) && deploymentSha === expectedCommit,
    replay_directory_exact: replayDirectory === "/app/data/recovery-ingress",
  };
  return {
    ready: Object.values(checks).every((value) => value === true),
    checks,
    expected: {
      canonical_host: expectedHost || null,
      audience: expectedAudience || null,
      issuer: expectedIssuer || null,
      deployment_sha: expectedCommit,
      replay_directory: "/app/data/recovery-ingress",
    },
    observed: {
      mode: mode || null,
      canonical_host: canonicalHost || null,
      audience: audience || null,
      issuer: issuer || null,
      deployment_sha: deploymentSha || null,
      replay_directory: replayDirectory || null,
      key_id_present: Boolean(keyId),
      public_key_configured: Boolean(rawPublicKey),
      public_key_ed25519: publicKeyEd25519,
    },
    raw_public_key_exposed: false,
    secrets_included: false,
  };
}

const expectedCommit = String(
  process.env.STAGING_CERT_EXPECTED_COMMIT ||
  process.env.DEPLOYMENT_EXPECTED_COMMIT_SHA ||
  process.env.DEPLOY_COMMIT ||
  ""
).trim().toLowerCase();
const expectedBranch = String(process.env.STAGING_CERT_EXPECTED_BRANCH || process.env.DEPLOY_BRANCH || "main").trim();
const expectedTree = String(process.env.STAGING_CERT_EXPECTED_TREE || "").trim().toLowerCase();
const expectedContextFileSet = String(process.env.STAGING_CERT_EXPECTED_CONTEXT_FILE_SET_SHA256 || "").trim().toLowerCase();
const expectedImageDigest = String(process.env.STAGING_CERT_APP_IMAGE_ID || "").trim().toLowerCase();
const appBase = normalizeUrl(process.env.STAGING_CERT_APP_BASE_URL, "http://127.0.0.1:8080");
const requireReady = bool(process.env.STAGING_CERT_REQUIRE_READY, false);
const requireGateway = bool(
  process.env.STAGING_CERT_REQUIRE_GATEWAY,
  bool(process.env.ACTIVATION_STAGING_GATEWAY_ENABLED, false),
);
const requireGatewayUpstream = bool(process.env.STAGING_CERT_REQUIRE_GATEWAY_UPSTREAM, false);

if (!SHA_RE.test(expectedCommit)) {
  console.error("STAGING_CERT_EXPECTED_COMMIT must be an exact lowercase 40-character SHA");
  process.exit(1);
}
if (!expectedBranch) {
  console.error("STAGING_CERT_EXPECTED_BRANCH is required");
  process.exit(1);
}
if (!/^[0-9a-f]{40}$/u.test(expectedTree)) {
  console.error("STAGING_CERT_EXPECTED_TREE must be an exact lowercase 40-character tree SHA");
  process.exit(1);
}
if (!/^[0-9a-f]{64}$/u.test(expectedContextFileSet)) {
  console.error("STAGING_CERT_EXPECTED_CONTEXT_FILE_SET_SHA256 must be an exact lowercase 64-character digest");
  process.exit(1);
}
if (expectedImageDigest && !/^sha256:[0-9a-f]{64}$/u.test(expectedImageDigest)) {
  console.error("STAGING_CERT_APP_IMAGE_ID must be a sha256 content digest when supplied");
  process.exit(1);
}

const gw = { resolution: null, load_error: null };
if (requireGateway) {
  try {
    gw.resolution = loadActivationGatewayProfilePolicy("staging", {
      registry: convergenceRegistry,
    });
  } catch (error) {
    gw.load_error = String(error?.message || "activation_gateway_canonical_policy_unavailable").slice(0, 256);
  }
}
const gatewayProfile = convergenceRegistry.profiles.staging.activation_gateway;
const gatewayPolicy = gw.resolution?.policy || null;
const gatewayPolicyPath = gw.resolution?.canonical_policy_path || gatewayProfile.policy_path || null;

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
const appManifest = body.deployment || {};
const observedImageDigest = String(appManifest.image_digest || "").trim().toLowerCase();
const artifactSetChecks = [
  check("app_tree_exact", appManifest.tree_sha === expectedTree, { expected: expectedTree, observed: appManifest.tree_sha || null }),
  check("app_context_file_set_exact", appManifest.context_file_set_sha256 === expectedContextFileSet, { expected: expectedContextFileSet, observed: appManifest.context_file_set_sha256 || null }),
  check("app_image_digest_present", /^sha256:[0-9a-f]{64}$/u.test(observedImageDigest), { observed: observedImageDigest || null }),
  ...(expectedImageDigest ? [check("app_image_digest_exact", observedImageDigest === expectedImageDigest, { expected: expectedImageDigest, observed: observedImageDigest || null })] : []),
  check("app_manifest_secret_free", appManifest.secrets_included === false, { observed: appManifest.secrets_included ?? null }),
];

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
  ...artifactSetChecks,
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
  loaded_policy_path: gw.resolution?.loaded_policy_path || null,
  policy_source: gw.resolution?.policy_source || null,
  expected_policy_hash: gatewayProfile.expected_policy_hash || null,
  expected_source_commit: expectedCommit,
  public_host: gatewayProfile.public_host || null,
  profile_validation: gw.resolution?.validation || null,
  probe_target: null,
  recovery_trusted_ingress: null,
  health: null,
  ready: null,
};

if (requireGateway) {
  if (!gw.resolution || !gatewayPolicy) {
    integrityChecks.push(check("gateway_environment_profile_current", false, {
      environment: "staging",
      policy_path: gatewayPolicyPath,
      error: gw.load_error,
      caller_policy_override_allowed: false,
    }));
  } else {
    const profileValidation = gw.resolution.validation;
    integrityChecks.push(check("gateway_environment_profile_current", profileValidation.ok, {
      environment: profileValidation.environment,
      expected_policy_key: profileValidation.expected_policy_key,
      observed_policy_key: profileValidation.observed_policy_key,
      expected_policy_hash: profileValidation.expected_policy_hash,
      observed_policy_hash: profileValidation.observed_policy_hash,
      expected_public_host: profileValidation.expected_public_host,
      observed_public_host: profileValidation.observed_public_host,
      policy_path: profileValidation.policy_path,
      loaded_policy_path: gw.resolution.loaded_policy_path,
      policy_source: gw.resolution.policy_source,
      caller_policy_override_allowed: false,
      checks: profileValidation.checks,
    }));

    if (profileValidation.ok) {
      const recoveryTrustedIngress = inspectStagingRecoveryTrustedIngress(process.env, {
        expectedCommit,
        gatewayPolicy,
      });
      gatewayEvidence.recovery_trusted_ingress = recoveryTrustedIngress;
      readinessChecks.push(check(
        "gateway_recovery_trusted_ingress",
        recoveryTrustedIngress.ready,
        recoveryTrustedIngress,
        "readiness",
      ));

      const probeTarget = resolveGatewayProbeTarget(process.env, gatewayPolicy);
      gatewayEvidence.probe_target = {
        source: probeTarget.source,
        profile_origin: probeTarget.profile_origin,
        resolved_origin: probeTarget.resolved_origin,
        override_present: probeTarget.override_present,
        synthetic_loopback_fixture: probeTarget.synthetic_loopback_fixture,
        caller_override_allowed: probeTarget.caller_override_allowed,
        reason: probeTarget.reason,
        secrets_included: false,
      };
      integrityChecks.push(check("gateway_probe_target_profile_bound", probeTarget.ok, gatewayEvidence.probe_target));

      if (probeTarget.ok) {
        const health = await fetchJson(new URL("/health", probeTarget.url));
        const gatewayHealthUsable = health.ok && health.body !== null && typeof health.body === "object";
        gatewayEvidence.health = health.body || { status: health.status, error: health.error || null };
        integrityChecks.push(check("gateway_health_reachable", gatewayHealthUsable, {
          status: health.status,
          error: health.error || null,
          json_body_available: health.body !== null,
        }));
        if (gatewayHealthUsable) {
          readinessChecks.push(check("gateway_policy_not_stale", health.body.ok === true && health.body.stale === false, {
            stale: health.body.stale ?? null,
            source_commit: health.body.sourceCommit || null,
          }, "readiness"));
          readinessChecks.push(check("gateway_exact_commit", String(health.body.sourceCommit || "").trim().toLowerCase() === expectedCommit, {
            expected: expectedCommit,
            observed: health.body.sourceCommit || null,
          }, "readiness"));
          readinessChecks.push(check("gateway_policy_hash_current", health.body.policyHash === gatewayProfile.expected_policy_hash, {
            expected: gatewayProfile.expected_policy_hash,
            observed: health.body.policyHash || null,
          }, "readiness"));
          readinessChecks.push(check("gateway_policy_key_current", health.body.policyKey === gatewayProfile.policy_key, {
            expected: gatewayProfile.policy_key || null,
            observed: health.body.policyKey || null,
          }, "readiness"));
          readinessChecks.push(check("gateway_health_secret_free", health.body.secretsIncluded === false, health.body.secretsIncluded ?? null, "readiness"));
        }
        if (requireGatewayUpstream) {
          const ready = await fetchJson(new URL("/ready", probeTarget.url));
          gatewayEvidence.ready = ready.body || { status: ready.status, error: ready.error || null };
          readinessChecks.push(check("gateway_upstream_ready", ready.ok && ready.body?.ok === true && ready.body?.upstreamReady === true, {
            status: ready.status,
            upstream_ready: ready.body?.upstreamReady ?? null,
            error: ready.error || ready.body?.error?.code || null,
          }, "readiness"));
        }
      }
    }
  }
}

const integrityFailed = integrityChecks.filter((entry) => !entry.ok);
const readinessFailed = readinessChecks.filter((entry) => !entry.ok);
const outcome = integrityFailed.length > 0 ? "blocked" : readinessFailed.length > 0 ? "degraded" : "ready";
const gatewayExactCommitSatisfied = !requireGateway
  || readinessChecks.some((entry) => entry.key === "gateway_exact_commit" && entry.ok);
const gatewayRecoveryTrustedIngressSatisfied = !requireGateway
  || readinessChecks.some((entry) => entry.key === "gateway_recovery_trusted_ingress" && entry.ok);

const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  outcome,
  ready: outcome === "ready",
  expected: {
    branch: expectedBranch,
    commit_sha: expectedCommit,
    tree_sha: expectedTree,
    context_file_set_sha256: expectedContextFileSet,
    image_digest: expectedImageDigest || null,
    activation_gateway_policy_hash: gatewayProfile.expected_policy_hash || null,
    app_base_url: appBase.origin,
  },
  observed: {
    branch: body.branch || null,
    commit_sha: body.commit_sha || body.commit || null,
    app_env: body.app_env || null,
    runtime_integrity_state: runtimeIntegrity?.state || null,
    combined_database_status: combined?.status || null,
    app_tree_sha: appManifest.tree_sha || null,
    app_context_file_set_sha256: appManifest.context_file_set_sha256 || null,
    app_image_digest: observedImageDigest || null,
  },
  artifact_set: {
    complete: artifactSetChecks.every((entry) => entry.ok)
      && gatewayExactCommitSatisfied
      && gatewayRecoveryTrustedIngressSatisfied,
    app: {
      source_commit: body.commit_sha || body.commit || null,
      tree_sha: appManifest.tree_sha || null,
      context_file_set_sha256: appManifest.context_file_set_sha256 || null,
      image_digest: observedImageDigest || null,
      secrets_included: appManifest.secrets_included ?? null,
    },
    gateway: {
      source_commit: gatewayEvidence.health?.sourceCommit || null,
      policy_hash: gatewayEvidence.health?.policyHash || null,
      expected_policy_hash: gatewayEvidence.expected_policy_hash,
      signed_attestation_required: requireGateway,
      recovery_trusted_ingress_ready: gatewayEvidence.recovery_trusted_ingress?.ready ?? null,
    },
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

report.convergence = classifyEnvironmentCertification(report, {
  environment: "staging",
  registry: convergenceRegistry,
});

console.log(JSON.stringify(report));
if (outcome === "blocked" || (requireReady && outcome !== "ready")) process.exitCode = 1;
