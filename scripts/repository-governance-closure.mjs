#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONTRACT = "mad4b.repository-governance-closure.v2";
const SHA_RE = /^[0-9a-f]{40}$/u;
const SUPPORTED_ASSERTIONS = new Set(["metric_zero", "flag_true", "value_equals", "collection_empty", "number_compare", "forall"]);
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const constitutionPath = path.join(root, "http-generic-api/config/repository-governance-constitution.json");
const policyRegistryPath = path.join(root, ".github/governance/policy-registry.json");
const semanticRegistryPath = path.join(root, ".github/governance/semantic-surface-registry.json");
const semanticVerifierRequirementsPath = path.join(root, ".github/governance/semantic-verifier-requirements.json");
const verifierRegistryPath = path.join(root, ".github/governance/verifier-registry.json");
const testAuthorityRegistryPath = path.join(root, ".github/governance/test-authority-registry.json");
const derivedRegistryPath = path.join(root, ".github/derived-state-governance.json");
const ciSurfacePolicyPath = path.join(root, "docs/repository-ci-surface-policy.json");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}
function git(args, { allowFailure = false, binary = false } = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: binary ? null : "utf8", maxBuffer: 64 * 1024 * 1024 });
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr || "");
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${args.join(" ")} failed: ${stderr || result.error?.message || "unknown"}`);
  const stdout = binary ? Buffer.from(result.stdout || []) : String(result.stdout || "");
  return { ok: result.status === 0, stdout, stderr };
}
function gitText(args) { return git(args).stdout; }
function gitBuffer(args) { return git(args, { binary: true }).stdout; }
function nulFields(value) {
  const fields = (Buffer.isBuffer(value) ? value.toString("utf8") : String(value || "")).split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
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
function compilePathClasses(entries = []) {
  return entries.map((entry) => ({ ...entry, matchers: (entry.patterns || entry.path_patterns || []).map(globRegex) }));
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function trackedFilesAt(sha, prefix = "") {
  const args = ["ls-tree", "-r", "-z", "--name-only", sha];
  if (prefix) args.push("--", prefix);
  return nulFields(gitBuffer(args));
}
function readCandidateFile(file, maxBytes = 2 * 1024 * 1024) {
  const full = path.join(root, file);
  try {
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > maxBytes) return "";
    return fs.readFileSync(full, "utf8");
  } catch { return ""; }
}
function readHistoricalFile(baseSha, file, maxBytes = 2 * 1024 * 1024) {
  const result = git(["show", `${baseSha}:${file}`], { allowFailure: true });
  if (!result.ok || Buffer.byteLength(result.stdout, "utf8") > maxBytes) return "";
  return result.stdout;
}
function semanticClassesFor(file, compiled) {
  return compiled.filter((entry) => entry.matchers.some((matcher) => matcher.test(file))).map((entry) => entry.id);
}
function semanticFacetsFor(file, content, compiled) {
  const facets = [];
  for (const entry of compiled) {
    const pathMatch = entry.matchers.some((matcher) => matcher.test(file));
    const contentMatch = (entry.content_patterns || []).some((pattern) => {
      try { return new RegExp(pattern, "imu").test(content); } catch { return false; }
    });
    if (pathMatch || contentMatch) facets.push(entry.id);
  }
  return stableUnique(facets);
}
function parseChanges(baseSha, candidateSha, constitution, semanticRegistry) {
  const fields = nulFields(gitBuffer(["diff", "--name-status", "-z", "--find-renames=50%", "--find-copies=50%", baseSha, candidateSha]));
  const supported = new Set(constitution.change_model?.supported_git_statuses || []);
  const surfaceClasses = compilePathClasses(constitution.surface_classes || []);
  const semanticClasses = compilePathClasses(constitution.semantic_executable_classes || []);
  const semanticFacets = compilePathClasses(semanticRegistry.facets || []);
  const executableExtensions = new Set(constitution.executable_extensions || []);
  const changes = [], unsupported = [], unknown = [], unknownExecutables = [], unknownSemanticExecutables = [], historical = [];
  for (let i = 0; i < fields.length;) {
    const raw = fields[i++] || "";
    const status = raw.charAt(0);
    if (!supported.has(status)) unsupported.push(raw || "missing");
    let oldPath = null, newPath = null;
    if (status === "R" || status === "C") {
      oldPath = fields[i++] ?? null;
      newPath = fields[i++] ?? null;
    } else {
      const file = fields[i++] ?? null;
      if (status === "D") oldPath = file;
      else newPath = file;
    }
    if ((status === "R" || status === "C") ? (!oldPath || !newPath) : (!oldPath && !newPath)) {
      unsupported.push(`malformed:${raw || "missing"}`);
      continue;
    }
    const entries = [];
    for (const file of stableUnique([oldPath, newPath].filter(Boolean))) {
      const isHistorical = file === oldPath && ["D", "R", "C"].includes(status);
      const content = isHistorical ? readHistoricalFile(baseSha, file) : readCandidateFile(file);
      const surfaces = surfaceClasses.filter((entry) => entry.matchers.some((matcher) => matcher.test(file))).map((entry) => entry.id);
      const extension = path.extname(file).toLowerCase();
      const executable = executableExtensions.has(extension) || /^\.github\/workflows\/.*\.ya?ml$/u.test(file);
      const semantic = semanticClassesFor(file, semanticClasses);
      const facets = semanticFacetsFor(file, content, semanticFacets);
      if (!surfaces.length) { unknown.push(file); if (executable) unknownExecutables.push(file); }
      if (executable && !semantic.length) unknownSemanticExecutables.push(file);
      if (isHistorical && !surfaces.length) historical.push(file);
      entries.push({ path: file, historical: isHistorical, surface_classes: surfaces, semantic_classes: semantic, facets, executable });
    }
    changes.push({ raw_status: raw, status, old_path: oldPath, new_path: newPath, git_native_newness: ["A", "R", "C"].includes(status), paths: entries });
  }
  return {
    changes,
    unsupported_statuses: stableUnique(unsupported),
    unknown_surfaces: stableUnique(unknown),
    unknown_executables: stableUnique(unknownExecutables),
    unknown_semantic_executables: stableUnique(unknownSemanticExecutables),
    unclassified_historical_paths: stableUnique(historical),
  };
}
function isRepositoryRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized !== ".." && !normalized.startsWith("../");
}
function resolveRelativeImport(fromFile, specifier, tracked) {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  if (!isRepositoryRelativePath(base)) return { resolved: base, escaped: true };
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, `${base}.tsx`, `${base}.json`, path.posix.join(base, "index.js"), path.posix.join(base, "index.mjs"), path.posix.join(base, "index.ts")];
  return { resolved: candidates.find((candidate) => tracked.has(candidate)) || candidates[0], escaped: false };
}
function buildSemanticGraph(inventory, baseSha, semanticRegistry) {
  const maxBytes = Number(semanticRegistry.dependency_extraction?.max_file_bytes || 2 * 1024 * 1024);
  const extensionAllow = new Set(semanticRegistry.dependency_extraction?.extensions || []);
  const tracked = new Set(nulFields(gitBuffer(["ls-files", "-z"])));
  const deletedOrRenamed = new Set(inventory.changes.flatMap((entry) => ["D", "R"].includes(entry.status) && entry.old_path ? [entry.old_path] : []));
  const changedCurrent = new Set(inventory.changes.flatMap((entry) => entry.new_path ? [entry.new_path] : []));
  const edges = [], unresolved = [], dangling = [];
  const importRe = /(?:\bfrom\s+|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/gmu;
  for (const file of tracked) {
    if (extensionAllow.size && !extensionAllow.has(path.extname(file).toLowerCase())) continue;
    const content = readCandidateFile(file, maxBytes);
    if (!content) continue;
    let match;
    while ((match = importRe.exec(content))) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const resolution = resolveRelativeImport(file, specifier, tracked);
      if (!resolution) continue;
      const edge = { from: file, specifier, to: resolution.resolved, kind: "relative_module" };
      if (resolution.escaped) unresolved.push({ ...edge, reason: "relative_target_escapes_repository" });
      else if (tracked.has(resolution.resolved)) edges.push(edge);
      else if (deletedOrRenamed.has(resolution.resolved)) dangling.push({ ...edge, reason: "deleted_or_renamed_target" });
      else if (changedCurrent.has(file)) unresolved.push({ ...edge, reason: "unresolved_relative_target" });
    }
    for (const historicalPath of deletedOrRenamed) {
      if (content.includes(historicalPath)) dangling.push({ from: file, specifier: historicalPath, to: historicalPath, kind: "literal_repository_path", reason: "historical_path_literal_remains" });
    }
  }
  const changedNodes = inventory.changes.flatMap((entry) => entry.paths.map((node) => ({
    ...node,
    status: entry.status,
    replacement_path: node.historical && entry.new_path ? entry.new_path : null,
  })));
  return {
    registry_contract: semanticRegistry.contract,
    changed_nodes: changedNodes,
    dependency_edges: edges,
    unresolved_dependencies: stableUnique(unresolved.map((entry) => JSON.stringify(entry))).map((entry) => JSON.parse(entry)),
    dangling_references: stableUnique(dangling.map((entry) => JSON.stringify(entry))).map((entry) => JSON.parse(entry)),
  };
}
function derivedGraph(registry) {
  const ids = new Set((registry.artifacts || []).map((entry) => entry.artifact_id));
  const dependencies = new Map(), missing = [];
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
function validateSemanticRegistry(registry) {
  const errors = [];
  if (registry?.contract !== "mad4b.repository-semantic-surface-registry.v1") errors.push("semantic_registry_contract_mismatch");
  const ids = new Set();
  for (const facet of registry.facets || []) {
    if (!facet?.id || ids.has(facet.id)) errors.push(`semantic_facet_duplicate_or_missing:${facet?.id || "missing"}`);
    ids.add(facet?.id);
    for (const pattern of facet.content_patterns || []) {
      try { new RegExp(pattern, "imu"); } catch { errors.push(`semantic_content_pattern_invalid:${facet.id}`); }
    }
  }
  return stableUnique(errors);
}
function validateVerifierRegistry(registry) {
  const errors = [];
  if (registry?.contract !== "mad4b.repository-verifier-registry.v1") errors.push("verifier_registry_contract_mismatch");
  if (registry?.execution_model !== "safe_registered_processes") errors.push("verifier_registry_execution_model_invalid");
  if (registry?.shell_execution_forbidden !== true) errors.push("verifier_registry_shell_execution_not_forbidden");
  const allowed = new Set(registry.allowed_step_types || []);
  const ids = new Set();
  for (const verifier of registry.verifiers || []) {
    if (!verifier?.id || ids.has(verifier.id)) errors.push(`verifier_id_duplicate_or_missing:${verifier?.id || "missing"}`);
    ids.add(verifier?.id);
    if (!Array.isArray(verifier.steps) || !verifier.steps.length) errors.push(`verifier_steps_missing:${verifier?.id || "missing"}`);
    for (const step of verifier.steps || []) {
      if (!allowed.has(step?.type)) errors.push(`verifier_step_type_not_allowed:${verifier.id}:${step?.type || "missing"}`);
      if (!["node", "npm"].includes(step?.type)) continue;
      if (step.type === "npm") {
        const packageJson = path.join(root, step.cwd || ".", "package.json");
        if (!step.script || !fs.existsSync(packageJson)) errors.push(`verifier_npm_step_invalid:${verifier.id}`);
        else {
          try {
            const scripts = readJson(packageJson).scripts || {};
            if (!Object.prototype.hasOwnProperty.call(scripts, step.script)) errors.push(`verifier_npm_script_missing:${verifier.id}:${step.script}`);
          } catch { errors.push(`verifier_npm_package_unreadable:${verifier.id}`); }
        }
      } else {
        if (!step.path || path.posix.isAbsolute(step.path) || step.path.split("/").includes("..")) errors.push(`verifier_node_path_invalid:${verifier.id}`);
        else if (!fs.existsSync(path.join(root, step.cwd || ".", step.path))) errors.push(`verifier_node_path_missing:${verifier.id}:${step.path}`);
      }
    }
  }
  return stableUnique(errors);
}
function validateSemanticVerifierRequirements(registry, verifierRegistry) {
  const errors = [];
  if (registry?.contract !== "mad4b.repository-semantic-verifier-requirements.v1") errors.push("semantic_verifier_requirements_contract_mismatch");
  if (registry?.unknown_semantic_impact_mode !== "block") errors.push("semantic_verifier_unknown_impact_not_blocking");
  const verifierIds = new Set((verifierRegistry.verifiers || []).map((entry) => entry.id));
  const ids = new Set();
  for (const requirement of registry.requirements || []) {
    if (!requirement?.id || ids.has(requirement.id)) errors.push(`semantic_verifier_requirement_duplicate_or_missing:${requirement?.id || "missing"}`);
    ids.add(requirement?.id);
    if (!Array.isArray(requirement.when_facets) || !requirement.when_facets.length) errors.push(`semantic_verifier_requirement_facets_missing:${requirement?.id || "missing"}`);
    if (!Array.isArray(requirement.required_verifiers) || !requirement.required_verifiers.length) errors.push(`semantic_verifier_requirement_verifiers_missing:${requirement?.id || "missing"}`);
    for (const verifierId of requirement.required_verifiers || []) if (!verifierIds.has(verifierId)) errors.push(`semantic_verifier_required_id_unregistered:${requirement.id}:${verifierId}`);
  }
  return stableUnique(errors);
}
function validateTestAuthorityRegistry(registry) {
  const errors = [];
  if (registry?.contract !== "mad4b.repository-test-authority-registry.v1") errors.push("test_authority_registry_contract_mismatch");
  if (registry?.deleted_test_mode !== "block_without_replacement") errors.push("test_authority_deleted_test_mode_not_blocking");
  const ids = new Set();
  for (const invariant of registry.invariant_authorities || []) {
    if (!invariant?.id || ids.has(invariant.id)) errors.push(`test_authority_invariant_duplicate_or_missing:${invariant?.id || "missing"}`);
    ids.add(invariant?.id);
    if (!Array.isArray(invariant.test_paths) || !invariant.test_paths.length) errors.push(`test_authority_paths_missing:${invariant?.id || "missing"}`);
    for (const testPath of invariant.test_paths || []) if (!isRepositoryRelativePath(testPath)) errors.push(`test_authority_path_invalid:${invariant.id}`);
  }
  for (const pattern of registry.test_file_patterns || []) try { globRegex(pattern); } catch { errors.push(`test_authority_pattern_invalid:${pattern}`); }
  return stableUnique(errors);
}
function requiredVerifierClosure(inventory, requirements, verifierRegistry) {
  const changedFacets = stableUnique(inventory.changes.flatMap((entry) => entry.paths.flatMap((node) => node.facets || [])));
  const registered = new Set((verifierRegistry.verifiers || []).map((entry) => entry.id));
  const applicable = (requirements.requirements || []).filter((entry) => (entry.when_facets || []).some((facet) => changedFacets.includes(facet)));
  const required = stableUnique(applicable.flatMap((entry) => entry.required_verifiers || []));
  const missing = required.filter((id) => !registered.has(id));
  return { changed_facets: changedFacets, applicable_requirements: applicable.map((entry) => entry.id), required_verifiers: required, missing_required_verifiers: missing, uncovered_semantic_impact_count: missing.length };
}
function testAuthorityClosure(inventory, registry) {
  const patterns = (registry.test_file_patterns || []).map((entry) => globRegex(entry));
  const registeredPaths = new Set((registry.invariant_authorities || []).flatMap((entry) => entry.test_paths || []));
  const changedTests = stableUnique(inventory.changes.flatMap((entry) => entry.paths.filter((node) => !node.historical && patterns.some((matcher) => matcher.test(node.path))).map((node) => node.path)));
  const unregisteredTests = changedTests.filter((file) => !registeredPaths.has(file));
  const removedRegisteredTests = stableUnique(inventory.changes.filter((entry) => ["D", "R"].includes(entry.status)).flatMap((entry) => entry.paths.filter((node) => node.historical && registeredPaths.has(node.path) && !(entry.paths || []).some((candidate) => !candidate.historical && registeredPaths.has(candidate.path))).map((node) => node.path)));
  return { changed_test_paths: changedTests, unregistered_tests: unregisteredTests, removed_registered_tests: removedRegisteredTests, unregistered_test_count: unregisteredTests.length, test_authority_removal_count: removedRegisteredTests.length };
}
function dottedPathError(value) {
  if (typeof value !== "string" || !value) return "missing";
  if (value.includes("\0")) return "nul";
  const segments = value.split(".");
  if (segments.some((segment) => !segment)) return "empty_segment";
  if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) return "prototype_segment";
  return null;
}
function validateRegistry(registry) {
  const errors = [];
  if (registry?.contract !== "mad4b.repository-governance-policy-registry.v1") errors.push("policy_registry_contract_mismatch");
  if (registry?.execution_model !== "declarative_registered_assertions") errors.push("policy_registry_execution_model_invalid");
  const declared = new Set(registry.allowed_assertion_types || []), ids = new Set();
  for (const type of declared) if (!SUPPORTED_ASSERTIONS.has(type)) errors.push(`unsupported_declared_assertion_type:${type}`);
  for (const policy of registry.policies || []) {
    if (!policy?.id) { errors.push("policy_id_missing"); continue; }
    if (ids.has(policy.id)) errors.push(`duplicate_policy_id:${policy.id}`);
    ids.add(policy.id);
    if (!Array.isArray(policy.assertions) || !policy.assertions.length) errors.push(`policy_assertions_missing:${policy.id}`);
    for (const assertion of policy.assertions || []) {
      if (!SUPPORTED_ASSERTIONS.has(assertion?.type)) errors.push(`unsupported_assertion_type:${policy.id}:${assertion?.type || "missing"}`);
      if (!declared.has(assertion?.type)) errors.push(`undeclared_assertion_type:${policy.id}:${assertion?.type || "missing"}`);
      if (["value_equals", "collection_empty", "number_compare", "forall"].includes(assertion?.type)) {
        const issue = dottedPathError(assertion.path);
        if (issue) errors.push(`assertion_path_invalid:${policy.id}:${issue}`);
      }
      if (assertion?.type === "forall") {
        const issue = dottedPathError(assertion.predicate?.field);
        if (issue) errors.push(`predicate_field_invalid:${policy.id}:${issue}`);
        if (assertion.predicate?.operator === "matches") {
          try { new RegExp(assertion.predicate?.pattern, "u"); } catch { errors.push(`predicate_pattern_invalid:${policy.id}`); }
        }
      }
    }
  }
  return stableUnique(errors);
}
function authorityConflicts(constitution, derived) {
  const conflicts = [];
  if (constitution?.contract !== "mad4b.repository-governance-constitution.v1") conflicts.push("constitution_contract_mismatch");
  if (derived?.contract !== "mad4b.repository-derived-state-governance.v1") conflicts.push("derived_registry_contract_mismatch");
  if (derived?.repository_governance?.constitution !== constitution.authority?.source_of_truth) conflicts.push("derived_registry_constitution_pointer_mismatch");
  for (const [key, authorityKey] of [["policy_registry","policy_registry"],["evidence_producer_registry","evidence_producer_registry"],["waiver_ledger","waiver_ledger"],["semantic_surface_registry","semantic_surface_registry"],["verifier_registry","verifier_registry"],["semantic_verifier_requirements","semantic_verifier_requirements"],["test_authority_registry","test_authority_registry"]]) {
    if (derived?.repository_governance?.[key] !== constitution.authority?.[authorityKey]) conflicts.push(`${key}_pointer_mismatch`);
  }
  if (derived?.required_check_name !== constitution.authority?.final_gate_context) conflicts.push("final_gate_context_mismatch");
  if (!sameSet(derived?.protected_branches || [], Object.keys(constitution.branches || {}))) conflicts.push("protected_branch_universe_mismatch");
  for (const branch of Object.keys(constitution.branches || {})) {
    const desired = constitution.branches[branch] || {}, observed = derived.server_enforcement?.[branch] || {};
    for (const key of ["require_pull_request","block_direct_push","block_force_push","dismiss_stale_approvals","require_conversation_resolution","generic_pull_request_merge_forbidden","promotion_path","same_sha_closure_required"]) {
      if (desired[key] !== undefined && observed[key] !== desired[key]) conflicts.push(`${branch}_server_policy_mismatch:${key}`);
    }
    if (!sameSet(observed.required_checks || [], desired.required_checks || [])) conflicts.push(`${branch}_required_checks_mismatch`);
  }
  return stableUnique(conflicts);
}
function getPath(value, dotted) {
  const raw = String(dotted || "");
  if (dottedPathError(raw)) return undefined;
  let current = value;
  for (const key of raw.split(".")) {
    if (current === null || current === undefined || (typeof current !== "object" && typeof current !== "function")) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = current[key];
  }
  return current;
}
function predicatePass(item, predicate = {}) {
  const value = getPath(item, predicate.field || "");
  switch (predicate.operator) {
    case "nonempty": return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && String(value).length > 0;
    case "equals": return value === predicate.value;
    case "includes": return Array.isArray(value) && value.includes(predicate.value);
    case "matches": { try { return new RegExp(predicate.pattern, "u").test(String(value ?? "")); } catch { return false; } }
    default: return false;
  }
}
function evaluateAssertion(assertion, context) {
  let observed = null, passed = false;
  if (assertion.type === "metric_zero") { observed = Number(context.metrics?.[assertion.metric]); passed = Number.isFinite(observed) && observed === 0; }
  else if (assertion.type === "flag_true") { observed = context.flags?.[assertion.flag] === true; passed = observed === true; }
  else if (assertion.type === "value_equals") { observed = getPath(context, assertion.path); passed = observed === assertion.value; }
  else if (assertion.type === "collection_empty") { observed = getPath(context, assertion.path); passed = Array.isArray(observed) && observed.length === 0; }
  else if (assertion.type === "number_compare") {
    observed = Number(getPath(context, assertion.path));
    const expected = Number(assertion.value);
    passed = Number.isFinite(observed) && Number.isFinite(expected) && ({ lt: observed < expected, lte: observed <= expected, eq: observed === expected, gte: observed >= expected, gt: observed > expected }[assertion.operator] === true);
  } else if (assertion.type === "forall") {
    observed = getPath(context, assertion.path);
    passed = Array.isArray(observed) && observed.every((item) => predicatePass(item, assertion.predicate));
  }
  return { ...assertion, observed, passed };
}
function evaluatePolicies(registry, context) {
  return (registry.policies || []).map((policy) => {
    const assertions = (policy.assertions || []).map((assertion) => evaluateAssertion(assertion, context));
    return { id: policy.id, version: policy.version, severity: policy.severity, passed: assertions.length > 0 && assertions.every((entry) => entry.passed), assertions };
  });
}
function workflowCountAt(sha) {
  return trackedFilesAt(sha, ".github/workflows").filter((file) => /\.ya?ml$/u.test(file)).length;
}
function selfTest() {
  const check = (condition, message) => { if (!condition) throw new Error(`self-test failed: ${message}`); };
  const recursive = globRegex("a/**/*.js");
  check(recursive.test("a/x.js"), "**/ must match zero directories");
  check(recursive.test("a/b/c.js"), "**/ must match nested directories");
  check(!recursive.test("a/b/c.ts"), "glob extension must remain bounded");
  const weird = nulFields(Buffer.from("a\nb\0x\ty\0", "utf8"));
  check(weird.length === 2 && weird[0] === "a\nb" && weird[1] === "x\ty", "NUL parser must preserve newline/tab filenames");
  const value = { safe: { value: 7 } };
  check(getPath(value, "safe.value") === 7, "own dotted path must resolve");
  check(getPath(value, "__proto__.polluted") === undefined, "__proto__ traversal must be rejected");
  check(getPath(value, "constructor.prototype") === undefined, "constructor/prototype traversal must be rejected");
  const escaped = resolveRelativeImport("a/b.js", "../../../outside.js", new Set());
  check(escaped?.escaped === true, "relative dependency escape must fail closed");
  const invalid = validateRegistry({
    contract: "mad4b.repository-governance-policy-registry.v1",
    execution_model: "declarative_registered_assertions",
    allowed_assertion_types: ["value_equals"],
    policies: [{ id: "prototype-probe", assertions: [{ type: "value_equals", path: "__proto__.polluted", value: true }] }],
  });
  check(invalid.some((entry) => entry.startsWith("assertion_path_invalid:prototype-probe:")), "registry must reject prototype paths");
  console.log(JSON.stringify({ ok: true, contract: CONTRACT, nul_safe_git_fields: true, repository_relative_dependencies: true, prototype_safe_policy_paths: true, glob_compiler: true }));
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const constitution = readJson(constitutionPath);
const policyRegistry = readJson(policyRegistryPath);
const semanticRegistry = readJson(semanticRegistryPath);
const semanticVerifierRequirements = readJson(semanticVerifierRequirementsPath);
const verifierRegistry = readJson(verifierRegistryPath);
const testAuthorityRegistry = readJson(testAuthorityRegistryPath);
const derivedRegistry = readJson(derivedRegistryPath);
const ciSurfacePolicy = fs.existsSync(ciSurfacePolicyPath) ? readJson(ciSurfacePolicyPath) : {};
const expectedSha = arg("expected-sha", gitText(["rev-parse", "HEAD"]).trim());
const baseSha = arg("base-sha", expectedSha);
const candidateKind = arg("candidate-kind", "exact_sha");
const reportFile = path.resolve(arg("report-file", path.join(root, ".artifacts/repository-governance-closure/report.json")));
if (!SHA_RE.test(expectedSha) || !SHA_RE.test(baseSha)) throw new Error("expected/base SHA must be exact lowercase 40-character Git SHAs");
const observedHead = gitText(["rev-parse", "HEAD"]).trim();
if (observedHead !== expectedSha) throw new Error(`exact candidate mismatch: expected=${expectedSha} observed=${observedHead}`);
const initial = gitText(["status", "--porcelain", "--untracked-files=all"]).trim();
if (initial) throw new Error(`governance closure must start clean:\n${initial}`);

const inventory = parseChanges(baseSha, expectedSha, constitution, semanticRegistry);
const semanticGraph = buildSemanticGraph(inventory, baseSha, semanticRegistry);
const graph = derivedGraph(derivedRegistry);
const registryErrors = validateRegistry(policyRegistry);
const semanticRegistryErrors = validateSemanticRegistry(semanticRegistry);
const verifierRegistryErrors = validateVerifierRegistry(verifierRegistry);
const semanticVerifierRequirementsErrors = validateSemanticVerifierRequirements(semanticVerifierRequirements, verifierRegistry);
const testAuthorityRegistryErrors = validateTestAuthorityRegistry(testAuthorityRegistry);
const requiredVerifiers = requiredVerifierClosure(inventory, semanticVerifierRequirements, verifierRegistry);
const testAuthority = testAuthorityClosure(inventory, testAuthorityRegistry);
const conflicts = authorityConflicts(constitution, derivedRegistry);
const protectedPaths = new Set(derivedRegistry.convergence?.automation_control_paths || []);
const unregisteredControl = stableUnique((constitution.control_plane_paths || []).filter((file) => !protectedPaths.has(file)));
const baseWorkflowCount = workflowCountAt(baseSha);
const candidateWorkflowCount = workflowCountAt(expectedSha);
const workflowTarget = Number(ciSurfacePolicy.targetMaxWorkflowFiles || ciSurfacePolicy.maxWorkflowFiles || 160);
const workflowAllowedCeiling = Math.max(workflowTarget, baseWorkflowCount);
const metrics = {
  constitution_conflict_count: conflicts.length,
  unknown_surface_count: inventory.unknown_surfaces.length,
  unknown_executable_count: inventory.unknown_executables.length,
  unknown_semantic_executable_count: inventory.unknown_semantic_executables.length,
  unsupported_git_status_count: inventory.unsupported_statuses.length,
  unclassified_historical_path_count: inventory.unclassified_historical_paths.length,
  deletion_dangling_reference_count: semanticGraph.dangling_references.length,
  semantic_unresolved_dependency_count: semanticGraph.unresolved_dependencies.length,
  semantic_registry_error_count: semanticRegistryErrors.length,
  verifier_registry_error_count: verifierRegistryErrors.length,
  semantic_verifier_requirements_error_count: semanticVerifierRequirementsErrors.length,
  test_authority_registry_error_count: testAuthorityRegistryErrors.length,
  missing_required_verifiers: requiredVerifiers.missing_required_verifiers.length,
  uncovered_semantic_impact_count: requiredVerifiers.uncovered_semantic_impact_count,
  unvalidated_executable_count: inventory.unknown_semantic_executables.length,
  unregistered_test_count: testAuthority.unregistered_test_count,
  test_authority_removal_count: testAuthority.test_authority_removal_count,
  missing_derived_dependency_count: graph.missing_dependencies.length,
  derived_cycle_count: graph.cycles.length,
  unregistered_control_plane_path_count: unregisteredControl.length,
  policy_registry_error_count: registryErrors.length,
  workflow_surface_base_count: baseWorkflowCount,
  workflow_surface_candidate_count: candidateWorkflowCount,
  workflow_surface_target_count: workflowTarget,
  workflow_surface_allowed_ceiling: workflowAllowedCeiling,
  workflow_surface_growth_count: Math.max(0, candidateWorkflowCount - workflowAllowedCeiling),
};
const flags = {
  git_native_newness: constitution.authority?.change_identity === "git_base_candidate_tree" && constitution.change_model?.filename_age_heuristics_forbidden === true,
  workflow_surface_ratchet_enforced: Number.isInteger(workflowTarget) && workflowTarget >= 1,
};
const context = { metrics, flags, semantic_graph: semanticGraph, change_inventory: inventory, derived_state_graph: graph };
const policies = evaluatePolicies(policyRegistry, context);
const blocking = policies.filter((entry) => entry.severity === "blocking" && !entry.passed);
const final = gitText(["status", "--porcelain", "--untracked-files=all"]).trim();
if (final) throw new Error(`governance verifier mutated checkout:\n${final}`);
const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  candidate: { kind: candidateKind, sha: observedHead, base_sha: baseSha },
  constitution_contract: constitution.contract,
  policy_registry_contract: policyRegistry.contract,
  semantic_registry_contract: semanticRegistry.contract,
  final_gate_context: constitution.authority?.final_gate_context || null,
  metrics,
  flags,
  converged: blocking.length === 0,
  blocking_failure_policy_ids: blocking.map((entry) => entry.id),
  authority_conflicts: conflicts,
  policy_registry_errors: registryErrors,
  semantic_registry_errors: semanticRegistryErrors,
  verifier_registry_errors: verifierRegistryErrors,
  semantic_verifier_requirements_errors: semanticVerifierRequirementsErrors,
  test_authority_registry_errors: testAuthorityRegistryErrors,
  required_verifier_closure: requiredVerifiers,
  test_authority_closure: testAuthority,
  unregistered_control_plane_paths: unregisteredControl,
  change_inventory: {
    changed_entry_count: inventory.changes.length,
    unknown_surfaces: inventory.unknown_surfaces,
    unknown_executables: inventory.unknown_executables,
    unknown_semantic_executables: inventory.unknown_semantic_executables,
    unvalidated_executables: inventory.unknown_semantic_executables,
    unclassified_historical_paths: inventory.unclassified_historical_paths,
    changes: inventory.changes,
  },
  semantic_graph: semanticGraph,
  derived_state_graph: graph,
  ci_surface_ratchet: { base_count: baseWorkflowCount, candidate_count: candidateWorkflowCount, target_count: workflowTarget, allowed_ceiling: workflowAllowedCeiling, growth_blocked: metrics.workflow_surface_growth_count > 0 },
  policies,
  server_enforcement: {
    desired_attestation: constitution.authority?.server_enforcement_attestation || null,
    activation_guard: derivedRegistry.server_enforcement?.activation_guard || null,
    live_readback_performed_by_this_verifier: false,
    note: "Live GitHub enforcement is a separate authority; source verification never infers it from repository files."
  },
  safety: { detection_mode: "read_only", repository_mutation_performed: false, dynamic_code_evaluation: false, shell_execution: false, secrets_included: false }
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ contract: CONTRACT, candidate_sha: observedHead, converged: report.converged, metrics }));
if (!report.converged) process.exitCode = 1;
