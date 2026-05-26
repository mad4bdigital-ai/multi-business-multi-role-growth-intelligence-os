import assert from "node:assert/strict";
import { resolveWorkflowCandidates } from "./workflowRegistryAuthorityResolver.js";

function createPool() {
  const state = { queries: [] };
  const pool = {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params });
      const compactSql = String(sql).replace(/\s+/g, " ").trim();
      if (compactSql.includes("FROM `registry_surfaces_catalog`")) {
        assert.equal(params[0], "surface.workflow_registry_sheet");
        return [[{
          surface_id: "surface.workflow_registry_sheet",
          logical_surface_key: "surface.workflow_registry_sheet",
          surface_name: "Workflow Registry",
          surface_type: "registry",
          surface_scope: "runtime",
          storage_type: "workbook_sheet",
          active_status: "active",
          authority_status: "authoritative",
          required_for_execution: "TRUE",
          resolution_rule: "sql_primary",
          owner_layer: "governed_context_resolution",
          schema_ref: "workflows",
          schema_version: "1",
          binding_mode: "sql_runtime_authority",
          sheet_role: "runtime_workflow_registry",
          source_surface_id: null,
          source_surface_role: null,
          retired_replacement_surface_id: null,
          backend_type: "sql",
          backend_adapter: "governed_context_resolution.workflow_registry",
          authority_model: "sql_runtime_authority",
          portability_class: "runtime_workflow_authority",
          repair_candidate_types: "surface_authority|workflow_readback|customization_integrity",
          repair_priority: "high",
          updated_at: "2026-05-26T00:00:00.000Z",
        }]];
      }
      if (compactSql.includes("FROM `workflows`")) {
        return [[
          {
            id: 1,
            workflow_id: "wf.base.seo.audit",
            workflow_key: "workflow.seo.audit",
            workflow_name: "Base SEO Audit",
            module_mode: "standard",
            trigger_source: "gpt|api",
            input_type: "brief",
            primary_objective: "Base SEO audit workflow",
            mapped_engines: "engine.seo|engine.audit",
            engine_order: "engine.seo,engine.audit",
            workflow_type: "analysis",
            primary_output: "SEO audit report",
            priority: "medium",
            route_key: "seo.audit",
            execution_mode: "standard",
            user_facing: "TRUE",
            status: "active",
            linked_workflows: "workflow.content.plan",
            linked_engines: "engine.content",
            entry_priority_weight: "medium",
            output_artifact_type: "report",
            active: "TRUE",
            target_module: "seoRuntime",
            execution_class: "standard",
            lifecycle_mode: "runtime",
            route_compatibility: "seo.audit|site.audit",
            memory_required: "TRUE",
            logging_required: "TRUE",
            review_required: "FALSE",
            allowed_states: "ready|active",
            degraded_action: "return_degraded_workflow",
            blocked_action: "block_execution",
            registry_source: "platform_base",
            supported_ingress_channels: "gpt|api",
            supports_structured_api_calls: "TRUE",
            supported_model_providers: "openai|anthropic",
            model_adapter_required: "TRUE",
            allowed_actor_roles: "admin|member",
            allowed_governance_levels: "standard|advanced",
            client_allowed: "all",
            team_allowed: "all",
            admin_only: "FALSE",
            brand_scope_enforced: "FALSE",
            supported_languages: "en|ar",
            translation_step_required: "FALSE",
            locale_sensitive: "TRUE",
          },
          {
            id: 2,
            workflow_id: "wf.brand.seo.audit",
            workflow_key: "workflow.brand.seo.audit",
            workflow_name: "Brand SEO Audit",
            module_mode: "advanced",
            trigger_source: "gpt",
            input_type: "brief",
            primary_objective: "Brand-specialized SEO audit workflow",
            mapped_engines: "engine.brand_seo|engine.audit",
            engine_order: "engine.brand_seo,engine.audit",
            workflow_type: "analysis",
            primary_output: "Brand SEO audit report",
            priority: "high",
            route_key: "seo.audit",
            execution_mode: "standard",
            user_facing: "TRUE",
            status: "active",
            linked_workflows: "workflow.brand.content.plan",
            linked_engines: "engine.brand_content",
            entry_priority_weight: "high",
            output_artifact_type: "report",
            active: "TRUE",
            target_module: "brandSeoRuntime",
            execution_class: "advanced",
            lifecycle_mode: "runtime",
            route_compatibility: "seo.audit",
            memory_required: "TRUE",
            logging_required: "TRUE",
            review_required: "TRUE",
            allowed_states: "ready|active",
            degraded_action: "return_degraded_workflow",
            blocked_action: "block_execution",
            registry_source: "brand_specialization",
            supported_ingress_channels: "gpt",
            supports_structured_api_calls: "TRUE",
            supported_model_providers: "openai",
            model_adapter_required: "TRUE",
            allowed_actor_roles: "admin|member",
            allowed_governance_levels: "advanced",
            client_allowed: "tenant_1",
            team_allowed: "growth",
            admin_only: "FALSE",
            brand_scope_enforced: "TRUE",
            supported_languages: "ar",
            translation_step_required: "FALSE",
            locale_sensitive: "TRUE",
          },
          {
            id: 3,
            workflow_id: "wf.admin.seo.audit",
            workflow_key: "workflow.admin.seo.audit",
            workflow_name: "Admin SEO Workflow",
            module_mode: "admin",
            trigger_source: "gpt",
            input_type: "brief",
            primary_objective: "Admin-only workflow",
            mapped_engines: "engine.admin",
            engine_order: "engine.admin",
            workflow_type: "analysis",
            primary_output: "Admin audit",
            priority: "critical",
            route_key: "seo.audit",
            execution_mode: "standard",
            user_facing: "FALSE",
            status: "active",
            linked_workflows: "",
            linked_engines: "",
            entry_priority_weight: "critical",
            output_artifact_type: "report",
            active: "TRUE",
            target_module: "adminRuntime",
            execution_class: "advanced",
            lifecycle_mode: "runtime",
            route_compatibility: "seo.audit",
            memory_required: "TRUE",
            logging_required: "TRUE",
            review_required: "TRUE",
            allowed_states: "ready|active",
            registry_source: "admin_specialization",
            supported_ingress_channels: "gpt",
            supports_structured_api_calls: "TRUE",
            supported_model_providers: "openai",
            model_adapter_required: "TRUE",
            allowed_actor_roles: "admin",
            allowed_governance_levels: "advanced",
            client_allowed: "all",
            team_allowed: "all",
            admin_only: "TRUE",
            brand_scope_enforced: "FALSE",
            supported_languages: "ar",
            locale_sensitive: "TRUE",
          },
        ]];
      }
      throw new Error(`unexpected query: ${compactSql}`);
    },
  };
  return pool;
}

