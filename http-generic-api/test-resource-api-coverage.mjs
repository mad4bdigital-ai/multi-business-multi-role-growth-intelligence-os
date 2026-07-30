import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { RESOURCE_DESCRIPTORS, decodePageToken, descriptor, encodePageToken } from "./src/domain/resourceApi/resourceCatalog.js";
import { _testingResourceCoverageService, evaluateResourceSurfacePolicy, isRecoverySnapshotSurface, requiresScopedPrimaryKey, shouldResolvePriorCoverageFindings } from "./resourceApiCoverageService.js";
import { validateDirectRouteCallabilityContracts } from "./scripts/resource-api-callability-contracts.mjs";

const manifest = JSON.parse(readFileSync("resource-api-coverage.manifest.json", "utf8"));
const routeSource = readFileSync("routes/resourceApiRoutes.js", "utf8");
const repositorySource = readFileSync("src/infrastructure/resourceApi/resourceRepository.js", "utf8");
const migration = readFileSync("migrations/1023_sprint69_resource_api_coverage_gate.sql", "utf8");
const surfacePolicyMigration = readFileSync("migrations/1025_sprint69_resource_surface_policy_governance.sql", "utf8");
const auditCloseoutMigration = readFileSync("migrations/1026_sprint69_resource_coverage_audit_closeout.sql", "utf8");
const auditScript = readFileSync("scripts/resource-api-coverage-audit.mjs", "utf8");
const spec = readFileSync("../specs/001-resource-api-coverage/spec.md", "utf8");

assert.equal(manifest.policy_key, "platform_resource_api_coverage_policy_v1");
assert.equal(manifest.new_feature_gate.require_surface_policy_decision, true);
assert.deepEqual(manifest.required_operation_classes, ["list", "get", "search", "permissions", "changes", "revisions", "readback"]);
for (const key of ["sessions", "executions", "assets", "approvals", "resource_api_governance"]) assert(manifest.resources.some((row) => row.resource_key === key), `missing ${key} descriptor`);
for (const resource of manifest.resources) for (const operation of manifest.required_operation_classes) assert(resource.operations[operation], `${resource.resource_key} missing ${operation}`);
assert(manifest.resources.find((row) => row.resource_key === "resource_api_governance").source_tables.includes("platform_resource_surface_policy_registry"));
assert.equal(manifest.resources.find((row) => row.resource_key === "assets").operations.revisions, "readback_guarded");
assert.equal(manifest.resources.find((row) => row.resource_key === "approvals").operations.revisions, "readback_guarded");
assert(routeSource.includes('router.get("/admin/resource-types"'));
assert(routeSource.includes('router.get("/admin/resource-coverage/audit"'));
assert(routeSource.includes('router.get("/me/workspaces/:tenant_id/resources"'));
assert(routeSource.includes('router.get("/gpt/sessions/:id/turns"'));
assert(repositorySource.includes("content_preview"));
assert(!routeSource.includes("SELECT "));
assert.equal(descriptor("sessions").table, "customer_sessions");
const token = encodePageToken({ session_id: "s1", created_at: "2026-01-01" }, RESOURCE_DESCRIPTORS.sessions);
assert.equal(decodePageToken(token).id, "s1");
assert(_testingResourceCoverageService.BACKUP_TABLE_RE.test("repair_backup_demo"));
assert(migration.includes("platform_resource_type_registry"));
assert(migration.includes("platform_resource_operation_registry"));
assert(migration.includes("platform_resource_coverage_findings"));
assert(migration.includes("v_platform_resource_api_coverage"));
assert(surfacePolicyMigration.includes("CREATE TABLE IF NOT EXISTS platform_resource_surface_policy_registry"));
assert(surfacePolicyMigration.includes("resource_surface_policy_backfill_v1"));
assert(surfacePolicyMigration.includes("internal_surfaces_require_explicit_not_applicable"));
assert(!/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(surfacePolicyMigration));
assert(auditCloseoutMigration.includes("completed_state_only"));
assert(auditCloseoutMigration.includes("blocked_by_policy"));
assert(auditCloseoutMigration.includes("migration_only"));
assert(!/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(auditCloseoutMigration));
assert(auditScript.includes("new_relation_missing_surface_policy_decision"));
assert(spec.includes("No feature without resource API coverage"));
const directRouteCallability = validateDirectRouteCallabilityContracts({ root: process.cwd(), manifest });
assert.equal(directRouteCallability.ok, true, JSON.stringify(directRouteCallability.findings));
assert(directRouteCallability.covered_tool_keys.includes("workspace_brands_list"));
assert(directRouteCallability.covered_route_signatures.includes("GET /me/workspaces/{tenant_id}/brands"));
for (const toolKey of ["workspace_invitation_create", "workspace_invitation_accept", "workspace_access_request_create", "workspace_access_request_approve", "workspace_access_request_reject"]) {
  assert(directRouteCallability.covered_tool_keys.includes(toolKey), `${toolKey} mutation contract must be covered`);
}
assert(directRouteCallability.covered_route_signatures.includes("POST /me/invitations/accept"));
assert(directRouteCallability.covered_route_signatures.includes("POST /me/workspaces/{tenant_id}/access-requests/{request_id}/approve"));
const workspaceRouteSource = readFileSync("routes/workspaceResourceRoutes.js", "utf8");
const tamperedRouteCallability = validateDirectRouteCallabilityContracts({
  root: process.cwd(),
  manifest,
  fileOverrides: {
    "routes/workspaceResourceRoutes.js": workspaceRouteSource.replace("RESOURCE_API_CALLABILITY_CONTRACT: workspace_brands_list", "RESOURCE_API_CALLABILITY_CONTRACT: tampered"),
  },
});
assert.equal(tamperedRouteCallability.ok, false);
assert(!tamperedRouteCallability.covered_tool_keys.includes("workspace_brands_list"));
assert(tamperedRouteCallability.findings.some((row) => row.type === "direct_route_contract_marker_missing" && row.role === "route"));

