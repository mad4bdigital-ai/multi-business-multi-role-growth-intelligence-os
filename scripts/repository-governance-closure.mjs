#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONTRACT = "mad4b.repository-governance-closure.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;
const SUPPORTED_ASSERTIONS = new Set(["metric_zero", "flag_true"]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const constitutionPath = path.join(repoRoot, "http-generic-api/config/repository-governance-constitution.json");
const policyRegistryPath = path.join(repoRoot, ".github/governance/policy-registry.json");
const derivedRegistryPath = path.join(repoRoot, ".github/derived-state-governance.json");

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || result.error?.message || "unknown").trim()}`);
  }
  return String(result.stdout || "");
}

function headSha() {
  return git(["rev-parse", "HEAD"]).trim();
}

function stableUnique(values = []) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sameStringSet(left = [], right = []) {
  const a = stableUnique(left);
  const b = stableUnique(right);
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else {
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`, "u");
}

function compileSurfaceClasses(constitution) {
  return (constitution.surface_classes || []).map((surface) => ({
    ...surface,
    matchers: (surface.patterns || []).map(globToRegExp),
  }));
}

function classifyPath(filePath, compiledClasses) {
  return compiledClasses
    .filter((surface) => surface.matchers.some((matcher) => matcher.test(filePath)))
    .map((surface) => surface.id);
}

function parseChangeInventory(baseSha, expectedSha, constitution) {
  const output = git([
    "diff",
    "--name-status",
    "--find-renames=50%",
    "--find-copies=50%",
    baseSha,
    expectedSha,
  ]);
  const supported = new Set(constitution.change_model?.supported_git_statuses || []);
  const compiledClasses = compileSurfaceClasses(constitution);
  const executableExtensions = new Set(constitution.executable_extensions || []);
  const changes = [];
  const unsupportedStatuses = [];
  const unknownSurfaces = [];
  const unknownExecutables = [];
  const unclassifiedHistoricalPaths = [];

  for (const line of output.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const rawStatus = parts[0] || "";
    const status = rawStatus.charAt(0);
    if (!supported.has(status)) unsupportedStatuses.push(rawStatus || "missing");

    let oldPath = null;
    let newPath = null;
    if (status === "R" || status === "C") {
      oldPath = parts[1] || null;
      newPath = parts[2] || null;
    } else if (status === "D") {
      oldPath = parts[1] || null;
    } else {
      newPath = parts[1] || null;
    }

    const observedPaths = stableUnique([oldPath, newPath].filter(Boolean));
    const pathEvidence = observedPaths.map((filePath) => {
      const classes = classifyPath(filePath, compiledClasses);
      const extension = path.extname(filePath).toLowerCase();
      const executable = executableExtensions.has(extension)
        || (/^\.github\/workflows\/.*\.ya?ml$/u.test(filePath));
      if (classes.length === 0) {
        unknownSurfaces.push(filePath);
        if (executable) unknownExecutables.push(filePath);
      }
      if (filePath === oldPath && (status === "D" || status === "R" || status === "C") && classes.length === 0) {
        unclassifiedHistoricalPaths.push(filePath);
      }
      return { path: filePath, classes, executable };
    });

    changes.push({
      raw_status: rawStatus,
      status,
      old_path: oldPath,
      new_path: newPath,
      git_native_newness: status === "A" || status === "R" || status === "C",
      paths: pathEvidence,
    });
  }

  return {
    changes,
    unsupported_statuses: stableUnique(unsupportedStatuses),
    unknown_surfaces: stableUnique(unknownSurfaces),
    unknown_executables: stableUnique(unknownExecutables),
    unclassified_historical_paths: stableUnique(unclassifiedHistoricalPaths),
  };
}

function buildDerivedGraph(derivedRegistry) {
  const ids = new Set((derivedRegistry.artifacts || []).map((artifact) => artifact.artifact_id));
  const dependencies = new Map();
  const missingDependencies = [];
  for (const artifact of derivedRegistry.artifacts || []) {
    const deps = [];
    for (const dependency of artifact.dependency_scope || []) {
      if (dependency?.type !== "artifact") continue;
      if (!ids.has(dependency.artifact_id)) {
        missingDependencies.push({ artifact_id: artifact.artifact_id, missing_artifact_id: dependency.artifact_id || null });
      } else {
        deps.push(dependency.artifact_id);
      }
    }
    dependencies.set(artifact.artifact_id, stableUnique(deps));
  }

  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const dependency of dependencies.get(node) || []) visit(dependency);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const id of stableUnique([...ids])) visit(id);
  const normalizedCycles = stableUnique(cycles.map((cycle) => cycle.join(" -> ")));
  return {
    dependencies: Object.fromEntries([...dependencies.entries()].sort(([a], [b]) => a.localeCompare(b))),
    missing_dependencies: missingDependencies,
    cycles: normalizedCycles,
  };
}

