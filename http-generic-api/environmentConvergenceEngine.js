import { createHash } from "node:crypto";
import {
  classifyEnvironmentCertification,
  getEnvironmentConvergenceProfile,
  readEnvironmentConvergenceRegistry,
  validateEnvironmentConvergenceRegistry,
} from "./environmentConvergenceRegistry.js";

const SHA_RE = /^[0-9a-f]{40}$/u;

function compact(value) {
  return String(value ?? "").trim();
}

function normalizeEnvironment(value) {
  return compact(value).toLowerCase();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function planHash(planBody) {
  return createHash("sha256").update(canonicalJson(planBody)).digest("hex");
}

function validateReleaseSpec(releaseSpec, profile, registry) {
  const repository = compact(releaseSpec?.repository);
  const sourceBranch = compact(releaseSpec?.source_branch);
  const commitSha = compact(releaseSpec?.commit_sha).toLowerCase();
  const errors = [];
  if (!repository) errors.push("release_repository_required");
  if (!sourceBranch) errors.push("release_source_branch_required");
  if (!SHA_RE.test(commitSha)) errors.push("release_commit_sha_invalid");
  if (sourceBranch && sourceBranch !== compact(profile?.source_branch)) {
    errors.push("release_source_branch_profile_mismatch");
  }
  return {
    ok: errors.length === 0,
    errors,
    release_spec: {
      contract: registry?.release_spec?.contract || "mad4b.environment-release-spec.v1",
      repository: repository || null,
      source_branch: sourceBranch || null,
      commit_sha: SHA_RE.test(commitSha) ? commitSha : (commitSha || null),
    },
  };
}

function approvalMatches(plan, approval) {
  if (!approval || typeof approval !== "object") return false;
  return approval.contract === "mad4b.environment-convergence-approval.v1"
    && compact(approval.plan_sha256).toLowerCase() === plan.plan_sha256
    && normalizeEnvironment(approval.environment) === plan.environment
    && compact(approval.commit_sha).toLowerCase() === plan.release_spec.commit_sha;
}

export function buildEnvironmentConvergencePlan({
  environment,
  releaseSpec,
  classification,
  registry = readEnvironmentConvergenceRegistry(),
} = {}) {
  const registryValidation = validateEnvironmentConvergenceRegistry(registry);
  if (!registryValidation.ok) {
    throw new Error(`environment_convergence_registry_invalid:${registryValidation.errors.join(",")}`);
  }

  const environmentKey = normalizeEnvironment(environment);
  const profile = getEnvironmentConvergenceProfile(environmentKey, registry);
  const releaseValidation = validateReleaseSpec(releaseSpec, profile, registry);
  if (!releaseValidation.ok) {
    throw new Error(`environment_release_spec_invalid:${releaseValidation.errors.join(",")}`);
  }
  if (classification?.status !== "reconciliation_required") {
    throw new Error(`environment_convergence_plan_not_required:${classification?.status || "unknown"}`);
  }

  const governedFailures = (classification.classified_failures || []).filter(
    (entry) => entry?.repairability === "governed" && entry?.handoff,
  );
  if (governedFailures.length === 0) {
    throw new Error("environment_convergence_governed_drift_missing");
  }

  const firstHandoff = governedFailures[0].handoff;
  const body = {
    contract: "mad4b.environment-convergence-plan.v1",
    state_machine: registry.state_machine.key,
    environment: environmentKey,
    release_spec: releaseValidation.release_spec,
    component: "activation_gateway",
    profile_binding: {
      source_branch: profile.source_branch,
      runtime_adapter: profile.runtime_adapter,
      mutation_policy: profile.mutation_policy,
      policy_key: profile.activation_gateway?.policy_key || null,
      policy_path: profile.activation_gateway?.policy_path || null,
      public_host: profile.activation_gateway?.public_host || null,
    },
    drift: governedFailures.map((entry) => ({
      check_key: entry.check_key,
      drift_class: entry.drift_class,
      failure_kind: entry.failure_kind,
      desired_release_commit: entry.desired_release_commit,
      observed_release_commit: entry.observed_release_commit,
    })),
    governed_handoff: {
      authority: firstHandoff.authority,
      current_authority_adapter: firstHandoff.current_authority_adapter,
      target_authority_model: firstHandoff.target_authority_model,
      plan_capability: firstHandoff.plan_capability,
      apply_capability: firstHandoff.apply_capability,
      profile_binding_required: firstHandoff.profile_binding_required === true,
      automatic_apply_allowed: false,
    },
    maximum_reconciliation_passes: Number(registry.state_machine.maximum_reconciliation_passes || 0),
    certification_is_final_judge: registry.state_machine.certification_is_final_judge === true,
    certification_may_mutate: false,
    safety: {
      mutation_performed: false,
      provider_mutation: false,
      database_mutation: false,
      production_deploy: false,
      workflow_dispatch: false,
      secrets_included: false,
    },
  };

  return deepFreeze({
    ...body,
    plan_sha256: planHash(body),
  });
}

export function runEnvironmentConvergence({
  environment = "staging",
  releaseSpec,
  certificationReport = {},
  approval = null,
  registry = readEnvironmentConvergenceRegistry(),
} = {}) {
  const registryValidation = validateEnvironmentConvergenceRegistry(registry);
  if (!registryValidation.ok) {
    return deepFreeze({
      contract: "mad4b.environment-convergence-run.v1",
      status: "blocked",
      current_stage: "observe",
      next_stage: null,
      errors: registryValidation.errors,
      stage_trace: [],
      safety: {
        mutation_performed: false,
        provider_mutation: false,
        database_mutation: false,
        production_deploy: false,
        workflow_dispatch: false,
        secrets_included: false,
      },
    });
  }

  const environmentKey = normalizeEnvironment(environment);
  const profile = getEnvironmentConvergenceProfile(environmentKey, registry);
  const releaseValidation = validateReleaseSpec(releaseSpec, profile, registry);
  const base = {
    contract: "mad4b.environment-convergence-run.v1",
    state_machine: registry.state_machine.key,
    environment: environmentKey,
    profile: {
      source_branch: profile.source_branch,
      runtime_adapter: profile.runtime_adapter,
      mutation_policy: profile.mutation_policy,
      policy_key: profile.activation_gateway?.policy_key || null,
      public_host: profile.activation_gateway?.public_host || null,
    },
    release_spec: releaseValidation.release_spec,
    safety: {
      mutation_performed: false,
      provider_mutation: false,
      database_mutation: false,
      production_deploy: false,
      workflow_dispatch: false,
      secrets_included: false,
    },
  };

  if (!releaseValidation.ok) {
    return deepFreeze({
      ...base,
      status: "blocked",
      current_stage: "observe",
      next_stage: null,
      errors: releaseValidation.errors,
      stage_trace: [],
      classification: null,
      plan: null,
      approval_checkpoint: null,
      governed_handoff: null,
    });
  }

  const classification = classifyEnvironmentCertification(certificationReport, {
    environment: environmentKey,
    registry,
  });
  const stageTrace = ["observe", "classify"];

  if (classification.status === "blocked") {
    return deepFreeze({
      ...base,
      status: "blocked",
      current_stage: "classify",
      next_stage: null,
      errors: [],
      stage_trace: stageTrace,
      classification,
      plan: null,
      approval_checkpoint: null,
      governed_handoff: null,
    });
  }

  if (classification.status === "converged") {
    return deepFreeze({
      ...base,
      status: "converged",
      current_stage: "certify",
      next_stage: null,
      errors: [],
      stage_trace: [...stageTrace, "certify"],
      classification,
      plan: null,
      approval_checkpoint: null,
      governed_handoff: null,
      certification_is_final_judge: true,
    });
  }

  if (classification.status !== "reconciliation_required") {
    return deepFreeze({
      ...base,
      status: classification.status,
      current_stage: "classify",
      next_stage: null,
      errors: [],
      stage_trace: stageTrace,
      classification,
      plan: null,
      approval_checkpoint: null,
      governed_handoff: null,
    });
  }

  const plan = buildEnvironmentConvergencePlan({
    environment: environmentKey,
    releaseSpec,
    classification,
    registry,
  });
  const approved = approvalMatches(plan, approval);
  const approvalCheckpoint = {
    contract: "mad4b.environment-convergence-approval-checkpoint.v1",
    required: true,
    status: approved ? "satisfied_for_handoff" : "approval_required",
    plan_sha256: plan.plan_sha256,
    environment: environmentKey,
    commit_sha: plan.release_spec.commit_sha,
    approval_is_execution_authority: false,
    provider_execution_performed: false,
  };

  if (!approved) {
    return deepFreeze({
      ...base,
      status: "approval_required",
      current_stage: "approval_checkpoint",
      next_stage: "approval_checkpoint",
      errors: [],
      stage_trace: [...stageTrace, "plan", "approval_checkpoint"],
      classification,
      plan,
      approval_checkpoint: approvalCheckpoint,
      governed_handoff: null,
    });
  }

  return deepFreeze({
    ...base,
    status: "handoff_ready",
    current_stage: "approval_checkpoint",
    next_stage: "apply",
    errors: [],
    stage_trace: [...stageTrace, "plan", "approval_checkpoint"],
    classification,
    plan,
    approval_checkpoint: approvalCheckpoint,
    governed_handoff: {
      ...plan.governed_handoff,
      plan_sha256: plan.plan_sha256,
      environment: environmentKey,
      commit_sha: plan.release_spec.commit_sha,
      execution_performed: false,
    },
  });
}
