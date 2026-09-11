import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = path.join(__dirname, "config", "environment-convergence-registry.json");
const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, "..");
const SHA256_RE = /^[0-9a-f]{64}$/u;

function compact(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function isWithin(root, candidate) {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);

  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

function isSafeRepositoryRelativePath(value) {
  const candidate = compact(value);
  if (!candidate) return false;

  if (
    path.isAbsolute(candidate)
    || path.posix.isAbsolute(candidate)
    || path.win32.isAbsolute(candidate)
  ) {
    return false;
  }

  return !candidate
    .split(/[\\/]+/u)
    .some((segment) => segment === "..");
}

export function readEnvironmentConvergenceRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (registry?.contract !== "mad4b.environment-convergence-registry.v1") {
    throw new Error("environment_convergence_registry_contract_invalid");
  }
  return registry;
}

export function getEnvironmentConvergenceProfile(environment, registry = readEnvironmentConvergenceRegistry()) {
  const key = compact(environment).toLowerCase();
  const profile = registry?.profiles?.[key];
  if (!profile) throw new Error(`environment_convergence_profile_missing:${key || "empty"}`);
  return clone(profile);
}

export function assertActivationGatewayProfilePolicy(environment, policy, registry = readEnvironmentConvergenceRegistry()) {
  const profile = getEnvironmentConvergenceProfile(environment, registry);
  const gateway = profile.activation_gateway || {};
  const expectedPolicyHash = compact(gateway.expected_policy_hash).toLowerCase();
  const observedPolicyHash = compact(policy?.content_hash_sha256).toLowerCase();
  const checks = {
    policy_key: compact(policy?.policy_key) === compact(gateway.policy_key),
    public_host: compact(policy?.public_host).toLowerCase() === compact(gateway.public_host).toLowerCase(),
    policy_path_present: Boolean(compact(gateway.policy_path)),
    expected_policy_hash_valid: SHA256_RE.test(expectedPolicyHash),
    policy_hash: SHA256_RE.test(observedPolicyHash) && observedPolicyHash === expectedPolicyHash,
  };
  const ok = Object.values(checks).every(Boolean);
  return {
    ok,
    environment: compact(environment).toLowerCase(),
    profile_key: gateway.profile_key || null,
    policy_path: gateway.policy_path || null,
    packaged_policy_path: gateway.packaged_policy_path || null,
    expected_policy_key: gateway.policy_key || null,
    observed_policy_key: policy?.policy_key || null,
    expected_policy_hash: expectedPolicyHash || null,
    observed_policy_hash: observedPolicyHash || null,
    expected_public_host: gateway.public_host || null,
    observed_public_host: policy?.public_host || null,
    checks,
    secrets_included: false,
  };
}

export function loadActivationGatewayProfilePolicy(environment, {
  registry = readEnvironmentConvergenceRegistry(),
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
} = {}) {
  const environmentKey = compact(environment).toLowerCase();
  const profile = getEnvironmentConvergenceProfile(environmentKey, registry);
  const gateway = profile.activation_gateway || {};
  const sourceRelativePath = compact(gateway.policy_path);
  if (!sourceRelativePath) throw new Error(`activation_gateway_policy_path_missing:${environmentKey}`);
  if (!isSafeRepositoryRelativePath(sourceRelativePath)) {
    throw new Error(`activation_gateway_policy_path_outside_repository:${environmentKey}`);
  }

  const sourcePath = path.resolve(repositoryRoot, sourceRelativePath);
  if (!isWithin(repositoryRoot, sourcePath)) {
    throw new Error(`activation_gateway_policy_path_outside_repository:${environmentKey}`);
  }

  const candidates = [{ path: sourcePath, source: "repository_profile" }];
  const packagedPolicyPath = compact(gateway.packaged_policy_path);
  if (packagedPolicyPath) {
    if (!path.isAbsolute(packagedPolicyPath)) {
      throw new Error(`activation_gateway_packaged_policy_path_not_absolute:${environmentKey}`);
    }
    candidates.push({ path: packagedPolicyPath, source: "packaged_profile" });
  }

  let loaded = null;
  for (const candidate of candidates) {
    try {
      loaded = {
        ...candidate,
        policy: JSON.parse(fs.readFileSync(candidate.path, "utf8")),
      };
      break;
    } catch { }
  }
  if (!loaded) throw new Error(`activation_gateway_canonical_policy_unavailable:${environmentKey}`);

  const validation = assertActivationGatewayProfilePolicy(environmentKey, loaded.policy, registry);
  if (!validation.ok) {
    const failed = Object.entries(validation.checks).filter(([, ok]) => ok !== true).map(([key]) => key);
    throw new Error(`activation_gateway_profile_policy_invalid:${environmentKey}:${failed.join(",")}`);
  }

  return {
    environment: environmentKey,
    profile,
    policy: loaded.policy,
    policy_source: loaded.source,
    loaded_policy_path: loaded.path,
    canonical_policy_path: sourceRelativePath,
    expected_policy_hash: validation.expected_policy_hash,
    validation,
    secrets_included: false,
  };
}

