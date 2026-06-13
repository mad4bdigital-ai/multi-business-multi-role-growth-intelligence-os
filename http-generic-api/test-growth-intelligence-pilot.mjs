import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runGrowthIntelligencePilot } from "./growthIntelligencePilot.js";

const result = runGrowthIntelligencePilot({
  tenant_id: "tenant-pilot-001",
  brand_key: "arab_cooling",
  brand_registry_rows: [{
    brand_key: "arab_cooling",
    normalized_brand_name: "Arab Cooling",
    business_type_key: "hvac_services",
    knowledge_profile_key: "hvac_profile",
    brand_core_required: "true",
    is_readable: "true",
    is_writable: "false",
  }],
  brand_core_registry_rows: [
    { brand_key: "arab_cooling", doc_key: "brand_profile", doc_id: "doc-1", status: "active" },
    { brand_key: "arab_cooling", doc_key: "seo_strategy", doc_id: "doc-2", status: "active" },
  ],
  activity_type_registry_rows: [{
    business_activity_type_key: "hvac_services",
    activity_type_name: "HVAC Services",
    compatible_engines: "brand_intelligence|seo_intelligence|execution_intelligence",
    brand_core_required: "required",
    status: "active",
  }],
  evidence: [
    { source: "brand_core", summary: "Brand serves residential and commercial cooling demand." },
    { source: "seo_inventory", summary: "Service intent landing-page coverage is incomplete." },
  ],
});

assert.equal(result.ok, true);
assert.equal(result.workflow.status, "analysis_complete_no_execution");
assert.equal(result.workflow.stages.length, 10);
assert.equal(result.workflow.stages.find((stage) => stage.stage === "brand_core_resolution").status, "pass");
assert.equal(result.workflow.stages.find((stage) => stage.stage === "prompt_router").status, "planned");
assert.equal(result.workflow.stages.find((stage) => stage.stage === "governed_tool_dispatch").status, "not_executed");
assert.equal(result.report.schema_version, "1.0.0");
assert.equal(result.report.brand_context.brandCoreStatus, "ready");
assert.equal(result.report.activity_intelligence.businessActivityTypeKey, "hvac_services");
assert(result.report.growth_opportunities.length >= 3);
assert(result.report.prioritized_backlog.every((action) => action.execution_mode === "dry_run"));
assert(result.report.approval_queue_view.every((action) => action.approval_state === "held"));
assert.equal(result.readback.provider_writes, 0);
assert.equal(result.readback.external_sends, 0);
assert.equal(result.readback.secrets_included, false);
assert.equal(result.readback.all_stages_passed, false);
assert.equal(result.readback.executed_stage_count, 4);
assert.equal(result.readback.planned_stage_count, 4);
assert.equal(result.readback.not_executed_stage_count, 2);
assert.equal(result.readback.approval_hold_count, 0);
assert.equal(result.readback.approval_queue_item_count, result.report.approval_queue_view.length);
assert.match(result.markdown_report, /No provider writes, external sends, or secrets were used/);

assert.throws(
  () => runGrowthIntelligencePilot({ tenant_id: "tenant-pilot-001", brand_key: "missing", brand_registry_rows: [] }),
  /could not be resolved/
);

const routes = readFileSync("routes/growthIntelligenceRoutes.js", "utf8");
assert.match(routes, /requireBackendApiKey/);
assert.match(routes, /growth-intelligence\/pilot/);
assert.doesNotMatch(routes, /\bfetch\s*\(|http-execute|connectorExecutor|provider_operation/);
assert.match(routes, /provider_writes:\s*0/);
assert.match(routes, /external_sends:\s*0/);

const tenantGptSchema = readFileSync("openapi.tenant-gpt.auth.yaml", "utf8");
assert.doesNotMatch(tenantGptSchema, /growth-intelligence\/pilot/);
const canonicalOpenApi = readFileSync("openapi.yaml", "utf8");
assert.match(canonicalOpenApi, /operationId: runGrowthIntelligencePilot/);

console.log("growth intelligence pilot tests passed");
