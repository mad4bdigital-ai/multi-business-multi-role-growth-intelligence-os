#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONTRACT = "mad4b.governed-generated-artifact-refresh.v1";
const INVENTORY_SELF_HOSTING_CONTRACT = "mad4b.repository-inventory-self-hosting.v1";
const CONFIRMATION = "APPLY_GENERATED_ARTIFACT_REFRESH";
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TARGET_BRANCH_PATTERN = /^(?:gpt|fix|feat|chore|docs|release)\/[A-Za-z0-9._/-]+$/u;
const PROTECTED_BRANCHES = new Set(["main", "Production"]);
const MAX_DIAGNOSTIC_CHARS = 4000;
const AUTO_RECIPE = "auto";
const FRONTEND_OPENAPI_RECIPE = "frontend_openapi_refresh";
const WORK_MAP_BOOTSTRAP_RECIPE = "work_map_self_hosting_bootstrap";
const REPOSITORY_INVENTORY_RECIPE = "repository_inventory_refresh";
const TRUSTED_WRITER_AUTHORITY_MODE = "trusted_generated_artifact_writer";
const EXPLICIT_RECIPES = new Set([
  FRONTEND_OPENAPI_RECIPE,
  WORK_MAP_BOOTSTRAP_RECIPE,
  REPOSITORY_INVENTORY_RECIPE,
]);
const FRONTEND_OPENAPI_ALLOWED_CHANGED_FILES = new Set([
  "http-generic-api/openapi.yaml",
  "http-generic-api/openapi/support-tickets.yaml",
  "http-generic-api/frontend-operation-governance.generated.json",
  "http-generic-api/frontend-surface-dispatch.generated.json",
  "http-generic-api/openapi/frontend-runtime-routes.generated.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.yaml",
  "http-generic-api/openapi/openapi.custom-gpt.activation-admin.yaml",
  "http-generic-api/openapi/openapi.tenant-gpt.auth.yaml",
  "http-generic-api/openapi/openapi.tenant-gpt.activation.yaml",
  "http-generic-api/openapi.gpt-action.local-connector.yaml",
]);
const WORK_MAP_BOOTSTRAP_EXACT_OUTPUTS = new Set([
  "specs/014-governed-hostinger-storage-orchestration/work-map-integration.json",
  "specs/014-governed-hostinger-storage-orchestration/tasks.md",
  "specs/014-retail-commerce-operations-growth-os/work-map-integration.json",
  "specs/017-remote-mcp-host-isolation-oauth-readiness/work-map-integration.json",
  "specs/018-environment-promotion-runtime-integrity/work-map-integration.json",
  "specs/019-governed-database-lifecycle-pressure-relief/work-map-integration.json",
]);
const REPOSITORY_INVENTORY_OUTPUTS = new Set([
  "docs/repository-inventory.json",
  "docs/repository-inventory-summary.json",
  "docs/repository-inventory.md",
]);
const WORK_MAP_SELF_HOSTING_TRIGGER_PATHS = new Set([
  ".github/workflows/spec-kit-work-map-autofix.yml",
  "http-generic-api/scripts/maintenance-tools/generated-artifact-refresh.mjs",
]);
const WORK_MAP_SELF_HOSTING_SOURCE_PATTERNS = [
  /^\.github\/workflows\/spec-kit-work-map-autofix\.yml$/u,
  /^(?:\.github\/workflows\/(?:governed-generated-artifact-refresh|repository-inventory(?:-autofix-dispatch)?)\.yml|docs\/repository-inventory-guide\.md)$/u,
  /^\.github\/repository-maintenance-tool-governance\.json$/u,
  /^\.changes\/e2e\/(?:work-map-autofix-v2-contract-regression|ci-generated-artifact-evidence-routing)\.json$/u,
  /^docs\/ci-evidence-routing\.md$/u,
  /^docs\/runbooks\/supervisor-runtime-assurance\.md$/u,
  /^http-generic-api\/scripts\/maintenance-tools\/(?:generated-artifact-refresh|repository-tool-lifecycle-guard)\.mjs$/u,
  /^http-generic-api\/scripts\/platform-work-map-generator\.mjs$/u,
  /^http-generic-api\/scripts\/taxonomy\/automation-overlap-policy\.json$/u,
  /^http-generic-api\/scripts\/(?:test-generated-artifact-refresh-maintenance-tool|test-repository-tool-lifecycle-guard)\.mjs$/u,
  /^http-generic-api\/scripts\/generated-artifact-refresh-pr-publisher\.mjs$/u,
  /^http-generic-api\/scripts\/test-generated-artifact-refresh-pr-publisher\.mjs$/u,
  /^http-generic-api\/test-spec014-refresh-final-work-map-binding\.mjs$/u,
  /^http-generic-api\/test-work-map-autofix-spec014-binding-convergence\.mjs$/u,
  /^http-generic-api\/test-supervisor-runtime-assurance-automation\.mjs$/u,
];
const WORK_MAP_BOOTSTRAP_GOVERNED_PATHS = [
  "docs/work-maps",
  "specs/014-governed-hostinger-storage-orchestration/work-map-integration.json",
  "specs/014-governed-hostinger-storage-orchestration/tasks.md",
  "specs/014-retail-commerce-operations-growth-os/work-map-integration.json",
  "specs/017-remote-mcp-host-isolation-oauth-readiness/work-map-integration.json",
  "specs/018-environment-promotion-runtime-integrity/work-map-integration.json",
  "specs/019-governed-database-lifecycle-pressure-relief/work-map-integration.json",
];

