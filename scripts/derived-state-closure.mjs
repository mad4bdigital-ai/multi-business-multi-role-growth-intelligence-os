#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONTRACT = "mad4b.repository-derived-state-closure.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;
const MAX_LOG = 3000;
const ARTIFACT_CLASSES = new Set(["semantic", "observability"]);
// Read-only CI verifier: lives with repository verifiers, not mutating maintenance tools.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(repoRoot, "http-generic-api");
const registryPath = path.join(repoRoot, ".github/derived-state-governance.json");

const VERIFIERS = Object.freeze({
  repository_inventory_currentness: [
    { cwd: repoRoot, command: process.execPath, args: ["scripts/repository-inventory.mjs", "--check"] }
  ],
  repository_evaluation_currentness: [
    { cwd: repoRoot, command: process.execPath, args: ["scripts/repository-evaluation.mjs", "--check", "--enforce"] }
  ],
  remote_mcp_write_scope_currentness: [
    { cwd: repoRoot, command: process.execPath, args: ["scripts/remote-mcp-write-scope-semantic-currentness.mjs"] },
    { cwd: repoRoot, command: process.execPath, args: ["scripts/test-remote-mcp-write-scope-inventory.mjs"] }
  ],
  frontend_openapi_currentness: [
    { cwd: apiDir, command: "npm", args: ["run", "frontend:dispatch:check"] },
    { cwd: apiDir, command: "npm", args: ["run", "openapi:auth:check"] },
    { cwd: apiDir, command: "npm", args: ["run", "schemas:check"] }
  ],
  work_map_currentness: [
    { cwd: apiDir, command: process.execPath, args: ["scripts/platform-work-map-generator.mjs", "--check"] },
    { cwd: apiDir, command: process.execPath, args: ["scripts/spec014-refresh-final-work-map-binding.mjs", "--check"] },
    { cwd: apiDir, command: process.execPath, args: ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "014-retail-commerce-operations-growth-os", "--check"] },
    { cwd: apiDir, command: process.execPath, args: ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "017-remote-mcp-host-isolation-oauth-readiness", "--check"] },
    { cwd: apiDir, command: process.execPath, args: ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "018-environment-promotion-runtime-integrity", "--check"] },
    { cwd: apiDir, command: process.execPath, args: ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "019-governed-database-lifecycle-pressure-relief", "--check"] }
  ],
  portable_staging_manifest_currentness: [
    { cwd: repoRoot, command: process.execPath, args: ["http-generic-api/test-staging-autopilot-closure.mjs"] }
  ]
});

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env }
  });
  return {
    ok: !result.error && result.status === 0,
    status: Number.isInteger(result.status) ? result.status : null,
    command: [command, ...args].join(" "),
    stdout_tail: String(result.stdout || "").slice(-MAX_LOG),
    stderr_tail: String(result.stderr || result.error?.message || "").slice(-MAX_LOG)
  };
}

function gitStatus() {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git status failed: ${result.stderr || result.error?.message || "unknown"}`);
  return String(result.stdout || "").trim();
}

function headSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git rev-parse HEAD failed: ${result.stderr || result.error?.message || "unknown"}`);
  return String(result.stdout || "").trim();
}

function resolveRepairAuthority(artifact) {
  if (artifact?.repair_authority) {
    const authority = artifact.repair_authority;
    if (!authority.id || !authority.kind) throw new Error(`invalid repair_authority for ${artifact.artifact_id}`);
    if (authority.kind === "delegated_work_map_writer") {
      if (!authority.workflow || !authority.writer_workflow) throw new Error(`delegated Work Map authority requires recovery and writer workflows for ${artifact.artifact_id}`);
      return { id: authority.id, kind: authority.kind, workflow: authority.workflow, writer_workflow: authority.writer_workflow };
    }
    throw new Error(`unregistered repair authority kind for ${artifact.artifact_id}: ${authority.kind}`);
  }
  if (!artifact?.recipe) throw new Error(`missing repair authority for ${artifact?.artifact_id || "unknown"}`);
  return { id: artifact.recipe, kind: "generated_artifact_recipe", recipe: artifact.recipe };
}

