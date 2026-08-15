import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDispatchPlan } from "./scripts/frontend-surface-dispatch.mjs";
import {
  listCanonicalBusinessOperations,
  resolveCanonicalBusinessOperation,
} from "./canonicalBusinessOperationRegistry.js";

const readiness = JSON.parse(readFileSync(new URL("../specs/020-platform-resource-identity-brand-governance/openapi-projection-readiness.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("../specs/020-platform-resource-identity-brand-governance/contracts/openapi-projection-readiness.schema.json", import.meta.url), "utf8"));
const apiRoot = fileURLToPath(new URL(".", import.meta.url));
const plan = buildDispatchPlan({ apiRoot, baselineRef: "readiness-test" });
const spec020Prefixes = ["brand.identity.", "brand.claim.", "asset.identity.", "provider_account.identity."];
const canonicalOperations = listCanonicalBusinessOperations();

assert.equal(schema.$id, "https://schemas.mad4b.com/spec020/openapi-projection-readiness.schema.json");
assert.equal(readiness.schema_version, "spec020-openapi-projection-readiness-v1");
assert.equal(readiness.status, "readiness_only");
assert.equal(readiness.review_state, "requires_separate_surface_activation_decision");
for (const [key, value] of Object.entries(readiness.scope_boundary)) assert.equal(value, false, `readiness boundary ${key} must remain false`);
for (const [key, value] of Object.entries(readiness.safety)) assert.equal(value, false, `readiness safety ${key} must remain false`);
assert.equal(readiness.repository_openapi_baseline.openapi_gap_count, 0);
assert.equal(readiness.repository_openapi_baseline.openapi_gap_count, plan.coverage.openapi_gap_count);
assert.equal(readiness.repository_openapi_baseline.auth_contract_gap_count, plan.coverage.auth_contract_gap_count);
assert.equal(readiness.repository_openapi_baseline.openapi_detail_gap_count, plan.coverage.openapi_detail_gap_count);
assert.equal(readiness.repository_openapi_baseline.coverage_complete, plan.coverage.coverage_complete);
assert.equal(plan.coverage.openapi_gap_count, 0);
assert.equal(plan.coverage.auth_contract_gap_count, 0);
assert.equal(plan.coverage.coverage_complete, false);

for (const entry of readiness.operations) {
  const operation = resolveCanonicalBusinessOperation(entry.operation_key);
  assert.ok(operation, `${entry.operation_key} must resolve in canonical registry`);
  assert.ok(spec020Prefixes.some((prefix) => entry.operation_key.startsWith(prefix)));
  assert.equal(operation.status, "shadow", `${entry.operation_key} must remain shadow`);
  assert.equal(entry.status, "shadow");
  assert.equal(entry.existing_surface, "library_only");
  assert.equal(entry.candidate_openapi_operation_id, null);
  for (const surface of ["custom_gpt", "system_layer", "rest", "frontend", "internal_agent"]) {
    assert.equal(operation.projection_policy[surface], "shadow", `${entry.operation_key} ${surface} projection must remain shadow`);
  }
  assert.equal(operation.projection_policy.remote_mcp, "not_projected");
  if (operation.effect_class !== "read_only") {
    assert.equal(operation.approval_required, true);
    assert.equal(operation.idempotency_required, true);
    assert.equal(operation.readback_required, true);
  }
}

const restBrandList = plan.families
  .flatMap((family) => family.operations)
  .find((operation) => operation.signature === "GET /me/workspaces/{tenant_id}/brands");
assert.ok(restBrandList, "existing REST Brand-list operation must remain discoverable");
assert.equal(restBrandList.openapi_canonical_documented, true);
assert.equal(restBrandList.auth_parity.state, "equivalent");
assert.equal(readiness.existing_surface_parity.find((entry) => entry.surface === "rest_workspace_brand_list")?.route_change_in_this_readiness_slice, false);
assert.equal(readiness.readiness_gates.allowlist_is_presence_only, true);
assert.equal(readiness.readiness_gates.detail_gaps_must_not_be_mislabeled_as_canonical, true);
console.log(JSON.stringify({
  ok: true,
  contract: "spec020-openapi-projection-readiness-v1",
  spec020_operation_count: readiness.operations.length,
  openapi_gap_count: plan.coverage.openapi_gap_count,
  openapi_detail_gap_count: plan.coverage.openapi_detail_gap_count,
  auth_contract_gap_count: plan.coverage.auth_contract_gap_count,
  coverage_complete: plan.coverage.coverage_complete,
  route_wiring: false,
  runtime_authority: false,
  secrets_included: false,
}));