const scriptPath = fileURLToPath(import.meta.url);
const apiDir = path.resolve(path.dirname(scriptPath), "../..");
const repoRoot = path.resolve(apiDir, "..");

function parseArguments(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-/gu, "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function sanitize(value = "") {
  return String(value)
    .replace(/\r/g, "")
    .replace(/(authorization\s*[:=]\s*)([^\s]+)/giu, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*)([^\s]+)/giu, "$1[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/gu, "[redacted-github-token]")
    .slice(-MAX_DIAGNOSTIC_CHARS);
}

class ToolFailure extends Error {
  constructor({ code, step, command, status, stdout, stderr }) {
    super(`${step} failed${Number.isInteger(status) ? ` with status ${status}` : ""}`);
    this.code = code;
    this.step = step;
    this.command = command;
    this.status = status;
    this.stdout = sanitize(stdout);
    this.stderr = sanitize(stderr);
  }
}

function run(step, command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw new ToolFailure({
      code: options.failureCode || `${step}_failed`,
      step,
      command: [command, ...args].join(" "),
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr || result.error?.message,
    });
  }
  return result;
}

function validateInputs({ target_ref, expected_head_sha, confirmation, recipe }) {
  if (!target_ref || !TARGET_BRANCH_PATTERN.test(target_ref)) {
    throw new ToolFailure({ code: "target_ref_invalid", step: "validate_inputs", command: "validate target_ref", status: 1, stderr: "Target ref must match a governed work-branch pattern." });
  }
  const target_branch = target_ref;
  if (PROTECTED_BRANCHES.has(target_branch) || target_branch === "main" || target_branch === "Production") {
    throw new ToolFailure({ code: "protected_branch_mutation_forbidden", step: "validate_inputs", command: "reject protected branch", status: 1, stderr: "main and Production are forbidden mutation targets." });
  }
  if (!FULL_SHA_PATTERN.test(expected_head_sha || "")) {
    throw new ToolFailure({ code: "expected_head_sha_invalid", step: "validate_inputs", command: "validate expected_head_sha", status: 1, stderr: "An exact 40-character expected_head_sha is required." });
  }
  if (confirmation !== CONFIRMATION) {
    throw new ToolFailure({ code: "typed_confirmation_required", step: "validate_inputs", command: "validate confirmation", status: 1, stderr: `Confirmation must equal ${CONFIRMATION}.` });
  }
  const requestedRecipe = recipe || AUTO_RECIPE;
  if (requestedRecipe !== AUTO_RECIPE && !EXPLICIT_RECIPES.has(requestedRecipe)) {
    throw new ToolFailure({ code: "recipe_invalid", step: "validate_inputs", command: "validate recipe", status: 1, stderr: "Recipe must be auto or one of the registered generated-artifact recipes." });
  }
}

