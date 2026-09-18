#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runEnvironmentConvergence } from "../environmentConvergenceEngine.js";
import { readEnvironmentConvergenceRegistry } from "../environmentConvergenceRegistry.js";
import { buildStagingActivationGatewayBundle, stableJson } from "../stagingActivationGatewayBundle.js";

const SHA40_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const WORKFLOW = ".github/workflows/staging-main-deploy-eligibility.yml";
const ACK_CONTRACT = "mad4b.environment-convergence-operator-acknowledgement.v1";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function hashStable(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function failedReadinessCheck(key, detail) {
  return { key, ok: false, severity: "readiness", detail: { ...detail, secrets_included: false } };
}

export function buildStagingActivationWorkerPreflightBinding({
  sourceSha,
  expectedPolicyHash,
  authoritativePlanSha256,
  workerBundleSha256,
} = {}) {
  const body = {
    contract: "mad4b.staging.activation-worker-refresh-preflight-binding.v1",
    environment: "staging",
    source_sha: normalized(sourceSha),
    policy_hash: normalized(expectedPolicyHash),
    authoritative_plan_sha256: normalized(authoritativePlanSha256),
    worker_bundle_sha256: normalized(workerBundleSha256),
    workflow: WORKFLOW,
    dry_run_operation: "activation_worker_refresh_dry_run",
    apply_operation: "deploy_activation_worker",
    same_run_preflight_required: true,
    caller_plan_digest_is_execution_authority: false,
    provider_target_caller_selectable: false,
  };
  if (!SHA40_RE.test(body.source_sha)) fail("staging_activation_worker_binding_source_invalid", "Exact source SHA is required.");
  for (const [key, value] of [
    ["policy_hash", body.policy_hash],
    ["authoritative_plan_sha256", body.authoritative_plan_sha256],
    ["worker_bundle_sha256", body.worker_bundle_sha256],
  ]) {
    if (!SHA256_RE.test(value)) fail("staging_activation_worker_binding_digest_invalid", `${key} must be SHA-256.`, { key });
  }
  return Object.freeze({ ...body, preflight_binding_sha256: hashStable(body) });
}

export async function verifyStagingActivationWorkerHandoff({
  sourceSha,
  expectedPolicyHash,
  callerPlanSha256 = "",
  healthUrl = "https://activation-dev.mad4b.com/health",
  outputFile = null,
  fetchImpl = globalThis.fetch,
  repositoryRoot = "",
} = {}) {
  const source = normalized(sourceSha);
  const policyHash = normalized(expectedPolicyHash);
  const callerPlan = normalized(callerPlanSha256);
  if (!SHA40_RE.test(source)) fail("staging_activation_worker_source_invalid", "Exact current-main SHA is required.");
  if (!SHA256_RE.test(policyHash)) fail("staging_activation_worker_policy_invalid", "Exact canonical policy SHA-256 is required.");
  if (!SHA256_RE.test(callerPlan)) fail("staging_activation_worker_caller_plan_invalid", "An exact operator-acknowledged convergence plan SHA-256 is required.");

  const registry = readEnvironmentConvergenceRegistry();
  const profile = registry?.profiles?.staging?.activation_gateway;
  if (!profile) fail("staging_activation_worker_profile_missing", "Staging Activation Gateway profile is unavailable.");
  if (normalized(profile.expected_policy_hash) !== policyHash) {
    fail("staging_activation_worker_policy_profile_mismatch", "Requested policy hash is not the canonical Staging profile hash.");
  }
  const canonicalHealthUrl = `https://${profile.public_host}/health`;
  if (String(healthUrl || "").trim() !== canonicalHealthUrl) {
    fail("staging_activation_worker_health_target_override_forbidden", "Health target must be the profile-owned Staging Activation Gateway.");
  }
  if (typeof fetchImpl !== "function") fail("staging_activation_worker_fetch_unavailable", "A fetch implementation is required.");

  let response;
  let health;
  try {
    response = await fetchImpl(canonicalHealthUrl, {
      headers: { accept: "application/json" },
      signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(20_000) : undefined,
    });
    health = await response.json();
  } catch (error) {
    fail("staging_activation_worker_health_unavailable", "Staging Activation Gateway health could not be read.", {
      message: String(error?.message || error),
    });
  }
  if (!health || typeof health !== "object" || Array.isArray(health)) {
    fail("staging_activation_worker_health_invalid", "Staging Activation Gateway health must be JSON.");
  }
  const staleIdentity = health.service === "activation-gateway"
    && health.stale === true
    && (Number(response?.status || 0) === 503
      || health?.error?.code === "GATEWAY_POLICY_STALE"
      || health?.code === "GATEWAY_POLICY_STALE");
  if (!staleIdentity) {
    fail("staging_activation_worker_handoff_not_stale", "Out-of-band Worker recovery is allowed only for a cryptographically identified stale Staging Gateway.", {
      status: Number(response?.status || 0),
      service: health.service || null,
      stale: health.stale ?? null,
    });
  }
  if (health.secretsIncluded !== false) {
    fail("staging_activation_worker_health_secret_boundary_invalid", "Stale Gateway health must explicitly prove secretsIncluded=false.");
  }

  const readinessChecks = [
    failedReadinessCheck("gateway_policy_not_stale", {
      source: "github_actions_live_activation_gateway_health",
      stale: true,
      source_commit: health.sourceCommit || null,
      gateway_error_code: health?.error?.code || health?.code || null,
    }),
  ];
  if (normalized(health.sourceCommit) !== source) {
    readinessChecks.push(failedReadinessCheck("gateway_exact_commit", {
      source: "github_actions_live_activation_gateway_health",
      expected: source,
      observed: health.sourceCommit || null,
    }));
  }
  if (normalized(health.policyHash) !== policyHash) {
    readinessChecks.push(failedReadinessCheck("gateway_policy_hash_current", {
      source: "github_actions_live_activation_gateway_health",
      expected: policyHash,
      observed: health.policyHash || null,
    }));
  }
  if (String(health.policyKey || "") !== String(profile.policy_key || "")) {
    readinessChecks.push(failedReadinessCheck("gateway_policy_key_current", {
      source: "github_actions_live_activation_gateway_health",
      expected: profile.policy_key || null,
      observed: health.policyKey || null,
    }));
  }

  const certificationReport = {
    outcome: "degraded",
    expected: { commit_sha: source },
    gateway: { health: { sourceCommit: null } },
    integrity_checks: [],
    readiness_checks: readinessChecks,
  };
  const releaseSpec = { repository: REPOSITORY, source_branch: "main", commit_sha: source };
  const initialRun = runEnvironmentConvergence({
    environment: "staging",
    releaseSpec,
    certificationReport,
    registry,
  });
  if (initialRun.status !== "approval_required" || !initialRun.plan?.plan_sha256) {
    fail("staging_activation_worker_authoritative_plan_unavailable", "Live stale state did not yield an immutable governed convergence plan.", {
      status: initialRun.status || null,
    });
  }
  const handoff = initialRun.classification?.next_governed_handoff || {};
  if (handoff.target_authority_model !== "server_governed_out_of_band"
    || handoff.transport !== "github_actions"
    || handoff.workflow !== WORKFLOW
    || handoff.dry_run_operation !== "activation_worker_refresh_dry_run"
    || handoff.apply_operation !== "deploy_activation_worker"
    || handoff.requires_exact_main !== true
    || handoff.requires_same_run_preflight !== true
    || handoff.caller_selected_provider_target_allowed !== false
    || handoff.stale_gateway_bypass_required !== true
    || handoff.automatic_apply_allowed !== false) {
    fail("staging_activation_worker_handoff_contract_invalid", "Live convergence did not resolve to the bounded Staging out-of-band authority.");
  }

  const authoritativePlanSha256 = initialRun.plan.plan_sha256;
  if (callerPlan !== authoritativePlanSha256) {
    fail("staging_activation_worker_plan_assertion_mismatch", "Operator acknowledgement does not match the current workflow-owned Staging convergence plan.", {
      caller_plan_sha256: callerPlan,
      authoritative_plan_sha256: authoritativePlanSha256,
    });
  }
  const acknowledgement = {
    contract: ACK_CONTRACT,
    plan_sha256: callerPlan,
    environment: "staging",
    commit_sha: source,
  };
  const acknowledgedRun = runEnvironmentConvergence({
    environment: "staging",
    releaseSpec,
    certificationReport,
    operatorAcknowledgement: acknowledgement,
    registry,
  });
  if (acknowledgedRun.status !== "handoff_ready"
    || acknowledgedRun.operator_acknowledgement?.status !== "acknowledged_for_handoff"
    || acknowledgedRun.plan?.plan_sha256 !== authoritativePlanSha256
    || acknowledgedRun.governed_handoff?.execution_ready !== true
    || acknowledgedRun.governed_handoff?.execution_performed !== false) {
    fail("staging_activation_worker_handoff_not_ready", "The workflow-owned convergence plan did not reach a non-executing acknowledged handoff.");
  }

  const bundle = await buildStagingActivationGatewayBundle({ sourceSha: source, repositoryRoot });
  if (bundle.policy_hash !== policyHash || bundle.source_sha !== source) {
    fail("staging_activation_worker_bundle_identity_mismatch", "Exact-SHA Worker bundle does not match the authoritative policy/source identity.");
  }
  const binding = buildStagingActivationWorkerPreflightBinding({
    sourceSha: source,
    expectedPolicyHash: policyHash,
    authoritativePlanSha256,
    workerBundleSha256: bundle.worker_bundle_sha256,
  });
  const evidence = {
    contract: "mad4b.staging.activation-worker-refresh-dry-run.v2",
    operation: "activation_worker_refresh_dry_run",
    environment: "staging",
    source_sha: source,
    policy_hash: policyHash,
    caller_parent_convergence_plan_sha256: callerPlan,
    caller_plan_digest_matches_authoritative: true,
    caller_plan_digest_is_execution_authority: false,
    authoritative_plan_sha256: authoritativePlanSha256,
    authoritative_plan_source: "live_profile_owned_gateway_health_plus_environment_convergence_engine",
    authoritative_plan_status: acknowledgedRun.status,
    operator_acknowledgement_status: acknowledgedRun.operator_acknowledgement.status,
    operator_acknowledgement_is_execution_authority: false,
    worker_bundle_sha256: bundle.worker_bundle_sha256,
    preflight_binding_sha256: binding.preflight_binding_sha256,
    profile_owned_health_url: canonicalHealthUrl,
    observed_gateway: {
      status: Number(response?.status || 0),
      source_commit: health.sourceCommit || null,
      worker_build_sha: health.workerBuildSha || null,
      policy_key: health.policyKey || null,
      policy_hash: health.policyHash || null,
      stale: true,
    },
    stale_plan_identity_uses_desired_release_commit: true,
    stale_plan_observed_release_commit_in_hash: false,
    exact_current_main_required: true,
    same_run_preflight_required_for_apply: true,
    provider_target_caller_selectable: false,
    provider_accessed: false,
    provider_mutation_performed: false,
    database_mutation_performed: false,
    dns_mutation_performed: false,
    custom_domain_mutation_performed: false,
    production_mutation_performed: false,
    secrets_included: false,
    status: "handoff_ready",
  };
  if (outputFile) {
    await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
    await fs.writeFile(path.resolve(outputFile), stableJson(evidence), "utf8");
  }
  return Object.freeze(evidence);
}

function parseCli(argv) {
  const args = {};
  for (const item of argv.slice(2)) {
    const index = item.indexOf("=");
    const key = index === -1 ? item : item.slice(0, index);
    const value = index === -1 ? "" : item.slice(index + 1);
    if (key === "--source-sha") args.sourceSha = value;
    else if (key === "--expected-policy-hash") args.expectedPolicyHash = value;
    else if (key === "--caller-plan-sha256") args.callerPlanSha256 = value;
    else if (key === "--health-url") args.healthUrl = value;
    else if (key === "--output") args.outputFile = value;
    else fail("staging_activation_worker_argument_unknown", `Unknown argument: ${key}`);
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = await verifyStagingActivationWorkerHandoff(parseCli(process.argv));
    console.log(JSON.stringify({
      authoritative_plan_sha256: evidence.authoritative_plan_sha256,
      worker_bundle_sha256: evidence.worker_bundle_sha256,
      preflight_binding_sha256: evidence.preflight_binding_sha256,
      caller_plan_digest_is_execution_authority: false,
      status: evidence.status,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      status: "blocked",
      error: {
        code: error?.code || "staging_activation_worker_handoff_verification_failed",
        message: String(error?.message || error),
        details: error?.details || {},
      },
      provider_mutation_performed: false,
      production_mutation_performed: false,
      secrets_included: false,
    }));
    process.exitCode = 1;
  }
}
