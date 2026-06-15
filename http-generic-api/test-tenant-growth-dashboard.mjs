import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import {
  normalizeDashboardPreferences,
  resolveProductTabKeys,
  buildDashboardCards,
  _testingTenantGrowthDashboard,
} from "./tenantGrowthDashboardService.js";

const read = (path) => readFileSync(path, "utf8");

const normalized = normalizeDashboardPreferences({
  active_container_key: "workspace:one",
  active_tab_key: "tenant_today",
  pinned_tabs: ["tenant_sales_bookings", "tenant_sales_bookings", ""],
  hidden_tabs: ["tenant_campaigns"],
  preferred_date_range: "last_7_days",
  saved_filters: { channel: "organic" },
  dashboard_density: "compact",
  language: "ar",
  currency: "EGP",
  timezone: "Africa/Cairo",
});
assert.deepEqual(normalized.pinned_tabs, ["tenant_sales_bookings"]);
assert.deepEqual(normalized.hidden_tabs, ["tenant_campaigns"]);
assert.equal(normalized.dashboard_density, "compact");
assert.equal(normalized.preferred_date_range, "last_7_days");
assert.equal(normalized.timezone, "Africa/Cairo");

const fallbackPreferences = normalizeDashboardPreferences({ dashboard_density: "unsupported" });
assert.equal(fallbackPreferences.dashboard_density, "comfortable");
assert.equal(fallbackPreferences.preferred_date_range, "last_30_days");
assert.deepEqual(fallbackPreferences.saved_filters, {});

const travelTabs = resolveProductTabKeys({
  businessContext: { business_type_key: "destination_or_travel_business" },
  profileRows: [
    { profile_key: "travel", business_type_key: "destination_or_travel_business", tab_key: "tenant_today", priority_order: 1 },
    { profile_key: "travel", business_type_key: "destination_or_travel_business", tab_key: "tenant_sales_bookings", priority_order: 10 },
    { profile_key: "travel", business_type_key: "destination_or_travel_business", tab_key: "tenant_customers_leads", priority_order: 20 },
    { profile_key: "travel", business_type_key: "destination_or_travel_business", tab_key: "tenant_campaigns", priority_order: 30 },
  ],
  preferences: normalized,
});
assert.equal(travelTabs[0], "tenant_sales_bookings", "pinned tabs must lead navigation");
assert.equal(travelTabs.includes("tenant_today"), true);
assert.equal(travelTabs.includes("tenant_customers_leads"), true);
assert.equal(travelTabs.includes("tenant_campaigns"), false, "hidden tabs must stay hidden");
assert.ok(travelTabs.length <= 12, "mobile navigation must remain bounded");

const cards = buildDashboardCards({
  businessContext: { brand: { brand_core_ready: true } },
  operationalSummary: {
    summary: { attention_count: 1 },
    tab_badges: {
      connectors: { active: 2, pending: 0, error: 0 },
      tasks: { open: 4, blocked: 0 },
      agents: { active: 3 },
      skills: { active_grants: 8 },
    },
    freshness_status: "fresh",
  },
  dashboardManifest: { tiles: [] },
  metrics: [],
  actions: [],
  activeTab: "tenant_today",
});
assert.ok(cards.length >= 5);
assert.equal(cards[0].card_type, "score");
assert.equal(cards[0].metric_key, "dashboard_health_score");
assert.equal(cards.every((card) => card.data_status?.source_scope === "tenant_authorized"), true);
assert.equal(cards.every((card) => typeof card.interpretation === "string"), true);

const emptyIntegrationCard = buildDashboardCards({
  businessContext: { brand: { brand_core_ready: false } },
  operationalSummary: {
    summary: {},
    tab_badges: { connectors: {}, tasks: {}, agents: {}, skills: {} },
    freshness_status: "unknown",
  },
  dashboardManifest: { tiles: [] },
  metrics: [], actions: [], activeTab: "tenant_today",
}).find((card) => card.card_id === "active_integrations");
assert.equal(emptyIntegrationCard.status, "not_connected");
assert.ok(emptyIntegrationCard.empty_state?.steps?.length >= 3);
assert.equal(emptyIntegrationCard.value, 0);
assert.match(emptyIntegrationCard.interpretation, /Connect at least one business data source/);