function readRemoteHead(target_ref) {
  const result = run("read_remote_head", "git", ["ls-remote", "origin", `refs/heads/${target_ref}`], { cwd: repoRoot });
  return String(result.stdout || "").trim().split(/\s+/u)[0] || null;
}

function assertExpectedHead({ target_ref, expected_head_sha, phase }) {
  const current_head_sha = readRemoteHead(target_ref);
  if (current_head_sha !== expected_head_sha) {
    throw new ToolFailure({
      code: "expected_head_sha_mismatch",
      step: phase,
      command: `git ls-remote origin refs/heads/${target_ref}`,
      status: 1,
      stdout: `expected_head_sha=${expected_head_sha} current_head_sha=${current_head_sha || "missing"}`,
      stderr: "The target branch moved; refusing repository mutation.",
    });
  }
  const local_head_sha = run("read_local_head", "git", ["rev-parse", "HEAD"], { cwd: repoRoot }).stdout.trim();
  if (local_head_sha !== expected_head_sha) {
    throw new ToolFailure({
      code: "local_expected_head_sha_mismatch",
      step: phase,
      command: "git rev-parse HEAD",
      status: 1,
      stdout: `expected_head_sha=${expected_head_sha} local_head_sha=${local_head_sha}`,
      stderr: "The checked-out candidate does not equal expected_head_sha.",
    });
  }
}

