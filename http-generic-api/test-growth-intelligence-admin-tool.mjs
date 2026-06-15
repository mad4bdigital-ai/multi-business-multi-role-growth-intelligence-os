import assert from "node:assert/strict";

import {
  assertGrowthIntelligencePilotAdminSafety,
  runGrowthIntelligencePilotAdmin,
} from "./growthIntelligenceAdminTool.js";

const tenant = {
  tenant_id: "65f3f066-eefa-4625-9023-8318c858e94b",
  tenant_type: "brand",
  display_name: "Arab Cooling",
  status: "active",
};
const brand = {
  id: 6,
  brand_name: "Arab Cooling",
  normalized_brand_name: "Arab Cooling",
  target_key: "arab_cooling",
  base_url: "https://arabcooling.com/",
  brand_core_ready: "TRUE",
  write_allowed: "FALSE",
  status: "active",
  governance_readiness_status: null,
};
const core = [
  { brand_key: "arab_cooling", asset_key: "brand_core_profile", doc_id: "doc-1", status: "active" },
  { brand_key: "arab_cooling", asset_key: "seo_growth_starting_map", doc_id: "doc-2", status: "active" },
];
const activity = {
  business_activity_type_key: "business_and_industrial_products",
  activity_key: "business_and_industrial_products",
  business_type_key: "b2b_product_supplier",
  label: "Business & Industrial Products",
  parent_activity_type: null,
  default_knowledge_profile_key: "generic_brand_profile",
  supported_engine_categories: "Brand Intelligence|Content Engines|Marketing Engines|Report Engines",
  supported_route_keys: "content_generation; growth_strategy; website_audit",
  supported_workflows: "content_generation_workflow; brand_marketing_workflow; growth_strategy_workflow",
  brand_core_required: "TRUE",
  status: "active",
  active: "active",
  notes: "registry-backed activity",
};

function fakePool(overrides = {}) {
  const data = {
    tenant: Object.prototype.hasOwnProperty.call(overrides, "tenant") ? overrides.tenant : tenant,
    brand: Object.prototype.hasOwnProperty.call(overrides, "brand") ? overrides.brand : brand,
    core: Object.prototype.hasOwnProperty.call(overrides, "core") ? overrides.core : core,
    activity: Object.prototype.hasOwnProperty.call(overrides, "activity") ? overrides.activity : activity,
  };
  return {
    async query(sql) {
      if (sql.includes("FROM tenants")) return [[data.tenant].filter(Boolean)];
      if (sql.includes("FROM brands")) return [[data.brand].filter(Boolean)];
      if (sql.includes("FROM brand_core")) return [data.core || []];
      if (sql.includes("FROM business_activity_types")) return [[data.activity].filter(Boolean)];
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

assert.doesNotThrow(() => assertGrowthIntelligencePilotAdminSafety({ persistence_mode: "internal_registry" }));
assert.throws(
  () => assertGrowthIntelligencePilotAdminSafety({ persistence_mode: "none" }),
  (error) => error?.code === "growth_pilot_admin_persistence_mode_invalid"
);
assert.throws(
  () => assertGrowthIntelligencePilotAdminSafety({ apply: true }),
  (error) => error?.code === "growth_pilot_admin_execution_boundary_violation"
);
assert.throws(
  () => assertGrowthIntelligencePilotAdminSafety({ external_sends: 1 }),
  (error) => error?.code === "growth_pilot_admin_execution_boundary_violation"
);

let persistedPilot = null;
const result = await runGrowthIntelligencePilotAdmin({
  tenant_id: tenant.tenant_id,
  brand_key: "arab_cooling",
  business_activity_type_key: "business_and_industrial_products",
  persistence_mode: "internal_registry",
}, {
  pool: fakePool(),
  async persistPilot(pilot) {
    persistedPilot = pilot;
    return {
      persistence_mode: "internal_registry",
      report_id: pilot.report.report_id,
      workflow_run_id: "workflow-run-1",
      insight_count: pilot.report.growth_opportunities.length,
      action_count: pilot.report.prioritized_backlog.length,
      approval_holds: pilot.report.prioritized_backlog.map((item, index) => ({ hold_id: `hold-${index + 1}`, action_id: item.action_id })),
      provider_writes: 0,
      external_sends: 0,
      secrets_included: false,
    };
  },
  async readReport() {
    return {
      report: { report_id: persistedPilot.report.report_id },
      insights: persistedPilot.report.growth_opportunities,
      actions: persistedPilot.report.prioritized_backlog,
      readiness_assessments: [],
    };
  },
  async persistAssessment() {
    return {
      assessment_id: "assessment-1",
      assessment_status: "blocked",
      blocking_gap_count: 3,
      execution_allowed: false,
      provider_writes_allowed: false,
      external_sends_allowed: false,
      secrets_included: false,
    };
  },
});

assert.equal(result.ok, true);
assert.equal(result.tool, "growth_intelligence_pilot_run");
assert.equal(result.classification, "growth_intelligence_pilot_persisted_approval_pending");
assert.equal(result.brand_key, "arab_cooling");
assert.equal(result.business_activity_type_key, "business_and_industrial_products");
assert.equal(result.resolution.brand_core_asset_count, 2);
assert.equal(result.registry.approval_holds.length, 3);
assert.equal(result.readback.persisted_report_found, true);
assert.equal(result.readback.persisted_insight_count, 3);
assert.equal(result.readback.persisted_action_count, 3);
assert.equal(result.provider_writes, 0);
assert.equal(result.external_sends, 0);
assert.equal(result.mutations_executed, false);
assert.equal(result.secrets_included, false);
assert.equal(result.workflow.stages.find((stage) => stage.stage === "tenant_activation")?.status, "pass");
assert.equal(result.workflow.stages.find((stage) => stage.stage === "approval_hold")?.status, "pass");
assert.equal(result.workflow.stages.find((stage) => stage.stage === "prompt_router")?.status, "pass");
assert.equal(result.workflow.stages.find((stage) => stage.stage === "module_loader")?.status, "pass");
assert.equal(result.workflow.stages.find((stage) => stage.stage === "engine_compatibility")?.status, "pass");
assert.equal(result.workflow.stages.find((stage) => stage.stage === "governed_tool_dispatch")?.status, "pass");
assert.equal(result.workflow.stages.every((stage) => stage.status === "pass"), true);
assert.equal(result.readback.all_stages_passed, true);
assert.ok(result.report.evidence.every((item) => item.assumption === false));

await expectCode(
  runGrowthIntelligencePilotAdmin({ tenant_id: tenant.tenant_id, brand_key: "arab_cooling" }, {
    pool: fakePool({ tenant: null }),
  }),
  "growth_pilot_admin_tenant_not_found"
);
await expectCode(
  runGrowthIntelligencePilotAdmin({ tenant_id: tenant.tenant_id, brand_key: "arab_cooling" }, {
    pool: fakePool({ brand: { ...brand, brand_core_ready: "FALSE" } }),
  }),
  "growth_pilot_admin_brand_core_not_ready"
);
await expectCode(
  runGrowthIntelligencePilotAdmin({ tenant_id: tenant.tenant_id, brand_key: "arab_cooling" }, {
    pool: fakePool({ core: [] }),
  }),
  "growth_pilot_admin_brand_core_missing"
);
await expectCode(
  runGrowthIntelligencePilotAdmin({ tenant_id: tenant.tenant_id, brand_key: "arab_cooling" }, {
    pool: fakePool({ activity: null }),
  }),
  "growth_pilot_admin_activity_not_found"
);

console.log("growth intelligence admin tool tests passed");
