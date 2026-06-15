import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export const canonicalFamilies = [
  {
    name: "system_bootstrap",
    sourceDir: path.join(repoRoot, "canonicals", "system_bootstrap"),
    outputFile: path.join(repoRoot, "system_bootstrap.md"),
    heading: "System Bootstrap Canonical",
    expectedFileCount: 23,
    index: [
      ["00_header_purpose.md", "Header and purpose", "Canonical identity, status, and purpose."],
      ["01_logic_pointer_knowledge.md", "Logic pointers and knowledge profiles", "Logic pointer authority, knowledge profiles, brand onboarding, and asset-read governance."],
      ["02_activation_transport.md", "Activation transport", "Activation transport, tool-first behavior, continuation override, and readiness guards."],
      ["03_audit_logging_schema.md", "Audit, logging, and schema", "Full-system audit authority, execution logging, parent actions, and HTTP schema gates."],
      ["04_registry_foundation.md", "Registry foundation", "Registry workbook authority, schema governance, strict routing, and policy surfaces."],
      ["05_activation_runtime.md", "Activation runtime", "Activation bootstrap, integrity, repairability, starter policy, and provider continuity."],
      ["06_http_generic_api.md", "HTTP Generic API", "HTTP Generic API governance, endpoint registry validation, and security constraints."],
      ["07_governed_additions_graph.md", "Governed additions and graph", "Governed addition pipeline, promotion, graph nodes, and graph routing."],
      ["08_google_workspace_runtime.md", "Google Workspace runtime", "Google Workspace native action governance and runtime validation dependencies."],
      ["09_growth_execution_authority.md", "Growth execution authority", "Growth feedback, scoring, authority model, workflow registry, and binding integrity."],
      ["10_observability_repair.md", "Observability and repair", "Observability, review surfaces, validation states, fallback handling, and repair signals."],
      ["11_analytics_api_retirement.md", "Analytics and API retirement", "Brand tracking bindings, API retirement, analytics warehouse governance, and URL authority."],
      ["12_runtime_validation_enforcer.md", "Runtime validation enforcer", "Runtime validation lifecycle, pre-write checks, readback, schema loading, and completion lock."],
      ["13_wordpress_publish_contract.md", "WordPress publish contract", "WordPress publish contract runtime governance patch."],
      ["14_governed_context_resolution.md", "Governed context resolution", "Governed context resolution order for Logic, business activity, and brand."],
      ["15_business_type_brand_path_resolution.md", "Business type and brand path resolution", "Canonical path resolver for Business Type folders and brand folders under resolved business types."],
      ["16_context_resolver_layer.md", "Context resolver layer", "Resolver layer architecture, resolveContext contract, resolver inventory, and validation state model."],
      ["17_agent_execution_runtime.md", "Agent execution runtime", "Agent runtime, model class routing, verify pass, engine dispatch, Drive knowledge layer, and sync script."],
      ["18_local_connector_dispatch.md", "Local connector and dispatch governance", "Dispatch layer, task_routes authority, agent skill grants, local connector config, auto-provisioning, and DNS governance."],
      ["19_tenant_gpt_oauth_preset.md", "Tenant GPT OAuth preset", "Tenant Custom GPT OAuth preset, schema URL, client ID, redirect/auth URLs, scopes, and sign-in failure interpretation."],
      ["20_sql_primary_data_source.md", "SQL primary data source", "SQL runtime authority, sheet-to-table map, async mirror behavior, recovery helpers, and GPT-initiated migration repair flow."],
      ["21_activation_guidance_intelligence.md", "Activation guidance intelligence", "Proactive Tenant/Admin activation guidance, account counts, readiness semantics, and next-best actions."],
      ["22_capability_assurance_graph.md", "Capability assurance graph", "Canonical capability, invocation evidence, resource authority, readiness, certification, provenance, and debt governance."],
    ],
  },
  {
    name: "direct_instructions_registry_patch",
    sourceDir: path.join(repoRoot, "canonicals", "direct_instructions_registry_patch"),
    outputFile: path.join(repoRoot, "direct_instructions_registry_patch.md"),
    heading: "Direct Instructions Registry Patch Canonical",
    expectedFileCount: 18,
    index: [
      ["00_header_purpose.md", "Header and purpose", "Canonical identity, status, and direct patch purpose."],
      ["01_governance_foundation.md", "Governance foundation", "Canonical presentation, pointer authority, brand core, activation, and early logging governance."],
      ["02_http_execution_logging.md", "HTTP execution and logging", "Parent action schema, auth routing, HTTP execution classification, and logging surfaces."],
      ["03_registry_authority_schema.md", "Registry authority and schema", "Registry source of truth, duplicate headers, dynamic placeholders, runtime bindings, and schema governance."],
      ["04_activation_policy_runtime.md", "Activation policy runtime", "Activation bootstrap, live canonical validation, full-system integrity, scoring, and retry governance."],
      ["05_http_generic_api_additions.md", "HTTP Generic API additions", "HTTP Generic API, adaptive schema learning, governed additions, and graph governance."],
      ["06_google_workspace_validation.md", "Google Workspace validation", "Google Workspace governance, runtime validation, post-activation governance, and growth feedback."],
      ["07_authority_binding_repair.md", "Authority, binding, and repair", "Authority model, routes and chains, target scopes, observability, repair, and recovery."],
      ["08_analytics_wordpress_preflight.md", "Analytics and WordPress preflight", "Brand tracking, API retirement, analytics governance, URL migration, and WordPress preflight."],
      ["09_wordpress_publish_contract.md", "WordPress publish contract", "WordPress publish contract direct instruction patch."],
      ["10_governed_context_resolution.md", "Governed context resolution", "Governed context resolution enforcement for direct instructions."],
      ["11_business_type_brand_path_resolution.md", "Business type and brand path resolution", "Direct instruction patch for business-type-first and brand-under-business-type path governance."],
      ["12_context_resolver_layer.md", "Context resolver layer", "Resolver-first enforcement, resolver precedence rules, and blocked context handling."],
      ["13_agent_execution_runtime.md", "Agent execution runtime", "Agent runtime enforcement, model tier selection, verify pass, engine dispatch, and Drive knowledge layer."],
      ["14_dispatch_local_connector_governance.md", "Dispatch and local connector governance", "task_routes mutation rules, MODULE_EXECUTORS registration, agent skills/grants/bindings, supervision policy, and DNS enforcement."],
      ["15_schema_repair_governance.md", "Schema repair governance", "Safe additive schema repair, collation guard, and capability-vault draft runtime safety."],
      ["16_activation_guidance_intelligence.md", "Activation guidance intelligence", "Proactive Tenant/Admin activation guidance, account counts, readiness semantics, and next-best actions."],
      ["17_capability_assurance_graph.md", "Capability assurance graph", "Direct enforcement of invocation evidence, capability-specific resource authority, typed gaps, provenance, certification, and no-secret reconciliation."],
    ],
  },
  {
    name: "module_loader",
    sourceDir: path.join(repoRoot, "canonicals", "module_loader"),
    outputFile: path.join(repoRoot, "module_loader.md"),
    heading: "Module Loader Canonical",
    expectedFileCount: 9,
    index: [
      ["00_header_purpose.md", "Header and purpose", "Canonical identity, status, purpose, and initial loader readiness."],
      ["01_dependency_resolution.md", "Dependency resolution", "Credential chains, variable contracts, async dependencies, and Google Workspace dependency resolution."],
      ["02_live_canonical_api_resolution.md", "Live canonical and API resolution", "Live canonical resolution, API capability and endpoint resolution, embedded auth, and analytics sheet transformation."],
      ["03_schema_logging_enforcement.md", "Schema and logging enforcement", "Analytics identity enforcement, schema loading, and native Google logging preparation."],
      ["04_wordpress_publish_contract.md", "WordPress publish contract", "WordPress runtime governance loader bindings and sink contracts."],
      ["05_governed_context_resolution.md", "Governed context dependencies", "Governed context dependencies for module loader HTTP execution."],
      ["06_business_type_brand_path_resolution.md", "Business type and brand path dependencies", "Loader dependencies for Business Type Path Resolver, Brand Path Resolver, and completion gates."],
      ["07_context_resolver_layer.md", "Context resolver layer dependencies", "Loader row collections for resolveContext and resolver loading order."],
      ["08_capability_assurance_graph.md", "Capability assurance graph dependencies", "Capability, envelope, binding, evidence, certification, provenance, and debt dependencies for governed dispatch."],
    ],
  },
  {
    name: "prompt_router",
    sourceDir: path.join(repoRoot, "canonicals", "prompt_router"),
    outputFile: path.join(repoRoot, "prompt_router.md"),
    heading: "Prompt Router Canonical",
    expectedFileCount: 10,
    index: [
      ["00_header_purpose.md", "Header and purpose", "Canonical identity, status, purpose, and initial routing posture."],
      ["01_core_routing.md", "Core routing", "HTTP variable-aware routing, async routing, and Native Google routing clarification."],
      ["02_runtime_validation_routing.md", "Runtime validation routing", "Runtime validation declaration, full audit routing, provider continuity, and analytics routing."],
      ["03_repair_review_routing.md", "Repair and review routing", "Repair loop guards, forced repair routing, escalation, review surfaces, and review write planning."],
      ["04_schema_first_routing.md", "Schema-first routing", "Schema-first routing rule."],
      ["05_wordpress_publish_contract.md", "WordPress publish contract", "WordPress publish contract routing patch."],
      ["06_governed_context_resolution.md", "Governed context resolution", "Governed context resolution routing constraints and handoff behavior."],
      ["07_business_type_brand_path_resolution.md", "Business type and brand path routing", "Routes for new business type addition, new brand under business type, and path validation."],
      ["08_context_resolver_layer.md", "Context resolver layer routing", "Pre-route resolution rules, intent routing table, degraded routing states, and successful route conditions."],
      ["09_capability_assurance_graph.md", "Capability assurance routing", "Routing for invocation envelopes, capability-specific resource bindings, typed gaps, certification, and reconciliation."],
    ],
  },
];

export function getCanonicalFamily(name) {
  const family = canonicalFamilies.find((entry) => entry.name === name);
  if (!family) throw new Error(`Unknown canonical family: ${name}`);
  return family;
}