const groupedContract = {
  contract_key: "grouped_route_example",
  tool_keys: ["grouped_tool_alpha", "grouped_tool_beta"],
  route_signature: "GET /me/grouped-example",
  migration_file: "migrations/grouped-example.sql",
  route_file: "routes/grouped-example.js",
  mount_file: "routes/grouped-index.js",
  test_file: "test-grouped-example.mjs",
  openapi_file: "openapi-grouped-example.yaml",
  migration_markers: ["grouped_tool_alpha", "grouped_tool_beta"],
  route_markers: ["router.get grouped example", "requireUserJwt", "readback marker"],
  mount_markers: ["mount grouped example"],
  test_markers: ["grouped example test"],
  openapi_markers: ["/me/grouped-example:", "operationId: groupedExample"],
  auth_model: "user_jwt",
  read_only: true,
  runtime_execution_allowed: true,
  provider_calls_allowed: false,
  external_writes_allowed: false,
  credential_payload_reads_allowed: false,
  secrets_included: false,
};
const groupedCallability = validateDirectRouteCallabilityContracts({
  root: process.cwd(),
  manifest: { callability_gate: { direct_route_contracts: [groupedContract] } },
  fileOverrides: {
    "migrations/grouped-example.sql": "grouped_tool_alpha grouped_tool_beta",
    "routes/grouped-example.js": "router.get grouped example requireUserJwt readback marker",
    "routes/grouped-index.js": "mount grouped example",
    "test-grouped-example.mjs": "grouped example test",
    "openapi-grouped-example.yaml": "/me/grouped-example:\noperationId: groupedExample",
  },
});
assert.equal(groupedCallability.ok, true, JSON.stringify(groupedCallability.findings));
assert.deepEqual(groupedCallability.covered_tool_keys.filter((key) => key.startsWith("grouped_tool_")), ["grouped_tool_alpha", "grouped_tool_beta"]);
assert.equal(groupedCallability.covered_contracts.filter((row) => row.contract_key === "grouped_route_example").length, 2);
const duplicateGroupedCallability = validateDirectRouteCallabilityContracts({
  root: process.cwd(),
  manifest: { callability_gate: { direct_route_contracts: [groupedContract, { ...groupedContract, contract_key: "grouped_route_duplicate", route_signature: "GET /me/grouped-example-duplicate", tool_keys: ["grouped_tool_beta"] }] } },
  fileOverrides: {
    "migrations/grouped-example.sql": "grouped_tool_alpha grouped_tool_beta",
    "routes/grouped-example.js": "router.get grouped example requireUserJwt readback marker",
    "routes/grouped-index.js": "mount grouped example",
    "test-grouped-example.mjs": "grouped example test",
    "openapi-grouped-example.yaml": "/me/grouped-example:\noperationId: groupedExample",
  },
});
assert.equal(duplicateGroupedCallability.ok, false);
assert(duplicateGroupedCallability.findings.some((row) => row.type === "direct_route_contract_tool_key_duplicate" && row.tool_key === "grouped_tool_beta"));