function validatePolicyRegistry(policyRegistry) {
  const errors = [];
  if (policyRegistry?.contract !== "mad4b.repository-governance-policy-registry.v1") {
    errors.push("policy_registry_contract_mismatch");
  }
  if (policyRegistry?.execution_model !== "declarative_registered_assertions") {
    errors.push("policy_registry_execution_model_invalid");
  }
  const declaredAllowed = new Set(policyRegistry.allowed_assertion_types || []);
  for (const type of declaredAllowed) {
    if (!SUPPORTED_ASSERTIONS.has(type)) errors.push(`unsupported_declared_assertion_type:${type}`);
  }
  const ids = new Set();
  for (const policy of policyRegistry.policies || []) {
    if (!policy?.id) {
      errors.push("policy_id_missing");
      continue;
    }
    if (ids.has(policy.id)) errors.push(`duplicate_policy_id:${policy.id}`);
    ids.add(policy.id);
    if (!Array.isArray(policy.assertions) || policy.assertions.length === 0) {
      errors.push(`policy_assertions_missing:${policy.id}`);
      continue;
    }
    for (const assertion of policy.assertions) {
      if (!SUPPORTED_ASSERTIONS.has(assertion?.type)) errors.push(`unsupported_assertion_type:${policy.id}:${assertion?.type || "missing"}`);
      if (!declaredAllowed.has(assertion?.type)) errors.push(`undeclared_assertion_type:${policy.id}:${assertion?.type || "missing"}`);
    }
  }
  return stableUnique(errors);
}

function constitutionConflicts(constitution, derivedRegistry) {
  const conflicts = [];
  if (constitution?.contract !== "mad4b.repository-governance-constitution.v1") conflicts.push("constitution_contract_mismatch");
  if (derivedRegistry?.contract !== "mad4b.repository-derived-state-governance.v1") conflicts.push("derived_registry_contract_mismatch");
  if (derivedRegistry?.repository_governance?.constitution !== constitution.authority?.source_of_truth) conflicts.push("derived_registry_constitution_pointer_mismatch");
  if (derivedRegistry?.repository_governance?.policy_registry !== constitution.authority?.policy_registry) conflicts.push("derived_registry_policy_registry_pointer_mismatch");
  if (derivedRegistry?.required_check_name !== constitution.authority?.final_gate_context) conflicts.push("final_gate_context_mismatch");
  if (!sameStringSet(derivedRegistry?.protected_branches || [], Object.keys(constitution.branches || {}))) conflicts.push("protected_branch_universe_mismatch");

  const mainDesired = constitution.branches?.main || {};
  const mainObserved = derivedRegistry.server_enforcement?.main || {};
  for (const key of ["require_pull_request", "block_direct_push", "block_force_push", "dismiss_stale_approvals", "require_conversation_resolution"]) {
    if (mainObserved[key] !== mainDesired[key]) conflicts.push(`main_server_policy_mismatch:${key}`);
  }
  if (!sameStringSet(mainObserved.required_checks || [], mainDesired.required_checks || [])) conflicts.push("main_required_checks_mismatch");

  const productionDesired = constitution.branches?.Production || {};
  const productionObserved = derivedRegistry.server_enforcement?.Production || {};
  for (const key of ["block_direct_push", "block_force_push", "generic_pull_request_merge_forbidden", "promotion_path", "same_sha_closure_required"]) {
    if (productionObserved[key] !== productionDesired[key]) conflicts.push(`production_server_policy_mismatch:${key}`);
  }
  if (derivedRegistry.policy?.path_filtering_for_closure_forbidden !== true) conflicts.push("closure_path_filtering_must_be_forbidden");
  if (derivedRegistry.policy?.branch_prefix_dependency_inference_forbidden !== true) conflicts.push("branch_prefix_dependency_inference_must_be_forbidden");
  return stableUnique(conflicts);
}

function unregisteredControlPlanePaths(constitution, derivedRegistry) {
  const protectedPaths = new Set(derivedRegistry.convergence?.automation_control_paths || []);
  return stableUnique((constitution.control_plane_paths || []).filter((filePath) => !protectedPaths.has(filePath)));
}

function evaluatePolicies(policyRegistry, metrics, flags) {
  const results = [];
  for (const policy of policyRegistry.policies || []) {
    const assertions = [];
    for (const assertion of policy.assertions || []) {
      let passed = false;
      let observed = null;
      if (assertion.type === "metric_zero") {
        observed = Number(metrics[assertion.metric]);
        passed = Number.isFinite(observed) && observed === 0;
      } else if (assertion.type === "flag_true") {
        observed = flags[assertion.flag] === true;
        passed = observed === true;
      }
      assertions.push({ ...assertion, observed, passed });
    }
    results.push({
      id: policy.id,
      version: policy.version,
      severity: policy.severity,
      passed: assertions.length > 0 && assertions.every((assertion) => assertion.passed),
      assertions,
    });
  }
  return results;
}

