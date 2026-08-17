#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONTRACT = "mad4b.repository-governance-closure.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;
const SUPPORTED_ASSERTIONS = new Set(["metric_zero", "flag_true"]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const constitutionPath = path.join(root, "http-generic-api/config/repository-governance-constitution.json");
const policyRegistryPath = path.join(root, ".github/governance/policy-registry.json");
const derivedRegistryPath = path.join(root, ".github/derived-state-governance.json");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}
function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message || "unknown"}`);
  return String(result.stdout || "");
}
function stableUnique(values = []) { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
function sameSet(a = [], b = []) {
  const x = stableUnique(a), y = stableUnique(b);
  return x.length === y.length && x.every((entry, i) => entry === y[i]);
}
function escapeRegex(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }
function globRegex(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { source += "(?:.*/)?"; i += 2; }
        else { source += ".*"; i += 1; }
      } else source += "[^/]*";
    } else source += escapeRegex(ch);
  }
  return new RegExp(`^${source}$`, "u");
}
function compileClasses(constitution) {
  return (constitution.surface_classes || []).map((entry) => ({ ...entry, matchers: (entry.patterns || []).map(globRegex) }));
}
function parseChanges(baseSha, candidateSha, constitution) {
  const output = git(["diff", "--name-status", "--find-renames=50%", "--find-copies=50%", baseSha, candidateSha]);
  const supported = new Set(constitution.change_model?.supported_git_statuses || []);
  const compiled = compileClasses(constitution);
  const executableExtensions = new Set(constitution.executable_extensions || []);
  const changes = [], unsupported = [], unknown = [], unknownExecutables = [], historical = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const raw = parts[0] || "";
    const status = raw.charAt(0);
    if (!supported.has(status)) unsupported.push(raw || "missing");
    let oldPath = null, newPath = null;
    if (status === "R" || status === "C") { oldPath = parts[1] || null; newPath = parts[2] || null; }
    else if (status === "D") oldPath = parts[1] || null;
    else newPath = parts[1] || null;
    const paths = stableUnique([oldPath, newPath].filter(Boolean)).map((file) => {
      const classes = compiled.filter((entry) => entry.matchers.some((matcher) => matcher.test(file))).map((entry) => entry.id);
      const extension = path.extname(file).toLowerCase();
      const executable = executableExtensions.has(extension) || /^\.github\/workflows\/.*\.ya?ml$/u.test(file);
      if (!classes.length) { unknown.push(file); if (executable) unknownExecutables.push(file); }
      if (file === oldPath && ["D", "R", "C"].includes(status) && !classes.length) historical.push(file);
      return { path: file, classes, executable };
    });
    changes.push({ raw_status: raw, status, old_path: oldPath, new_path: newPath, git_native_newness: ["A", "R", "C"].includes(status), paths });
  }
  return {
    changes,
    unsupported_statuses: stableUnique(unsupported),
    unknown_surfaces: stableUnique(unknown),
    unknown_executables: stableUnique(unknownExecutables),
    unclassified_historical_paths: stableUnique(historical),
  };
}
function derivedGraph(registry) {
  const ids = new Set((registry.artifacts || []).map((entry) => entry.artifact_id));
  const dependencies = new Map();
  const missing = [];
  for (const artifact of registry.artifacts || []) {
    const deps = [];
    for (const dep of artifact.dependency_scope || []) {
      if (dep?.type !== "artifact") continue;
      if (!ids.has(dep.artifact_id)) missing.push({ artifact_id: artifact.artifact_id, missing_artifact_id: dep.artifact_id || null });
      else deps.push(dep.artifact_id);
    }
    dependencies.set(artifact.artifact_id, stableUnique(deps));
  }
  const cycles = [], visiting = new Set(), visited = new Set(), stack = [];
  function visit(id) {
    if (visiting.has(id)) { const start = stack.indexOf(id); cycles.push([...stack.slice(start), id].join(" -> ")); return; }
    if (visited.has(id)) return;
    visiting.add(id); stack.push(id);
    for (const dep of dependencies.get(id) || []) visit(dep);
    stack.pop(); visiting.delete(id); visited.add(id);
  }
  for (const id of stableUnique([...ids])) visit(id);
  return { dependencies: Object.fromEntries([...dependencies.entries()]), missing_dependencies: missing, cycles: stableUnique(cycles) };
}
function validateRegistry(registry) {
  const errors = [];
  if (registry?.contract !== "mad4b.repository-governance-policy-registry.v1") errors.push("policy_registry_contract_mismatch");
  if (registry?.execution_model !== "declarative_registered_assertions") errors.push("policy_registry_execution_model_invalid");
  const declared = new Set(registry.allowed_assertion_types || []);
  const ids = new Set();
  for (const type of declared) if (!SUPPORTED_ASSERTIONS.has(type)) errors.push(`unsupported_declared_assertion_type:${type}`);
  for (const policy of registry.policies || []) {
    if (!policy?.id) { errors.push("policy_id_missing"); continue; }
    if (ids.has(policy.id)) errors.push(`duplicate_policy_id:${policy.id}`);
    ids.add(policy.id);
    if (!Array.isArray(policy.assertions) || !policy.assertions.length) errors.push(`policy_assertions_missing:${policy.id}`);
    for (const assertion of policy.assertions || []) {
      if (!SUPPORTED_ASSERTIONS.has(assertion?.type)) errors.push(`unsupported_assertion_type:${policy.id}:${assertion?.type || "missing"}`);
      if (!declared.has(assertion?.type)) errors.push(`undeclared_assertion_type:${policy.id}:${assertion?.type || "missing"}`);
    }
  }
  return stableUnique(errors);
}
function authorityConflicts(constitution, derived) {
  const conflicts = [];
  if (constitution?.contract !== "mad4b.repository-governance-constitution.v1") conflicts.push("constitution_contract_mismatch");
  if (derived?.contract !== "mad4b.repository-derived-state-governance.v1") conflicts.push("derived_registry_contract_mismatch");
  if (derived?.repository_governance?.constitution !== constitution.authority?.source_of_truth) conflicts.push("derived_registry_constitution_pointer_mismatch");
  if (derived?.repository_governance?.policy_registry !== constitution.authority?.policy_registry) conflicts.push("derived_registry_policy_registry_pointer_mismatch");
  if (derived?.repository_governance?.evidence_producer_registry !== constitution.authority?.evidence_producer_registry) conflicts.push("evidence_registry_pointer_mismatch");
  if (derived?.repository_governance?.waiver_ledger !== constitution.authority?.waiver_ledger) conflicts.push("waiver_ledger_pointer_mismatch");
  if (derived?.required_check_name !== constitution.authority?.final_gate_context) conflicts.push("final_gate_context_mismatch");
  if (!sameSet(derived?.protected_branches || [], Object.keys(constitution.branches || {}))) conflicts.push("protected_branch_universe_mismatch");
  const mainDesired = constitution.branches?.main || {}, mainObserved = derived.server_enforcement?.main || {};
  for (const key of ["require_pull_request","block_direct_push","block_force_push","dismiss_stale_approvals","require_conversation_resolution"]) {
    if (mainObserved[key] !== mainDesired[key]) conflicts.push(`main_server_policy_mismatch:${key}`);
  }
  if (!sameSet(mainObserved.required_checks || [], mainDesired.required_checks || [])) conflicts.push("main_required_checks_mismatch");
  const prodDesired = constitution.branches?.Production || {}, prodObserved = derived.server_enforcement?.Production || {};
  for (const key of ["block_direct_push","block_force_push","generic_pull_request_merge_forbidden","promotion_path","same_sha_closure_required"]) {
    if (prodObserved[key] !== prodDesired[key]) conflicts.push(`production_server_policy_mismatch:${key}`);
  }
  if (derived.policy?.path_filtering_for_closure_forbidden !== true) conflicts.push("closure_path_filtering_must_be_forbidden");
  if (derived.policy?.branch_prefix_dependency_inference_forbidden !== true) conflicts.push("branch_prefix_dependency_inference_must_be_forbidden");
  return stableUnique(conflicts);
}
function evaluatePolicies(registry, metrics, flags) {
  return (registry.policies || []).map((policy) => {
    const assertions = (policy.assertions || []).map((assertion) => {
      let observed = null, passed = false;
      if (assertion.type === "metric_zero") { observed = Number(metrics[assertion.metric]); passed = Number.isFinite(observed) && observed === 0; }
      else if (assertion.type === "flag_true") { observed = flags[assertion.flag] === true; passed = observed === true; }
      return { ...assertion, observed, passed };
    });
    return { id: policy.id, version: policy.version, severity: policy.severity, passed: assertions.length > 0 && assertions.every((entry) => entry.passed), assertions };
  });
}

const constitution = JSON.parse(fs.readFileSync(constitutionPath, "utf8"));
const policyRegistry = JSON.parse(fs.readFileSync(policyRegistryPath, "utf8"));
const derivedRegistry = JSON.parse(fs.readFileSync(derivedRegistryPath, "utf8"));
const expectedSha = arg("expected-sha", git(["rev-parse", "HEAD"]).trim());
const baseSha = arg("base-sha", expectedSha);
const candidateKind = arg("candidate-kind", "exact_sha");
const reportFile = path.resolve(arg("report-file", path.join(root, ".artifacts/repository-governance-closure/report.json")));
if (!SHA_RE.test(expectedSha) || !SHA_RE.test(baseSha)) throw new Error("expected/base SHA must be exact lowercase 40-character Git SHAs");
const observedHead = git(["rev-parse", "HEAD"]).trim();
if (observedHead !== expectedSha) throw new Error(`exact candidate mismatch: expected=${expectedSha} observed=${observedHead}`);
const initial = git(["status", "--porcelain", "--untracked-files=all"]).trim();
if (initial) throw new Error(`governance closure must start clean:\n${initial}`);

const inventory = parseChanges(baseSha, expectedSha, constitution);
const graph = derivedGraph(derivedRegistry);
const registryErrors = validateRegistry(policyRegistry);
const conflicts = authorityConflicts(constitution, derivedRegistry);
const protectedPaths = new Set(derivedRegistry.convergence?.automation_control_paths || []);
const unregisteredControl = stableUnique((constitution.control_plane_paths || []).filter((file) => !protectedPaths.has(file)));
const metrics = {
  constitution_conflict_count: conflicts.length,
  unknown_surface_count: inventory.unknown_surfaces.length,
  unknown_executable_count: inventory.unknown_executables.length,
  unsupported_git_status_count: inventory.unsupported_statuses.length,
  unclassified_historical_path_count: inventory.unclassified_historical_paths.length,
  missing_derived_dependency_count: graph.missing_dependencies.length,
  derived_cycle_count: graph.cycles.length,
  unregistered_control_plane_path_count: unregisteredControl.length,
  policy_registry_error_count: registryErrors.length,
};
const flags = {
  git_native_newness: constitution.authority?.change_identity === "git_base_candidate_tree" && constitution.change_model?.filename_age_heuristics_forbidden === true,
};
const policies = evaluatePolicies(policyRegistry, metrics, flags);
const blocking = policies.filter((entry) => entry.severity === "blocking" && !entry.passed);
const final = git(["status", "--porcelain", "--untracked-files=all"]).trim();
if (final) throw new Error(`governance verifier mutated checkout:\n${final}`);
const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  candidate: { kind: candidateKind, sha: observedHead, base_sha: baseSha },
  constitution_contract: constitution.contract,
  policy_registry_contract: policyRegistry.contract,
  final_gate_context: constitution.authority?.final_gate_context || null,
  metrics, flags,
  converged: blocking.length === 0,
  blocking_failure_policy_ids: blocking.map((entry) => entry.id),
  authority_conflicts: conflicts,
  policy_registry_errors: registryErrors,
  unregistered_control_plane_paths: unregisteredControl,
  change_inventory: { changed_entry_count: inventory.changes.length, unknown_surfaces: inventory.unknown_surfaces, unknown_executables: inventory.unknown_executables, unclassified_historical_paths: inventory.unclassified_historical_paths, changes: inventory.changes },
  derived_state_graph: graph,
  policies,
  server_enforcement: {
    desired_attestation: constitution.authority?.server_enforcement_attestation || null,
    activation_guard: derivedRegistry.server_enforcement?.activation_guard || null,
    live_readback_performed_by_this_verifier: false,
    note: "Live GitHub enforcement is a separate authority; source verification never infers it from repository files."
  },
  safety: { detection_mode: "read_only", repository_mutation_performed: false, secrets_included: false }
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ contract: CONTRACT, candidate_sha: observedHead, converged: report.converged, metrics }));
if (!report.converged) process.exitCode = 1;
