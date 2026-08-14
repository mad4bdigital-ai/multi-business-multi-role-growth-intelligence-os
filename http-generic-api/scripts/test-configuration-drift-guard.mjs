import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfigurationCandidates } from "./maintenance-tools/configuration-candidate-discovery.mjs";
import { runConfigurationDriftGuard } from "./maintenance-tools/configuration-drift-guard.mjs";

const root = await mkdtemp(join(tmpdir(), "configuration-drift-guard-"));
try {
  await mkdir(join(root, ".github/workflows"), { recursive: true });
  await mkdir(join(root, ".changes/e2e"), { recursive: true });
  await mkdir(join(root, "docs/governance"), { recursive: true });
  await mkdir(join(root, "http-generic-api/runtime"), { recursive: true });
  await mkdir(join(root, "http-generic-api/scripts/maintenance-tools"), { recursive: true });
  await writeFile(join(root, "http-generic-api/runtime/example.js"), "const DEFAULT_TIMEOUT = 30;\n");
  await writeFile(join(root, "docs/repository-inventory.json"), JSON.stringify({ schemaVersion: 1, generatedFrom: "git-index", deterministic: true, files: [{ path: "http-generic-api/runtime/example.js" }] }));
  await writeFile(join(root, ".github/repository-maintenance-tool-governance.json"), JSON.stringify({
    contract: "mad4b.repository-maintenance-tool-governance.v1",
    tools: {
      "configuration-candidate-discovery": { entrypoint: "http-generic-api/scripts/maintenance-tools/configuration-candidate-discovery.mjs", mode: "read_only", report_contract: "mad4b.configuration-candidate-discovery.v1" },
      "configuration-drift-guard": { entrypoint: "http-generic-api/scripts/maintenance-tools/configuration-drift-guard.mjs", mode: "read_only", report_contract: "mad4b.configuration-drift-guard.v1" },
    },
  }));
  const e2e = {
    current_phase: "mvp",
    secrets_included: false,
    scope: { include: [
      ".changes/e2e/configuration-drift-guard-20260815.json",
      ".github/repository-maintenance-tool-governance.json",
      ".github/workflows/repository-tool-lifecycle-governance.yml",
      "docs/governance/configuration-drift-policy.json",
      "http-generic-api/scripts/maintenance-tools/configuration-drift-guard.mjs",
      "http-generic-api/scripts/maintenance-tools/configuration-candidate-discovery.mjs",
      "http-generic-api/scripts/test-configuration-drift-guard.mjs",
    ] },
  };
  await writeFile(join(root, ".changes/e2e/configuration-drift-guard-20260815.json"), JSON.stringify(e2e));
  await writeFile(join(root, ".github/workflows/repository-tool-lifecycle-governance.yml"), "read-only\n");
  await writeFile(join(root, "http-generic-api/scripts/maintenance-tools/configuration-drift-guard.mjs"), "read-only\n");
  await writeFile(join(root, "http-generic-api/scripts/maintenance-tools/configuration-candidate-discovery.mjs"), "read-only\n");
  await writeFile(join(root, "http-generic-api/scripts/test-configuration-drift-guard.mjs"), "test\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Drift Guard Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  const initial = await discoverConfigurationCandidates({ repositoryRoot: root, inventoryPath: "docs/repository-inventory.json", outputDir: ".artifacts/initial" });
  const baseline = initial.candidates.map((candidate) => [candidate.path, candidate.symbol, candidate.expression_kind, candidate.suggested_config_key].join("|")).sort();
  const policyPath = "docs/governance/configuration-drift-policy.json";
  const policy = {
    contract: "mad4b.configuration-drift-guard.v1",
    schema_version: 1,
    inventory_path: "docs/repository-inventory.json",
    baseline_fingerprints: baseline,
    max_existing_secret_candidates: initial.summary.secret_candidates,
    fail_on_removed_candidates: false,
    required_contract_paths: e2e.scope.include,
    suppressions: [],
    safety: { report_only: true, migration_generation_allowed: false, runtime_mutation_allowed: false, production_activation_allowed: false, secrets_included: false },
  };
  await writeFile(join(root, policyPath), `${JSON.stringify(policy, null, 2)}\n`);
  execFileSync("git", ["add", "."], { cwd: root });

  const baselineResult = await runConfigurationDriftGuard({ repositoryRoot: root, policyPath, outputDir: ".artifacts/baseline", failOnDrift: true });
  assert.equal(baselineResult.ok, true);
  assert.equal(baselineResult.new_candidate_count, 0);

  await writeFile(join(root, "http-generic-api/runtime/example.js"), "const DEFAULT_TIMEOUT = 30;\nconst DEFAULT_RETRY = 3;\n");
  const driftResult = await runConfigurationDriftGuard({ repositoryRoot: root, policyPath, outputDir: ".artifacts/drift" });
  assert.equal(driftResult.ok, false);
  assert.ok(driftResult.findings.some((item) => item.code === "NEW_CONFIGURATION_CANDIDATE_DRIFT"));
  const retryFingerprint = "http-generic-api/runtime/example.js|DEFAULT_RETRY|literal_declaration|retry";
  policy.suppressions = [{ fingerprint: retryFingerprint, owner: "owner@example.invalid", reason: "reviewed runtime retry setting", expires_at: "2099-01-01T00:00:00.000Z" }];
  await writeFile(join(root, policyPath), `${JSON.stringify(policy, null, 2)}\n`);
  const suppressedResult = await runConfigurationDriftGuard({ repositoryRoot: root, policyPath, outputDir: ".artifacts/suppressed", failOnDrift: true });
  assert.equal(suppressedResult.ok, true);
  assert.equal(suppressedResult.suppressed_candidate_count, 1);

  policy.suppressions[0].expires_at = "2020-01-01T00:00:00.000Z";
  await writeFile(join(root, policyPath), `${JSON.stringify(policy, null, 2)}\n`);
  const expiredResult = await runConfigurationDriftGuard({ repositoryRoot: root, policyPath, outputDir: ".artifacts/expired" });
  assert.equal(expiredResult.ok, false);
  assert.ok(expiredResult.findings.some((item) => item.code === "INVALID_OR_EXPIRED_SUPPRESSION"));
  assert.equal(JSON.stringify(expiredResult).includes("secret-raw-value"), false);

  console.log(JSON.stringify({ ok: true, contract: "mad4b.configuration-drift-guard-regression.v1", cases: 4, repository_mutation_executed: false, database_mutation_executed: false, secrets_included: false }));
} finally {
  await rm(root, { recursive: true, force: true });
}