function failedChecks(report = {}) {
  return [
    ...(Array.isArray(report.integrity_checks) ? report.integrity_checks : []),
    ...(Array.isArray(report.readiness_checks) ? report.readiness_checks : []),
  ].filter((entry) => entry && entry.ok !== true && compact(entry.key));
}

export function classifyEnvironmentCertification(report = {}, {
  environment = "staging",
  registry = readEnvironmentConvergenceRegistry(),
} = {}) {
  const environmentKey = compact(environment).toLowerCase();
  const profile = getEnvironmentConvergenceProfile(environmentKey, registry);
  const gatewayProfile = profile.activation_gateway || {};
  const gatewayDependency = registry?.dependencies?.activation_gateway || {};
  const metadataByCheck = gatewayDependency.checks || {};
  const classified = [];
  const unclassified = [];

  for (const entry of failedChecks(report)) {
    const metadata = metadataByCheck[entry.key];
    if (!metadata) {
      unclassified.push({
        check_key: entry.key,
        failure_kind: entry.severity === "blocking" ? "integrity_failure" : "readiness_failure",
        repairability: "undeclared",
        detail: entry.detail ?? null,
        secrets_included: false,
      });
      continue;
    }

    const planCapability = hasOwn(gatewayProfile, "plan_capability")
      ? gatewayProfile.plan_capability
      : metadata.plan_capability;
    const applyCapability = hasOwn(gatewayProfile, "apply_capability")
      ? gatewayProfile.apply_capability
      : metadata.apply_capability;
    const executionReady = gatewayProfile.governed_apply_ready === true && Boolean(compact(applyCapability));

    classified.push({
      component: "activation_gateway",
      check_key: entry.key,
      failure_kind: metadata.failure_kind,
      drift_class: metadata.drift_class,
      repairability: metadata.repairability,
      desired_release_commit: compact(report?.expected?.commit_sha) || null,
      observed_release_commit: compact(report?.gateway?.health?.sourceCommit) || compact(entry?.detail?.observed) || null,
      profile: {
        environment: environmentKey,
        source_branch: profile.source_branch,
        policy_key: gatewayProfile.policy_key || null,
        policy_path: gatewayProfile.policy_path || null,
        expected_policy_hash: gatewayProfile.expected_policy_hash || null,
        public_host: gatewayProfile.public_host || null,
      },
      handoff: metadata.repairability === "governed" ? {
        authority: gatewayDependency.authority || "server_governed",
        current_authority_adapter: gatewayProfile.current_authority_adapter || null,
        target_authority_model: gatewayProfile.target_authority_model || null,
        plan_capability: planCapability || null,
        apply_capability: applyCapability || null,
        profile_binding_required: metadata.profile_binding_required === true,
        execution_ready: executionReady,
        apply_block_reason: executionReady ? null : (gatewayProfile.apply_block_reason || "governed_apply_authority_not_ready"),
        automatic_apply_allowed: metadata.automatic_apply_allowed === true && executionReady,
      } : null,
      detail: entry.detail ?? null,
      secrets_included: false,
    });
  }

  const hasIntegrityFailure = unclassified.some((entry) => entry.failure_kind === "integrity_failure")
    || classified.some((entry) => entry.failure_kind === "integrity_failure");
  const hasGovernedDrift = classified.some((entry) => entry.failure_kind === "convergence_drift" && entry.repairability === "governed");
  const hasUnclassified = unclassified.length > 0;
  const hasManualBlock = classified.some((entry) => ["manual_or_external", "manual_non_repairable"].includes(entry.repairability));

  let status = "converged";
  if (hasIntegrityFailure || hasUnclassified || hasManualBlock) status = "blocked";
  else if (hasGovernedDrift) status = "reconciliation_required";
  else if (classified.length > 0) status = "degraded";

  return {
    contract: "mad4b.environment-convergence-classification.v1",
    environment: environmentKey,
    state_machine: profile.state_machine,
    status,
    certification_outcome: report?.outcome || null,
    classified_failures: classified,
    unclassified_failures: unclassified,
    next_governed_handoff: classified.find((entry) => entry.handoff)?.handoff || null,
    safety: {
      mutation_performed: false,
      provider_mutation: false,
      database_mutation: false,
      production_deploy: false,
      secrets_included: false,
    },
  };
}

