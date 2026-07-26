import assert from "node:assert/strict";
import { resolveTaskRouteCandidates } from "./taskRouteAuthorityResolver.js";

function createPool() {
  const state = { queries: [] };
  const pool = {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params });
      const compactSql = String(sql).replace(/\s+/g, " ").trim();
      if (compactSql.includes("FROM `registry_surfaces_catalog`")) {
        assert.equal(params[0], "surface.task_routes_sheet");
        return [[{
          surface_id: "surface.task_routes_sheet",
          logical_surface_key: "surface.task_routes_sheet",
          surface_name: "Task Routes",
          surface_type: "registry",
          surface_scope: "runtime",
          storage_type: "workbook_sheet",
          active_status: "active",
          authority_status: "authoritative",
          required_for_execution: "TRUE",
          resolution_rule: "sql_primary",
          owner_layer: "governed_context_resolution",
          schema_ref: "task_routes",
          schema_version: "1",
          binding_mode: "sql_runtime_authority",
          sheet_role: "runtime_route_registry",
          source_surface_id: null,
          source_surface_role: null,
          retired_replacement_surface_id: null,
          backend_type: "sql",
          backend_adapter: "governed_context_resolution.task_routes",
          authority_model: "sql_runtime_authority",
          portability_class: "runtime_route_authority",
          repair_candidate_types: "surface_authority|route_readback|customization_integrity",
          repair_priority: "high",
          updated_at: "2026-05-26T00:00:00.000Z",
        }]];
      }
      if (compactSql.includes("FROM `task_routes`")) {
        return [[
          {
            id: 1,
            route_id: "route.base.seo",
            task_key: "seo.audit",
            intent_key: "seo.audit",
            trigger_terms: "seo audit|site audit",
            route_modules: "seo_module|audit_module",
            execution_layer: "standard",
            priority: "medium",
            enabled: "TRUE",
            active: "TRUE",
            output_focus: "Base SEO audit route",
            brand_scope: "all",
            request_type: "analysis",
            route_mode: "standard",
            target_module: "seoRuntime",
            workflow_key: "workflow.seo.audit",
            lifecycle_mode: "runtime",
            memory_required: "TRUE",
            logging_required: "TRUE",
            review_required: "FALSE",
            allowed_states: "ready|active",
            degraded_action: "return_degraded_route",
            blocked_action: "block_execution",
            route_source: "platform_base",
            supported_ingress_channels: "gpt|api",
            supported_model_providers: "openai|anthropic",
            allowed_actor_roles: "admin|member",
            allowed_governance_levels: "standard|advanced",
            client_allowed: "all",
            team_allowed: "all",
            admin_only: "FALSE",
            brand_scope_enforced: "FALSE",
            supported_languages: "en|ar",
            locale_sensitive: "TRUE",
          },
          {
            id: 2,
            route_id: "route.brand.seo",
            task_key: "seo.audit",
            intent_key: "seo.audit",
            trigger_terms: "seo audit",
            route_modules: "brand_seo_module",
            execution_layer: "advanced",
            priority: "high",
            enabled: "TRUE",
            active: "TRUE",
            output_focus: "Brand-specific SEO audit route",
            brand_scope: "brand_acme",
            request_type: "analysis",
            route_mode: "standard",
            target_module: "brandSeoRuntime",
            workflow_key: "workflow.brand.seo.audit",
            lifecycle_mode: "runtime",
            memory_required: "TRUE",
            logging_required: "TRUE",
            review_required: "TRUE",
            allowed_states: "ready|active",
            degraded_action: "return_degraded_route",
            blocked_action: "block_execution",
            route_source: "brand_specialization",
            supported_ingress_channels: "gpt",
            supported_model_providers: "openai",
            allowed_actor_roles: "admin|member",
            allowed_governance_levels: "advanced",
            client_allowed: "tenant_1",
            team_allowed: "growth",
            admin_only: "FALSE",
            brand_scope_enforced: "TRUE",
            supported_languages: "ar",
            locale_sensitive: "TRUE",
          },
          {
            id: 3,
            route_id: "route.admin.secret",
            task_key: "seo.audit",
            intent_key: "seo.audit",
            trigger_terms: "seo audit",
            route_modules: "admin_module",
            execution_layer: "admin",
            priority: "critical",
            enabled: "TRUE",
            active: "TRUE",
            output_focus: "Admin only route",
            brand_scope: "all",
            request_type: "analysis",
            route_mode: "standard",
            target_module: "adminRuntime",
            workflow_key: "workflow.admin.secret",
            lifecycle_mode: "runtime",
            memory_required: "TRUE",
            logging_required: "TRUE",
            review_required: "TRUE",
            allowed_states: "ready|active",
            route_source: "admin_specialization",
            supported_ingress_channels: "gpt",
            supported_model_providers: "openai",
            allowed_actor_roles: "admin",
            allowed_governance_levels: "advanced",
            client_allowed: "all",
            team_allowed: "all",
            admin_only: "TRUE",
            brand_scope_enforced: "FALSE",
            supported_languages: "ar",
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
  const result = await resolveTaskRouteCandidates({
    pool,
    intent_key: "seo.audit",
    brand_key: "brand_acme",
    tenant_id: "tenant_1",
    client_key: "tenant_1",
    team_key: "growth",
    actor_role: "member",
    governance_level: "advanced",
    ingress_channel: "gpt",
    model_provider: "openai",
    language: "ar",
    request_type: "analysis",
    route_mode: "standard",
    limit: 5,
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolver, "shared_task_route_authority_resolver");
  assert.equal(result.mode, "read_model_only");
  assert.equal(result.surface_authority.ok, true);
  assert.equal(result.secrets_included, false);
  assert.equal(result.count, 2);
  assert.equal(result.candidates[0].route_id, "route.brand.seo");
  assert.equal(result.candidates[0].customization.specialized, true);
  assert(result.candidates[0].customization.layers.includes("brand_specialization"));
  assert(result.candidates[0].customization.layers.includes("client_specialization"));
  assert(result.candidates[0].customization.layers.includes("team_specialization"));
  assert.equal(result.candidates[0].requirements.review_required, true);
  assert.equal(result.candidates[0].secrets_included, false);
  assert.equal(result.candidates[1].route_id, "route.base.seo");
}

{
  const pool = createPool();
  const result = await resolveTaskRouteCandidates({
    pool,
    intent_key: "seo.audit",
    actor_role: "member",
    governance_level: "standard",
    ingress_channel: "gpt",
    model_provider: "openai",
    language: "ar",
    request_type: "analysis",
    route_mode: "standard",
    include_denied: true,
    limit: 10,
  });

  const admin = result.candidates.find((candidate) => candidate.route_id === "route.admin.secret");
  assert(admin);
  assert.equal(admin.evaluation.allowed, false);
  assert(admin.evaluation.reasons.includes("admin_only_route"));
  assert.equal(admin.secrets_included, false);
}

console.log("task route authority resolver tests passed");
