import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRemoteMcpCatalogFingerprint } from "../http-generic-api/remoteMcpScopeCatalog.js";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const inventory = JSON.parse(readFileSync(`${root}/http-generic-api/remote-mcp-write-scope-inventory.generated.json`, "utf8"));
const catalog = JSON.parse(readFileSync(`${root}/http-generic-api/remote-mcp-scope-catalog.generated.json`, "utf8"));

assert.equal(inventory.schema_version, 1);
assert.equal(inventory.generated_from, "git-index-and-runtime-catalog");
assert.equal(inventory.catalog_fingerprint, getRemoteMcpCatalogFingerprint(catalog));
assert.equal(inventory.db_catalog_fingerprint_match, true, "DB catalog fingerprint must match runtime catalog");
assert(inventory.db_catalog_fingerprints.includes(inventory.catalog_fingerprint));
assert(inventory.file_count > 0);
assert(inventory.route_count > 0);
assert(inventory.write_route_count > 0);
assert.equal(inventory.classified_write_route_count, inventory.write_route_count, "every write route must have an explicit classification");
assert.equal(inventory.unclassified_write_route_count, 0);
assert.equal(inventory.intentionally_unmapped_write_route_count, 612);
assert.equal(inventory.write_route_classifications.filter((route) => route.classification === "shadow_candidate").length, 38);
assert(inventory.write_route_classifications.every((route) => route.route_id));
assert.equal(new Set(inventory.write_route_classifications.map((route) => route.route_id)).size, inventory.write_route_count);
assert(inventory.write_route_classifications.filter((route) => route.classification === "intentionally_unmapped").every((route) => route.owner && route.reason && route.resource_candidate));
assert(inventory.sensitive_intentionally_unmapped_write_route_count > 0);
assert(inventory.write_route_classifications.every((route) => route.provider_mutation_allowed === false));
assert(inventory.write_route_classifications.every((route) => route.evidence?.static_only === true && route.evidence?.source_line > 0));
assert(inventory.write_route_classifications.every((route) => route.promotion_prerequisites?.includes("explicit_resource_operation_scope_binding")));
assert(inventory.write_route_classifications.every((route) => route.evidence_confidence?.authorizes === false));
assert(inventory.write_route_classifications.every((route) => route.promotion_status === "blocked"));
assert.equal(inventory.evidence_graph.node_counts.routes, inventory.write_route_count);
assert.equal(inventory.evidence_graph.edge_counts.route_to_handler_file, inventory.write_route_count);
assert.equal(inventory.evidence_graph.static_only, true);
assert.equal(inventory.evidence_graph.execution_edges_are_non_authorizing, true);
assert(inventory.write_route_classifications.every((route) => route.mapping_status === "blocked" || route.mapping_status === "blocked_until_explicit_binding"));
assert(inventory.migration_count > 0);
assert(inventory.registry_evidence_count > 0);
assert.equal(inventory.write_scope_count, 6);
assert.equal(inventory.bound_write_scope_count, 0);
assert.equal(inventory.readiness.inventory_ready, false, "unbound shadow write scopes must remain blocked");
assert.equal(inventory.readiness.write_activation_allowed, false);
assert.equal(inventory.readiness.provider_mutation_allowed, false);
assert.equal(inventory.readiness.production_allowed, false);
assert.equal(inventory.readiness.migration_apply_allowed, false);
assert.equal(inventory.readiness.secrets_included, false);

const routePaths = new Set(inventory.route_inventory.map((route) => route.path));
for (const expectedPath of ["/github", "/cloudflare", "/hostinger"]) {
  assert(routePaths.has(expectedPath), `expected provider route missing from inventory: ${expectedPath}`);
}
assert(inventory.route_inventory.some((route) => route.path.includes("assets")), "asset route surface missing");
assert(inventory.route_inventory.some((route) => route.path.includes("approval") || route.path.includes("grant-request")), "approval route surface missing");
assert(inventory.registry_evidence.some((entry) => entry.registries.includes("platform_resource_authority_bindings")));
for (const scope of inventory.write_scopes) {
  assert.equal(scope.default_request, false, `${scope.scope_key} must not be a default request`);
  assert.equal(scope.status, "shadow", `${scope.scope_key} must remain shadow`);
  assert.equal(scope.tool_bound, false, `${scope.scope_key} must not be exposed before binding`);
}

console.log(`remote MCP write-scope inventory self-test passed: ${inventory.write_scope_count} shadow scopes, ${inventory.write_route_count} write routes observed`);
