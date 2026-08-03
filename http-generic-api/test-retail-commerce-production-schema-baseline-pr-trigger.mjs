import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(
  apiRoot,
  "../.github/workflows/retail-commerce-production-schema-baseline-pr-trigger.yml",
);
const source = readFileSync(workflowPath, "utf8");
const workflow = YAML.parse(source);

assert(workflow?.on?.pull_request, "Workflow must remain pull_request-scoped");
assert.equal(workflow.on.pull_request_target, undefined, "pull_request_target is forbidden");
assert.deepEqual(workflow.permissions, {
  contents: "read",
  "pull-requests": "read",
});

const job = workflow.jobs?.["production-schema-baseline"];
assert(job, "Production schema-baseline job is required");
assert.equal(job.environment, "Production");
assert.match(job.if, /pull_request\.draft == true/u);
assert.match(job.if, /gpt\/retail-commerce-production-schema-baseline-trigger-/u);
assert.equal(job.env.DB_HOST, "${{ secrets.DB_HOST }}");
assert.equal(job.env.DB_NAME, "${{ secrets.DB_NAME }}");
assert.equal(job.env.DB_USER, "${{ secrets.DB_USER }}");
assert.equal(job.env.DB_PASSWORD, "${{ secrets.DB_PASSWORD }}");

const steps = job.steps;
assert(Array.isArray(steps));
const stepByName = new Map(steps.map((step) => [step.name, step]));
const indexOf = (name) => steps.findIndex((step) => step.name === name);

const initialize = stepByName.get("Initialize bounded evidence report");
const verify = stepByName.get("Verify trigger scope and immutable read-only binding");
const preflight = stepByName.get("Preflight Production database secret bindings");
const collect = stepByName.get("Collect authoritative Production schema and migration-ledger baseline");
const ensure = stepByName.get("Ensure bounded evidence report exists");
const summary = stepByName.get("Publish bounded evidence summary");
const upload = stepByName.get("Upload Production schema baseline Artifact");
const failClosed = stepByName.get("Fail closed after publishing evidence");

for (const [name, step] of [
  ["Initialize bounded evidence report", initialize],
  ["Verify trigger scope and immutable read-only binding", verify],
  ["Preflight Production database secret bindings", preflight],
  ["Collect authoritative Production schema and migration-ledger baseline", collect],
  ["Ensure bounded evidence report exists", ensure],
  ["Publish bounded evidence summary", summary],
  ["Upload Production schema baseline Artifact", upload],
  ["Fail closed after publishing evidence", failClosed],
]) {
  assert(step, `${name} step is required`);
}

assert(indexOf("Initialize bounded evidence report") < indexOf("Verify trigger scope and immutable read-only binding"));
assert(indexOf("Verify trigger scope and immutable read-only binding") < indexOf("Preflight Production database secret bindings"));
assert(indexOf("Preflight Production database secret bindings") < indexOf("Upload Production schema baseline Artifact"));
assert(indexOf("Upload Production schema baseline Artifact") < indexOf("Fail closed after publishing evidence"));

assert.match(initialize.run, /status: "initialized"/u);
assert.match(initialize.run, /execution_current_main_sha/u);
assert.match(initialize.run, /non_executable_main_drift_accepted: false/u);
assert.match(initialize.run, /accepted_main_drift_files: \[\]/u);
assert.match(initialize.run, /credential_values_returned: false/u);
assert.match(initialize.run, /secrets_included: false/u);

assert.match(verify.run, /compare\/\$\{BASE_SHA\}\.\.\.\$\{current_main_sha\}/u);
assert.match(verify.run, /\.merge_base_commit\.sha == \$base/u);
assert.match(verify.run, /\.behind_by == 0/u);
assert.match(verify.run, /\.ahead_by >= 1 and \.ahead_by <= 20/u);
assert.match(verify.run, /\.total_commits >= 1 and \.total_commits <= 20/u);
assert.match(verify.run, /all\(\.files\[\]\.filename; \. == "docs\/repo-maintenance-status\.md"\)/u);
assert.match(verify.run, /accepted_drift_files/u);
assert.match(verify.run, /non_executable_main_drift_accepted/u);
assert.doesNotMatch(verify.run, /docs\/\*\*/u, "Main drift allowlist must not use a docs wildcard");
assert.doesNotMatch(verify.run, /\.github\/workflows\/.+accepted/u, "Executable workflow drift must never be accepted");

assert.equal(preflight.id, "db_preflight");
assert.match(preflight.run, /for key in DB_HOST DB_NAME DB_USER DB_PASSWORD/u);
assert.match(preflight.run, /missing_secret_bindings/u);
assert.match(preflight.run, /ready=false/u);
assert.match(preflight.run, /exit 0/u);
assert.doesNotMatch(preflight.run, /echo\s+.*\$\{!key/u, "Credential values must never be echoed");

assert.equal(collect.if, "steps.db_preflight.outputs.ready == 'true'");
assert.equal(collect["continue-on-error"], true);
assert.match(collect.run, /execution_current_main_sha/u);
assert.equal(ensure.if, "always()");
assert.equal(summary.if, "always()");
assert.match(summary.run, /accepted_main_drift_files/u);
assert.equal(upload.id, "upload");
assert.equal(upload.if, "always()");
assert.equal(upload.with["if-no-files-found"], "error");
assert.equal(failClosed.if, "always()");
assert.match(failClosed.run, /UPLOAD_OUTCOME/u);
assert.match(failClosed.run, /blocked_missing_secret_bindings/u);
assert.match(failClosed.run, /execution_current_main_sha/u);
assert.match(failClosed.run, /exit 1/u);

assert.doesNotMatch(source, /secrets_included:\s*true/u);
assert.doesNotMatch(source, /credential_values_returned:\s*true/u);
assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|TRUNCATE|CALL|GRANT|REVOKE)\b.*governed_migration_ledger/iu);

console.log(JSON.stringify({
  ok: true,
  test: "retail_commerce_production_schema_baseline_pr_trigger",
  initialized_before_preflight: true,
  artifact_uploaded_before_fail_closed: true,
  exact_non_executable_main_drift_allowlist: ["docs/repo-maintenance-status.md"],
  main_drift_commit_limit: 20,
  missing_binding_names_only: true,
  credential_values_returned: false,
  secrets_included: false,
}));
