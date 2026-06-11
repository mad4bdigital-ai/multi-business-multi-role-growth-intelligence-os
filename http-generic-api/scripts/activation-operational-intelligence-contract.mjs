import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

const [
  route,
  hardEvidence,
  dynamicEvidence,
  dynamicTabs,
  operationalIntelligence,
  dashboardMigration,
  tabsMigration,
  autoDiscoveryMigration,
  intelligenceMigration,
  intelligenceSeed,
] = await Promise.all([
  read("routes/activationRoutes.js"),
  read("activationHardEvidence.js"),
  read("activationDynamicEvidence.js"),
  read("activationDynamicTabsEvidence.js"),
  read("activationOperationalIntelligenceEvidence.js"),
  read("migrations/20260611_activation_operational_dashboard.sql"),
  read("migrations/20260611_activation_dynamic_tabs.sql"),
  read("migrations/20260611_activation_dynamic_tabs_autodiscovery.sql"),
  read("migrations/20260611_activation_operational_intelligence.sql"),
  read("migrations/20260611_activation_operational_intelligence_seed.sql"),
]);

assert.match(route, /buildActivationDynamicTabsEvidence/, "hard activation route must import dynamic tabs builder");
assert.match(route, /buildActivationOperationalDashboardEvidence/, "hard activation route must import operational dashboard builder");
assert.match(route, /buildActivationOperationalIntelligenceEvidence/, "hard activation route must import operational intelligence builder");
assert.match(route, /dynamic_tabs:\s*await buildActivationDynamicTabsEvidence/, "hard activation response must expose dynamic_tabs");
assert.match(route, /operational_intelligence:\s*await buildActivationOperationalIntelligenceEvidence/, "hard activation response must expose operational_intelligence");
assert.match(route, /operational_dashboard:\s*await buildActivationOperationalDashboardEvidence/, "hard activation response must expose operational_dashboard");

for (const reasonCode of [
  "degraded_missing_repo_canonical_evidence",
  "degraded_missing_dynamic_tool_catalog_evidence",
]) {
  assert.match(hardEvidence, new RegExp(reasonCode), `hard activation evidence must include ${reasonCode}`);
}

assert.match(dynamicEvidence, /buildRepoCanonicalRuntimeEvidence/, "repo canonical readback builder must exist");
assert.match(dynamicEvidence, /buildDynamicToolCatalogEvidence/, "dynamic tool catalog builder must exist");
assert.match(dynamicEvidence, /buildActivationOperationalDashboardEvidence/, "operational dashboard builder must exist");

assert.match(dynamicTabs, /buildActivationDynamicTabsEvidence/, "dynamic tabs builder must exist");
assert.match(dynamicTabs, /activation_dynamic_tab_discovery_rule_registry/, "dynamic tabs must load discovery rules");
assert.match(dynamicTabs, /activation_authorized_surface_registry/, "dynamic tabs must auto-discover authorized surfaces");
assert.match(dynamicTabs, /authorized_surfaces_auto_discover_into_tabs/, "dynamic tabs policy must expose auto-discovery");
assert.match(dynamicTabs, /do_not_return_secret_values/, "dynamic tabs must declare secret-safe policy");

assert.match(operationalIntelligence, /buildActivationOperationalIntelligenceEvidence/, "operational intelligence builder must exist");
assert.match(operationalIntelligence, /attention_queue/, "operational intelligence must expose attention queue");
assert.match(operationalIntelligence, /tab_badges/, "operational intelligence must expose tab badges");
assert.match(operationalIntelligence, /section_actions/, "operational intelligence must expose section actions");
assert.match(operationalIntelligence, /fallback_negotiation/, "operational intelligence must expose fallback negotiation");
assert.match(operationalIntelligence, /container_graph/, "operational intelligence must expose container graph");
assert.match(operationalIntelligence, /secret_values_never_returned/, "operational intelligence must declare secret-safe policy");

for (const [name, content, requiredTables] of [
  ["dashboard", dashboardMigration, ["activation_operational_tile_registry", "activation_callback_registry", "activation_auth_source_router"]],
  ["tabs", tabsMigration, ["activation_dynamic_tab_registry", "activation_dynamic_tab_section_registry"]],
  ["autodiscovery", autoDiscoveryMigration, ["activation_dynamic_tab_discovery_rule_registry"]],
  ["intelligence", intelligenceMigration, ["activation_section_action_registry", "activation_attention_rule_registry", "activation_freshness_policy_registry", "activation_signal_subscription_registry", "activation_connector_pack_registry"]],
  ["intelligence_seed", intelligenceSeed, ["activation_section_action_registry", "activation_freshness_policy_registry", "activation_signal_subscription_registry", "activation_connector_pack_component_registry"]],
]) {
  for (const table of requiredTables) {
    assert.match(content, new RegExp(table), `${name} migration must include ${table}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  test: "activation_operational_intelligence_contract",
  checked: {
    route: true,
    hard_evidence: true,
    dynamic_evidence: true,
    dynamic_tabs: true,
    operational_intelligence: true,
    migrations: 5,
  },
  secrets_included: false,
}));
