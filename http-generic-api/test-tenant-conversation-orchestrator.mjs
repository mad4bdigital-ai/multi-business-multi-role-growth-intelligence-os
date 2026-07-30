import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildConnectionDisposition,
  buildQuestionnaireFromSchema,
  classifyBrandCoreAsset,
  classifyConnectionEvidence,
  mergeOperationalMemory,
  tenantConversationOrchestrationPreview,
} from "./tenantConversationOrchestrator.js";

assert.equal(classifyConnectionEvidence({ status: "active", validation_status: "metadata_only" }), "historical_snapshot");
assert.equal(classifyConnectionEvidence({ status: "active", validation_status: "validated", last_validated_at: new Date().toISOString() }), "indexed_and_fresh");

const questionnaire = buildQuestionnaireFromSchema({
  type: "object",
  required: ["title", "language"],
  properties: {
    title: { type: "string", title: "Title" },
    language: { type: "string", enum: ["ar", "en"] },
  },
}, { title: "Fixture title" }, "indexed_and_fresh");
assert.equal(questionnaire.missing_field_count, 1);
assert.equal(questionnaire.questions[0].field_key, "language");
assert.equal(questionnaire.execution_eligible_evidence, true);

const cleanup = buildConnectionDisposition({
  status: "active",
  validation_status: "validated",
  credential_material_present: true,
  resource_binding_count: 0,
});
assert.equal(cleanup.recommendation, "repair_binding");
assert.equal(cleanup.cancellation_allowed, false);

const asset = classifyBrandCoreAsset({
  asset_type: "CPT Configuration Snapshot",
  asset_key: "fixture-cpt",
  status: "active",
  validation_status: "pending",
});
assert.equal(asset.asset_class, "cpt_snapshot");
assert.equal(asset.action_eligible, false);
assert.equal(asset.evidence_class, "historical_snapshot");

const memory = mergeOperationalMemory({ selected_brand: "brand-alpha" }, { selected_brand: "brand-beta", current_goal: "create draft" });
assert.equal(memory.selected_brand, "brand-beta");
assert.equal(memory.current_goal, "create draft");

const brandContext = {
  ok: true,
  principal: { tenant_id: "tenant-generic", user_id: "user-generic" },
  brand: { brand_key: "brand-generic", target_key: "brand-generic", brand_name: "Generic Brand" },
  workspaces: [{ workspace_id: "workspace-generic", workspace_key: "workspace-generic", bootstrap_status: "ready" }],
  cms_sites: [{ site_id: "site-generic", app_key: "cms-generic", normalized_domain: "generic.example", canonical_target_key: "brand-generic" }],
  connections: [{ connection_id: "connection-generic", app_key: "cms-generic", status: "active", validation_status: "validated", last_validated_at: new Date().toISOString() }],
  connection_state: { connectivity_status: "not_checked", live_verified_at: null },
  cms_access_grants: [{ site_id: "site-generic", connection_id: "connection-generic", draft_allowed: 1, publish_allowed: 0 }],
  brand_core_assets: [],
};
const capabilityPreview = {
  ok: true,
  ready: true,
  status: "ready",
  capability: { capability_key: "content.draft.create", resource_type: "cms_site", operation_key: "draft", requires_approval: false, requires_readback: true },
  projection: { tool_name: "capability_content_draft_create", input_schema_json: JSON.stringify({ type: "object", required: ["title"], properties: { title: { type: "string" } } }) },
  connection: { connection_id: "connection-generic", resource_binding_verified: true },
  resource_binding: { status: "resource_connection_bound", selection_reason: "single_resource_bound_connection" },
  checks: { connection_resource_binding_ready: true },
  authority: { resource_authority_present: true },
};
const orchestrated = await tenantConversationOrchestrationPreview({
  intent: "Create one content draft",
  brand_ref: "Generic Brand",
  capability_key: "content.draft.create",
  provided_inputs: { title: "Draft title" },
}, {
  auth: { tenant_id: "tenant-generic", user_id: "user-generic" },
  brandWorkspaceContextResolve: async () => brandContext,
  tenantEffectiveCapabilityPreview: async (args) => {
    assert.equal(args.resource_ref, "site-generic");
    return capabilityPreview;
  },
  pool: {},
});
assert.equal(orchestrated.ok, true);
assert.equal(orchestrated.memory_patch.selected_brand, "brand-generic");
assert.equal(orchestrated.memory_patch.publish_authority, "draft_only");
assert.equal(orchestrated.action_preview.execution_allowed, false);
assert.equal(orchestrated.verified_executable_resource.resource_ref, "site-generic");

const source = fs.readFileSync(new URL("./tenantConversationOrchestrator.js", import.meta.url), "utf8").toLowerCase();
assert.equal(source.includes("allroyalegypt"), false, "runtime implementation must be Tenant/Brand agnostic");
assert.match(source, /resolve_context/);
assert.match(source, /live_status/);
assert.match(source, /capability_preview/);
assert.match(source, /missing_inputs/);
assert.match(source, /action_preview/);
assert.match(source, /readback/);
assert.match(source, /tenant_connection_cleanup_plan/);
assert.match(source, /tenant_brand_core_operational_index_preview/);
console.log("tenant conversation orchestrator tests passed");
