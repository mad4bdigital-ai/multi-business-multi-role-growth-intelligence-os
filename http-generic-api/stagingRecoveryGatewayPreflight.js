import { getPool } from "./db.js";
import { getGovernancePool } from "./governanceDb.js";
import {
  buildActivationGatewayRolloutPlan,
  runActivationGatewayDarkDeploy,
} from "./activationGatewayRolloutTool.js";

export const STAGING_RECOVERY_GATEWAY_PREFLIGHT_CONTRACT = "mad4b.staging-recovery-gateway-preflight.v1";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ALLOWED_INPUT_KEYS = Object.freeze([
  "expected_source_commit",
  "expected_policy_hash",
  "environment_convergence_plan_sha256",
]);

function fail(code, message, status = 400, details = {}) {
  return Object.assign(new Error(message), {
    code,
    status,
    details: { ...details, secrets_included: false },
  });
}

function text(value, max = 256) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeStagingRecoveryGatewayPreflightInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw fail("STAGING_RECOVERY_GATEWAY_PREFLIGHT_INPUT_INVALID", "Gateway preflight input must be a JSON object.");
  }
  const unexpected = Object.keys(input).filter((key) => !ALLOWED_INPUT_KEYS.includes(key));
  if (unexpected.length) {
    throw fail(
      "STAGING_RECOVERY_GATEWAY_PREFLIGHT_FIELD_FORBIDDEN",
      "Gateway preflight accepts only exact release, policy, and caller-asserted convergence-plan bindings.",
      400,
      { fields: unexpected },
    );
  }
  const expectedSourceCommit = text(input.expected_source_commit, 64).toLowerCase();
  const expectedPolicyHash = text(input.expected_policy_hash, 128).toLowerCase();
  const convergencePlanSha256 = text(input.environment_convergence_plan_sha256, 128).toLowerCase();
  if (!SHA40_RE.test(expectedSourceCommit)) {
    throw fail("STAGING_RECOVERY_GATEWAY_EXPECTED_COMMIT_INVALID", "expected_source_commit must be an exact 40-character Git SHA.");
  }
  if (!SHA256_RE.test(expectedPolicyHash)) {
    throw fail("STAGING_RECOVERY_GATEWAY_POLICY_HASH_INVALID", "expected_policy_hash must be an exact SHA-256 digest.");
  }
  if (!SHA256_RE.test(convergencePlanSha256)) {
    throw fail("STAGING_RECOVERY_GATEWAY_CONVERGENCE_PLAN_INVALID", "environment_convergence_plan_sha256 must be an exact SHA-256 digest.");
  }
  return Object.freeze({
    expected_source_commit: expectedSourceCommit,
    expected_policy_hash: expectedPolicyHash,
    environment_convergence_plan_sha256: convergencePlanSha256,
  });
}

function executionDeps(deps = {}, auth = {}) {
  return {
    ...deps,
    runtimePool: deps.runtimePool || getPool(),
    governancePool: deps.governancePool || getGovernancePool(),
    auth,
    env: deps.env || process.env,
  };
}

function assertNoProviderAccess(result = {}) {
  const providerCalls = Number(result?.provider_calls_made || result?.provider_call_count || 0);
  if (result?.provider_accessed === true || result?.provider_mutation_performed === true || providerCalls > 0) {
    throw fail(
      "STAGING_RECOVERY_GATEWAY_PROVIDER_ACCESS_FORBIDDEN",
      "Staging Recovery Gateway preflight must not access or mutate the provider.",
      502,
      { provider_calls_made: Number.isFinite(providerCalls) ? providerCalls : 0 },
    );
  }
}

function convergenceBinding(input) {
  return {
    plan_sha256: input.environment_convergence_plan_sha256,
    binding_mode: "exact_digest_assertion",
    server_acknowledgement_verified: false,
    operator_acknowledgement_is_execution_authority: false,
    consequential_apply_authority_issued: false,
    secrets_included: false,
  };
}

export async function previewStagingRecoveryGatewayRollout(input = {}, deps = {}) {
  const normalized = normalizeStagingRecoveryGatewayPreflightInput(input);
  const builder = deps.buildRolloutPlan || buildActivationGatewayRolloutPlan;
  const result = await builder(
    { mode: "dry_run", ...normalized },
    executionDeps(deps, deps.auth || {}),
  );
  assertNoProviderAccess(result);
  return {
    ok: result?.ok === true,
    contract: STAGING_RECOVERY_GATEWAY_PREFLIGHT_CONTRACT,
    operation: "activation_gateway_rollout_plan",
    mode: "preview",
    environment: "staging",
    adapter: result?.adapter || "staging_activation_gateway_profile_apply",
    classification: result?.classification || "staging_activation_gateway_preview_unavailable",
    preflight_ready: result?.apply_ready === true,
    apply_ready: false,
    execution_plan_issued: false,
    execution_plan_identity_returned: false,
    expected_source_commit: normalized.expected_source_commit,
    expected_policy_hash: normalized.expected_policy_hash,
    environment_convergence_plan_sha256: normalized.environment_convergence_plan_sha256,
    convergence_binding: convergenceBinding(normalized),
    profile_binding: result?.profile_binding || null,
    resolved_resource_binding: result?.resource_binding || null,
    workspace: result?.workspace || null,
    checks: Array.isArray(result?.checks) ? result.checks : [],
    provider_target_caller_selectable: false,
    caller_selected_resource_binding: false,
    caller_selected_capability_envelope: false,
    provider_accessed: false,
    provider_mutation_performed: false,
    governance_state_mutation_performed: false,
    target_database_mutation_performed: false,
    production_mutation_performed: false,
    secrets_included: false,
  };
}

export async function prepareStagingRecoveryGatewayDarkDeployDryRun(input = {}, deps = {}) {
  const normalized = normalizeStagingRecoveryGatewayPreflightInput(input);
  const runner = deps.runDarkDeploy || runActivationGatewayDarkDeploy;
  const result = await runner(
    { mode: "dry_run", ...normalized },
    executionDeps(deps, deps.auth || {}),
  );
  assertNoProviderAccess(result);
  const governanceStateMutation = result?.governance_state_mutation === true;
  const executionPlanIssued = result?.apply_ready === true && governanceStateMutation;
  return {
    ...result,
    ok: result?.ok === true,
    contract: STAGING_RECOVERY_GATEWAY_PREFLIGHT_CONTRACT,
    operation: "activation_gateway_dark_deploy_dry_run",
    mode: "dry_run",
    environment: "staging",
    convergence_binding: convergenceBinding(normalized),
    execution_plan_issued: executionPlanIssued,
    apply_authority_issued: false,
    capability_envelope_issued: false,
    execution_nonce_issued: false,
    caller_selected_resource_binding: false,
    caller_selected_capability_envelope: false,
    provider_target_caller_selectable: false,
    provider_accessed: false,
    provider_mutation_performed: false,
    governance_state_mutation_performed: governanceStateMutation,
    target_database_mutation_performed: false,
    production_mutation_performed: false,
    database_mutation: governanceStateMutation,
    secrets_included: false,
  };
}

export const _testingStagingRecoveryGatewayPreflight = Object.freeze({
  ALLOWED_INPUT_KEYS,
  SHA40_RE,
  SHA256_RE,
  convergenceBinding,
  assertNoProviderAccess,
});