export function validateEnvironmentConvergenceRegistry(registry = readEnvironmentConvergenceRegistry()) {
  const errors = [];
  const staging = registry?.profiles?.staging;
  const production = registry?.profiles?.production;
  if (!staging || !production) errors.push("profiles_staging_and_production_required");
  if (staging?.state_machine !== registry?.state_machine?.key || production?.state_machine !== registry?.state_machine?.key) {
    errors.push("profiles_must_share_registry_state_machine");
  }
  if (!Array.isArray(registry?.release_spec?.identity) || !registry.release_spec.identity.includes("activation_gateway_policy_hash")) {
    errors.push("release_spec_gateway_policy_hash_identity_required");
  }
  for (const [environment, profile] of Object.entries(registry?.profiles || {})) {
    if (profile.provider_mutation_implementation !== null) errors.push(`${environment}_profile_must_not_implement_provider_mutation`);
    const gateway = profile.activation_gateway || {};
    if (!compact(gateway.policy_key) || !compact(gateway.policy_path) || !compact(gateway.public_host) || !SHA256_RE.test(compact(gateway.expected_policy_hash).toLowerCase())) {
      errors.push(`${environment}_activation_gateway_identity_incomplete`);
    }
    if (!compact(gateway.plan_capability)) errors.push(`${environment}_activation_gateway_plan_capability_missing`);
    if (gateway.governed_apply_ready === true && !compact(gateway.apply_capability)) {
      errors.push(`${environment}_activation_gateway_apply_capability_missing`);
    }
    if (gateway.governed_apply_ready !== true && compact(gateway.apply_capability)) {
      errors.push(`${environment}_activation_gateway_unready_apply_capability_must_be_null`);
    }
  }
  for (const [checkKey, metadata] of Object.entries(registry?.dependencies?.activation_gateway?.checks || {})) {
    if (!compact(metadata.failure_kind) || !compact(metadata.repairability)) errors.push(`${checkKey}_remediation_metadata_incomplete`);
    if (metadata.repairability === "governed" && (!compact(metadata.plan_capability) || !compact(metadata.apply_capability))) {
      errors.push(`${checkKey}_governed_capabilities_incomplete`);
    }
  }
  if (registry?.dependencies?.activation_gateway?.checks?.gateway_exact_commit?.failure_kind !== "convergence_drift") {
    errors.push("gateway_exact_commit_must_be_convergence_drift");
  }
  return {
    ok: errors.length === 0,
    errors,
    state_machine: registry?.state_machine?.key || null,
    profile_count: Object.keys(registry?.profiles || {}).length,
    secrets_included: false,
  };
}
