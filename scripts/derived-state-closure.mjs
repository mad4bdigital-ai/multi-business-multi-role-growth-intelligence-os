#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONTRACT = "mad4b.repository-derived-state-closure.v2";
const SHA_RE = /^[0-9a-f]{40}$/u;
const MAX_LOG = 3000;
const ARTIFACT_CLASSES = new Set(["semantic", "observability"]);
const STEP_TYPES = new Set(["node", "npm", "work_map_dynamic"]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(repoRoot, ".github/derived-state-governance.json");
const verifierRegistryPath = path.join(repoRoot, ".github/governance/verifier-registry.json");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env }, shell: false });
  return {
    ok: !result.error && result.status === 0,
    status: Number.isInteger(result.status) ? result.status : null,
    command: [command, ...args].join(" "),
    stdout_tail: String(result.stdout || "").slice(-MAX_LOG),
    stderr_tail: String(result.stderr || result.error?.message || "").slice(-MAX_LOG)
  };
}
function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message || "unknown"}`);
  return String(result.stdout || "").trim();
}
function safeCwd(value = ".") {
  const resolved = path.resolve(repoRoot, value);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) throw new Error(`verifier cwd escapes repository: ${value}`);
  return resolved;
}
function safeRepoPath(value) {
  const full = path.resolve(repoRoot, value);
  if (!full.startsWith(`${repoRoot}${path.sep}`)) throw new Error(`verifier path escapes repository: ${value}`);
  if (!fs.existsSync(full)) throw new Error(`registered verifier path is missing: ${value}`);
  return full;
}
function resolveRepairAuthority(artifact) {
  if (artifact?.repair_authority) {
    const authority = artifact.repair_authority;
    if (!authority.id || !authority.kind) throw new Error(`invalid repair_authority for ${artifact.artifact_id}`);
    if (authority.kind !== "delegated_work_map_writer" || !authority.workflow || !authority.writer_workflow) throw new Error(`unregistered or incomplete repair_authority for ${artifact.artifact_id}`);
    return { id: authority.id, kind: authority.kind, workflow: authority.workflow, writer_workflow: authority.writer_workflow };
  }
  if (!artifact?.recipe) throw new Error(`missing repair authority for ${artifact?.artifact_id || "unknown"}`);
  return { id: artifact.recipe, kind: "generated_artifact_recipe", recipe: artifact.recipe };
}
function dependencyIds(artifact) {
  return (artifact.dependency_scope || []).filter((entry) => entry?.type === "artifact").map((entry) => entry.artifact_id);
}
function topologicalArtifacts(artifacts) {
  const byId = new Map(artifacts.map((entry) => [entry.artifact_id, entry]));
  const indegree = new Map(artifacts.map((entry) => [entry.artifact_id, 0]));
  const dependents = new Map(artifacts.map((entry) => [entry.artifact_id, []]));
  for (const artifact of artifacts) {
    for (const dep of dependencyIds(artifact)) {
      if (!byId.has(dep)) throw new Error(`missing artifact dependency ${dep} for ${artifact.artifact_id}`);
      indegree.set(artifact.artifact_id, indegree.get(artifact.artifact_id) + 1);
      dependents.get(dep).push(artifact.artifact_id);
    }
  }
  const ready = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const ordered = [];
  while (ready.length) {
    const id = ready.shift();
    ordered.push(byId.get(id));
    for (const dependent of dependents.get(id).sort()) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) { ready.push(dependent); ready.sort(); }
    }
  }
  if (ordered.length !== artifacts.length) throw new Error("derived-state dependency graph contains a cycle");
  return ordered;
}
function loadVerifierRegistry() {
  const registry = JSON.parse(fs.readFileSync(verifierRegistryPath, "utf8"));
  if (registry?.contract !== "mad4b.repository-verifier-registry.v1") throw new Error("verifier registry contract mismatch");
  if (registry?.shell_execution_forbidden !== true) throw new Error("verifier registry must forbid shell execution");
  const declared = new Set(registry.allowed_step_types || []);
  if ([...declared].some((type) => !STEP_TYPES.has(type))) throw new Error("verifier registry declares unsafe step type");
  const byId = new Map();
  for (const verifier of registry.verifiers || []) {
    if (!verifier?.id || byId.has(verifier.id) || !Array.isArray(verifier.steps) || verifier.steps.length === 0) throw new Error(`invalid verifier registry entry: ${verifier?.id || "missing"}`);
    for (const step of verifier.steps) if (!STEP_TYPES.has(step?.type) || !declared.has(step.type)) throw new Error(`unsupported verifier step type: ${step?.type || "missing"}`);
    byId.set(verifier.id, verifier);
  }
  return { registry, byId };
}
function registeredWorkMapFeatures(pattern = "specs/*/work-map-integration.json") {
  return git(["ls-files", pattern]).split("\n").filter(Boolean).map((file) => file.split("/")[1]).filter(Boolean).sort();
}
function expandVerifierSteps(verifier) {
  const commands = [];
  for (const step of verifier.steps) {
    const cwd = safeCwd(step.cwd || ".");
    if (step.type === "node") {
      const script = safeRepoPath(path.posix.join(step.cwd || ".", step.path));
      commands.push({ cwd, command: process.execPath, args: [script, ...(step.args || [])], source_type: "node" });
    } else if (step.type === "npm") {
      if (!/^[a-zA-Z0-9:_-]+$/u.test(step.script || "")) throw new Error(`invalid npm script name: ${step.script || "missing"}`);
      commands.push({ cwd, command: "npm", args: ["run", step.script], source_type: "npm" });
    } else if (step.type === "work_map_dynamic") {
      const generator = safeRepoPath(path.posix.join(step.cwd || ".", step.generator));
      const bindingVerifier = safeRepoPath(path.posix.join(step.cwd || ".", step.binding_verifier));
      commands.push({ cwd, command: process.execPath, args: [generator, "--check"], source_type: "work_map_generator" });
      commands.push({ cwd, command: process.execPath, args: [bindingVerifier, "--check"], source_type: "work_map_default_binding" });
      for (const feature of registeredWorkMapFeatures(step.integration_glob)) {
        commands.push({ cwd, command: process.execPath, args: [bindingVerifier, "--feature-key", feature, "--check"], source_type: "work_map_discovered_binding", feature_key: feature });
      }
    }
  }
  return commands;
}
function validateRegistry(registry, verifiers) {
  if (registry?.contract !== "mad4b.repository-derived-state-governance.v1") throw new Error("derived-state registry contract mismatch");
  if (registry?.repository_governance?.verifier_registry !== ".github/governance/verifier-registry.json") throw new Error("derived-state verifier registry pointer mismatch");
  if (!Array.isArray(registry.artifacts) || !registry.artifacts.length) throw new Error("derived-state registry has no artifacts");
  const ids = new Set();
  for (const artifact of registry.artifacts) {
    if (!artifact?.artifact_id || ids.has(artifact.artifact_id)) throw new Error(`duplicate or missing artifact_id: ${artifact?.artifact_id || "missing"}`);
    ids.add(artifact.artifact_id);
    if (!ARTIFACT_CLASSES.has(artifact.artifact_class)) throw new Error(`invalid artifact_class for ${artifact.artifact_id}`);
    if (typeof artifact.merge_blocking !== "boolean") throw new Error(`merge_blocking must be explicit for ${artifact.artifact_id}`);
    if (artifact.artifact_class === "observability" && artifact.merge_blocking) throw new Error(`observability artifact cannot block merge: ${artifact.artifact_id}`);
    if (artifact.artifact_class === "semantic" && !artifact.merge_blocking) throw new Error(`semantic artifact must block merge: ${artifact.artifact_id}`);
    if (!verifiers.has(artifact.verifier_id)) throw new Error(`unregistered verifier_id: ${artifact.verifier_id}`);
    resolveRepairAuthority(artifact);
  }
  return topologicalArtifacts(registry.artifacts);
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const verifierAuthority = loadVerifierRegistry();
const orderedArtifacts = validateRegistry(registry, verifierAuthority.byId);
const expectedSha = arg("expected-sha", git(["rev-parse", "HEAD"]));
const candidateKind = arg("candidate-kind", "exact_sha");
const prNumberRaw = arg("pr-number", "0");
const sourceHeadSha = arg("source-head-sha", expectedSha);
const baseSha = arg("base-sha", expectedSha);
const reportFile = path.resolve(arg("report-file", path.join(repoRoot, ".artifacts/derived-state-closure/report.json")));
if (![expectedSha, sourceHeadSha, baseSha].every((sha) => SHA_RE.test(sha))) throw new Error("candidate/source/base SHA must be exact lowercase 40-character Git SHAs");
if (!/^(?:0|[1-9][0-9]*)$/u.test(prNumberRaw)) throw new Error("pr-number invalid");
if (git(["rev-parse", "HEAD"]) !== expectedSha) throw new Error("exact candidate mismatch");
const initial = git(["status", "--porcelain", "--untracked-files=all"]);
if (initial) throw new Error(`closure must start clean:\n${initial}`);

const results = [];
let verifierMutation = null;
for (const artifact of orderedArtifacts) {
  const commands = [];
  const verifier = verifierAuthority.byId.get(artifact.verifier_id);
  for (const spec of expandVerifierSteps(verifier)) {
    const result = run(spec.command, spec.args, spec.cwd);
    commands.push({ ...result, source_type: spec.source_type, feature_key: spec.feature_key || null });
    const dirty = git(["status", "--porcelain", "--untracked-files=all"]);
    if (dirty) { verifierMutation = { artifact_id: artifact.artifact_id, verifier_id: artifact.verifier_id, dirty_paths: dirty.split("\n") }; break; }
    if (!result.ok) break;
  }
  const repairAuthority = resolveRepairAuthority(artifact);
  results.push({
    artifact_id: artifact.artifact_id,
    artifact_class: artifact.artifact_class,
    merge_blocking: artifact.merge_blocking,
    recipe: repairAuthority.recipe || null,
    repair_authority: repairAuthority,
    verifier_id: artifact.verifier_id,
    verifier_registry_contract: verifierAuthority.registry.contract,
    current: !verifierMutation && commands.length > 0 && commands.every((entry) => entry.ok),
    dependency_ids: dependencyIds(artifact),
    dependency_scope: artifact.dependency_scope,
    outputs: artifact.outputs,
    commands
  });
  if (verifierMutation) break;
}
const failed = results.filter((entry) => !entry.current);
const blockingFailed = failed.filter((entry) => entry.merge_blocking);
const observabilityFailed = failed.filter((entry) => entry.artifact_class === "observability");
const repairAuthorities = [...new Map(blockingFailed.map((entry) => [entry.repair_authority.id, entry.repair_authority])).values()];
const advisoryRepairAuthorities = [...new Map(observabilityFailed.map((entry) => [entry.repair_authority.id, entry.repair_authority])).values()];
const converged = blockingFailed.length === 0 && !verifierMutation && results.length === orderedArtifacts.length;
const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  candidate: { kind: candidateKind, sha: expectedSha, pr_number: Number(prNumberRaw) || null, source_head_sha: sourceHeadSha, base_sha: baseSha },
  registry_contract: registry.contract,
  verifier_registry_contract: verifierAuthority.registry.contract,
  required_check_name: registry.required_check_name,
  execution_order: orderedArtifacts.map((entry) => entry.artifact_id),
  registered_artifact_count: registry.artifacts.length,
  registered_verifier_count: verifierAuthority.byId.size,
  checked_artifact_count: results.length,
  current_artifact_count: results.filter((entry) => entry.current).length,
  stale_or_failed_artifact_count: failed.length,
  blocking_stale_or_failed_artifact_count: blockingFailed.length,
  observability_stale_or_failed_artifact_count: observabilityFailed.length,
  converged,
  repair_authorities: repairAuthorities,
  advisory_repair_authorities: advisoryRepairAuthorities,
  repair_recipes: repairAuthorities.filter((entry) => entry.kind === "generated_artifact_recipe").map((entry) => entry.recipe),
  artifacts: results,
  verifier_mutation: verifierMutation,
  safety: { detection_mode: "read_only", verifier_registry_only: true, shell_execution: false, remote_repository_mutation_performed: false, protected_branch_mutation_performed: false, force_push_performed: false, database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false }
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ contract: report.contract, candidate_sha: expectedSha, converged, blocking_stale_or_failed_artifact_count: blockingFailed.length, observability_stale_or_failed_artifact_count: observabilityFailed.length, repair_authority_ids: repairAuthorities.map((entry) => entry.id), execution_order: report.execution_order }));
if (!converged) process.exitCode = 1;
