import { createHash } from "node:crypto";
import {
  classifyEnvironmentCertification,
  getEnvironmentConvergenceProfile,
  readEnvironmentConvergenceRegistry,
  validateEnvironmentConvergenceRegistry,
} from "./environmentConvergenceRegistry.js";

const SHA_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

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
  const canonicalRepository = compact(registry?.release_spec?.canonical_repository);
  const sourceBranch = compact(releaseSpec?.source_branch);
  const commitSha = compact(releaseSpec?.commit_sha).toLowerCase();
  const expectedGatewayPolicyHash = compact(profile?.activation_gateway?.expected_policy_hash).toLowerCase();
  const suppliedGatewayPolicyHash = compact(releaseSpec?.activation_gateway_policy_hash).toLowerCase();
  const errors = [];

  if (!canonicalRepository) errors.push("release_canonical_repository_missing");
  if (!repository) errors.push("release_repository_required");
  if (repository && canonicalRepository && repository !== canonicalRepository) {
    errors.push("release_repository_canonical_mismatch");
  }
  if (!sourceBranch) errors.push("release_source_branch_required");
  if (!SHA_RE.test(commitSha)) errors.push("release_commit_sha_invalid");
  if (!SHA256_RE.test(expectedGatewayPolicyHash)) errors.push("release_gateway_policy_hash_profile_invalid");
  if (sourceBranch && sourceBranch !== compact(profile?.source_branch)) {
    errors.push("release_source_branch_profile_mismatch");
  }
  if (suppliedGatewayPolicyHash && suppliedGatewayPolicyHash !== expectedGatewayPolicyHash) {
    errors.push("release_gateway_policy_hash_profile_mismatch");
  }

  return {
    ok: errors.length === 0,
    errors,
    release_spec: {
      contract: registry?.release_spec?.contract || "mad4b.environment-release-spec.v1",
      repository: canonicalRepository || repository || null,
      source_branch: sourceBranch || null,
      commit_sha: SHA_RE.test(commitSha) ? commitSha : (commitSha || null),
      activation_gateway_policy_hash: expectedGatewayPolicyHash || null,
      canonical_repository_bound: Boolean(repository && canonicalRepository && repository === canonicalRepository),
    },
  };
}

function resolveEnvironmentExecutionTarget(environmentKey, profile) {
  const target = profile?.activation_gateway?.execution_target || {};
  const bundle = target?.bundle_binding || {};
  const resource = target?.resource_binding || {};
  const executionReady = profile?.activation_gateway?.governed_apply_ready === true;
  const errors = [];

  if (target.contract !== "mad4b.environment-convergence-execution-target.v1") {
    errors.push("execution_target_contract_invalid");
  }
  if (compact(target.component) !== "activation_gateway") {
    errors.push("execution_target_component_invalid");
  }
  if (!compact(target.target_key)) errors.push("execution_target_key_missing");
  if (!compact(bundle.bundle_key)) errors.push("execution_target_bundle_key_missing");
  if (compact(bundle.policy_path) !== compact(profile?.activation_gateway?.policy_path)) {
    errors.push("execution_target_policy_path_mismatch");
  }
  if (compact(resource.resource_type) !== "cloudflare_worker") {
    errors.push("execution_target_resource_type_invalid");
  }
  if (executionReady) {
    if (!compact(resource.resource_binding_id)) errors.push("execution_target_resource_binding_missing");
    if (!compact(target.runtime_surface)) errors.push("execution_target_runtime_surface_missing");
    if (compact(target.runtime_surface) !== compact(profile?.activation_gateway?.apply_capability)) {
      errors.push("execution_target_runtime_surface_capability_mismatch");
    }
  } else {
    if (compact(target.runtime_surface)) errors.push("execution_target_unready_runtime_surface_must_be_null");
    if (compact(resource.resource_binding_id)) errors.push("execution_target_unready_resource_binding_must_be_null");
  }

  if (errors.length > 0) {
    throw new Error(`environment_execution_target_invalid:${environmentKey}:${errors.join(",")}`);
  }

  return {
    contract: target.contract,
    environment: environmentKey,
    component: "activation_gateway",
    target_key: target.target_key,
    bundle_binding: {
      bundle_key: bundle.bundle_key,
      entrypoint: bundle.entrypoint || null,
      policy_path: bundle.policy_path,
    },
    resource_binding: {
      resource_type: resource.resource_type,
      resource_binding_id: resource.resource_binding_id || null,
    },
    runtime_surface: target.runtime_surface || null,
    execution_ready: executionReady,
    server_resolved: true,
    caller_target_override_allowed: false,
    secrets_included: false,
  };
}

function gatewayPolicyIdentity(certificationReport, profile) {
  const health = certificationReport?.gateway?.health || {};
  const profileValidation = certificationReport?.gateway?.profile_validation || {};
  const artifactGateway = certificationReport?.artifact_set?.gateway || {};
  const observedHash = compact(
    health?.policyHash
    || artifactGateway?.policy_hash
    || profileValidation?.observed_policy_hash,
  ).toLowerCase();
  const observedKey = compact(
    health?.policyKey
    || profileValidation?.observed_policy_key,
  );
  const observedHost = compact(profileValidation?.observed_public_host).toLowerCase();

  return {
    desired: {
      policy_key: profile?.activation_gateway?.policy_key || null,
      policy_hash_sha256: compact(profile?.activation_gateway?.expected_policy_hash).toLowerCase() || null,
      public_host: compact(profile?.activation_gateway?.public_host).toLowerCase() || null,
    },
    observed: {
      policy_key: observedKey || null,
      policy_hash_sha256: SHA256_RE.test(observedHash) ? observedHash : (observedHash || null),
      public_host: observedHost || null,
      source_commit: compact(health?.sourceCommit).toLowerCase() || null,
    },
  };
}