const internalPolicy = { exposure_class: "internal_registry", resource_key: null, descriptor_requirement: "not_applicable", operation_requirement: "not_applicable", archive_requirement: "not_applicable", version_requirement: "not_applicable" };
assert.deepEqual(evaluateResourceSurfacePolicy({ surfaceKind: "table", surfaceRef: "internal_registry_example", policy: internalPolicy }), []);
const resourcePolicy = { exposure_class: "resource_source", resource_key: "assets", descriptor_requirement: "required", operation_requirement: "not_applicable", archive_requirement: "resource_state", version_requirement: "resource_state" };
assert.deepEqual(evaluateResourceSurfacePolicy({ surfaceKind: "table", surfaceRef: "workspace_assets", policy: resourcePolicy, descriptor: { resource_key: "assets", operation_policy: { archive: "active", revisions: "readback_guarded" } }, coveredRelation: true }), []);
assert(evaluateResourceSurfacePolicy({ surfaceKind: "table", surfaceRef: "unclassified_table", policy: null }).some((row) => row.finding_type === "missing_resource_surface_policy"));
assert(evaluateResourceSurfacePolicy({ surfaceKind: "table", surfaceRef: "workspace_assets", policy: resourcePolicy, descriptor: { resource_key: "assets", operation_policy: { archive: "active", revisions: "not_yet_versioned" } }, coveredRelation: true }).some((row) => row.finding_type === "resource_version_strategy_unresolved"));
assert(evaluateResourceSurfacePolicy({ surfaceKind: "tool", surfaceRef: "example_resource_tool", policy: { ...internalPolicy, exposure_class: "resource_tool", resource_key: "assets", operation_requirement: "required" }, coveredTool: false }).some((row) => row.finding_type === "tool_not_linked_to_resource_operation"));

assert.equal(isRecoverySnapshotSurface({ surfaceRef: "collation_backup_demo", policy: { exposure_class: "recovery_snapshot" }, lifecycle: { usage_status: "backup_snapshot" } }), true);
assert.equal(isRecoverySnapshotSurface({ surfaceRef: "workspace_assets", policy: resourcePolicy, lifecycle: { usage_status: "runtime_canonical" } }), false);
assert.equal(requiresScopedPrimaryKey({ surfaceRef: "collation_backup_demo", policy: { exposure_class: "recovery_snapshot" }, lifecycle: { usage_status: "backup_snapshot" }, hasScope: 1, hasPrimaryKey: 0 }), false);
assert.equal(requiresScopedPrimaryKey({ surfaceRef: "workspace_assets", policy: resourcePolicy, lifecycle: { usage_status: "runtime_canonical" }, hasScope: 1, hasPrimaryKey: 0 }), true);
assert.equal(shouldResolvePriorCoverageFindings({ status: "complete", findingsTotal: 0 }), true);
assert.equal(shouldResolvePriorCoverageFindings({ status: "debt_detected", findingsTotal: 1 }), false);
assert.equal(shouldResolvePriorCoverageFindings({ status: "complete", findingsTotal: 1 }), false);

const output = execFileSync(process.execPath, ["scripts/resource-api-coverage-audit.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const result = JSON.parse(output.trim());
assert.equal(result.ok, true);
assert(result.resources >= 5);
assert(result.route_operations >= 30);
console.log("resource API coverage gate tests passed");
