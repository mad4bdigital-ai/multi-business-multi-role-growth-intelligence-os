import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildPlan } from "./scripts/openapi-gap-closure-plan.mjs";

const apiRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(apiRoot, "..");
const artifactPath = resolve(repositoryRoot, "specs/020-platform-resource-identity-brand-governance/openapi-gap-closure-plan.json");
const schemaPath = resolve(repositoryRoot, "specs/020-platform-resource-identity-brand-governance/contracts/openapi-gap-closure-plan.schema.json");

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const generated = buildPlan();

assert.deepEqual(artifact, generated, "gap-closure plan must be deterministic");
assert.equal(schema.$id, "https://schemas.mad4b.com/spec020/openapi-gap-closure-plan.schema.json");
assert.equal(artifact.coverage.openapi_gap_count, 0);
assert.equal(artifact.coverage.auth_contract_gap_count, 0);
assert.equal(artifact.coverage.coverage_complete, false);
assert.equal(artifact.closure_summary.blocking_contract_gaps, 0);
assert.equal(artifact.closure_summary.all_safe_closures_included, true);
assert.equal(artifact.closure_summary.activation_remains_separate, true);
assert.equal(artifact.families.length, artifact.coverage.mounted_family_count);
assert.equal(new Set(artifact.families.map((family) => family.family_key)).size, artifact.families.length);
assert.ok(artifact.families.every((family) => family.activation_allowed === false));
assert.ok(artifact.workstreams.some((workstream) => workstream.id === "projection_activation" && workstream.status === "blocked_by_separate_approval"));
assert.ok(artifact.workstreams.some((workstream) => workstream.id === "runtime_authority" && workstream.status === "forbidden_in_this_pr"));
assert.deepEqual(artifact.scope_boundary, {
  route_wiring: false,
  runtime_authority: false,
  rest_projection: false,
  custom_gpt_projection: false,
  remote_mcp_projection: false,
  frontend_projection: false,
  database_write: false,
  migration_apply: false,
  grant_execution: false,
  provider_call: false,
  credential_read: false,
  production_activation: false,
});

console.log(JSON.stringify({
  ok: true,
  contract: "spec020-openapi-gap-closure-plan-v1",
  operation_count: artifact.coverage.operation_count,
  family_count: artifact.families.length,
  blocking_contract_gaps: artifact.closure_summary.blocking_contract_gaps,
  surface_decisions_requiring_owner: artifact.closure_summary.surface_decisions_requiring_owner,
  traceability_closures: artifact.closure_summary.read_only_traceability_closures,
  route_wiring: artifact.scope_boundary.route_wiring,
  runtime_authority: artifact.scope_boundary.runtime_authority,
  production_activation: artifact.scope_boundary.production_activation,
}, null, 2));