function acknowledgementMatches(plan, acknowledgement) {
  if (!acknowledgement || typeof acknowledgement !== "object") return false;
  const contractAccepted = acknowledgement.contract === "mad4b.environment-convergence-operator-acknowledgement.v1"
    || acknowledgement.contract === "mad4b.environment-convergence-approval.v1";
  return contractAccepted
    && compact(acknowledgement.plan_sha256).toLowerCase() === plan.plan_sha256
    && normalizeEnvironment(acknowledgement.environment) === plan.environment
    && compact(acknowledgement.commit_sha).toLowerCase() === plan.release_spec.commit_sha;
}

function buildAcknowledgementState(plan, supplied, matched) {
  return {
    contract: "mad4b.environment-convergence-operator-acknowledgement.v1",
    required: true,
    status: matched ? "acknowledged_for_handoff" : "acknowledgement_required",
    plan_sha256: plan.plan_sha256,
    environment: plan.environment,
    commit_sha: plan.release_spec.commit_sha,
    activation_gateway_policy_hash: plan.release_spec.activation_gateway_policy_hash,
    operator_acknowledgement_is_execution_authority: false,
    provider_execution_performed: false,
    legacy_approval_input_accepted: supplied?.contract === "mad4b.environment-convergence-approval.v1",
    secrets_included: false,
  };
}

function buildApprovalCheckpointAlias(acknowledgement) {
  return {
    contract: "mad4b.environment-convergence-approval-checkpoint.v1",
    required: acknowledgement.required,
    status: acknowledgement.status === "acknowledged_for_handoff" ? "satisfied_for_handoff" : "approval_required",
    plan_sha256: acknowledgement.plan_sha256,
    environment: acknowledgement.environment,
    commit_sha: acknowledgement.commit_sha,
    activation_gateway_policy_hash: acknowledgement.activation_gateway_policy_hash,
    approval_is_execution_authority: false,
    provider_execution_performed: false,
    canonical_semantics: "operator_acknowledgement",
    transitional_alias: true,
  };
}

export function buildEnvironmentConvergencePlan({
  environment,
  releaseSpec,
  classification,
  certificationReport = {},
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

  const executionTarget = resolveEnvironmentExecutionTarget(environmentKey, profile);
  const firstHandoff = governedFailures[0].handoff;
  const policyIdentity = gatewayPolicyIdentity(certificationReport, profile);
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
      expected_policy_hash: profile.activation_gateway?.expected_policy_hash || null,
      public_host: profile.activation_gateway?.public_host || null,
    },
    gateway_policy_identity: policyIdentity,
    execution_target: executionTarget,
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
      execution_target: executionTarget,
      execution_ready: firstHandoff.execution_ready === true && executionTarget.execution_ready === true,
      apply_block_reason: firstHandoff.apply_block_reason || null,
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
  operatorAcknowledgement = null,
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
      expected_policy_hash: profile.activation_gateway?.expected_policy_hash || null,
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
      operator_acknowledgement: null,
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
      operator_acknowledgement: null,
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
      operator_acknowledgement: null,
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
      operator_acknowledgement: null,
      approval_checkpoint: null,
      governed_handoff: null,
    });
  }

  const plan = buildEnvironmentConvergencePlan({
    environment: environmentKey,
    releaseSpec,
    classification,
    certificationReport,
    registry,
  });
  const suppliedAcknowledgement = operatorAcknowledgement ?? approval;
  const acknowledged = acknowledgementMatches(plan, suppliedAcknowledgement);
  const operatorAcknowledgementState = buildAcknowledgementState(plan, suppliedAcknowledgement, acknowledged);
  const approvalCheckpoint = buildApprovalCheckpointAlias(operatorAcknowledgementState);

  if (!acknowledged) {
    return deepFreeze({
      ...base,
      status: "approval_required",
      current_stage: "approval_checkpoint",
      next_stage: "approval_checkpoint",
      errors: [],
      stage_trace: [...stageTrace, "plan", "approval_checkpoint"],
      classification,
      plan,
      operator_acknowledgement: operatorAcknowledgementState,
      approval_checkpoint: approvalCheckpoint,
      governed_handoff: null,
    });
  }

  const governedHandoff = {
    ...plan.governed_handoff,
    plan_sha256: plan.plan_sha256,
    environment: environmentKey,
    commit_sha: plan.release_spec.commit_sha,
    activation_gateway_policy_hash: plan.release_spec.activation_gateway_policy_hash,
    execution_target: plan.execution_target,
    execution_performed: false,
  };

  if (plan.governed_handoff.execution_ready !== true) {
    return deepFreeze({
      ...base,
      status: "governed_authority_required",
      current_stage: "approval_checkpoint",
      next_stage: null,
      errors: [plan.governed_handoff.apply_block_reason || "governed_apply_authority_not_ready"],
      stage_trace: [...stageTrace, "plan", "approval_checkpoint"],
      classification,
      plan,
      operator_acknowledgement: operatorAcknowledgementState,
      approval_checkpoint: approvalCheckpoint,
      governed_handoff: governedHandoff,
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
    operator_acknowledgement: operatorAcknowledgementState,
    approval_checkpoint: approvalCheckpoint,
    governed_handoff: governedHandoff,
  });
}
