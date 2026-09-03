import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildReport, classifyChange, classifyPath, parseNameStatusLine } from "./scripts/environment-impact-closure.mjs";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(apiRoot, "..");
const deployment = JSON.parse(fs.readFileSync(path.join(apiRoot, "config/deployment-branch-policy.json"), "utf8"));
const policy = deployment.environment_impact;
const derivedState = JSON.parse(fs.readFileSync(path.join(root, policy.derived_outputs.registry), "utf8"));
const derivedOutputs = derivedState.artifacts.flatMap((artifact) =>
  (artifact.outputs || []).map((pattern) => ({ artifact_id: artifact.artifact_id, pattern })),
);
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
assert.equal(report.derived_output_registry.path, ".github/derived-state-governance.json");
assert.equal(report.derived_output_registry.contract, "mad4b.repository-derived-state-governance.v1");
assert.equal(report.derived_output_registry.mode, "registered_outputs_are_not_independent_environment_sources");
assert.ok(report.derived_output_registry.output_pattern_count > 0);
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
assert.equal(policy.derived_outputs.registry, ".github/derived-state-governance.json");
assert.equal(policy.derived_outputs.contract, "mad4b.repository-derived-state-governance.v1");
assert.equal(policy.derived_outputs.mode, "registered_outputs_are_not_independent_environment_sources");
assert.equal(policy.derived_outputs.source_path_classification_remains_authoritative, true);
assert.equal(policy.derived_outputs.unregistered_outputs_fail_closed, true);
const sharedRuntimeClass = policy.path_classes.find((entry) => entry.id === "shared_runtime");
const repositoryGovernanceClass = policy.path_classes.find((entry) => entry.id === "repository_governance");
assert.ok(sharedRuntimeClass.patterns.includes("local-connector/**"));
assert.ok(sharedRuntimeClass.exclude_patterns.includes("http-generic-api/test-*.mjs"));
assert.ok(sharedRuntimeClass.exclude_patterns.includes("http-generic-api/test-*.js"));
assert.ok(repositoryGovernanceClass.patterns.includes("http-generic-api/test-*.mjs"));
assert.ok(repositoryGovernanceClass.patterns.includes("http-generic-api/test-*.js"));
assert.deepEqual(
  [...policy.source_of_truth_paths].sort(),
  Object.values(policy.authorities).sort(),
);

