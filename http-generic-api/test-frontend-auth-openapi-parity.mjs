import assert from "node:assert/strict";
import fs from "node:fs";

const plan = JSON.parse(fs.readFileSync("frontend-surface-dispatch.generated.json", "utf8"));
const operations = plan.families.flatMap((family) => family.operations.map((operation) => ({ ...operation, family_key: family.family_key })));

function operation(signature, sourceFile = null) {
  const matches = operations.filter((entry) => entry.signature === signature && (!sourceFile || entry.source_file === sourceFile));
  assert.equal(matches.length, 1, `expected one dispatch operation for ${signature}${sourceFile ? ` in ${sourceFile}` : ""}`);
  return matches[0];
}

const userJwtOperations = [
  "GET /connect/onboarding-state",
  "POST /connect/workspace",
  "POST /connect/escalate",
  "GET /me",
  "GET /me/workspaces",
  "POST /me/workspaces",
  "GET /me/capabilities",
  "POST /connect/preferences",
  "POST /connect/profile",
  "GET /connect/api/credential-intake/sessions/{session_id}/wait",
  "GET /me/agent-surfaces/catalog",
  "GET /me/agent-surfaces",
  "GET /me/agent-surfaces/readiness",
  "PUT /me/agent-surfaces/{surface_key}/preferences",
  "PUT /me/agent-surfaces/{surface_key}/deployment",
];

for (const signature of userJwtOperations) {
  const entry = operation(signature);
  assert.equal(entry.runtime_auth.profile, "user_jwt", `${signature} runtime guard must resolve to user JWT`);
  assert.equal(entry.auth_parity.state, "equivalent", `${signature} OpenAPI security must match its runtime user-JWT guard`);
}

for (const signature of [
  "POST /platform/capability-vault/repo-ingestion-plan",
  "POST /platform/capability-vault/mirror-plan",
  "POST /platform/capability-vault/package-plan",
  "POST /platform/capability-vault/reinstall-diff-plan",
  "POST /platform/capability-vault/variant-plan",
  "POST /platform/capability-vault/install-request-plan",
  "POST /platform/capability-vault/variant-merge-plan",
  "POST /platform/capability-vault/runtime-resolve",
  "POST /platform/capability-vault/google-file-read/resolve",
]) {
  const entry = operation(signature);
  assert.equal(entry.runtime_auth.profile, "admin_backend");
  assert.equal(entry.auth_parity.state, "equivalent", `${signature} must not inherit anonymous OpenAPI security`);
  assert.equal(entry.governance.classification, "read_action", `${signature} is a non-mutating planning action`);
}

assert.equal(operation("GET /connector-agent/installer.ps1").runtime_auth.profile, "signed_query_token");
assert.equal(operation("GET /connector-agent/installer.ps1").auth_parity.state, "equivalent");
assert.equal(operation("POST /connector-agent/heartbeat").runtime_auth.profile, "connector_bearer");
assert.equal(operation("POST /connector-agent/heartbeat").auth_parity.state, "equivalent");

const resourceMutationSignatures = [
  "POST /me/workspaces/{tenant_id}/resources/{resourceKey}",
  "PATCH /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "DELETE /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
  "POST /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/restore",
];
for (const signature of resourceMutationSignatures) {
  const entry = operation(signature, "routes/resourceApiRoutes.js");
  assert.equal(entry.governance.classification, "state_change");
  assert.equal(entry.governance.controls.readback.mode, "inline_post_commit");
  assert(entry.governance.blockers.includes("mutation_rollback_gap"), `${signature} must remain blocked until failure rollback/compensation is implemented`);
}

assert.equal(plan.coverage.auth_parity_counts.undefined_scheme || 0, 0, "every referenced OpenAPI security scheme must be defined in its source document");
assert.equal(plan.coverage.auth_contract_gap_count, 0, "runtime and canonical OpenAPI authentication must have complete parity");
assert.equal(plan.coverage.operation_policy_issue_count, 0, "all exact auth and operation rules must resolve uniquely");
assert(plan.coverage.openapi_generated_index_count > 0, "high-confidence runtime operations must be represented in the generated OpenAPI index");
assert.equal(plan.coverage.openapi_gap_count, 0, "every mounted runtime operation must have canonical, generated-index, or explicit exemption presence");
assert(plan.coverage.openapi_detail_gap_count > 0, "operation indexing must not be misreported as reviewed request/response schema completion");

console.log("frontend runtime auth, OpenAPI parity, and per-operation mutation governance tests passed");