function parseChangedFiles() {
  const result = run("inspect_write_set", "git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot });
  return result.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((file) => file.includes(" -> ") ? file.split(" -> ").at(-1) : file);
}

function readCandidateSourceFiles() {
  const result = run("inspect_candidate_scope", "git", ["diff", "--name-only", "main", "HEAD"], { cwd: repoRoot });
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function isWorkMapBootstrapOutput(file) {
  return file.startsWith("docs/work-maps/") || WORK_MAP_BOOTSTRAP_EXACT_OUTPUTS.has(file);
}

function isAllowedWorkMapSelfHostingSource(file) {
  return isWorkMapBootstrapOutput(file) || WORK_MAP_SELF_HOSTING_SOURCE_PATTERNS.some((pattern) => pattern.test(file));
}

function assertWorkMapSelfHostingScope(candidateSourceFiles) {
  const unexpected = candidateSourceFiles.filter((file) => !isAllowedWorkMapSelfHostingSource(file));
  if (unexpected.length) {
    throw new ToolFailure({
      code: "work_map_self_hosting_scope_violation",
      step: "classify_recipe",
      command: "validate work-map self-hosting candidate scope",
      status: 1,
      stdout: unexpected.join("\n"),
      stderr: "The Work Map self-hosting bootstrap is restricted to the registered writer, maintenance authority, governed regressions, publisher evidence, and canonical generated outputs.",
    });
  }
}

function classifyRecipe(candidateSourceFiles) {
  const hasSelfHostingTrigger = candidateSourceFiles.some((file) => WORK_MAP_SELF_HOSTING_TRIGGER_PATHS.has(file));
  if (!hasSelfHostingTrigger) return FRONTEND_OPENAPI_RECIPE;
  assertWorkMapSelfHostingScope(candidateSourceFiles);
  return WORK_MAP_BOOTSTRAP_RECIPE;
}

function resolveRecipe(requestedRecipe, candidateSourceFiles) {
  const normalized = requestedRecipe || AUTO_RECIPE;
  if (normalized === AUTO_RECIPE) return classifyRecipe(candidateSourceFiles);
  if (normalized === WORK_MAP_BOOTSTRAP_RECIPE) assertWorkMapSelfHostingScope(candidateSourceFiles);
  return normalized;
}

function runFrontendOpenApiRefresh() {
  run("verify_exact_operation_auth_repair", "node", ["scripts/test-openapi-runtime-auth-sync-operation-insertion.mjs"], { cwd: apiDir });
  run("sync_precise_registry", "node", ["scripts/openapi-precise-contract-registry-sync.mjs", "--write"], { cwd: apiDir });
  run("autofill_openapi_routes", "node", ["scripts/openapi-autofill-missing-routes.mjs", "--write"], { cwd: apiDir });
  run("sync_openapi_runtime_auth", "node", ["scripts/openapi-runtime-auth-sync.mjs", "--write"], { cwd: apiDir });
  run("generate_frontend_dispatch", "npm", ["run", "frontend:dispatch:generate", "--", "--baseline-ref=main"], { cwd: apiDir });
  run("generate_custom_gpt_schemas", "node", ["scripts/generate-custom-gpt-schemas.mjs", "--write"], { cwd: apiDir });

  const verificationCommands = [
    ["verify_openapi_autofill", "node", ["test-openapi-autofill-missing-routes.mjs"]],
    ["verify_openapi_auth_operation_insertion", "node", ["scripts/test-openapi-runtime-auth-sync-operation-insertion.mjs"]],
    ["verify_frontend_governance", "node", ["test-frontend-operation-governance-generator.mjs"]],
    ["verify_frontend_dispatch", "node", ["test-frontend-surface-dispatch.mjs"]],
    ["verify_auth_parity", "node", ["test-frontend-auth-openapi-parity.mjs"]],
    ["verify_openapi_route_coverage", "node", ["test-openapi-route-coverage.mjs"]],
    ["verify_openapi_auth", "npm", ["run", "openapi:auth:check"]],
    ["verify_schema_guard", "npm", ["run", "schemas:guard"]],
  ];
  for (const [step, command, commandArgs] of verificationCommands) run(step, command, commandArgs, { cwd: apiDir });
}

function runWorkMapSelfHostingBootstrap() {
  run("verify_work_map_generator_syntax", "node", ["--check", "scripts/platform-work-map-generator.mjs"], { cwd: apiDir });
  run("verify_spec014_binding_syntax", "node", ["--check", "scripts/spec014-refresh-final-work-map-binding.mjs"], { cwd: apiDir });
  run("verify_work_map_schema_contract", "node", ["scripts/work-map-schema-classification-contract.mjs"], { cwd: apiDir });
  run("verify_work_map_schema_classification", "node", ["scripts/work-map-schema-classification.mjs"], { cwd: apiDir });

  const converge = () => {
    run("generate_work_maps", "node", ["scripts/platform-work-map-generator.mjs", "--write"], { cwd: apiDir });
    run("refresh_hostinger_spec014_binding", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs"], { cwd: apiDir });
    run("refresh_retail_spec014_binding", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "014-retail-commerce-operations-growth-os"], { cwd: apiDir });
    run("refresh_remote_mcp_spec017_binding", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "017-remote-mcp-host-isolation-oauth-readiness"], { cwd: apiDir });
    run("refresh_runtime_integrity_spec018_binding", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "018-environment-promotion-runtime-integrity"], { cwd: apiDir });
    run("refresh_database_lifecycle_spec019_binding", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "019-governed-database-lifecycle-pressure-relief"], { cwd: apiDir });
  };

  converge();
  const firstDiff = run("capture_first_work_map_bootstrap_diff", "git", ["diff", "--binary", "--", ...WORK_MAP_BOOTSTRAP_GOVERNED_PATHS], { cwd: repoRoot }).stdout;
  converge();
  const secondDiff = run("capture_second_work_map_bootstrap_diff", "git", ["diff", "--binary", "--", ...WORK_MAP_BOOTSTRAP_GOVERNED_PATHS], { cwd: repoRoot }).stdout;
  if (firstDiff !== secondDiff) {
    throw new ToolFailure({
      code: "work_map_self_hosting_not_idempotent",
      step: "prove_work_map_bootstrap_idempotency",
      command: "compare bounded generated diff after two convergence passes",
      status: 1,
      stderr: "Work Map plus final-registry binding convergence changed between the first and second deterministic pass.",
    });
  }

  run("verify_work_maps_current", "node", ["scripts/platform-work-map-generator.mjs", "--check"], { cwd: apiDir });
  run("verify_hostinger_spec014_binding_current", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs", "--check"], { cwd: apiDir });
  run("verify_retail_spec014_binding_current", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "014-retail-commerce-operations-growth-os", "--check"], { cwd: apiDir });
  run("verify_remote_mcp_spec017_binding_current", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "017-remote-mcp-host-isolation-oauth-readiness", "--check"], { cwd: apiDir });
  run("verify_runtime_integrity_spec018_binding_current", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "018-environment-promotion-runtime-integrity", "--check"], { cwd: apiDir });
  run("verify_database_lifecycle_spec019_binding_current", "node", ["scripts/spec014-refresh-final-work-map-binding.mjs", "--feature-key", "019-governed-database-lifecycle-pressure-relief", "--check"], { cwd: apiDir });
  run("verify_spec014_binding_regression", "node", ["test-spec014-refresh-final-work-map-binding.mjs"], { cwd: apiDir });
}

