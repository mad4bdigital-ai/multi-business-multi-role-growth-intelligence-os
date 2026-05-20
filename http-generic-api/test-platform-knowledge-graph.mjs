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

const service = readFileSync("services/platformKnowledgeGraphResolver.js", "utf8");
const routes = readFileSync("routes/platformGraphRoutes.js", "utf8");
const index = readFileSync("routes/index.js", "utf8");
const governance = readFileSync("routes/governanceRoutes.js", "utf8");
const migration = readFileSync("migrations/105_sprint62p_platform_knowledge_graph_runtime.sql", "utf8");
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

assert("graph service forbids raw secret terms and avoids raw secret columns",
  service.includes("FORBIDDEN_SECRET_TERMS") &&
  service.includes("api_key_value") &&
  service.includes("oauth_client_secret") &&
  !service.includes("SELECT api_key_value") &&
  !service.includes("SELECT oauth_client_secret") &&
  !service.includes("SELECT password_hash"));

assert("graph service uses MariaDB-compatible JSON writes",
  !service.includes("CAST(? AS JSON)") &&
  service.includes("metadata_json=VALUES(metadata_json)") &&
  service.includes("results_json=?"));

assert("routes expose admin-protected graph runtime endpoints",
  routes.includes("/platform/graph/project") &&
  routes.includes("/platform/graph/validate") &&
  routes.includes("/platform/graph/resolve-context") &&
  routes.includes("/platform/graph/node/:node_id") &&
  routes.includes("/platform/graph/neighborhood") &&
  routes.includes("/platform/graph/status") &&
  routes.includes("requireBackendApiKey") &&
  routes.includes("requireAdminPrincipal"));

assert("graph routes are registered",
  index.includes("buildPlatformGraphRoutes") &&
  index.includes("app.use(buildPlatformGraphRoutes"));

assert("governance diagnostic includes graph_context",
  governance.includes("resolvePlatformGraphContext") &&
  governance.includes("graph_context") &&
  governance.includes("authority_summary"));

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