const classes = policy.path_classes;
assert.deepEqual(classifyPath("autopilot-portable-staging/Start-AutoPilot.ps1", classes).map((entry) => entry.id), ["staging_only"]);
assert.deepEqual(classifyPath("local-connector/server.mjs", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("local-connector/connector-watchdog.ps1", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("http-generic-api/routes/tenantTools.js", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("http-generic-api/schema.sql", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("autopilot-portable-production/Deploy.ps1", classes).map((entry) => entry.id), ["production_only"]);
assert.deepEqual(classifyPath("http-generic-api/.env.staging.example", classes).map((entry) => entry.id), ["staging_only"]);
assert.deepEqual(classifyPath("http-generic-api/frontend-surface-dispatch.generated.json", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("http-generic-api/auth.mjs", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("http-generic-api/test-environment-impact-closure.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/test-example.js", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("docs/repository-inventory.json", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/e2e-phase-governance-core.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/test-e2e-single-pr-maintenance-evaluator.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/e2e-parallel-work-governance.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/github-main-review-policy-readiness-issue-publisher.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/github-review-policy-target.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/test-github-review-policy-target.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/test-generated-artifact-refresh-maintenance-tool.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/maintenance-tools/configuration-candidate-discovery.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/maintenance-tools/configuration-drift-guard.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/test-configuration-drift-guard.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/environment-impact-closure.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/taxonomy/automation-overlap-policy.json", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/taxonomy/script-taxonomy.json", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/migration-order.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("http-generic-api/scripts/hostinger-runtime-bootstrap.mjs", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath(".dockerignore", classes).map((entry) => entry.id), ["staging_only", "repository_governance"]);
assert.deepEqual(classifyPath("docs/README.md", classes), []);
assert.deepEqual(classifyPath("Updating Registry Patch Index.md", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("deployment_parity_checklist.md", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("docs/ai-docs-agent-governance.md", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("docs/auto-docs-agent/README.md", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("docs/change-documentation-governance.md", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(parseNameStatusLine("M\tUpdating Registry Patch Index.md"), {
  status: "M",
  path: "Updating Registry Patch Index.md",
  previous_path: null,
});
assert.deepEqual(parseNameStatusLine("R100\told file.md\tnew file.md"), {
  status: "R100",
  path: "new file.md",
  previous_path: "old file.md",
});

const sharedChange = classifyChange({ status: "M", path: "http-generic-api/routes/tenantTools.js", previous_path: null }, classes, derivedOutputs);
assert.deepEqual(sharedChange.classes, ["shared_runtime"]);
assert.deepEqual(sharedChange.environments, ["production", "staging"]);
assert.deepEqual(sharedChange.environment_source_classes, ["shared_runtime"]);
assert.deepEqual(sharedChange.environment_source_environments, ["production", "staging"]);
assert.equal(sharedChange.requires_live_certification, true);
assert.equal(sharedChange.environment_source_requires_live_certification, true);
const connectorRuntimeChange = classifyChange({ status: "M", path: "local-connector/server.mjs", previous_path: null }, classes, derivedOutputs);
assert.deepEqual(connectorRuntimeChange.classes, ["shared_runtime"]);
assert.deepEqual(connectorRuntimeChange.environments, ["production", "staging"]);
assert.deepEqual(connectorRuntimeChange.environment_source_classes, ["shared_runtime"]);
assert.deepEqual(connectorRuntimeChange.environment_source_environments, ["production", "staging"]);
assert.equal(connectorRuntimeChange.requires_live_certification, true);
assert.equal(connectorRuntimeChange.environment_source_requires_live_certification, true);
const schemaChange = classifyChange({ status: "M", path: "http-generic-api/schema.sql", previous_path: null }, classes, derivedOutputs);
assert.deepEqual(schemaChange.classes, ["shared_runtime"]);
assert.deepEqual(schemaChange.environments, ["production", "staging"]);
assert.deepEqual(schemaChange.environment_source_classes, ["shared_runtime"]);
assert.deepEqual(schemaChange.environment_source_environments, ["production", "staging"]);
assert.equal(schemaChange.requires_live_certification, true);
assert.equal(schemaChange.environment_source_requires_live_certification, true);

const e2eGovernanceChange = classifyChange({
  status: "M",
  path: "http-generic-api/scripts/e2e-phase-governance-core.mjs",
  previous_path: null,
}, classes, derivedOutputs);
assert.deepEqual(e2eGovernanceChange.classes, ["repository_governance"]);
assert.deepEqual(e2eGovernanceChange.environments, ["repository"]);
assert.deepEqual(e2eGovernanceChange.environment_source_classes, ["repository_governance"]);
assert.deepEqual(e2eGovernanceChange.environment_source_environments, ["repository"]);
assert.equal(e2eGovernanceChange.requires_live_certification, false);
assert.equal(e2eGovernanceChange.environment_source_requires_live_certification, false);

const derivedWorkMap = classifyChange({
  status: "M",
  path: "specs/020-platform-resource-identity-brand-governance/work-map-integration.json",
  previous_path: null,
}, classes, derivedOutputs);
assert.deepEqual(derivedWorkMap.classes, ["repository_governance", "shared_runtime"]);
assert.deepEqual(derivedWorkMap.environments, ["production", "repository", "staging"]);
assert.equal(derivedWorkMap.registered_derived_output, true);
assert.deepEqual(derivedWorkMap.derived_artifact_ids, ["work_maps"]);
assert.deepEqual(derivedWorkMap.environment_source_classes, []);
assert.deepEqual(derivedWorkMap.environment_source_environments, []);
assert.equal(derivedWorkMap.environment_source_requires_live_certification, false);

const derivedPortableManifest = classifyChange({
  status: "M",
  path: "autopilot-portable-staging/manifest.json",
  previous_path: null,
}, classes, derivedOutputs);
assert.deepEqual(derivedPortableManifest.classes, ["staging_only"]);
assert.deepEqual(derivedPortableManifest.environments, ["staging"]);
assert.equal(derivedPortableManifest.registered_derived_output, true);
assert.deepEqual(derivedPortableManifest.derived_artifact_ids, ["portable_staging_manifest"]);
assert.deepEqual(derivedPortableManifest.environment_source_classes, []);
assert.deepEqual(derivedPortableManifest.environment_source_environments, []);
assert.equal(derivedPortableManifest.environment_source_requires_live_certification, false);

const sourceToDerivedRename = classifyChange({
  status: "R100",
  path: "specs/020-platform-resource-identity-brand-governance/work-map-integration.json",
  previous_path: "http-generic-api/routes/tenantTools.js",
}, classes, derivedOutputs);
assert.equal(sourceToDerivedRename.registered_derived_output, true);
assert.deepEqual(sourceToDerivedRename.environment_source_classes, ["shared_runtime"]);
assert.deepEqual(sourceToDerivedRename.environment_source_environments, ["production", "staging"]);
assert.equal(sourceToDerivedRename.environment_source_requires_live_certification, true);

const derivedToSourceRename = classifyChange({
  status: "R100",
  path: "http-generic-api/routes/tenantTools.js",
  previous_path: "specs/020-platform-resource-identity-brand-governance/work-map-integration.json",
}, classes, derivedOutputs);
assert.equal(derivedToSourceRename.registered_derived_output, true);
assert.deepEqual(derivedToSourceRename.environment_source_classes, ["shared_runtime"]);
assert.deepEqual(derivedToSourceRename.environment_source_environments, ["production", "staging"]);
assert.equal(derivedToSourceRename.environment_source_requires_live_certification, true);

const renamedAcrossEnvironments = classifyChange({
  status: "R100",
  path: "autopilot-portable-staging/New.ps1",
  previous_path: "autopilot-portable-production/Old.ps1",
}, classes, derivedOutputs);
assert.deepEqual(renamedAcrossEnvironments.path_classes, ["staging_only"]);
assert.deepEqual(renamedAcrossEnvironments.previous_path_classes, ["production_only"]);
assert.deepEqual(renamedAcrossEnvironments.classes, ["production_only", "staging_only"]);
assert.deepEqual(renamedAcrossEnvironments.environments, ["production", "staging"]);
assert.deepEqual(renamedAcrossEnvironments.environment_source_classes, ["production_only", "staging_only"]);
assert.deepEqual(renamedAcrossEnvironments.environment_source_environments, ["production", "staging"]);
assert.equal(renamedAcrossEnvironments.requires_live_certification, true);
assert.equal(renamedAcrossEnvironments.environment_source_requires_live_certification, true);

const unknownRenameSource = classifyChange({
  status: "R100",
  path: "autopilot-portable-staging/New.ps1",
  previous_path: "unknown-surface/Old.ps1",
}, classes, derivedOutputs);
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
