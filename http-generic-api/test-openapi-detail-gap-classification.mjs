import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDispatchPlan } from "./scripts/frontend-surface-dispatch.mjs";
import { buildClassification } from "./scripts/openapi-detail-gap-classification.mjs";

const apiRoot = fileURLToPath(new URL(".", import.meta.url));
const classification = JSON.parse(readFileSync(new URL("../specs/020-platform-resource-identity-brand-governance/openapi-detail-gap-classification.json", import.meta.url), "utf8"));
const dispatch = JSON.parse(readFileSync(new URL("./frontend-surface-dispatch.generated.json", import.meta.url), "utf8"));
const plan = buildDispatchPlan({ apiRoot, baselineRef: classification.source.baseline_ref });
const rebuilt = buildClassification();
const boundaryEntries = Object.entries(classification.scope_boundary);
const sumCounts = (entries) => entries.reduce((total, entry) => total + entry.count, 0);

assert.equal(classification.$schema, "https://schemas.mad4b.com/spec020/openapi-detail-gap-classification.schema.json");
assert.equal(classification.schema_version, "spec020-openapi-detail-gap-classification-v1");
assert.equal(classification.status, "classification_only");
assert.equal(classification.review_state, "documentation_and_surface_decision_readiness");
assert.deepEqual(classification, rebuilt, "persisted classification must equal the deterministic rebuild");
assert.deepEqual(classification.coverage, {
  operation_count: plan.coverage.operation_count,
  openapi_documented_count: plan.coverage.openapi_documented_count,
  openapi_canonical_documented_count: plan.coverage.openapi_canonical_documented_count,
  openapi_generated_index_count: plan.coverage.openapi_generated_index_count,
  openapi_gap_count: plan.coverage.openapi_gap_count,
  auth_contract_gap_count: plan.coverage.auth_contract_gap_count,
  openapi_detail_gap_count: plan.coverage.openapi_detail_gap_count,
  unresolved_surface_decision_count: plan.coverage.unresolved_surface_decision_count,
  coverage_complete: plan.coverage.coverage_complete,
});
assert.equal(classification.source.dispatch_artifact_sha256, createHash("sha256").update(readFileSync(new URL("./frontend-surface-dispatch.generated.json", import.meta.url))).digest("hex"));
assert.equal(classification.source.dispatch_source_digest, dispatch.baseline.source_digest);
assert.equal(classification.coverage.openapi_gap_count, 0);
assert.equal(classification.coverage.auth_contract_gap_count, 0);
assert.equal(classification.coverage.coverage_complete, false);
assert.equal(classification.distributions.detail_gap_entries_by_method.length >= 1, true);
assert.equal(sumCounts(classification.distributions.detail_gap_entries_by_method), classification.coverage.openapi_detail_gap_count);
assert.equal(sumCounts(classification.distributions.detail_gap_entries_by_surface_decision), classification.coverage.openapi_detail_gap_count);
assert.equal(sumCounts(classification.distributions.detail_gap_entries_by_family), classification.coverage.openapi_detail_gap_count);
assert.equal(classification.priority_summary.blocking_contract_gap_count, 0);
assert.equal(classification.priority_summary.documentation_only_detail_gap_count, classification.coverage.openapi_detail_gap_count);
assert.equal(classification.priority_summary.surface_decision_required_family_count, classification.distributions.surface_decisions_by_family.find((entry) => entry.decision === "requires_review")?.count);
assert.equal(classification.priority_rules.length, 3);
for (const [key, value] of boundaryEntries) assert.equal(value, false, `classification boundary ${key} must remain false`);
for (const method of classification.distributions.detail_gap_entries_by_method) assert.match(method.method, /^(GET|POST|PUT|PATCH|DELETE)$/u);
console.log(JSON.stringify({
  ok: true,
  contract: classification.schema_version,
  openapi_detail_gap_count: classification.coverage.openapi_detail_gap_count,
  unresolved_surface_decision_count: classification.coverage.unresolved_surface_decision_count,
  blocking_contract_gap_count: classification.priority_summary.blocking_contract_gap_count,
  route_wiring: false,
  runtime_authority: false,
  production_activation: false,
}));
