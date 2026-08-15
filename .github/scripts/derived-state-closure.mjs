#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONTRACT = "mad4b.repository-derived-state-closure.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;
const MAX_LOG = 3000;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
    { cwd: repoRoot, command: process.execPath, args: ["scripts/remote-mcp-write-scope-inventory.mjs", "--check"] },
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

function validateRegistry(registry) {
  if (registry?.contract !== "mad4b.repository-derived-state-governance.v1") throw new Error("derived-state registry contract mismatch");
  if (!Array.isArray(registry.artifacts) || registry.artifacts.length === 0) throw new Error("derived-state registry has no artifacts");
  const ids = new Set();
  for (const artifact of registry.artifacts) {
    if (!artifact?.artifact_id || ids.has(artifact.artifact_id)) throw new Error(`duplicate or missing artifact_id: ${artifact?.artifact_id || "missing"}`);
    ids.add(artifact.artifact_id);
    if (!VERIFIERS[artifact.verifier_id]) throw new Error(`unregistered verifier_id: ${artifact.verifier_id}`);
    if (!artifact.recipe) throw new Error(`missing recipe for ${artifact.artifact_id}`);
    if (!Array.isArray(artifact.outputs) || artifact.outputs.length === 0) throw new Error(`missing outputs for ${artifact.artifact_id}`);
    if (!Array.isArray(artifact.dependency_scope) || artifact.dependency_scope.length === 0) throw new Error(`missing dependency_scope for ${artifact.artifact_id}`);
  }
}

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
validateRegistry(registry);

const expectedSha = arg("expected-sha", process.env.DERIVED_STATE_EXPECTED_SHA || headSha());
const candidateKind = arg("candidate-kind", process.env.DERIVED_STATE_CANDIDATE_KIND || "exact_sha");
const reportFile = path.resolve(arg("report-file", process.env.DERIVED_STATE_REPORT_FILE || path.join(repoRoot, ".artifacts/derived-state-closure/report.json")));
if (!SHA_RE.test(expectedSha)) throw new Error("expected SHA must be an exact lowercase 40-character Git SHA");
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
  const current = !verifierMutation && commandResults.length > 0 && commandResults.every((entry) => entry.ok);
  results.push({
    artifact_id: artifact.artifact_id,
    recipe: artifact.recipe,
    verifier_id: artifact.verifier_id,
    current,
    dependency_scope: artifact.dependency_scope,
    outputs: artifact.outputs,
    commands: commandResults
  });
  if (verifierMutation) break;
}

const failed = results.filter((entry) => !entry.current);
const repairRecipes = [...new Set(failed.map((entry) => entry.recipe))];
const converged = failed.length === 0 && !verifierMutation && results.length === registry.artifacts.length;
const report = {
  contract: CONTRACT,
  generated_at: new Date().toISOString(),
  candidate: {
    kind: candidateKind,
    sha: observedHead
  },
  registry_contract: registry.contract,
  required_check_name: registry.required_check_name,
  registered_artifact_count: registry.artifacts.length,
  checked_artifact_count: results.length,
  current_artifact_count: results.filter((entry) => entry.current).length,
  stale_or_failed_artifact_count: failed.length,
  converged,
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
process.stdout.write(`${JSON.stringify({ contract: report.contract, candidate_sha: observedHead, converged, stale_or_failed_artifact_count: failed.length, repair_recipes: repairRecipes, verifier_mutation: Boolean(verifierMutation), secrets_included: false })}\n`);
if (!converged) process.exitCode = 1;