const brandIssue = _testingTenantGrowthDashboard.chooseTopIssue({
  businessContext: { brand: { brand_core_ready: false } },
  operationalSummary: { tab_badges: {} },
});
assert.equal(brandIssue.code, "brand_core_incomplete");
assert.equal(brandIssue.impact, "high");

const blockedIssue = _testingTenantGrowthDashboard.chooseTopIssue({
  businessContext: { brand: { brand_core_ready: true } },
  operationalSummary: { tab_badges: { tasks: { blocked: 2 } } },
});
assert.equal(blockedIssue.code, "blocked_growth_tasks");

const routeSource = read("routes/tenantGrowthDashboardRoutes.js");
const overlaySource = read("routes/tenantActivationOverlayRoutes.js");
const indexSource = read("routes/index.js");
const migration = read("migrations/20260615_tenant_growth_dashboard_product.sql");
const responseService = read("activationHardResponseService.js");
const openapiText = read("openapi.tenant-gpt.auth.yaml");
const openapi = YAML.parse(openapiText);
const primaryOpenapi = YAML.parse(read("openapi.yaml"));

function resolveLocalRef(document, ref) {
  assert.match(ref, /^#\//, `Only local refs are supported in this contract test: ${ref}`);
  return ref.slice(2).split("/").reduce((value, segment) => value?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")], document);
}

function assertLocalRefsResolve(document, value) {
  if (Array.isArray(value)) {
    for (const item of value) assertLocalRefsResolve(document, item);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) {
    assert.ok(resolveLocalRef(document, value.$ref), `Unresolved OpenAPI ref: ${value.$ref}`);
  }
  for (const child of Object.values(value)) assertLocalRefsResolve(document, child);
}

assert.match(routeSource, /req\.auth\.tenant_id/);
assert.match(routeSource, /req\.auth\.user_id/);
assert.doesNotMatch(routeSource, /req\.body\?\.tenant_id/);
assert.doesNotMatch(routeSource, /req\.body\?\.user_id/);
assert.match(routeSource, /tenant_user_jwt_required/);
assert.match(routeSource, /recommendations\/.*feedback/);

assert.match(overlaySource, /req\.auth\?\.mode !== "user_jwt"/);
assert.match(overlaySource, /product_guidance/);
assert.match(overlaySource, /markActivationRunPrepared/);
assert.match(overlaySource, /markActivationRunDelivered/);
assert.match(overlaySource, /max_response_chars/);
assert.ok(
  indexSource.indexOf("buildTenantActivationOverlayRoutes") < indexSource.indexOf("buildActivationRoutes(deps)"),
  "tenant overlay must mount before the generic activation router"
);

for (const path of [
  "/tenant/dashboard",
  "/tenant/dashboard/tabs/{tabKey}",
  "/tenant/dashboard/preferences",
  "/tenant/dashboard/digest",
  "/tenant/dashboard/actions/{actionRefKey}/preview",
  "/tenant/dashboard/recommendations/{recommendationId}/feedback",
]) {
  assert.ok(openapi.paths[path], `OpenAPI path missing: ${path}`);
}
assert.equal(openapi.openapi, "3.1.0");
assert.equal(openapi.paths["/tenant/dashboard"].get.operationId, "getTenantGrowthDashboard");
assert.equal(openapi.paths["/tenant/dashboard/preferences"].put["x-openai-isConsequential"], true);
assert.equal(openapi.paths["/tenant/dashboard/recommendations/{recommendationId}/feedback"].post.responses["201"] !== undefined, true);
assert.ok(openapi.components.schemas.GrowthDashboardResponse);
assert.ok(openapi.components.schemas.GrowthDashboardCard);
assert.ok(openapi.components.schemas.GrowthDashboardPreferences);

assert.match(responseService, /navigationOnlyTabManifest/);
assert.match(responseService, /project_active_container_navigation_and_container_index/);
assert.match(responseService, /non_active_containers_are_indexed_not_expanded/);

assert.match(migration, /tenant_dynamic_dashboard_preferences/);
assert.match(migration, /tenant_growth_recommendation_events/);
assert.match(migration, /growth_dashboard_metric_registry/);
assert.match(migration, /growth_dashboard_instruction_registry/);
assert.match(migration, /tenant_today/);
assert.match(migration, /travel_package_optimization/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i, "migration must remain additive");

console.log("tenant growth dashboard tests passed");
