import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildReport, classifyChange, classifyPath } from "./scripts/environment-impact-closure.mjs";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(apiRoot, "..");
const deployment = JSON.parse(fs.readFileSync(path.join(apiRoot, "config/deployment-branch-policy.json"), "utf8"));
const policy = deployment.environment_impact;
const report = buildReport();

assert.equal(report.contract, "mad4b.environment-impact-closure.v1");
assert.equal(report.converged, true, JSON.stringify(report.issues));
assert.equal(report.issue_count, 0);
assert.equal(report.environment_authority.staging.branch, "main");
assert.equal(report.environment_authority.production.branch, "Production");
assert.deepEqual(
  report.environment_authority.staging.hosts.filter((host) => report.environment_authority.production.hosts.includes(host)),
  [],
);
assert.equal(report.schema_compatibility.required_field, "mcp_catalog_level");
assert.equal(report.schema_compatibility.matching_migration_count, 1);
assert.equal(report.schema_compatibility.migrations[0].path, "http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql");
assert.equal(report.schema_compatibility.migrations[0].sha256, "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681");
assert.equal(report.db_authority.generic_runtime_principal_fallback, false);
assert.equal(report.gateway.stale_mutation_policy, "deny");
assert.equal(report.declared_environment_impact.production_mutation_allowed, false);
assert.equal(report.safety.read_only, true);
assert.equal(report.safety.database_mutation, false);
assert.equal(report.safety.migration_apply, false);
assert.equal(report.safety.provider_mutation, false);
assert.equal(report.safety.secrets_included, false);

assert.equal(policy.authorities.deployment_branch_policy, "http-generic-api/config/deployment-branch-policy.json");
assert.equal(policy.fail_closed.unclassified_paths, true);
assert.equal(policy.fail_closed.rename_previous_path, true);
assert.equal(policy.fail_closed.copy_previous_path, true);
assert.ok(policy.impact_declarations.patterns.includes(".changes/e2e/*.json"));
assert.deepEqual(
  [...policy.source_of_truth_paths].sort(),
  Object.values(policy.authorities).sort(),
);

const classes = policy.path_classes;
assert.deepEqual(classifyPath("autopilot-portable-staging/Start-AutoPilot.ps1", classes).map((entry) => entry.id), ["staging_only"]);
assert.deepEqual(classifyPath("http-generic-api/routes/tenantTools.js", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("http-generic-api/schema.sql", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("autopilot-portable-production/Deploy.ps1", classes).map((entry) => entry.id), ["production_only"]);
assert.deepEqual(classifyPath("http-generic-api/.env.staging.example", classes).map((entry) => entry.id), ["staging_only"]);
assert.deepEqual(classifyPath("http-generic-api/frontend-surface-dispatch.generated.json", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("docs/repository-inventory.json", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/e2e-phase-governance-core.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/test-e2e-single-pr-maintenance-evaluator.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/e2e-parallel-work-governance.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/github-main-review-policy-readiness-issue-publisher.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/github-review-policy-target.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/test-github-review-policy-target.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/test-generated-artifact-refresh-maintenance-tool.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/environment-impact-closure.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath(".dockerignore", classes).map((entry) => entry.id), ["staging_only", "repository_governance"]);
assert.deepEqual(classifyPath("docs/README.md", classes), []);

const sharedChange = classifyChange({ status: "M", path: "http-generic-api/routes/tenantTools.js", previous_path: null }, classes);
assert.deepEqual(sharedChange.classes, ["shared_runtime"]);
assert.deepEqual(sharedChange.environments, ["production", "staging"]);
assert.equal(sharedChange.requires_live_certification, true);
const schemaChange = classifyChange({ status: "M", path: "http-generic-api/schema.sql", previous_path: null }, classes);
assert.deepEqual(schemaChange.classes, ["shared_runtime"]);
assert.deepEqual(schemaChange.environments, ["production", "staging"]);
assert.equal(schemaChange.requires_live_certification, true);

const e2eGovernanceChange = classifyChange({
  status: "M",
  path: "http-generic-api/scripts/e2e-phase-governance-core.mjs",
  previous_path: null,
}, classes);
assert.deepEqual(e2eGovernanceChange.classes, ["repository_governance"]);
assert.deepEqual(e2eGovernanceChange.environments, ["repository"]);
assert.equal(e2eGovernanceChange.requires_live_certification, false);

const renamedAcrossEnvironments = classifyChange({
  status: "R100",
  path: "autopilot-portable-staging/New.ps1",
  previous_path: "autopilot-portable-production/Old.ps1",
}, classes);
assert.deepEqual(renamedAcrossEnvironments.path_classes, ["staging_only"]);
assert.deepEqual(renamedAcrossEnvironments.previous_path_classes, ["production_only"]);
assert.deepEqual(renamedAcrossEnvironments.classes, ["production_only", "staging_only"]);
assert.deepEqual(renamedAcrossEnvironments.environments, ["production", "staging"]);
assert.equal(renamedAcrossEnvironments.requires_live_certification, true);

const unknownRenameSource = classifyChange({
  status: "R100",
  path: "autopilot-portable-staging/New.ps1",
  previous_path: "unknown-surface/Old.ps1",
}, classes);
assert.deepEqual(unknownRenameSource.path_classes, ["staging_only"]);
assert.deepEqual(unknownRenameSource.previous_path_classes, []);

const reportFile = path.join(os.tmpdir(), `environment-impact-${process.pid}.json`);
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
assert.equal(JSON.parse(fs.readFileSync(reportFile, "utf8")).contract, "mad4b.environment-impact-closure.v1");
fs.rmSync(reportFile, { force: true });

const cli = spawnSync(process.execPath, [path.join(apiRoot, "scripts/environment-impact-closure.mjs")], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
const cliSummary = JSON.parse(cli.stdout.trim());
assert.equal(path.relative(root, cliSummary.report_file).startsWith(".."), true, "default report must stay outside repository root");
fs.rmSync(cliSummary.report_file, { force: true });

console.log("environment impact closure contract tests passed");
void root;
