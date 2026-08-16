#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const GATE = path.join(HERE, "e2e-parallel-pr-gate.mjs");
const PHASE = path.join(HERE, "e2e-phase-governance.mjs");
const POLICY = path.join(REPO_ROOT, ".specify", "e2e-phase-governance.json");
const SCHEMA = path.join(REPO_ROOT, ".specify", "schemas", "e2e-phases.schema.json");
const LIVE_MAINTENANCE_CONTRACT = path.join(REPO_ROOT, ".changes", "e2e", "local-staging-autopilot-tunnel-closure.json");

function run(program, args, cwd) {
  return execFileSync(program, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function spawn(program, args, cwd) {
  return spawnSync(program, args, { cwd, encoding: "utf8" });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const schema = JSON.parse(fs.readFileSync(SCHEMA, "utf8"));
assert.deepEqual(
  schema.properties?.secrets_included,
  { const: false },
  "E2E schema must permit only an explicit false secrets_included declaration",
);

const liveContract = JSON.parse(fs.readFileSync(LIVE_MAINTENANCE_CONTRACT, "utf8"));
assert.equal(liveContract.delivery_mode, "single_pr");
assert.equal(liveContract.secrets_included, false);
assert.equal(
  liveContract.phases?.find((phase) => phase.id === liveContract.current_phase)?.status,
  "implemented",
);
const liveScope = new Set(liveContract.scope?.include || []);
for (const requiredPath of [
  "http-generic-api/.env.example",
  "http-generic-api/remoteMcpRequestHost.js",
  "http-generic-api/trustedRequestHost.js",
  "http-generic-api/routes/rootDiscoveryRoutes.js",
  "http-generic-api/routes/tenantGptOAuthMetadataRoutes.js",
  "http-generic-api/scripts/manifests/test-manifest-spec017.mjs",
  "http-generic-api/test-platform-routes.mjs",
  "http-generic-api/test-remote-mcp-production-trusted-ingress.mjs",
  "http-generic-api/test-trusted-request-host-routing.mjs",
]) {
  assert(liveScope.has(requiredPath), `maintenance contract must cover ${requiredPath}`);
}

const phaseGateSource = fs.readFileSync(PHASE, "utf8");
const legacyGateSource = fs.readFileSync(path.join(HERE, "e2e-parallel-pr-gate-legacy.mjs"), "utf8");
assert.match(phaseGateSource, /contract\.secrets_included === false/);
assert.match(legacyGateSource, /contract\.secrets_included === false/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-single-pr-maintenance-"));
fs.mkdirSync(path.join(root, ".specify", "schemas"), { recursive: true });
fs.copyFileSync(POLICY, path.join(root, ".specify", "e2e-phase-governance.json"));
fs.copyFileSync(SCHEMA, path.join(root, ".specify", "schemas", "e2e-phases.schema.json"));
run("git", ["init"], root);
run("git", ["config", "user.email", "ci@example.invalid"], root);
run("git", ["config", "user.name", "CI"], root);

fs.mkdirSync(path.join(root, "http-generic-api", "example"), { recursive: true });
fs.mkdirSync(path.join(root, "specs", "014-example"), { recursive: true });
fs.mkdirSync(path.join(root, ".changes", "e2e"), { recursive: true });
fs.writeFileSync(path.join(root, "http-generic-api", "example", "runtime.mjs"), "export const value = 1;\n");
fs.writeFileSync(path.join(root, "http-generic-api", "example", "e2e.mjs"), "process.exit(0);\n");

const integratedContract = {
  $schema: "../../.specify/schemas/e2e-phases.schema.json",
  schema_version: 1,
  feature_key: "014-example",
  title: "Integrated parallel example",
  delivery_mode: "multi_pr",
  current_phase: "mvp",
  scope: { include: ["specs/014-example/**", "http-generic-api/example/**"] },
  merge_contract: { minimum_phase: "mvp" },
  phases: [{
    id: "mvp",
    status: "implemented",
    objective: "Keep the integrated example operational.",
    e2e_journeys: [{
      id: "example-integrated-e2e",
      end_to_end: true,
      level: "synthetic_runtime",
      actor: "maintainer",
      entrypoint: "http-generic-api/example/runtime.mjs",
      terminal_outcome: "The integrated runtime remains covered.",
      steps: ["Change runtime", "Run coverage"],
      assertions: ["Runtime is covered."],
      tests: [{
        id: "example-e2e",
        runner: "node",
        working_directory: ".",
        path: "http-generic-api/example/e2e.mjs",
        args: [],
      }],
      evidence_paths: ["http-generic-api/example/runtime.mjs"],
    }],
  }],
  parallel_work: {
    enabled: true,
    strategy: "dependency_dag",
    file_ownership: "exclusive_by_default",
    merge_policy: "workstream_commits_then_e2e_rollup",
    no_partial_feature_merge: true,
    workstreams: [
      {
        id: "runtime-a",
        title: "Runtime A",
        status: "integrated",
        owner_type: "ai_agent",
        branch_pattern: "gpt/014-example/runtime-a-*",
        scope: { include: ["http-generic-api/example/**"] },
        depends_on: [],
        deliverables: ["Runtime A integrated"],
        integration_points: ["example-runtime"],
        required_tests: [],
      },
      {
        id: "runtime-b",
        title: "Runtime B",
        status: "integrated",
        owner_type: "ai_agent",
        branch_pattern: "gpt/014-example/runtime-b-*",
        scope: { include: ["specs/014-example/**"] },
        depends_on: ["runtime-a"],
        deliverables: ["Runtime B integrated"],
        integration_points: ["example-runtime"],
        required_tests: [],
      },
    ],
    declared_overlaps: [],
    integration: {
      branch_pattern: "gpt/014-example/integration-*",
      required_workstreams: ["runtime-a", "runtime-b"],
      e2e_journey_ids: ["example-integrated-e2e"],
      convergence_tests: [],
    },
  },
};
writeJson(path.join(root, "specs", "014-example", "e2e-phases.json"), integratedContract);
writeJson(path.join(root, "specs", "014-example", "work-map-integration.json"), { version: 1 });
run("git", ["add", "."], root);
run("git", ["commit", "-m", "baseline integrated feature"], root);
const baseSha = run("git", ["rev-parse", "HEAD"], root).trim();

function maintenanceContract({ includeSecretsDeclaration = true, includeRuntime = true } = {}) {
  return {
    $schema: "../../.specify/schemas/e2e-phases.schema.json",
    schema_version: 1,
    feature_key: "maintenance-example",
    title: "Single PR maintenance example",
    delivery_mode: "single_pr",
    current_phase: "mvp",
    ...(includeSecretsDeclaration ? { secrets_included: false } : {}),
    scope: {
      include: [
        ".changes/e2e/maintenance-example.json",
        ...(includeRuntime ? ["http-generic-api/example/runtime.mjs"] : []),
        "http-generic-api/example/e2e.mjs",
      ],
    },
    merge_contract: { minimum_phase: "mvp" },
    phases: [{
      id: "mvp",
      status: "implemented",
      objective: "Maintain an already-integrated feature without reopening its workstreams.",
      e2e_journeys: [{
        id: "maintenance-e2e",
        end_to_end: true,
        level: "synthetic_runtime",
        actor: "maintainer",
        entrypoint: "http-generic-api/example/runtime.mjs",
        terminal_outcome: "Maintenance coverage is complete.",
        steps: ["Change runtime", "Run maintenance regression"],
        assertions: ["No secrets are included."],
        tests: [{
          id: "maintenance-e2e-test",
          runner: "node",
          working_directory: ".",
          path: "http-generic-api/example/e2e.mjs",
          args: [],
        }],
        evidence_paths: ["http-generic-api/example/runtime.mjs"],
      }],
    }],
  };
}

fs.writeFileSync(path.join(root, "http-generic-api", "example", "runtime.mjs"), "export const value = 2;\n");
writeJson(path.join(root, "specs", "014-example", "work-map-integration.json"), { version: 2 });
writeJson(path.join(root, ".changes", "e2e", "maintenance-example.json"), maintenanceContract());
run("git", ["add", "."], root);
run("git", ["commit", "-m", "safe single PR maintenance"], root);
const goodHead = run("git", ["rev-parse", "HEAD"], root).trim();

const gateGood = spawn(process.execPath, [
  GATE,
  "--root", root,
  "--base", baseSha,
  "--head", goodHead,
  "--head-ref", "fix/maintenance-example",
  "--base-ref", "main",
], root);
assert.equal(gateGood.status, 0, gateGood.stderr || gateGood.stdout);
const gateGoodReport = JSON.parse(gateGood.stdout);
assert.equal(gateGoodReport.ok, true, JSON.stringify(gateGoodReport.findings));
assert.equal(gateGoodReport.pr_mode, "standard");
assert.equal(gateGoodReport.single_pr_maintenance_contract?.contract_path, ".changes/e2e/maintenance-example.json");

const phaseGood = spawn(process.execPath, [
  PHASE,
  "check",
  "--root", root,
  "--base", baseSha,
  "--head", goodHead,
  "--base-ref", "main",
], root);
assert.equal(phaseGood.status, 0, phaseGood.stderr || phaseGood.stdout);
const phaseGoodReport = JSON.parse(phaseGood.stdout);
assert.equal(phaseGoodReport.ok, true, JSON.stringify(phaseGoodReport.findings));
assert.equal(phaseGoodReport.single_pr_maintenance_contract?.contract_path, ".changes/e2e/maintenance-example.json");

run("git", ["checkout", "--detach", baseSha], root);
fs.writeFileSync(path.join(root, "http-generic-api", "example", "runtime.mjs"), "export const value = 3;\n");
writeJson(path.join(root, "specs", "014-example", "work-map-integration.json"), { version: 3 });
writeJson(
  path.join(root, ".changes", "e2e", "maintenance-example.json"),
  maintenanceContract({ includeSecretsDeclaration: false }),
);
run("git", ["add", "."], root);
run("git", ["commit", "-m", "unsafe maintenance without secret declaration"], root);
const unsafeHead = run("git", ["rev-parse", "HEAD"], root).trim();
const gateUnsafe = spawn(process.execPath, [
  GATE,
  "--root", root,
  "--base", baseSha,
  "--head", unsafeHead,
  "--head-ref", "fix/maintenance-example-unsafe",
  "--base-ref", "main",
], root);
assert.notEqual(gateUnsafe.status, 0);
const unsafeReport = JSON.parse(gateUnsafe.stdout);
assert(unsafeReport.findings.some((row) => row.code === "parallel_work_pr_branch_not_declared"));
assert.equal(unsafeReport.single_pr_maintenance_contract, null);

console.log(JSON.stringify({
  ok: true,
  gate: "e2e_single_pr_maintenance_contract",
  schema_allows_false_only: true,
  explicit_secret_safety_required: true,
  integrated_parallel_maintenance_supported: true,
  undeclared_unsafe_maintenance_rejected: true,
  secrets_included: false,
}));