function hashFile(relativePath) {
  return createHash("sha256").update(fs.readFileSync(path.join(repoRoot, relativePath))).digest("hex");
}

function readRepositoryInventoryHashes() {
  return Object.fromEntries([...REPOSITORY_INVENTORY_OUTPUTS].sort().map((file) => [file, hashFile(file)]));
}

function runRepositoryInventoryRefresh() {
  const beforeHashes = readRepositoryInventoryHashes();
  run("install_root_dependencies", "npm", ["ci", "--ignore-scripts"], { cwd: repoRoot, failureCode: "root_npm_ci_failed" });
  run("generate_repository_inventory_first_pass", "npm", ["run", "inventory:write"], { cwd: repoRoot });
  const firstPassHashes = readRepositoryInventoryHashes();
  run("generate_repository_inventory_second_pass", "npm", ["run", "inventory:write"], { cwd: repoRoot });
  const secondPassHashes = readRepositoryInventoryHashes();
  if (JSON.stringify(firstPassHashes) !== JSON.stringify(secondPassHashes)) {
    throw new ToolFailure({
      code: "repository_inventory_not_deterministic",
      step: "prove_repository_inventory_determinism",
      command: "compare SHA-256 hashes after two inventory:write passes",
      status: 1,
      stdout: JSON.stringify({ first_pass: firstPassHashes, second_pass: secondPassHashes }),
      stderr: "Repository Inventory outputs changed between deterministic generation passes.",
    });
  }
  run("verify_repository_inventory_current", "npm", ["run", "inventory:check"], { cwd: repoRoot });
  run("verify_repository_inventory_contract", "npm", ["run", "inventory:test"], { cwd: repoRoot });
  return {
    deterministic: true,
    inventory_check: true,
    inventory_test: true,
    before_hashes: beforeHashes,
    after_hashes: secondPassHashes,
    authority_mode: TRUSTED_WRITER_AUTHORITY_MODE,
  };
}

function isAllowedGeneratedOutput(recipe, file) {
  if (recipe === WORK_MAP_BOOTSTRAP_RECIPE) return isWorkMapBootstrapOutput(file);
  if (recipe === REPOSITORY_INVENTORY_RECIPE) return REPOSITORY_INVENTORY_OUTPUTS.has(file);
  return FRONTEND_OPENAPI_ALLOWED_CHANGED_FILES.has(file);
}

function buildFailure(error) {
  const failure = error instanceof ToolFailure
    ? error
    : new ToolFailure({ code: "generated_artifact_refresh_unhandled_failure", step: "unhandled", command: "unknown", status: null, stderr: error?.stack || error?.message || String(error) });
  return {
    code: failure.code,
    step: failure.step,
    command: failure.command,
    exit_status: Number.isInteger(failure.status) ? failure.status : null,
    stderr_tail: failure.stderr || "",
    stdout_tail: failure.stdout || "",
    secrets_included: false,
  };
}