{
  const pool = createPool();
  const result = await resolveWorkflowCandidates({
    pool,
    route_key: "seo.audit",
    brand_key: "brand_acme",
    tenant_id: "tenant_1",
    client_key: "tenant_1",
    team_key: "growth",
    actor_role: "member",
    governance_level: "advanced",
    ingress_channel: "gpt",
    model_provider: "openai",
    language: "ar",
    workflow_type: "analysis",
    execution_mode: "standard",
    limit: 5,
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolver, "shared_workflow_registry_authority_resolver");
  assert.equal(result.mode, "read_model_only");
  assert.equal(result.surface_authority.ok, true);
  assert.equal(result.secrets_included, false);
  assert.equal(result.count, 2);
  assert.equal(result.candidates[0].workflow_key, "workflow.brand.seo.audit");
  assert.equal(result.candidates[0].customization.specialized, true);
  assert(result.candidates[0].customization.layers.includes("client_specialization"));
  assert(result.candidates[0].customization.layers.includes("team_specialization"));
  assert(result.candidates[0].customization.layers.includes("model_capability_specialization"));
  assert.equal(result.candidates[0].requirements.review_required, true);
  assert.deepEqual(result.candidates[0].engine_order, ["engine.brand_seo", "engine.audit"]);
  assert.equal(result.candidates[0].secrets_included, false);
  assert.equal(result.candidates[1].workflow_key, "workflow.seo.audit");
}

{
  const pool = createPool();
  const result = await resolveWorkflowCandidates({
    pool,
    route_key: "seo.audit",
    actor_role: "member",
    governance_level: "standard",
    ingress_channel: "gpt",
    model_provider: "openai",
    language: "ar",
    workflow_type: "analysis",
    execution_mode: "standard",
    include_denied: true,
    limit: 10,
  });

  const admin = result.candidates.find((candidate) => candidate.workflow_key === "workflow.admin.seo.audit");
  assert(admin);
  assert.equal(admin.evaluation.allowed, false);
  assert(admin.evaluation.reasons.includes("admin_only_workflow"));
  assert.equal(admin.secrets_included, false);
}

console.log("workflow registry authority resolver tests passed");