function validateRegistry(registry) {
  if (registry?.contract !== "mad4b.repository-derived-state-governance.v1") throw new Error("derived-state registry contract mismatch");
  if (!Array.isArray(registry.artifacts) || registry.artifacts.length === 0) throw new Error("derived-state registry has no artifacts");
  const ids = new Set();
  for (const artifact of registry.artifacts) {
    if (!artifact?.artifact_id || ids.has(artifact.artifact_id)) throw new Error(`duplicate or missing artifact_id: ${artifact?.artifact_id || "missing"}`);
    ids.add(artifact.artifact_id);
    if (!ARTIFACT_CLASSES.has(artifact.artifact_class)) throw new Error(`invalid artifact_class for ${artifact.artifact_id}: ${artifact.artifact_class || "missing"}`);
    if (typeof artifact.merge_blocking !== "boolean") throw new Error(`merge_blocking must be explicit for ${artifact.artifact_id}`);
    if (artifact.artifact_class === "observability" && artifact.merge_blocking) throw new Error(`observability artifact cannot block merge: ${artifact.artifact_id}`);
    if (artifact.artifact_class === "semantic" && !artifact.merge_blocking) throw new Error(`semantic artifact must block merge: ${artifact.artifact_id}`);
    if (!VERIFIERS[artifact.verifier_id]) throw new Error(`unregistered verifier_id: ${artifact.verifier_id}`);
    resolveRepairAuthority(artifact);
    if (!Array.isArray(artifact.outputs) || artifact.outputs.length === 0) throw new Error(`missing outputs for ${artifact.artifact_id}`);
    if (!Array.isArray(artifact.dependency_scope) || artifact.dependency_scope.length === 0) throw new Error(`missing dependency_scope for ${artifact.artifact_id}`);
  }
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
validateRegistry(registry);

const expectedSha = arg("expected-sha", headSha());
const candidateKind = arg("candidate-kind", "exact_sha");
const prNumberRaw = arg("pr-number", "0");
const sourceHeadSha = arg("source-head-sha", expectedSha);
const baseSha = arg("base-sha", expectedSha);
const reportFile = path.resolve(arg("report-file", path.join(repoRoot, ".artifacts/derived-state-closure/report.json")));

if (!SHA_RE.test(expectedSha)) throw new Error("expected SHA must be an exact lowercase 40-character Git SHA");
if (!SHA_RE.test(sourceHeadSha)) throw new Error("source head SHA must be an exact lowercase 40-character Git SHA");
if (!SHA_RE.test(baseSha)) throw new Error("base SHA must be an exact lowercase 40-character Git SHA");
if (!/^(?:0|[1-9][0-9]*)$/u.test(prNumberRaw)) throw new Error("pr-number must be zero or a positive integer");
const prNumber = Number.parseInt(prNumberRaw, 10);

const observedHead = headSha();
if (observedHead !== expectedSha) throw new Error(`exact candidate mismatch: expected=${expectedSha} observed=${observedHead}`);

const initialStatus = gitStatus();
if (initialStatus) throw new Error(`closure must start from a clean checkout; dirty paths:\n${initialStatus}`);

const results = [];
let verifierMutation = null;
for (const artifact of registry.artifacts) {
  const commandResults = [];
  for (const spec of VERIFIERS[artifact.verifier_id]) {
    const result = run(spec.command, spec.args, spec.cwd);
    commandResults.push(result);
    const dirty = gitStatus();
    if (dirty) {
      verifierMutation = { artifact_id: artifact.artifact_id, verifier_id: artifact.verifier_id, dirty_paths: dirty.split("\n") };
      break;
    }
    if (!result.ok) break;
  }
  const repairAuthority = resolveRepairAuthority(artifact);
  const current = !verifierMutation && commandResults.length > 0 && commandResults.every((entry) => entry.ok);
  results.push({
    artifact_id: artifact.artifact_id,
    artifact_class: artifact.artifact_class,
    merge_blocking: artifact.merge_blocking,
    recipe: repairAuthority.recipe || null,
    repair_authority: repairAuthority,
    verifier_id: artifact.verifier_id,
    current,
    dependency_scope: artifact.dependency_scope,
    outputs: artifact.outputs,
    commands: commandResults
  });
  if (verifierMutation) break;
}

const failed = results.filter((entry) => !entry.current);
const blockingFailed = failed.filter((entry) => entry.merge_blocking);
const observabilityFailed = failed.filter((entry) => entry.artifact_class === "observability");
const repairAuthorities = [...new Map(blockingFailed.map((entry) => [entry.repair_authority.id, entry.repair_authority])).values()];
const advisoryRepairAuthorities = [...new Map(observabilityFailed.map((entry) => [entry.repair_authority.id, entry.repair_authority])).values()];
const repairRecipes = repairAuthorities
  .filter((entry) => entry.kind === "generated_artifact_recipe")
  .map((entry) => entry.recipe);
const converged = blockingFailed.length === 0 && !verifierMutation && results.length === registry.artifacts.length;
const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  candidate: {
    kind: candidateKind,
    sha: observedHead,
    pr_number: prNumber > 0 ? prNumber : null,
    source_head_sha: sourceHeadSha,
    base_sha: baseSha
  },
  registry_contract: registry.contract,
  required_check_name: registry.required_check_name,
  registered_artifact_count: registry.artifacts.length,
  checked_artifact_count: results.length,
  current_artifact_count: results.filter((entry) => entry.current).length,
  stale_or_failed_artifact_count: failed.length,
  blocking_stale_or_failed_artifact_count: blockingFailed.length,
  observability_stale_or_failed_artifact_count: observabilityFailed.length,
  converged,
  repair_authorities: repairAuthorities,
  advisory_repair_authorities: advisoryRepairAuthorities,
  repair_recipes: repairRecipes,
  artifacts: results,
  verifier_mutation: verifierMutation,
  safety: {
    detection_mode: "read_only",
    remote_repository_mutation_performed: false,
    protected_branch_mutation_performed: false,
    force_push_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false
  }
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  contract: report.contract,
  candidate_sha: observedHead,
  candidate_kind: candidateKind,
  pr_number: report.candidate.pr_number,
  source_head_sha: sourceHeadSha,
  base_sha: baseSha,
  converged,
  stale_or_failed_artifact_count: failed.length,
  blocking_stale_or_failed_artifact_count: blockingFailed.length,
  observability_stale_or_failed_artifact_count: observabilityFailed.length,
  repair_authority_ids: repairAuthorities.map((entry) => entry.id),
  advisory_repair_authority_ids: advisoryRepairAuthorities.map((entry) => entry.id),
  repair_recipes: repairRecipes,
  verifier_mutation: Boolean(verifierMutation),
  secrets_included: false
})}\n`);
if (!converged) process.exitCode = 1;