function writeReport(outputDir, report) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "generated-artifact-refresh-report.json");
  const markdownPath = path.join(outputDir, "generated-artifact-refresh-report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Governed Generated Artifact Refresh",
    "",
    `- Contract: \`${report.contract}\``,
    `- Outcome: **${report.outcome}**`,
    `- Recipe: \`${report.recipe || "unresolved"}\``,
    `- Target ref: \`${report.target_ref}\``,
    `- Expected head SHA: \`${report.expected_head_sha}\``,
    `- Resulting head SHA: \`${report.result_head_sha || "none"}\``,
    `- Resulting commit SHA: \`${report.commit_sha || "none"}\``,
    `- Changed files: **${report.changed_files.length}**`,
    `- Authority mode: \`${report.authority?.mode || "unknown"}\``,
    "- Force push: **no**",
    "- Protected branch mutation: **no**",
    "- Job logs: **diagnostic-only**",
  ];
  if (report.first_failure) {
    lines.push(
      "",
      "## First blocking finding",
      "",
      `- Code: \`${report.first_failure.code}\``,
      `- Step: \`${report.first_failure.step}\``,
      `- Bounded stderr: \`${String(report.first_failure.stderr_tail || "").replace(/`/gu, "'")}\``,
      `- Bounded stdout: \`${String(report.first_failure.stdout_tail || "").replace(/`/gu, "'")}\``,
    );
  }
  fs.writeFileSync(markdownPath, `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  return { jsonPath, markdownPath };
}

export function runGovernedGeneratedArtifactRefresh(argv = process.argv) {
  const args = parseArguments(argv);
  const outputDir = path.resolve(args.output_dir || path.join(process.env.RUNNER_TEMP || repoRoot, "governed-generated-artifact-refresh"));
  let changedFiles = [];
  let candidateSourceFiles = [];
  let recipe = null;
  let commitSha = null;
  let resultHeadSha = null;
  let verification = null;
  let firstFailure = null;

  try {
    validateInputs(args);
    assertExpectedHead({ target_ref: args.target_ref, expected_head_sha: args.expected_head_sha, phase: "preflight_expected_head" });
    run("fetch_main", "git", ["fetch", "origin", "main", "--depth=1"], { cwd: repoRoot });
    run("sync_main_ref", "git", ["branch", "-f", "main", "origin/main"], { cwd: repoRoot });

    candidateSourceFiles = readCandidateSourceFiles();
    recipe = resolveRecipe(args.recipe, candidateSourceFiles);
    if (recipe === REPOSITORY_INVENTORY_RECIPE) {
      verification = runRepositoryInventoryRefresh();
    } else {
      run("install_dependencies", "npm", ["ci"], { cwd: apiDir, failureCode: "npm_ci_failed" });
      if (recipe === WORK_MAP_BOOTSTRAP_RECIPE) runWorkMapSelfHostingBootstrap();
      else runFrontendOpenApiRefresh();
    }

    changedFiles = parseChangedFiles();
    const unexpected = changedFiles.filter((file) => !isAllowedGeneratedOutput(recipe, file));
    if (unexpected.length) {
      throw new ToolFailure({ code: "generated_artifact_write_set_violation", step: "enforce_write_set", command: `validate ${recipe} generated paths`, status: 1, stdout: unexpected.join("\n"), stderr: "Generated files exceeded the registered recipe allowlist." });
    }

    assertExpectedHead({ target_ref: args.target_ref, expected_head_sha: args.expected_head_sha, phase: "postgeneration_expected_head" });
    if (changedFiles.length) {
      run("configure_git_name", "git", ["config", "user.name", "github-actions[bot]"], { cwd: repoRoot });
      run("configure_git_email", "git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { cwd: repoRoot });
      run("stage_generated_artifacts", "git", ["add", "--", ...changedFiles], { cwd: repoRoot });
      const commitMessage = recipe === WORK_MAP_BOOTSTRAP_RECIPE
        ? "docs(work-maps): bootstrap governed maps and Spec Kit bindings"
        : recipe === REPOSITORY_INVENTORY_RECIPE
          ? "docs(inventory): regenerate repository inventory"
          : "chore(ci): refresh generated contract artifacts";
      run("commit_generated_artifacts", "git", ["commit", "-m", commitMessage], { cwd: repoRoot });
      commitSha = run("read_resulting_commit", "git", ["rev-parse", "HEAD"], { cwd: repoRoot }).stdout.trim();
      if (!FULL_SHA_PATTERN.test(commitSha)) throw new ToolFailure({ code: "resulting_commit_sha_invalid", step: "read_resulting_commit", command: "git rev-parse HEAD", status: 1, stdout: commitSha });
      const current_head_sha = readRemoteHead(args.target_ref);
      if (current_head_sha !== args.expected_head_sha) {
        throw new ToolFailure({ code: "expected_head_sha_mismatch_before_push", step: "prepush_expected_head", command: "git ls-remote", status: 1, stdout: `expected_head_sha=${args.expected_head_sha} current_head_sha=${current_head_sha || "missing"}`, stderr: "The target branch moved before push; refusing repository mutation." });
      }
      run("push_generated_artifacts", "git", ["push", "origin", `HEAD:${args.target_ref}`], { cwd: repoRoot });
      resultHeadSha = readRemoteHead(args.target_ref);
      if (resultHeadSha !== commitSha) {
        throw new ToolFailure({ code: "resulting_head_readback_mismatch", step: "postpush_exact_head_readback", command: "git ls-remote", status: 1, stdout: `commit_sha=${commitSha} remote_head_sha=${resultHeadSha || "missing"}`, stderr: "Remote branch readback did not equal the generated-artifact commit." });
      }
    } else {
      resultHeadSha = args.expected_head_sha;
    }
  } catch (error) {
    firstFailure = buildFailure(error);
  }

  const report = {
    contract: CONTRACT,
    generated_at: new Date().toISOString(),
    outcome: firstFailure ? "blocked" : "passed",
    recipe_request: args.recipe || AUTO_RECIPE,
    recipe,
    self_hosting_contract: recipe === REPOSITORY_INVENTORY_RECIPE ? INVENTORY_SELF_HOSTING_CONTRACT : null,
    target_ref: args.target_ref || null,
    expected_head_sha: args.expected_head_sha || null,
    result_head_sha: resultHeadSha,
    candidate_source_files: candidateSourceFiles,
    commit_sha: commitSha,
    changed_files: changedFiles,
    verification,
    authority: {
      mode: TRUSTED_WRITER_AUTHORITY_MODE,
      candidate_mutation_before_main_trust: false,
      contents_write_scope: "registered_recipe_outputs_only",
    },
    first_failure: firstFailure,
    mutation: {
      mode: "mutating",
      outcome: changedFiles.length ? "commit" : "none",
      reason: !firstFailure && recipe === REPOSITORY_INVENTORY_RECIPE && changedFiles.length === 0 ? "inventory_already_current" : null,
      expected_head_verified: !firstFailure || !String(firstFailure.code).includes("expected_head"),
      result_head_readback_verified: !firstFailure && Boolean(resultHeadSha),
      protected_branches_rejected: true,
      force_push: false,
      allowed_changed_paths_only: !firstFailure || firstFailure.code !== "generated_artifact_write_set_violation",
      self_hosting_scope_bounded: recipe !== WORK_MAP_BOOTSTRAP_RECIPE || !firstFailure || firstFailure.code !== "work_map_self_hosting_scope_violation",
    },
    routing: {
      source_of_truth: "canonical_report",
      job_logs_role: "diagnostic_only",
      consult_job_logs: false,
    },
    secrets_included: false,
  };
  writeReport(outputDir, report);
  process.stdout.write(`${JSON.stringify({ contract: report.contract, outcome: report.outcome, recipe: report.recipe, result_head_sha: report.result_head_sha, commit_sha: report.commit_sha, first_failure: report.first_failure?.code || null, secrets_included: false })}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = runGovernedGeneratedArtifactRefresh();
  if (report.outcome !== "passed") process.exitCode = 1;
}
