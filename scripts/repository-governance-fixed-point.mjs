#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { splitMigrationSqlStatements } from "../http-generic-api/migrationSqlStatements.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const semanticBindingPath = path.join(root, ".github/governance/semantic-verifier-bindings.json");
const executableRegistryPath = path.join(root, ".github/governance/executable-validator-registry.json");
const testAuthorityPath = path.join(root, ".github/governance/test-authority-registry.json");
const verifierRegistryPath = path.join(root, ".github/governance/verifier-registry.json");
const baseClosurePath = path.join(root, "scripts/repository-governance-closure.mjs");
const FIXED_POINT_VERIFIERS = new Set([
  "fixed_point:server_policy_lifecycle",
  "fixed_point:semantic_impact",
  "fixed_point:executable_universe",
  "fixed_point:test_authority",
]);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}
function stableUnique(values = []) { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
function escapeRegex(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }
export function globRegex(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { source += "(?:.*/)?"; i += 2; }
        else { source += ".*"; i += 1; }
      } else source += "[^/]*";
    } else if (ch === "?") source += "[^/]";
    else source += escapeRegex(ch);
  }
  return new RegExp(`^${source}$`, "u");
}
function matchesAny(file, patterns = []) { return patterns.some((pattern) => globRegex(pattern).test(file)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function gitFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${String(result.stderr || result.error?.message || "unknown")}`);
  return Buffer.from(result.stdout || []).toString("utf8").split("\0").filter(Boolean).sort();
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    env: { ...process.env, ...(options.env || {}) },
  });
  return {
    ok: !result.error && result.status === 0,
    status: Number.isInteger(result.status) ? result.status : null,
    error: result.error?.code || result.error?.message || null,
    stderr_tail: String(result.stderr || result.error?.message || "").slice(-2000),
  };
}
function validatorMap(registry) {
  const map = new Map();
  for (const entry of registry.validators || []) {
    if (!entry?.validator || !Array.isArray(entry.extensions) || !entry.extensions.length) throw new Error("invalid executable validator registry entry");
    for (const ext of entry.extensions) {
      if (map.has(ext)) throw new Error(`duplicate executable extension validator: ${ext}`);
      map.set(ext, entry.validator);
    }
  }
  return map;
}
export function validateRegistryContracts({ semanticBindings, executableRegistry, testAuthority, verifierRegistry }) {
  const errors = [];
  if (semanticBindings?.contract !== "mad4b.repository-semantic-verifier-bindings.v1") errors.push("semantic_binding_contract_mismatch");
  if (executableRegistry?.contract !== "mad4b.repository-executable-validator-registry.v1") errors.push("executable_registry_contract_mismatch");
  if (testAuthority?.contract !== "mad4b.repository-test-authority-registry.v1") errors.push("test_authority_contract_mismatch");
  if (verifierRegistry?.contract !== "mad4b.repository-verifier-registry.v1") errors.push("verifier_registry_contract_mismatch");
  try { validatorMap(executableRegistry); } catch (error) { errors.push(String(error.message || error)); }
  const facetIds = new Set();
  for (const binding of semanticBindings.bindings || []) {
    if (!binding?.facet || facetIds.has(binding.facet) || !Array.isArray(binding.required_verifiers) || !binding.required_verifiers.length) errors.push(`invalid_semantic_binding:${binding?.facet || "missing"}`);
    facetIds.add(binding?.facet);
  }
  const invariantIds = new Set();
  for (const invariant of testAuthority.invariants || []) {
    if (!invariant?.invariant_id || invariantIds.has(invariant.invariant_id)) errors.push(`invalid_test_invariant:${invariant?.invariant_id || "missing"}`);
    invariantIds.add(invariant?.invariant_id);
  }
  return stableUnique(errors);
}
export function evaluateSemanticCoverage(report, semanticBindings, verifierRegistry) {
  const bindings = new Map((semanticBindings.bindings || []).map((entry) => [entry.facet, entry]));
  const registered = new Set((verifierRegistry.verifiers || []).map((entry) => entry.id));
  const uncovered = [];
  const missingVerifiers = [];
  const requirements = [];
  for (const node of report?.semantic_graph?.changed_nodes || []) {
    for (const facet of stableUnique(node.facets || [])) {
      const binding = bindings.get(facet);
      if (!binding) { uncovered.push({ path: node.path, facet }); continue; }
      for (const verifier of binding.required_verifiers) {
        requirements.push({ path: node.path, facet, verifier });
        if (!registered.has(verifier) && !FIXED_POINT_VERIFIERS.has(verifier)) missingVerifiers.push({ path: node.path, facet, verifier });
      }
    }
  }
  return { requirements, uncovered, missing_verifiers: missingVerifiers };
}
export function evaluateTestAuthority(files, registry, verifierRegistry) {
  const discoveryPatterns = registry.discovery?.test_path_patterns || [];
  const registeredPatterns = registry.registered_test_patterns || [];
  const exclusions = registry.governed_exclusions || [];
  const discovered = files.filter((file) => matchesAny(file, discoveryPatterns));
  const unregistered = discovered.filter((file) => !matchesAny(file, registeredPatterns) && !matchesAny(file, exclusions));
  const fileSet = new Set(files);
  const verifierIds = new Set((verifierRegistry.verifiers || []).map((entry) => entry.id));
  const missingInvariantTests = [];
  const missingInvariantVerifiers = [];
  for (const invariant of registry.invariants || []) {
    const tests = invariant.protected_by_tests || [];
    if (!tests.some((file) => fileSet.has(file))) missingInvariantTests.push({ invariant_id: invariant.invariant_id, expected_tests: tests });
    for (const verifier of invariant.protected_by_verifiers || []) {
      if (!verifierIds.has(verifier) && !FIXED_POINT_VERIFIERS.has(verifier)) missingInvariantVerifiers.push({ invariant_id: invariant.invariant_id, verifier });
    }
  }
  return { discovered, unregistered, missing_invariant_tests: missingInvariantTests, missing_invariant_verifiers: missingInvariantVerifiers };
}
function validateExecutableUniverse(files, registry) {
  const extensionValidators = validatorMap(registry);
  const exclusions = registry.governed_exclusions || [];
  const tracked = files.filter((file) => extensionValidators.has(path.extname(file).toLowerCase()) && !matchesAny(file, exclusions));
  const byValidator = new Map();
  for (const file of tracked) {
    const validator = extensionValidators.get(path.extname(file).toLowerCase());
    if (!byValidator.has(validator)) byValidator.set(validator, []);
    byValidator.get(validator).push(file);
  }
  const failures = [];
  const checked = [];
  const record = (validator, filesForRun, result) => {
    checked.push(...filesForRun);
    if (!result.ok) failures.push({ validator, files: filesForRun, status: result.status, error: result.error, stderr_tail: result.stderr_tail });
  };
  for (const [validator, validatorFiles] of byValidator) {
    if (validator === "node_check") {
      for (const file of validatorFiles) record(validator, [file], run(process.execPath, ["--check", path.join(root, file)]));
    } else if (validator === "typescript_no_emit") {
      const tsc = path.join(root, "node_modules/typescript/bin/tsc");
      record(validator, validatorFiles, fs.existsSync(tsc) ? run(process.execPath, [tsc, "--noEmit", "--pretty", "false"], { cwd: root }) : { ok: false, status: null, error: "typescript_binary_missing", stderr_tail: tsc });
    } else if (validator === "python_ast_parse") {
      const code = "import ast,pathlib,sys\nfor p in sys.argv[1:]: ast.parse(pathlib.Path(p).read_text(encoding='utf-8'), filename=p)";
      for (let i = 0; i < validatorFiles.length; i += 100) {
        const batch = validatorFiles.slice(i, i + 100);
        record(validator, batch, run("python3", ["-c", code, ...batch], { cwd: root, env: { PYTHONDONTWRITEBYTECODE: "1" } }));
      }
    } else if (validator === "bash_parse") {
      for (const file of validatorFiles) record(validator, [file], run("bash", ["-n", file], { cwd: root }));
    } else if (validator === "powershell_parser") {
      const code = "$p=$args[0];$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($p,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1}";
      for (const file of validatorFiles) {
        const absolute = path.resolve(root, file);
        record(validator, [file], run("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", code, absolute], { cwd: root }));
      }
    } else if (validator === "registered_sql_policy") {
      for (const file of validatorFiles) {
        let ok = true, stderr = "";
        try {
          const sql = fs.readFileSync(path.join(root, file), "utf8");
          if (!sql.trim() || sql.includes("\0")) throw new Error("SQL file is empty or contains NUL");
          if (/(?:^|\/)migrations\//u.test(file) && splitMigrationSqlStatements(sql).length === 0) throw new Error("registered migration contains no SQL statements");
        } catch (error) { ok = false; stderr = String(error.message || error); }
        record(validator, [file], { ok, status: ok ? 0 : 1, error: ok ? null : "registered_sql_policy_failed", stderr_tail: stderr });
      }
    } else {
      failures.push({ validator, files: validatorFiles, status: null, error: "unknown_hardcoded_validator", stderr_tail: "" });
    }
  }
  const failedFiles = stableUnique(failures.flatMap((entry) => entry.files || []));
  return { tracked, checked: stableUnique(checked), failures, failed_files: failedFiles };
}
async function main() {
  const semanticBindings = readJson(semanticBindingPath);
  const executableRegistry = readJson(executableRegistryPath);
  const testAuthority = readJson(testAuthorityPath);
  const verifierRegistry = readJson(verifierRegistryPath);
  const registryErrors = validateRegistryContracts({ semanticBindings, executableRegistry, testAuthority, verifierRegistry });
  if (process.argv.includes("--self-test")) {
    if (registryErrors.length) throw new Error(`fixed-point registry self-test failed: ${registryErrors.join(",")}`);
    console.log(JSON.stringify({ ok: true, contract: "mad4b.repository-governance-fixed-point.v1", registry_errors: [] }));
    return;
  }
  const reportFile = path.resolve(arg("report-file"));
  const baseArgs = process.argv.slice(2);
  const base = spawnSync(process.execPath, [baseClosurePath, ...baseArgs], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env }, shell: false });
  if (!fs.existsSync(reportFile)) {
    process.stderr.write(String(base.stderr || base.error?.message || "base repository governance closure produced no report"));
    process.exitCode = Number.isInteger(base.status) ? base.status : 1;
    return;
  }
  const report = readJson(reportFile);
  const files = gitFiles();
  const semantic = evaluateSemanticCoverage(report, semanticBindings, verifierRegistry);
  const executables = validateExecutableUniverse(files, executableRegistry);
  const tests = evaluateTestAuthority(files, testAuthority, verifierRegistry);
  const metrics = {
    uncovered_semantic_impact_count: semantic.uncovered.length,
    missing_required_verifier_count: semantic.missing_verifiers.length + tests.missing_invariant_verifiers.length,
    unregistered_test_count: tests.unregistered.length,
    unvalidated_executable_count: executables.failed_files.length,
    unprotected_invariant_count: tests.missing_invariant_tests.length,
    fixed_point_registry_error_count: registryErrors.length,
  };
  const blockingReasons = [];
  if (metrics.uncovered_semantic_impact_count) blockingReasons.push("semantic_impact_uncovered");
  if (metrics.missing_required_verifier_count) blockingReasons.push("required_verifier_missing");
  if (metrics.unregistered_test_count) blockingReasons.push("unregistered_tests_present");
  if (metrics.unvalidated_executable_count) blockingReasons.push("unvalidated_executables_present");
  if (metrics.unprotected_invariant_count) blockingReasons.push("test_coverage_authority_removed");
  if (metrics.fixed_point_registry_error_count) blockingReasons.push("fixed_point_registry_invalid");
  report.metrics = { ...(report.metrics || {}), ...metrics };
  report.fixed_point = {
    contract: "mad4b.repository-governance-fixed-point.v1",
    semantic_impact: semantic,
    executable_universe: executables,
    test_authority: tests,
    registry_errors: registryErrors,
    blocking_reasons: blockingReasons,
    converged: blockingReasons.length === 0,
    safety: { read_only: true, registry_commands_forbidden: true, network_required: false, secrets_included: false },
  };
  if (blockingReasons.length) report.converged = false;
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ contract: report.fixed_point.contract, candidate_sha: report?.candidate?.sha || null, converged: report.fixed_point.converged, metrics }));
  if ((Number.isInteger(base.status) && base.status !== 0) || blockingReasons.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error?.stack || error?.message || String(error)); process.exitCode = 1; });
}
