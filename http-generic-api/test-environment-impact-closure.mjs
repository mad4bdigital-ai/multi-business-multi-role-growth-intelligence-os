import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, classifyPath } from "./scripts/environment-impact-closure.mjs";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(apiRoot, "..");
const deployment = JSON.parse(fs.readFileSync(path.join(apiRoot, "config/deployment-branch-policy.json"), "utf8"));
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

const classes = deployment.environment_impact.path_classes;
assert.deepEqual(classifyPath("autopilot-portable-staging/Start-AutoPilot.ps1", classes).map((entry) => entry.id), ["staging_only"]);
assert.deepEqual(classifyPath("http-generic-api/routes/tenantTools.js", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("autopilot-portable-production/Deploy.ps1", classes).map((entry) => entry.id), ["production_only"]);
assert.deepEqual(classifyPath("http-generic-api/.env.staging.example", classes).map((entry) => entry.id), ["staging_only"]);
assert.deepEqual(classifyPath("http-generic-api/frontend-surface-dispatch.generated.json", classes).map((entry) => entry.id), ["shared_runtime"]);
assert.deepEqual(classifyPath("docs/repository-inventory.json", classes).map((entry) => entry.id), ["repository_governance"]);
assert.deepEqual(classifyPath("docs/README.md", classes), []);

const reportFile = path.join(os.tmpdir(), `environment-impact-${process.pid}.json`);
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
assert.equal(JSON.parse(fs.readFileSync(reportFile, "utf8")).contract, "mad4b.environment-impact-closure.v1");
fs.rmSync(reportFile, { force: true });
console.log("environment impact closure contract tests passed");
void root;
