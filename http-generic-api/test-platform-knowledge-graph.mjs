import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
function assert(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

function countOccurrences(text, needle) {
  return String(text || "").split(needle).length - 1;
}

const service = readFileSync("services/platformKnowledgeGraphResolver.js", "utf8");
const routes = readFileSync("routes/platformGraphRoutes.js", "utf8");
const memoryService = readFileSync("services/platformGraphMemoryResolver.js", "utf8");
const index = readFileSync("routes/index.js", "utf8");
const governance = readFileSync("routes/governanceRoutes.js", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");
const migration = readFileSync("migrations/105_sprint62p_platform_knowledge_graph_runtime.sql", "utf8");
const rankRulesMigration = readFileSync("migrations/108_sprint62s_platform_graph_memory_rank_rules.sql", "utf8");
const parentOpenapi = readFileSync("openapi.yaml", "utf8");
const childOpenapi = readFileSync("schemas/http-generic-api/http-generic-api.yaml", "utf8");

assert("migration defines canonical graph tables",
  migration.includes("platform_graph_taxonomy") &&
  migration.includes("platform_graph_nodes") &&
  migration.includes("platform_graph_edges") &&
  migration.includes("platform_graph_projection_runs") &&
  migration.includes("platform_graph_validation_runs") &&
  migration.includes("platform_graph_query_log"));

assert("migration seeds taxonomy dimensions",
  migration.includes("node_type.tenant") &&
  migration.includes("edge_type.attached_to") &&
  migration.includes("scope_type.tenant") &&
  migration.includes("sensitivity.secret_reference") &&
  migration.includes("runtime_role.authority"));

assert("graph service projects all first-slice source tables",
  [
    "tenants",
    "users",
    "memberships",
    "json_assets",
    "json_asset_subject_links",
    "local_manager_device_link_sessions",
    "local_app_releases",
    "actions",
    "endpoints",
    "task_routes",
    "workflows",
    "business_type_profiles",
    "platform_contract_surfaces",
    "platform_contract_nodes",
    "platform_contract_relationships",
    "execution_log",
  ].every((table) => service.includes(table)));

assert("graph service has projection, validation, neighborhood, and resolver exports",
  service.includes("export async function projectPlatformKnowledgeGraph") &&
  service.includes("export async function validatePlatformKnowledgeGraph") &&
  service.includes("export async function getGraphNeighborhood") &&
  service.includes("export async function resolvePlatformGraphContext") &&
  service.includes("export async function logGraphQuery"));

assert("graph projection downgrades runtime-enforced edges with inactive endpoints",
  service.includes("downgraded_runtime_enforced_edges_with_inactive_nodes") &&
  service.includes("runtime_enforced_edge_requires_active_source_and_target") &&
  service.includes("source_lifecycle_status") &&
  service.includes("target_lifecycle_status"));

assert("graph service forbids raw secret terms and avoids raw secret columns",
  service.includes("FORBIDDEN_SECRET_TERMS") &&
  service.includes("api_key_value") &&
  service.includes("oauth_client_secret") &&
  !service.includes("SELECT api_key_value") &&
  !service.includes("SELECT oauth_client_secret") &&
  !service.includes("SELECT password_hash"));

assert("graph memory service resolves scoped assets through graph attachments",
  memoryService.includes("export async function resolvePlatformGraphMemory") &&
  memoryService.includes("export async function resolveGraphRelevantAssets") &&
  memoryService.includes("resolvePlatformGraphContext") &&
  memoryService.includes("platform_graph_edges") &&
  memoryService.includes("json_asset_subject_links") &&
  memoryService.includes("payload_summary") &&
  memoryService.includes("summary_only") &&
  memoryService.includes("FORBIDDEN_SECRET_TERMS") &&
  memoryService.includes("raw_secret_values_included: false") &&
  memoryService.includes("secrets_included: false"));

assert("graph memory ranking can be tuned from DB with code fallback",
  memoryService.includes("DEFAULT_RANK_WEIGHTS") &&
  memoryService.includes("loadGraphMemoryRankWeights") &&
  memoryService.includes("platform_graph_memory_rank_rules") &&
  memoryService.includes("fallback_code_defaults") &&
  memoryService.includes("db_rank_rules") &&
  memoryService.includes("rank_weights_source") &&
  memoryService.includes("rank_weights") &&
  memoryService.includes("direct_asset_match") &&
  memoryService.includes("attached_scope_match"));

assert("rank rules migration seeds graph memory ranking weights",
  rankRulesMigration.includes("CREATE TABLE IF NOT EXISTS `platform_graph_memory_rank_rules`") &&
  rankRulesMigration.includes("direct_asset_match") &&
  rankRulesMigration.includes("asset_graph_node_match") &&
  rankRulesMigration.includes("attached_scope_match") &&
  rankRulesMigration.includes("validated_asset") &&
  rankRulesMigration.includes("knowledge_asset_type") &&
  rankRulesMigration.includes("ON DUPLICATE KEY UPDATE"));

assert("graph service uses MariaDB-compatible JSON writes",
  !service.includes("CAST(? AS JSON)") &&
  service.includes("metadata_json=VALUES(metadata_json)") &&
  service.includes("results_json=?"));

assert("routes expose admin-protected graph runtime endpoints",
  routes.includes("/platform/graph/project") &&
  routes.includes("/platform/graph/validate") &&
  routes.includes("/platform/graph/resolve-context") &&
  routes.includes("/platform/graph/memory") &&
  routes.includes("/platform/graph/node/:node_id") &&
  routes.includes("/platform/graph/neighborhood") &&
  routes.includes("/platform/graph/status") &&
  routes.includes("requireBackendApiKey") &&
  routes.includes("requireAdminPrincipal"));

assert("graph memory route is registered exactly once",
  countOccurrences(routes, "router.post(\"/platform/graph/memory\"") === 1 &&
  countOccurrences(routes, "platform_graph_memory_failed") === 1);

assert("graph routes are registered",
  index.includes("buildPlatformGraphRoutes") &&
  index.includes("app.use(buildPlatformGraphRoutes"));

assert("governance diagnostic includes graph_context, graph_memory, and graph_relevant_assets compatibility alias",
  governance.includes("resolvePlatformGraphContext") &&
  governance.includes("resolvePlatformGraphMemory") &&
  governance.includes("graph_context") &&
  governance.includes("graph_memory") &&
  governance.includes("graph_relevant_assets") &&
  governance.includes("authority_summary"));

assert("release readiness includes non-blocking graph memory diagnostics",
  releaseReadiness.includes("resolvePlatformGraphMemory") &&
  releaseReadiness.includes("checkGraphMemoryDiagnostics") &&
  releaseReadiness.includes("graph_memory_diagnostics") &&
  releaseReadiness.includes("graph_memory_resolved") &&
  releaseReadiness.includes("graph_memory_asset_count") &&
  releaseReadiness.includes("release_readiness") &&
  releaseReadiness.includes("secrets_included: false"));

assert("parent and child OpenAPI expose platform graph tag, schemas, and paths",
  [parentOpenapi, childOpenapi].every((schema) =>
    schema.includes("name: platform-graph") &&
    schema.includes("PlatformGraphNode:") &&
    schema.includes("PlatformGraphEdge:") &&
    schema.includes("PlatformGraphContext:") &&
    schema.includes("/platform/graph/project:") &&
    schema.includes("/platform/graph/validate:") &&
    schema.includes("/platform/graph/resolve-context:") &&
    schema.includes("/platform/graph/memory:") &&
    schema.includes("PlatformGraphMemoryResponse:") &&
    schema.includes("/platform/graph/node/{node_id}:") &&
    schema.includes("/platform/graph/neighborhood:") &&
    schema.includes("/platform/graph/status:")
  ));

assert("parent and child OpenAPI define graph memory path and schema exactly once",
  [parentOpenapi, childOpenapi].every((schema) =>
    countOccurrences(schema, "/platform/graph/memory:") === 1 &&
    countOccurrences(schema, "PlatformGraphMemoryResponse:") === 1
  ));

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
