import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  RESOURCE_DESCRIPTORS,
  decodePageToken,
  descriptor,
  encodePageToken,
} from "./src/domain/resourceApi/resourceCatalog.js";
import { _testingResourceCoverageService } from "./resourceApiCoverageService.js";

const manifest = JSON.parse(readFileSync("resource-api-coverage.manifest.json", "utf8"));
const routeSource = readFileSync("routes/resourceApiRoutes.js", "utf8");
const repositorySource = readFileSync("src/infrastructure/resourceApi/resourceRepository.js", "utf8");
const migration = readFileSync("migrations/1023_sprint69_resource_api_coverage_gate.sql", "utf8");
const spec = readFileSync("../specs/001-resource-api-coverage/spec.md", "utf8");

assert.equal(manifest.policy_key, "platform_resource_api_coverage_policy_v1");
assert.deepEqual(manifest.required_operation_classes, ["list", "get", "search", "permissions", "changes", "revisions", "readback"]);
for (const key of ["sessions", "executions", "assets", "approvals", "resource_api_governance"]) {
  assert(manifest.resources.some((resource) => resource.resource_key === key), `missing ${key} descriptor`);
}
for (const resource of manifest.resources) {
  for (const operation of manifest.required_operation_classes) {
    assert(resource.operations[operation], `${resource.resource_key} missing ${operation}`);
  }
}
assert(routeSource.includes('router.get("/admin/resource-types"'));
assert(routeSource.includes('router.get("/admin/resource-coverage/audit"'));
assert(routeSource.includes('router.get("/me/workspaces/:tenant_id/resources"'));
assert(routeSource.includes('router.get("/gpt/sessions/:id/turns"'));
assert(repositorySource.includes("content_preview"));
assert(!routeSource.includes("SELECT "));
assert.equal(descriptor("sessions").table, "customer_sessions");
const token = encodePageToken(
  { session_id: "s1", created_at: "2026-01-01" },
  RESOURCE_DESCRIPTORS.sessions
);
assert.equal(decodePageToken(token).id, "s1");
assert(_testingResourceCoverageService.BACKUP_TABLE_RE.test("repair_backup_demo"));
assert(migration.includes("platform_resource_type_registry"));
assert(migration.includes("platform_resource_operation_registry"));
assert(migration.includes("platform_resource_coverage_findings"));
assert(migration.includes("v_platform_resource_api_coverage"));
assert(spec.includes("No feature without resource API coverage"));

const output = execFileSync(process.execPath, ["scripts/resource-api-coverage-audit.mjs"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const result = JSON.parse(output.trim());
assert.equal(result.ok, true);
assert(result.resources >= 5);
assert(result.route_operations >= 30);

console.log("resource API coverage gate tests passed");
