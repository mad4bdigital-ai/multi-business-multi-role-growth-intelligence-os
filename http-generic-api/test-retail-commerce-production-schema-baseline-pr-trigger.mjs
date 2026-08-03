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
assert.equal(job.env.BACKEND_API_KEY, "${{ secrets.BACKEND_API_KEY }}");
assert.equal(job.env.RUNTIME_BASE_URL, "https://auth.mad4b.com");

const steps = job.steps;
assert(Array.isArray(steps));
const stepByName = new Map(steps.map((step) => [step.name, step]));
const indexOf = (name) => steps.findIndex((step) => step.name === name);

const initialize = stepByName.get("Initialize bounded evidence report");
const verify = stepByName.get("Verify trigger scope and immutable read-only binding");
const preflight = stepByName.get("Select authoritative baseline source");
const collect = stepByName.get("Collect authoritative Production schema and migration-ledger baseline");
const ensure = stepByName.get("Ensure bounded evidence report exists");
const summary = stepByName.get("Publish bounded evidence summary");
const upload = stepByName.get("Upload Production schema baseline Artifact");
const failClosed = stepByName.get("Fail closed after publishing evidence");

for (const [name, step] of [
  ["Initialize bounded evidence report", initialize],
  ["Verify trigger scope and immutable read-only binding", verify],
  ["Select authoritative baseline source", preflight],
  ["Collect authoritative Production schema and migration-ledger baseline", collect],
  ["Ensure bounded evidence report exists", ensure],
  ["Publish bounded evidence summary", summary],
  ["Upload Production schema baseline Artifact", upload],
  ["Fail closed after publishing evidence", failClosed],
]) {
  assert(step, `${name} step is required`);
}

assert(indexOf("Initialize bounded evidence report") < indexOf("Verify trigger scope and immutable read-only binding"));
assert(indexOf("Verify trigger scope and immutable read-only binding") < indexOf("Select authoritative baseline source"));
assert(indexOf("Select authoritative baseline source") < indexOf("Upload Production schema baseline Artifact"));
assert(indexOf("Upload Production schema baseline Artifact") < indexOf("Fail closed after publishing evidence"));

assert.match(initialize.run, /status: "initialized"/u);
assert.match(initialize.run, /selected_collection_source: null/u);
assert.match(initialize.run, /missing_binding_alternatives/u);
assert.match(initialize.run, /execution_current_main_sha/u);
assert.match(initialize.run, /non_executable_main_drift_accepted: false/u);
assert.match(initialize.run, /accepted_main_drift_files: \[\]/u);
assert.match(initialize.run, /sql_execution: false/u);
assert.match(initialize.run, /mutation_sql_execution: false/u);
assert.match(initialize.run, /runtime_api_request_executed: false/u);
assert.match(initialize.run, /credential_values_returned: false/u);
assert.match(initialize.run, /secrets_included: false/u);

assert.match(verify.run, /compare\/\$\{BASE_SHA\}\.\.\.\$\{current_main_sha\}/u);
assert.match(verify.run, /\.merge_base_commit\.sha == \$base/u);
assert.match(verify.run, /\.behind_by == 0/u);
assert.match(verify.run, /\.ahead_by >= 1 and \.ahead_by <= 20/u);
assert.match(verify.run, /\.total_commits >= 1 and \.total_commits <= 20/u);
assert.match(verify.run, /\.files \| type == "array"/u);
assert.match(verify.run, /all\(\.files\[\]\.filename; \. == "docs\/repo-maintenance-status\.md"\)/u);
assert.doesNotMatch(verify.run, /\.files \| type == "array" and length >= 1/u, "Zero-net tree drift must remain accepted");
assert.match(verify.run, /NON_EXECUTABLE_MAIN_DRIFT_ACCEPTED/u);
assert.match(verify.run, /ACCEPTED_MAIN_DRIFT_FILES/u);
assert.doesNotMatch(verify.run, /docs\/\*\*/u, "Main drift allowlist must not use a docs wildcard");
assert.doesNotMatch(verify.run, /\.github\/workflows\/.+accepted/u, "Executable workflow drift must never be accepted");