const constitution = JSON.parse(fs.readFileSync(constitutionPath, "utf8"));
const policyRegistry = JSON.parse(fs.readFileSync(policyRegistryPath, "utf8"));
const derivedRegistry = JSON.parse(fs.readFileSync(derivedRegistryPath, "utf8"));
const expectedSha = arg("expected-sha", headSha());
const baseSha = arg("base-sha", expectedSha);
const candidateKind = arg("candidate-kind", "exact_sha");
const reportFile = path.resolve(arg("report-file", path.join(repoRoot, ".artifacts/repository-governance-closure/report.json")));

if (!SHA_RE.test(expectedSha)) throw new Error("expected SHA must be an exact lowercase 40-character Git SHA");
if (!SHA_RE.test(baseSha)) throw new Error("base SHA must be an exact lowercase 40-character Git SHA");
const observedHead = headSha();
if (observedHead !== expectedSha) throw new Error(`exact candidate mismatch: expected=${expectedSha} observed=${observedHead}`);

const initialStatus = git(["status", "--porcelain", "--untracked-files=all"]).trim();
if (initialStatus) throw new Error(`governance closure must start from a clean checkout; dirty paths:\n${initialStatus}`);

const changeInventory = parseChangeInventory(baseSha, expectedSha, constitution);
const derivedGraph = buildDerivedGraph(derivedRegistry);
const policyRegistryErrors = validatePolicyRegistry(policyRegistry);
const conflicts = constitutionConflicts(constitution, derivedRegistry);
const unregisteredControlPaths = unregisteredControlPlanePaths(constitution, derivedRegistry);
const controlPlaneSet = new Set(constitution.control_plane_paths || []);
const changedControlPlanePaths = stableUnique(changeInventory.changes
  .flatMap((change) => [change.old_path, change.new_path])
  .filter((filePath) => filePath && controlPlaneSet.has(filePath)));

const metrics = {
  constitution_conflict_count: conflicts.length,
  unknown_surface_count: changeInventory.unknown_surfaces.length,
  unknown_executable_count: changeInventory.unknown_executables.length,
  unsupported_git_status_count: changeInventory.unsupported_statuses.length,
  unclassified_historical_path_count: changeInventory.unclassified_historical_paths.length,
  missing_derived_dependency_count: derivedGraph.missing_dependencies.length,
  derived_cycle_count: derivedGraph.cycles.length,
  unregistered_control_plane_path_count: unregisteredControlPaths.length,
  policy_registry_error_count: policyRegistryErrors.length,
};
const flags = {
  git_native_newness: constitution.authority?.change_identity === "git_base_candidate_tree"
    && constitution.change_model?.filename_age_heuristics_forbidden === true,
  control_plane_change_detected: changedControlPlanePaths.length > 0,
};
const policies = evaluatePolicies(policyRegistry, metrics, flags);
const blockingFailures = policies.filter((policy) => policy.severity === "blocking" && !policy.passed);
const converged = blockingFailures.length === 0;

const finalStatus = git(["status", "--porcelain", "--untracked-files=all"]).trim();
if (finalStatus) throw new Error(`governance verifier mutated the checkout; dirty paths:\n${finalStatus}`);

const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  candidate: {
    kind: candidateKind,
    sha: observedHead,
    base_sha: baseSha,
  },
  constitution_contract: constitution.contract,
  policy_registry_contract: policyRegistry.contract,
  final_gate_context: constitution.authority?.final_gate_context || null,
  metrics,
  flags,
  converged,
  blocking_failure_policy_ids: blockingFailures.map((policy) => policy.id),
  authority_conflicts: conflicts,
  policy_registry_errors: policyRegistryErrors,
  unregistered_control_plane_paths: unregisteredControlPaths,
  changed_control_plane_paths: changedControlPlanePaths,
  change_inventory: {
    changed_entry_count: changeInventory.changes.length,
    unknown_surfaces: changeInventory.unknown_surfaces,
    unknown_executables: changeInventory.unknown_executables,
    unsupported_statuses: changeInventory.unsupported_statuses,
    unclassified_historical_paths: changeInventory.unclassified_historical_paths,
    changes: changeInventory.changes,
  },
  derived_state_graph: derivedGraph,
  policies,
  server_enforcement: {
    attestation_required_before_merge: constitution.authority?.server_enforcement_attestation === "required_before_merge",
    live_readback_performed_by_this_verifier: false,
    note: "Live GitHub server enforcement remains a separate readback/apply authority and must not be inferred from repository configuration."
  },
  safety: {
    detection_mode: "read_only",
    repository_mutation_performed: false,
    protected_branch_mutation_performed: false,
    force_push_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false
  }
};

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  contract: report.contract,
  candidate_sha: observedHead,
  base_sha: baseSha,
  changed_entry_count: report.change_inventory.changed_entry_count,
  unknown_surface_count: metrics.unknown_surface_count,
  unknown_executable_count: metrics.unknown_executable_count,
  constitution_conflict_count: metrics.constitution_conflict_count,
  derived_cycle_count: metrics.derived_cycle_count,
  blocking_failure_policy_ids: report.blocking_failure_policy_ids,
  converged,
  secrets_included: false
})}\n`);
if (!converged) process.exitCode = 1;