assert.equal(preflight.id, "source_preflight");
assert.match(preflight.run, /for key in DB_HOST DB_NAME DB_USER DB_PASSWORD/u);
assert.match(preflight.run, /BACKEND_API_KEY/u);
assert.match(preflight.run, /source_mode="direct_db"/u);
assert.match(preflight.run, /source_mode="runtime_api"/u);
assert.match(preflight.run, /source_mode="none"/u);
assert.match(preflight.run, /credential_bindings_available_direct_database/u);
assert.match(preflight.run, /credential_bindings_available_governed_runtime_api/u);
assert.match(preflight.run, /blocked_missing_secret_bindings/u);
assert.match(preflight.run, /missing_binding_alternatives/u);
assert.match(preflight.run, /ready=true/u);
assert.match(preflight.run, /ready=false/u);
assert.doesNotMatch(preflight.run, /echo\s+.*\$\{!key/u, "Credential values must never be echoed");
assert.doesNotMatch(preflight.run, /printf[^\n]*BACKEND_API_KEY[^\n]*\$\{BACKEND_API_KEY/u, "Backend credential value must never be printed");

assert.equal(collect.if, "steps.source_preflight.outputs.ready == 'true'");
assert.equal(collect["continue-on-error"], true);
assert.equal(collect.env.SOURCE_MODE, "${{ steps.source_preflight.outputs.source_mode }}");
assert.match(collect.run, /--source=direct_db/u);
assert.match(collect.run, /--source=runtime_api/u);
assert.match(collect.run, /selected_collection_source = \$source_mode/u);
assert.match(collect.run, /execution_current_main_sha/u);
assert.match(collect.run, /--argjson drift_accepted/u);
assert.match(collect.run, /--argjson accepted_drift_files/u);
assert.match(collect.run, /non_executable_main_drift_accepted = \$drift_accepted/u);
assert.match(collect.run, /accepted_main_drift_files = \$accepted_drift_files/u);
assert.match(collect.run, /missing_binding_alternatives/u);

assert.equal(ensure.if, "always()");
assert.equal(summary.if, "always()");
assert.match(summary.run, /selected_collection_source/u);
assert.match(summary.run, /collection_source/u);
assert.match(summary.run, /missing_binding_alternatives/u);
assert.match(summary.run, /accepted_main_drift_files/u);
assert.equal(upload.id, "upload");
assert.equal(upload.if, "always()");
assert.equal(upload.with["if-no-files-found"], "error");
assert.equal(failClosed.if, "always()");
assert.match(failClosed.run, /UPLOAD_OUTCOME/u);
assert.match(failClosed.run, /blocked_missing_secret_bindings/u);
assert.match(failClosed.run, /selected_collection_source == "none"/u);
assert.match(failClosed.run, /direct_database_metadata/u);
assert.match(failClosed.run, /governed_production_runtime_schema_readback/u);
assert.match(failClosed.run, /https:\/\/auth\.mad4b\.com/u);
assert.match(failClosed.run, /runtime_api_request_executed == true/u);
assert.match(failClosed.run, /local_sql_execution == false/u);
assert.match(failClosed.run, /sql_execution == true/u);
assert.match(failClosed.run, /mutation_sql_execution == false/u);
assert.match(failClosed.run, /execution_current_main_sha/u);
assert.match(failClosed.run, /non_executable_main_drift_accepted \| type == "boolean"/u);
assert.match(failClosed.run, /accepted_main_drift_files \| type == "array"/u);
assert.match(failClosed.run, /exit 1/u);

assert.doesNotMatch(source, /secrets_included:\s*true/u);
assert.doesNotMatch(source, /credential_values_returned:\s*true/u);
assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|TRUNCATE|CALL|GRANT|REVOKE)\b.*governed_migration_ledger/iu);

console.log(JSON.stringify({
  ok: true,
  test: "retail_commerce_production_schema_baseline_pr_trigger",
  authoritative_sources: ["direct_db", "runtime_api"],
  runtime_api_target: "https://auth.mad4b.com",
  initialized_before_preflight: true,
  artifact_uploaded_before_fail_closed: true,
  zero_net_tree_drift_accepted: true,
  exact_non_executable_main_drift_allowlist: ["docs/repo-maintenance-status.md"],
  main_drift_commit_limit: 20,
  drift_evidence_preserved_after_collection: true,
  missing_binding_names_only: true,
  credential_values_returned: false,
  secrets_included: false,
}));
