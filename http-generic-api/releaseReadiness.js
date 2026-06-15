/**
 * releaseReadiness.js — Sprint 18
 *
 * Comprehensive platform health + release-readiness check.
 * Runs structural, data, and operational checks and returns a full report.
 *
 * Structural checks (table existence):
 *   All 42 new platform tables must exist.
 *
 * Data checks (seed integrity):
 *   Plans seeded, assistance roles seeded, quota rules seeded.
 *
 * Operational checks:
 *   DB connectivity, legacy tables reachable, migration inventory populated.
 */

import { getPool } from "./db.js";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlatformGraphMemory } from "./services/platformGraphMemoryResolver.js";
import { getRuntimeParity } from "./runtimeVerificationService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const SYSTEM_LAYER_ROUTES_PATH = path.join(__dirname, "routes", "systemLayerRoutes.js");
const REPOSITORY_TENANT_INTELLIGENCE_V2_PATH = path.join(__dirname, "repositoryTenantIntelligenceV2.js");
const GPT_TOOLS_ROUTES_PATH = path.join(__dirname, "routes", "gptToolsRoutes.js");
const OPENAPI_PATH = path.join(__dirname, "openapi.yaml");
const ROUTES_DIR = path.join(__dirname, "routes");

const EXPECTED_GOVERNED_LEDGER_MIGRATIONS = [
  "051_sprint48_cloudflare_and_self_repair_tools.sql",
  "052_sprint49_local_connector_install_bundle.sql",
  "054_sprint50_admin_device_seed_and_self_repair_tool.sql",
  "055_sprint51_sql_primary_data_source.sql",
  "057_sprint53_admin_session_turn_tools.sql",
  "162_sprint66_cms_site_resource_access_grants.sql",
  "163_sprint65_session_archive_smoke_tool.sql",
  "166_sprint65_ai_intelligence_runtime_governance.sql",
  "167_sprint65_ai_intelligence_runtime_governance_tools.sql",
  "168_sprint65_database_table_lifecycle_governance.sql",
  "176_sprint66_governed_migration_ledger.sql",
  "178_sprint66_runtime_authority_certification_registries.sql",
  "179_sprint66_dynamic_capability_audit_foundation.sql",
  "180_sprint66_wordpress_publish_authority_diagnostic_tool.sql",
  "181_sprint66_connected_execution_continuity_foundation.sql",
  "182_sprint66_database_lifecycle_report_snapshots.sql",
  "183_sprint66_database_lifecycle_snapshot_schedule_readiness.sql",
  "184_sprint66_database_lifecycle_scheduler_binding_readiness.sql",
  "185_sprint66_database_lifecycle_scheduler_approval_metadata.sql",
  "186_sprint66_database_lifecycle_scheduler_approval_readback.sql",
  "187_sprint66_connected_execution_continuity_api_tools.sql",
  "187_sprint66_platform_secret_intake_promotion_tool.sql",
  "188_sprint66_database_lifecycle_scheduler_snapshot_queue_tools.sql",
  "188_sprint66_remote_database_intake_autopromotion.sql",
  "191_sprint66_connected_execution_worker_bridge.sql",
  "192_sprint66_execution_job_tick_admin_tool.sql",
  "193_sprint66_connected_execution_read_only_tool_call_preflight.sql",
  "194_sprint66_admin_tool_registry_updated_at_column.sql",
  "194_sprint66_runtime_policy_reconciliation.sql",
  "195_sprint66_connected_execution_read_only_tool_execution.sql",
  "196_sprint66_admin_tool_registry_tags_text.sql",
  "199_sprint67_runtime_policy_resolver_monitoring_and_mirror_classification.sql",
  "200_sprint67_runtime_policy_target_rule_backfill.sql",
  "202_sprint67_policy_only_runtime_policy_target_rules.sql",
  "203_sprint67_execution_log_context_dimensions.sql",
  "204_sprint67_core_runtime_context_dimensions.sql",
  "205_sprint67_runtime_context_dimension_enrichment.sql",
  "216_sprint67_platform_secret_promotion_monitoring.sql",
  "219_sprint67_gpt_session_turn_batch_write_tool.sql",
  "223_sprint67_gpt_session_conversation_refs.sql",
  "225_sprint67_gpt_session_conversation_ref_primary.sql",
  "229_sprint67_gpt_session_archive_monitoring.sql",
  "245_sprint68_gpt_tool_archive_pinning_monitoring.sql",
  "246_sprint68_gpt_session_archive_backfill_tool.sql",
  "249_sprint68_gpt_archive_backfill_conversation_ref_monitoring.sql",
  "250_sprint68_gpt_conversation_capture_contract_monitoring.sql",
  "251_sprint68_dynamic_memory_scope_types.sql",
  "252_sprint68_memory_scope_links_foundation.sql",
  "253_sprint68_session_insight_candidates_foundation.sql",
  "254_sprint68_session_insight_scope_link_monitoring.sql",
  "256_sprint68_session_insight_promotion_foundation.sql",
  "230_sprint67_gpt_session_conversation_ref_capture_current.sql",
  "231_sprint68_shared_reconciliation_continuation_policy.sql",
  "232_sprint68_chunked_tool_response_continuation_policy.sql",
  "233_sprint68_local_connector_tunnel_provisioning_continuation_policy.sql",
  "236_sprint68_admin_branch_reconciliation_policy.sql",
  "248_sprint68_github_branch_fast_forward_policy.sql",
  "251_sprint68_github_branch_fast_forward_smoke_policy.sql",
  "255_sprint68_live_checkout_cleanup_capability_gate.sql",
  "260_sprint68_platform_development_constitution_policies.sql",
  "261_sprint68_orchestration_intelligence_foundation.sql",
  "262_sprint68_orchestration_readback_surface.sql",
  "263_sprint68_ads_governance_snapshot_proposal.sql",
  "264_sprint68_ads_governance_snapshot_record_gate.sql",
  "270_sprint68_support_ticket_lifecycle_orchestration_readback.sql",
  "272_sprint68_support_ticket_lifecycle_snapshot_proposal.sql",
  "273_sprint68_support_ticket_lifecycle_snapshot_record_gate.sql",
  "284_sprint68_wordpress_schema_import_completion_registry.sql",
  "285_sprint68_governed_migration_authorization_registry.sql",
  "286_sprint68_platform_schema_contract_completion_registry.sql",
  "287_sprint68_external_delivery_orchestration_graph_plugin.sql",
  "288_sprint68_external_delivery_no_send_tool_tag_completion.sql",
  "904_sprint68_support_ticket_lifecycle_snapshot_apply_binding.sql",
  "900_sprint68_governed_repository_intelligence_engine.sql",
  "950_sprint68_platform_resource_authority_bindings.sql",
  "233_sprint68_general_mode_choice_governance.sql",
  "311_sprint69_superseded_closed_pr_branch_cleanup.sql",
  "311_sprint69_platform_tool_dispatch_binding_integrity.sql",
  "312_sprint69_platform_tool_dispatch_integrity_scope_fix.sql",
  "1008_sprint69_post_deploy_restart_and_superseded_cleanup_policy.sql",
];

const REQUIRED_TOOL_DISPATCH_MIGRATION_CHECKSUMS = Object.freeze({
  "311_sprint69_platform_tool_dispatch_binding_integrity.sql": "7bb6d1a934d3504682303894b8bf1b95ed2d2e383c629a2838ecf1f4f7911216",
  "312_sprint69_platform_tool_dispatch_integrity_scope_fix.sql": "e64c8068e49266c1e630ae2b8b5f38778a0d642f0ba4287ff43ce2a26d600ed8",
});

const EXPECTED_ADMIN_TOOL_REGISTRY_SMOKE = [
  "admin_cloudflare",
  "admin_connector_activate",
  "gpt_session_end",
  "gpt_session_conversation_ref_upsert",
  "gpt_session_conversation_ref_mark_primary",
  "gpt_session_conversation_ref_capture_current",
  "gpt_session_turn_write",
  "gpt_session_turns_write_batch",
  "local_connector_install_bundle",
  "local_connector_self_repair",
  "platform_data_source_census",
  "platform_self_repair_diagnose",
  "release_session_archive_smoke",
];

const LEGACY_NON_REQUIRED_ADMIN_TOOLS = [
  "governance_execution_log_sheets_recovery",
];

const DEPRECATED_DB_BOOTSTRAP_REPLACED_ADMIN_TOOLS = new Set([
  "activation_sheets_bootstrap_read",
]);

const REQUIRED_RUNTIME_POLICY_SEEDS = [
  { check_key: "repo_mutation_guard", policy_group: "Repository Mutation Governance", policy_key: "Stale Duplicate Branch Merge Guard", required_blocking: true, required_scope_tokens: ["repo_patch_apply", "gpt_tools_call"], required_affects_layer_tokens: ["gptToolsRoutes", "repo_patch_apply"] },
  { check_key: "governed_repository_intelligence_engine", policy_group: "Repository Intelligence Governance", policy_key: "governed_repository_intelligence_engine_policy_v1", required_blocking: true, required_scope_tokens: ["governed_repository_intelligence", "repo.pr.reconciliation_sweep", "platform_resource_recipes"], required_affects_layer_tokens: ["platformResourceRecipeCapability", "releaseReadiness", "capability_resolution_envelope_ledger"] },
  { check_key: "platform_resource_authority_binding", policy_group: "Repository Intelligence Governance", policy_key: "platform_resource_authority_binding_policy_v1", required_blocking: true, required_scope_tokens: ["platform_resource_authority_bindings", "governed_resource_run", "repo.pr.reconciliation_sweep"], required_affects_layer_tokens: ["platformResourceRecipeCapability", "platform_resource_authority_bindings", "releaseReadiness"] },
  { check_key: "app_action_visibility", policy_group: "External App Action Governance", policy_key: "External App Action Preflight Visibility", required_blocking: false, required_scope_tokens: ["app_action", "external_app_action"], required_affects_layer_tokens: ["appAdapters", "appAdapters/index.js"] },
  { check_key: "n8n_workflow_execution_guard", policy_group: "External App Action Governance", policy_key: "n8n Workflow Execution Guard", required_blocking: true, required_scope_tokens: ["n8n", "execute_workflow"], required_affects_layer_tokens: ["appAdapters", "n8n"] },
  { check_key: "connector_dispatch_visibility", policy_group: "Connector Dispatch Governance", policy_key: "Connector Dispatch Preflight Visibility", required_blocking: false, required_scope_tokens: ["connector_dispatch", "workflow_dispatch"], required_affects_layer_tokens: ["connectorExecutor", "connectorExecutor.js"] },
  { check_key: "agent_loop_visibility", policy_group: "Agent Loop Governance", policy_key: "Agent Loop Preflight Visibility", required_blocking: false, required_scope_tokens: ["agent_loop", "logic_execution"], required_affects_layer_tokens: ["agentLoopRunner", "agentLoopRunner.js"] },
  { check_key: "brand_core_writing_guard", policy_group: "Agent Loop Governance", policy_key: "Brand Writing Requires Brand Core", required_blocking: true, required_scope_tokens: ["write", "publish", "seo"], required_affects_layer_tokens: ["agentLoopRunner", "brand_core"] },
  { check_key: "platform_development_constitution", policy_group: "Platform Development Constitution", policy_key: "platform_development_constitution_policy_v1", required_blocking: true, required_scope_tokens: ["platform_development", "routes", "tools"], required_affects_layer_tokens: ["releaseReadiness", "repo_patch_apply", "platform_engine_registry"] },
  { check_key: "orchestration_first_development", policy_group: "Orchestration Intelligence Governance", policy_key: "orchestration_first_development_policy_v1", required_blocking: true, required_scope_tokens: ["platform_development", "capability_addition", "workflow"], required_affects_layer_tokens: ["platform_orchestration_plugins", "platform_orchestration_stages", "execution_policies"] },
  { check_key: "orchestration_intelligence_foundation", policy_group: "Orchestration Intelligence Governance", policy_key: "orchestration_intelligence_foundation_policy_v1", required_blocking: true, required_scope_tokens: ["orchestration_intelligence", "state_snapshot", "recommendation_generation"], required_affects_layer_tokens: ["platform_orchestration_plugins", "platform_orchestration_state_snapshots", "platform_engine_registry"] },
  { check_key: "orchestration_intelligence_readback", policy_group: "Orchestration Intelligence Governance", policy_key: "orchestration_intelligence_readback_policy_v1", required_blocking: true, required_scope_tokens: ["orchestration_intelligence", "orchestration_readback", "graph_readiness"], required_affects_layer_tokens: ["platformOrchestrationReadback", "platformPluginRoutes", "admin_platform_endpoint_tools"] },
  { check_key: "ads_provider_governance_snapshot_proposal", policy_group: "Orchestration Intelligence Governance", policy_key: "ads_provider_governance_snapshot_proposal_policy_v1", required_blocking: true, required_scope_tokens: ["orchestration_intelligence", "ads_provider_governance", "snapshot_proposal"], required_affects_layer_tokens: ["adsProviderGovernanceSnapshotProposal", "platformPluginRoutes", "admin_platform_endpoint_tools"] },
  { check_key: "ads_provider_governance_snapshot_record_gate", policy_group: "Orchestration Intelligence Governance", policy_key: "ads_provider_governance_snapshot_record_gate_policy_v1", required_blocking: true, required_scope_tokens: ["orchestration_intelligence", "ads_provider_governance", "snapshot_record"], required_affects_layer_tokens: ["adsProviderGovernanceSnapshotRecord", "platformPluginRoutes", "platform_orchestration_state_snapshots"] },
  { check_key: "support_ticket_lifecycle_orchestration_readback", policy_group: "Orchestration Intelligence Governance", policy_key: "support_ticket_lifecycle_orchestration_readback_policy_v1", required_blocking: true, required_scope_tokens: ["support_ticket_lifecycle", "orchestration_readback", "ticket_readiness"], required_affects_layer_tokens: ["supportTicketLifecycleOrchestrationReadback", "platformOrchestrationReadback", "tickets"] },
  { check_key: "support_ticket_lifecycle_snapshot_proposal", policy_group: "Orchestration Intelligence Governance", policy_key: "support_ticket_lifecycle_snapshot_proposal_policy_v1", required_blocking: true, required_scope_tokens: ["support_ticket_lifecycle", "snapshot_proposal", "recommendation_proposal"], required_affects_layer_tokens: ["supportTicketLifecycleSnapshotProposal", "platformPluginRoutes", "admin_platform_endpoint_tools"] },
  { check_key: "support_ticket_lifecycle_snapshot_record_gate", policy_group: "Orchestration Intelligence Governance", policy_key: "support_ticket_lifecycle_snapshot_record_gate_policy_v1", required_blocking: true, required_scope_tokens: ["support_ticket_lifecycle", "snapshot_record", "recommendation_record"], required_affects_layer_tokens: ["supportTicketLifecycleSnapshotRecord", "platformPluginRoutes", "platform_orchestration_state_snapshots"] },
  { check_key: "support_ticket_lifecycle_snapshot_apply_binding", policy_group: "Orchestration Intelligence Governance", policy_key: "support_ticket_lifecycle_snapshot_apply_binding_policy_v1", required_blocking: true, required_scope_tokens: ["support_ticket_lifecycle", "apply_authorization", "platform_orchestration"], required_affects_layer_tokens: ["capability_apply_authorization_policy_registry", "app_integration_action_bindings", "supportTicketLifecycleSnapshotRecord"] },
  { check_key: "support_ticket_external_delivery_orchestration_readback", policy_group: "Orchestration Intelligence Governance", policy_key: "support_ticket_external_delivery_orchestration_readback_policy_v1", required_blocking: true, required_scope_tokens: ["support_ticket_external_delivery", "orchestration_readback", "no_external_send"], required_affects_layer_tokens: ["platformOrchestrationReadback", "v_platform_orchestration_external_delivery_readiness", "admin_platform_endpoint_tools"] },
  { check_key: "orchestration_state_snapshot_required", policy_group: "Orchestration Intelligence Governance", policy_key: "orchestration_state_snapshot_required_policy_v1", required_blocking: true, required_scope_tokens: ["orchestration_intelligence", "recommendation_generation"], required_affects_layer_tokens: ["platform_orchestration_state_snapshots", "decision_runs"] },
  { check_key: "recommendation_before_execution", policy_group: "Orchestration Intelligence Governance", policy_key: "recommendation_before_execution_policy_v1", required_blocking: true, required_scope_tokens: ["tool_execution", "repo_mutation", "provider_adapter"], required_affects_layer_tokens: ["platform_orchestration_recommendations", "capability_resolution_envelope_ledger"] },
  { check_key: "intentional_safety_block_classification", policy_group: "Orchestration Intelligence Governance", policy_key: "intentional_safety_block_classification_policy_v1", required_blocking: true, required_scope_tokens: ["blocker_classification", "execution_enablement"], required_affects_layer_tokens: ["execution_enablement_registry", "platform_pending_tasks"] },
  { check_key: "no_hidden_execution", policy_group: "Execution Safety Governance", policy_key: "no_hidden_execution_policy_v1", required_blocking: true, required_scope_tokens: ["tool_execution", "provider_adapter", "external_write"], required_affects_layer_tokens: ["appAdapters", "connectorExecutor", "gptToolsRoutes"] },
  { check_key: "plugin_manifest_completeness", policy_group: "Plugin Governance", policy_key: "plugin_manifest_completeness_policy_v1", required_blocking: true, required_scope_tokens: ["plugin_registry", "plugin_contribution"], required_affects_layer_tokens: ["platform_plugin_contributions", "platform_orchestration_plugins"] },
  { check_key: "orchestration_stage_graph_completeness", policy_group: "Orchestration Intelligence Governance", policy_key: "orchestration_stage_graph_completeness_policy_v1", required_blocking: true, required_scope_tokens: ["orchestration_graph", "plugin_stage"], required_affects_layer_tokens: ["platform_orchestration_stages", "platform_orchestration_edges"] },
  { check_key: "platform_task_quality_gate", policy_group: "Task Governance", policy_key: "platform_task_quality_gate_policy_v1", required_blocking: true, required_scope_tokens: ["platform_task_creation", "pending_task"], required_affects_layer_tokens: ["platform_pending_tasks", "platform_orchestration_recommendations"] },
  { check_key: "tenant_proactive_guidance", policy_group: "Tenant Experience Governance", policy_key: "tenant_proactive_guidance_policy_v1", required_blocking: true, required_scope_tokens: ["tenant_gpt", "tenant_activation"], required_affects_layer_tokens: ["tenant_gpt_operating_guide", "tenant_capability_registry"] },
  { check_key: "validation_semantics", policy_group: "Runtime Validation Governance", policy_key: "validation_semantics_policy_v1", required_blocking: true, required_scope_tokens: ["connection_status", "validation_status"], required_affects_layer_tokens: ["credential_intake_connection_status", "tenant_gpt_guidance"] },
  { check_key: "platform_schema_blocker_classification", policy_group: "Schema Governance", policy_key: "platform_schema_blocker_classification_policy_v1", required_blocking: true, required_scope_tokens: ["schema_error", "collation_error"], required_affects_layer_tokens: ["database_collation_policy_registry", "releaseReadiness"] },
  { check_key: "intelligence_policy_rules_required", policy_group: "Intelligence Governance", policy_key: "intelligence_policy_rules_required_policy_v1", required_blocking: true, required_scope_tokens: ["intelligence_engine_activation", "release_readiness"], required_affects_layer_tokens: ["intelligence_engines", "intelligence_policy_rules", "platform_engine_policy_rules"] },
  { check_key: "model_never_executes_tools", policy_group: "Agent Runtime Governance", policy_key: "model_never_executes_tools_policy_v1", required_blocking: true, required_scope_tokens: ["agent_loop", "model_tool_loop", "tool_use"], required_affects_layer_tokens: ["agentLoopRunner", "agentRuntime", "platformEngineRegistry"] },
  { check_key: "domain_generalization_before_provider_specific", policy_group: "Domain Architecture Governance", policy_key: "domain_generalization_before_provider_specific_policy_v1", required_blocking: true, required_scope_tokens: ["provider_adapter", "provider_surface"], required_affects_layer_tokens: ["ads_provider_preflight_contract_registry", "ads_provider_preflight_surface_blueprint_registry"] },
  { check_key: "legacy_surface_bridge", policy_group: "Legacy Migration Governance", policy_key: "legacy_surface_bridge_policy_v1", required_blocking: true, required_scope_tokens: ["legacy_surface", "migration_bridge"], required_affects_layer_tokens: ["execution_policies", "platform_pending_tasks", "policy_logic_bindings"] },
  { check_key: "session_memory_reliability", policy_group: "Session Memory Governance", policy_key: "session_memory_reliability_policy_v1", required_blocking: true, required_scope_tokens: ["session_memory", "gpt_session_turns"], required_affects_layer_tokens: ["gpt_session_turns", "session_summaries", "release_session_archive_smoke"] },
  { check_key: "release_readiness_orchestration_gate", policy_group: "Release Governance", policy_key: "release_readiness_orchestration_gate_policy_v1", required_blocking: true, required_scope_tokens: ["release_readiness", "pr_gate"], required_affects_layer_tokens: ["releaseReadiness", "openapi.yaml", "admin_platform_endpoint_tools"] },
  { check_key: "development_drift_detection", policy_group: "Development Drift Governance", policy_key: "development_drift_detection_policy_v1", required_blocking: true, required_scope_tokens: ["architecture_drift", "release_readiness"], required_affects_layer_tokens: ["releaseReadiness", "platform_data_source_census"] },
  { check_key: "final_pattern_enforcement", policy_group: "Platform Development Constitution", policy_key: "final_pattern_enforcement_policy_v1", required_blocking: true, required_scope_tokens: ["platform_development", "runtime_execution", "release_readiness"], required_affects_layer_tokens: ["execution_policies", "releaseReadiness", "platform_engine_policy_rules"] },
];

// ── All platform tables that must exist ───────────────────────────────────────
const REQUIRED_TABLES = [
  // Sprint 02
  "tenants", "tenant_relationships", "memberships", "invitations",
  // Sprint 03
  "users", "actor_profiles", "role_assignments", "plans",
  "subscriptions", "entitlements", "assistance_roles",
  // Sprint 04
  "customers", "contacts", "threads", "tickets", "timeline_events",
  // Sprint 05
  "logic_definitions", "logic_packs", "pack_attachments", "adaptation_records",
  // Sprint 06
  "request_envelopes",
  // Sprint 07
  "connected_systems", "installations", "permission_grants", "workspace_registry",
  // Sprint 08
  "intent_resolutions", "execution_plans",
  // Sprint 10
  "tracking_workspaces", "tracked_events", "reporting_views",
  // Sprint 12
  "onboarding_states", "readiness_checks",
  // Sprint 14
  "workflow_runs", "step_runs", "approval_holds",
  // Sprint 15
  "telemetry_spans", "usage_meters", "quota_rules",
  // Sprint 16
  "audit_log", "secret_references", "incidents", "compliance_profiles",
  // Sprint 17
  "developer_apps", "api_credentials", "webhooks", "rate_limit_rules",
  // Sprint 18
  "data_migration_inventory", "release_readiness_log",
];

// ── Legacy tables that must still be reachable ────────────────────────────────
const LEGACY_TABLES = [
  "brands", "actions", "endpoints", "execution_policies",
  "task_routes", "workflows", "execution_log",
];

const MIGRATION_REGISTRY_REQUIREMENTS = [
  { key: "admin_tools", table: "admin_platform_endpoint_tools", column: "tool_key", insertTable: "admin_platform_endpoint_tools" },
  { key: "tenant_tools", table: "tenant_platform_endpoint_tools", column: "tool_key", insertTable: "tenant_platform_endpoint_tools" },
  { key: "engines", table: "platform_engine_registry", column: "engine_key", insertTable: "platform_engine_registry" },
  { key: "engine_policies", table: "platform_engine_policy_registry", column: "policy_key", insertTable: "platform_engine_policy_registry" },
  { key: "engine_strategies", table: "platform_engine_strategy_registry", column: "strategy_key", insertTable: "platform_engine_strategy_registry" },
  { key: "engine_rules", table: "platform_engine_policy_rules", column: "rule_key", insertTable: "platform_engine_policy_rules" },
  { key: "engine_skills", table: "platform_engine_skill_prompt_registry", column: "skill_key", insertTable: "platform_engine_skill_prompt_registry" },
];

function compactList(values = [], limit = 50) {
  return Array.from(new Set(values.filter(Boolean))).sort().slice(0, limit);
}

function unescapeSqlString(value = "") {
  return String(value || "").replace(/''/g, "'");
}

function stripSqlStringLiterals(sql = "") {
  let out = "";
  let inString = false;
  for (let i = 0; i < String(sql || "").length; i += 1) {
    const ch = sql[i];
    if (!inString) {
      if (ch === "'") {
        inString = true;
        out += " ";
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === "'" && sql[i + 1] === "'") {
      out += "  ";
      i += 1;
      continue;
    }
    if (ch === "'") {
      inString = false;
      out += " ";
    } else {
      out += " ";
    }
  }
  return out;
}

const RESERVED_SCHEMA_OBJECT_NAMES = new Set(["IF", "NOT", "EXISTS", "SELECT", "AS"]);

export function extractMigrationReadinessRequirementsFromSql(sqlText = "") {
  const sql = String(sqlText || "");
  const schemaScanSql = stripSqlStringLiterals(stripSqlComments(sql));
  const schemaObjects = new Set();
  const requirements = {
    schema_objects: [],
    admin_tools: [],
    tenant_tools: [],
    engines: [],
    engine_policies: [],
    engine_strategies: [],
    engine_rules: [],
    engine_skills: [],
  };

  const createObjectRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
  for (const match of schemaScanSql.matchAll(createObjectRegex)) {
    const objectName = String(match?.[1] || "").trim();
    if (objectName && !RESERVED_SCHEMA_OBJECT_NAMES.has(objectName.toUpperCase())) {
      schemaObjects.add(objectName);
    }
  }

  for (const config of MIGRATION_REGISTRY_REQUIREMENTS) {
    for (const key of extractFirstColumnInsertKeys(sql, config.insertTable)) {
      requirements[config.key].push(key);
    }
  }

  requirements.schema_objects = compactList([...schemaObjects], 5000);
  for (const key of Object.keys(requirements)) {
    requirements[key] = compactList(requirements[key], 5000);
  }
  return requirements;
}

function extractFirstColumnInsertKeys(sql = "", tableName = "") {
  const escapedTable = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const insertRegex = new RegExp(`\\bINSERT\\s+(?:IGNORE\\s+)?INTO\\s+\`?${escapedTable}\`?\\b`, "i");
  const keys = new Set();
  for (const statement of splitSqlStatements(sql)) {
    if (!insertRegex.test(statement)) continue;
    const valuesIndex = statement.search(/\bVALUES\b/i);
    if (valuesIndex === -1) continue;
    const onDuplicateIndex = statement.search(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i);
    const valuesPart = statement.slice(valuesIndex, onDuplicateIndex === -1 ? undefined : onDuplicateIndex);
    for (const tuple of extractTopLevelSqlTuples(valuesPart)) {
      const firstValue = firstSqlStringValue(tuple);
      if (firstValue) keys.add(firstValue);
    }
  }
  return [...keys];
}

function extractTopLevelSqlTuples(sql = "") {
  const tuples = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'" && sql[i + 1] === "'") {
        i += 1;
      } else if (ch === "'") {
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === "(") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        tuples.push(sql.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return tuples;
}

function firstSqlStringValue(tuple = "") {
  return sqlStringValues(tuple)[0] || null;
}

function sqlStringValues(tuple = "") {
  const values = [];
  for (let i = 0; i < tuple.length; i += 1) {
    if (tuple[i] !== "'") continue;
    i += 1;
    let value = "";
    for (; i < tuple.length; i += 1) {
      const ch = tuple[i];
      if (ch === "'" && tuple[i + 1] === "'") {
        value += "'";
        i += 1;
        continue;
      }
      if (ch === "'") {
        values.push(value);
        break;
      }
      value += ch;
    }
  }
  return values;
}

function extractAdminToolMetadataFromSql(sql = "") {
  const metadata = {};
  const insertRegex = /INSERT\s+INTO\s+`?admin_platform_endpoint_tools`?[\s\S]*?;/gi;
  for (const statementMatch of String(sql || "").matchAll(insertRegex)) {
    const statement = statementMatch[0] || "";
    const valuesIndex = statement.search(/\bVALUES\b/i);
    if (valuesIndex === -1) continue;
    const valuesPart = statement.slice(valuesIndex);
    for (const tuple of extractTopLevelSqlTuples(valuesPart)) {
      const values = sqlStringValues(tuple);
      const toolKey = values[0];
      if (!toolKey) continue;
      metadata[toolKey] = {
        http_method: values[3] || null,
        http_path: values[4] || null,
      };
    }
  }
  return metadata;
}

export function extractNamedToolKeysFromSource(source = "") {
  const names = new Set();
  const nameRegex = /\bname\s*:\s*["']([A-Za-z0-9_.:-]+)["']/g;
  for (const match of String(source || "").matchAll(nameRegex)) {
    if (match?.[1]) names.add(match[1]);
  }
  return compactList([...names], 10000);
}

function extractOpenApiPathsFromSource(source = "") {
  const paths = new Set();
  const pathRegex = /^\s{2}(\/[A-Za-z0-9_{}:./-]+):\s*$/gm;
  for (const match of String(source || "").matchAll(pathRegex)) {
    if (match?.[1]) paths.add(match[1]);
  }
  return compactList([...paths], 10000);
}

function extractExpressRoutePathsFromSource(source = "") {
  const paths = new Set();
  const routeRegex = /\brouter\.(?:get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g;
  for (const match of String(source || "").matchAll(routeRegex)) {
    if (match?.[1]) paths.add(match[1]);
  }
  return compactList([...paths], 10000);
}

async function readRoutePathsFromRoutesDir() {
  const routePaths = [];
  const entries = await fs.readdir(ROUTES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const source = await fs.readFile(path.join(ROUTES_DIR, entry.name), "utf8");
    routePaths.push(...extractExpressRoutePathsFromSource(source));
  }
  return compactList(routePaths, 10000);
}

async function readMigrationDriftReplacementSurfaces() {
  const [systemLayerResult, gptToolsResult, openapiResult, routePathsResult] = await Promise.allSettled([
    fs.readFile(SYSTEM_LAYER_ROUTES_PATH, "utf8"),
    fs.readFile(GPT_TOOLS_ROUTES_PATH, "utf8"),
    fs.readFile(OPENAPI_PATH, "utf8"),
    readRoutePathsFromRoutesDir(),
  ]);
  return {
    system_layer_tools: systemLayerResult.status === "fulfilled"
      ? extractNamedToolKeysFromSource(systemLayerResult.value)
      : [],
    virtual_admin_tools: gptToolsResult.status === "fulfilled"
      ? extractNamedToolKeysFromSource(gptToolsResult.value)
      : [],
    documented_paths: openapiResult.status === "fulfilled"
      ? extractOpenApiPathsFromSource(openapiResult.value)
      : [],
    live_route_paths: routePathsResult.status === "fulfilled" ? routePathsResult.value : [],
  };
}

async function readMigrationDriftReplacementSurfacesSafe() {
  try {
    return await readMigrationDriftReplacementSurfaces();
  } catch {
    return { system_layer_tools: [], virtual_admin_tools: [], documented_paths: [], live_route_paths: [] };
  }
}

function classifyNames(names = [], classifier) {
  const result = {};
  for (const name of compactList(names, 10000)) {
    const classification = classifier(name);
    if (!result[classification]) result[classification] = [];
    result[classification].push(name);
  }
  for (const key of Object.keys(result)) result[key] = compactList(result[key], 10000);
  return result;
}

function countClassified(classification = {}) {
  return Object.fromEntries(
    Object.entries(classification).map(([key, values]) => [key, Array.isArray(values) ? values.length : 0])
  );
}

export function classifyMigrationDriftMissing(missing = {}, replacementSurfaces = {}, artifactMetadata = {}) {
  const systemLayerTools = new Set(replacementSurfaces.system_layer_tools || []);
  const virtualAdminTools = new Set(replacementSurfaces.virtual_admin_tools || []);
  const documentedPaths = new Set(replacementSurfaces.documented_paths || []);
  const liveRoutePaths = new Set(replacementSurfaces.live_route_paths || []);
  const adminToolMetadata = artifactMetadata.admin_tools || {};
  const classification = {
    schema_objects: classifyNames(missing.schema_objects, () => "migration_apply_candidate"),
    admin_tools: classifyNames(missing.admin_tools, (name) => {
      if (DEPRECATED_DB_BOOTSTRAP_REPLACED_ADMIN_TOOLS.has(name)) return "deprecated_replaced_by_db_bootstrap";
      if (systemLayerTools.has(name)) return "system_layer_replacement_present";
      if (virtualAdminTools.has(name)) return "virtual_replacement_present";
      const httpPath = adminToolMetadata?.[name]?.http_path;
      if (httpPath && liveRoutePaths.has(httpPath)) return "live_route_registry_exposure_missing";
      if (httpPath && documentedPaths.has(httpPath)) return "documented_route_registry_exposure_missing";
      return "missing_required_runtime_artifact";
    }),
    tenant_tools: classifyNames(missing.tenant_tools, () => "missing_required_runtime_artifact"),
    engines: classifyNames(missing.engines, () => "migration_apply_candidate"),
    engine_policies: classifyNames(missing.engine_policies, () => "migration_apply_candidate"),
    engine_strategies: classifyNames(missing.engine_strategies, () => "migration_apply_candidate"),
    engine_rules: classifyNames(missing.engine_rules, () => "migration_apply_candidate"),
    engine_skills: classifyNames(missing.engine_skills, () => "migration_apply_candidate"),
  };
  const counts = Object.fromEntries(
    Object.entries(classification).map(([surface, classes]) => [surface, countClassified(classes)])
  );
  return {
    classification,
    counts,
    replacement_surface_counts: {
      system_layer_tools: systemLayerTools.size,
      virtual_admin_tools: virtualAdminTools.size,
      documented_paths: documentedPaths.size,
      live_route_paths: liveRoutePaths.size,
    },
  };
}

export function splitSqlStatements(sql = "") {
  const boundaryStart = "(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TABLE|VIEW)|CREATE\\s+(?:UNIQUE\\s+)?INDEX|INSERT\\s+(?:IGNORE\\s+)?INTO|UPDATE\\s+`?[A-Za-z0-9_]+`?|ALTER\\s+TABLE|DROP\\s+TABLE|TRUNCATE\\s+TABLE|DELETE\\s+FROM)\\b";
  const interStatementTrivia = "(?:\\s|--[^\\n]*(?:\\n|$)|/\\*[\\s\\S]*?\\*/)*";
  const statementBoundary = new RegExp(`;${interStatementTrivia}(?=${interStatementTrivia}(?:${boundaryStart})|$)`, "i");
  return String(sql || "")
    .split(statementBoundary)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function stripSqlComments(sql = "") {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
}

function hasTopLevelSqlKeyword(sql = "", keyword = "") {
  const source = stripSqlComments(stripSqlStringLiterals(sql)).replace(/--[^\n]*(?:\n|$)/g, "");
  const target = String(keyword || "").toUpperCase();
  let depth = 0;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || source.slice(i, i + target.length).toUpperCase() !== target) continue;

    const before = source[i - 1] || "";
    const after = source[i + target.length] || "";
    if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) return true;
  }
  return false;
}

export function assessMigrationSqlPreflight(filename = "", sqlText = "") {
  const statements = splitSqlStatements(sqlText);
  const risks = [];
  const counts = {
    statements: statements.length,
    create_table: 0,
    create_table_idempotent: 0,
    create_view: 0,
    create_view_idempotent: 0,
    create_index: 0,
    create_index_idempotent: 0,
    insert: 0,
    insert_idempotent: 0,
    update: 0,
    update_guarded: 0,
    alter_table: 0,
    alter_table_idempotent: 0,
    destructive: 0,
  };

  for (const statement of statements) {
    const normalized = statement
      .replace(/^\s*(?:--[^\n]*\n\s*)+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/^CREATE\s+TABLE\b/i.test(normalized)) {
      counts.create_table += 1;
      if (/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(normalized)) {
        counts.create_table_idempotent += 1;
      } else {
        risks.push({ severity: "warn", code: "create_table_without_if_not_exists", statement: normalized.slice(0, 140) });
      }
    }
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i.test(normalized)) {
      counts.create_view += 1;
      if (/^CREATE\s+OR\s+REPLACE\s+VIEW\b/i.test(normalized)) {
        counts.create_view_idempotent += 1;
      } else {
        risks.push({ severity: "warn", code: "create_view_without_or_replace", statement: normalized.slice(0, 140) });
      }
    }
    if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(normalized)) {
      counts.create_index += 1;
      if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i.test(normalized)) {
        counts.create_index_idempotent += 1;
      } else {
        risks.push({ severity: "warn", code: "create_index_without_if_not_exists", statement: normalized.slice(0, 140) });
      }
    }
    if (/^INSERT\s+(?:IGNORE\s+)?INTO\b/i.test(normalized)) {
      counts.insert += 1;
      if (
        /^INSERT\s+IGNORE\s+INTO\b/i.test(normalized)
        || /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(normalized)
        || (
          /\bINSERT\s+INTO\b[\s\S]*\bSELECT\b/i.test(normalized)
          && /\b(?:WHERE|AND)\s+NOT\s+EXISTS\s*\(/i.test(normalized)
        )
      ) {
        counts.insert_idempotent += 1;
      } else {
        risks.push({ severity: "warn", code: "insert_without_ignore_or_on_duplicate", statement: normalized.slice(0, 140) });
      }
    }
    if (/^UPDATE\s+`?[A-Za-z0-9_]+`?\b/i.test(normalized)) {
      counts.update += 1;
      if (hasTopLevelSqlKeyword(statement, "WHERE")) {
        counts.update_guarded += 1;
      } else {
        risks.push({ severity: "warn", code: "update_without_where", statement: normalized.slice(0, 140) });
      }
    }
    if (/^ALTER\s+TABLE\b/i.test(normalized)) {
      counts.alter_table += 1;
      if (/^ALTER\s+TABLE\s+`?[A-Za-z0-9_]+`?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.test(normalized)) {
        counts.alter_table_idempotent += 1;
      } else if (/^ALTER\s+TABLE\s+`?admin_platform_endpoint_tools`?\s+MODIFY\s+COLUMN\s+`?tags`?\s+TEXT\b/i.test(normalized)) {
        counts.alter_table_idempotent += 1;
      } else {
        risks.push({ severity: "warn", code: "alter_table_requires_manual_idempotency_review", statement: normalized.slice(0, 140) });
      }
    }
    if (/^(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i.test(normalized)) {
      counts.destructive += 1;
      risks.push({ severity: "fail", code: "destructive_statement_detected", statement: normalized.slice(0, 140) });
    }
  }

  const status = risks.some((risk) => risk.severity === "fail") ? "fail" : risks.length ? "warn" : "pass";
  return {
    filename,
    status,
    counts,
    risk_count: risks.length,
    risks: risks.slice(0, 25),
    secrets_included: false,
  };
}

async function buildMigrationApplyPreflight(candidateFiles = [], { migrationsDir = MIGRATIONS_DIR } = {}) {
  const files = compactList(candidateFiles, 100);
  const file_reports = [];
  for (const file of files) {
    try {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      file_reports.push(assessMigrationSqlPreflight(file, sql));
    } catch (err) {
      file_reports.push({
        filename: file,
        status: "warn",
        counts: {},
        risk_count: 1,
        risks: [{ severity: "warn", code: "migration_file_unavailable", detail: err?.message || "read failed" }],
        secrets_included: false,
      });
    }
  }
  const status = file_reports.some((report) => report.status === "fail")
    ? "fail"
    : file_reports.some((report) => report.status === "warn") ? "warn" : "pass";
  return {
    mode: "dry_run",
    applies_sql: false,
    status,
    files_checked: file_reports.length,
    risk_count: file_reports.reduce((sum, report) => sum + Number(report.risk_count || 0), 0),
    file_reports,
    secrets_included: false,
  };
}

async function buildMigrationApplyPreflightSafe(candidateFiles = []) {
  try {
    return await buildMigrationApplyPreflight(candidateFiles);
  } catch (err) {
    return {
      mode: "dry_run",
      applies_sql: false,
      status: "warn",
      files_checked: 0,
      risk_count: 1,
      file_reports: [],
      error: err?.message || "migration apply preflight failed",
      secrets_included: false,
    };
  }
}

export function buildMigrationDriftApplyPlan(missing = {}, missingClassification = {}, artifactSources = {}) {
  const applySurfaces = [
    "schema_objects",
    "engines",
    "engine_policies",
    "engine_strategies",
    "engine_rules",
    "engine_skills",
  ];
  const candidateFiles = new Set();
  const candidatesBySurface = {};
  for (const surface of applySurfaces) {
    const itemKeys = missingClassification?.classification?.[surface]?.migration_apply_candidate || [];
    candidatesBySurface[surface] = compactList(itemKeys, 10000).map((item_key) => {
      const source_files = sourceFilesFor(artifactSources, surface, item_key, 20);
      for (const file of source_files) candidateFiles.add(file);
      return { item_key, source_files };
    });
  }
  const adminToolReview = compactList(
    missingClassification?.classification?.admin_tools?.missing_required_runtime_artifact || [],
    10000
  ).map((item_key) => ({
    item_key,
    source_files: sourceFilesFor(artifactSources, "admin_tools", item_key, 20),
    recommended_action: "review_registry_tool_surface_or_reseed_specific_tool",
  }));
  for (const item of adminToolReview) {
    for (const file of item.source_files) candidateFiles.add(file);
  }
  return {
    mode: "dry_run",
    applies_sql: false,
    candidate_files: compactList([...candidateFiles], 100),
    candidates_by_surface: candidatesBySurface,
    admin_tool_review: adminToolReview,
    notes: [
      "This plan is diagnostic only; no SQL was applied.",
      "Schema and engine artifacts are migration apply candidates.",
      "Admin tools marked missing_required_runtime_artifact need registry-surface review before reseeding.",
    ],
    secrets_included: false,
  };
}

function mergeMigrationRequirements(target, source) {
  for (const [key, values] of Object.entries(source || {})) {
    if (!Array.isArray(values)) continue;
    if (!target[key]) target[key] = [];
    target[key].push(...values);
  }
  return target;
}

function emptyMigrationArtifactSourceMap() {
  return {
    schema_objects: {},
    admin_tools: {},
    tenant_tools: {},
    engines: {},
    engine_policies: {},
    engine_strategies: {},
    engine_rules: {},
    engine_skills: {},
  };
}

function emptyMigrationArtifactMetadataMap() {
  return {
    admin_tools: {},
  };
}

function noteAdminToolMetadata(target, metadata, filename) {
  for (const [toolKey, info] of Object.entries(metadata || {})) {
    if (!toolKey) continue;
    target.admin_tools[toolKey] = {
      ...(target.admin_tools[toolKey] || {}),
      ...info,
      source_files: compactList([...(target.admin_tools[toolKey]?.source_files || []), filename], 50),
    };
  }
  return target;
}

function noteMigrationRequirementSources(target, requirements, filename) {
  for (const [surface, values] of Object.entries(requirements || {})) {
    if (!Array.isArray(values)) continue;
    if (!target[surface]) target[surface] = {};
    for (const value of values) {
      if (!value) continue;
      if (!target[surface][value]) target[surface][value] = [];
      target[surface][value].push(filename);
    }
  }
  return target;
}

function sourceFilesFor(artifactSources = {}, surface = "", itemKey = "", limit = 10) {
  return compactList(artifactSources?.[surface]?.[itemKey] || [], limit);
}

function sourceSamplesForMissing(missing = {}, artifactSources = {}, limit = 25) {
  return Object.fromEntries(
    Object.entries(missing).map(([surface, values]) => [
      surface,
      Object.fromEntries(
        compactList(values, limit).map((itemKey) => [itemKey, sourceFilesFor(artifactSources, surface, itemKey, 10)])
      ),
    ])
  );
}

function visibleMigrationMissingSamples(missing = {}, missingClassification = {}, limit = 25) {
  const hiddenAdminTools = new Set(
    missingClassification?.classification?.admin_tools?.deprecated_replaced_by_db_bootstrap || []
  );
  return Object.fromEntries(
    Object.entries(missing).map(([surface, values]) => {
      const filtered = surface === "admin_tools"
        ? (values || []).filter((value) => !hiddenAdminTools.has(value))
        : values;
      return [surface, compactList(filtered, limit)];
    })
  );
}

export function actionableMigrationDriftCounts(missing = {}, missingClassification = {}) {
  const adminCounts = missingClassification?.counts?.admin_tools || {};
  const counts = {
    schema_objects: Array.isArray(missing.schema_objects) ? missing.schema_objects.length : 0,
    admin_tools: Number(adminCounts.missing_required_runtime_artifact || 0)
      + Number(adminCounts.live_route_registry_exposure_missing || 0)
      + Number(adminCounts.documented_route_registry_exposure_missing || 0),
    tenant_tools: Array.isArray(missing.tenant_tools) ? missing.tenant_tools.length : 0,
    engines: Array.isArray(missing.engines) ? missing.engines.length : 0,
    engine_policies: Array.isArray(missing.engine_policies) ? missing.engine_policies.length : 0,
    engine_strategies: Array.isArray(missing.engine_strategies) ? missing.engine_strategies.length : 0,
    engine_rules: Array.isArray(missing.engine_rules) ? missing.engine_rules.length : 0,
    engine_skills: Array.isArray(missing.engine_skills) ? missing.engine_skills.length : 0,
  };
  return {
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0),
  };
}

function buildAdminToolRouteEvidence(missingAdminTools = [], replacementSurfaces = {}, artifactMetadata = {}, limit = 50) {
  const systemLayerTools = new Set(replacementSurfaces.system_layer_tools || []);
  const virtualAdminTools = new Set(replacementSurfaces.virtual_admin_tools || []);
  const documentedPaths = new Set(replacementSurfaces.documented_paths || []);
  const liveRoutePaths = new Set(replacementSurfaces.live_route_paths || []);
  const adminToolMetadata = artifactMetadata.admin_tools || {};
  return Object.fromEntries(
    compactList(missingAdminTools, limit).map((toolKey) => {
      const info = adminToolMetadata[toolKey] || {};
      const httpPath = info.http_path || null;
      return [toolKey, {
        http_method: info.http_method || null,
        http_path: httpPath,
        source_files: compactList(info.source_files || [], 10),
        system_layer_tool_present: systemLayerTools.has(toolKey),
        virtual_admin_tool_present: virtualAdminTools.has(toolKey),
        live_route_present: Boolean(httpPath && liveRoutePaths.has(httpPath)),
        documented_path_present: Boolean(httpPath && documentedPaths.has(httpPath)),
        recommended_action: systemLayerTools.has(toolKey) || virtualAdminTools.has(toolKey)
          ? "document_replacement_and_exclude_from_hard_drift"
          : httpPath && (liveRoutePaths.has(httpPath) || documentedPaths.has(httpPath))
            ? "restore_registry_exposure_or_document_deprecation"
            : "investigate_missing_runtime_surface_before_reseed",
      }];
    })
  );
}

async function readDynamicMigrationRequirements({ migrationsDir = MIGRATIONS_DIR } = {}) {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const requirements = {
    schema_objects: [],
    admin_tools: [],
    tenant_tools: [],
    engines: [],
    engine_policies: [],
    engine_strategies: [],
    engine_rules: [],
    engine_skills: [],
  };
  const artifact_sources = emptyMigrationArtifactSourceMap();
  const artifact_metadata = emptyMigrationArtifactMetadataMap();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const parsed = extractMigrationReadinessRequirementsFromSql(sql);
    const adminToolMetadata = extractAdminToolMetadataFromSql(sql);
    mergeMigrationRequirements(requirements, parsed);
    noteMigrationRequirementSources(artifact_sources, parsed, file);
    noteAdminToolMetadata(artifact_metadata, adminToolMetadata, file);
  }
  for (const key of Object.keys(requirements)) {
    requirements[key] = compactList(requirements[key], 10000);
  }
  for (const surface of Object.keys(artifact_sources)) {
    for (const itemKey of Object.keys(artifact_sources[surface] || {})) {
      artifact_sources[surface][itemKey] = compactList(artifact_sources[surface][itemKey], 50);
    }
  }
  return { files_scanned: files.length, requirements, artifact_sources, artifact_metadata };
}

async function lookupExistingNames({ table, column, names }) {
  const wanted = compactList(names, 10000);
  if (!wanted.length) return { table_exists: true, existing: new Set(), missing: [] };

  const [[tableRow]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [table]
  );
  if (!tableRow?.cnt) {
    return { table_exists: false, existing: new Set(), missing: wanted };
  }

  const [rows] = await getPool().query(
    `SELECT \`${column}\` AS item_key FROM \`${table}\` WHERE \`${column}\` IN (?)`,
    [wanted]
  );
  const existing = new Set((rows || []).map((row) => String(row.item_key)));
  return { table_exists: true, existing, missing: wanted.filter((name) => !existing.has(name)) };
}

async function lookupExistingSchemaObjects(names = []) {
  const wanted = compactList(names, 10000);
  if (!wanted.length) return { existing: new Set(), missing: [] };
  const [rows] = await getPool().query(
    "SELECT table_name AS item_key FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?)",
    [wanted]
  );
  const existing = new Set((rows || []).map((row) => String(row.item_key)));
  return { existing, missing: wanted.filter((name) => !existing.has(name)) };
}

async function checkDynamicMigrationDrift() {
  const migrationLoad = await readDynamicMigrationRequirements();
  const requirements = migrationLoad.requirements;
  const schemaResult = await lookupExistingSchemaObjects(requirements.schema_objects);
  const missing = {
    schema_objects: schemaResult.missing,
  };
  const registry_tables_missing = [];

  for (const config of MIGRATION_REGISTRY_REQUIREMENTS) {
    const result = await lookupExistingNames({
      table: config.table,
      column: config.column,
      names: requirements[config.key],
    });
    if (!result.table_exists) registry_tables_missing.push(config.table);
    missing[config.key] = result.missing;
  }

  const discovered_counts = Object.fromEntries(
    Object.entries(requirements).map(([key, values]) => [key, Array.isArray(values) ? values.length : 0])
  );
  const missing_counts = Object.fromEntries(
    Object.entries(missing).map(([key, values]) => [key, Array.isArray(values) ? values.length : 0])
  );
  const missing_total = Object.values(missing_counts).reduce((sum, count) => sum + Number(count || 0), 0)
    + registry_tables_missing.length;
  const replacement_surfaces = await readMigrationDriftReplacementSurfacesSafe();
  const missing_classification = classifyMigrationDriftMissing(
    missing,
    replacement_surfaces,
    migrationLoad.artifact_metadata
  );
  const actionable_missing = actionableMigrationDriftCounts(missing, missing_classification);
  const missing_source_samples = sourceSamplesForMissing(missing, migrationLoad.artifact_sources, 25);
  const admin_tool_route_evidence = buildAdminToolRouteEvidence(
    missing.admin_tools,
    replacement_surfaces,
    migrationLoad.artifact_metadata,
    50
  );
  const migration_apply_plan = buildMigrationDriftApplyPlan(
    missing,
    missing_classification,
    migrationLoad.artifact_sources
  );
  const migration_apply_preflight = await buildMigrationApplyPreflightSafe(migration_apply_plan.candidate_files);

  return {
    status: actionable_missing.total > 0 ? "warn" : "pass",
    detail: actionable_missing.total > 0
      ? `Dynamic migration drift detected: ${actionable_missing.total} actionable migration artifact gap(s) remain; ${missing_total} raw missing artifact(s) were classified.`
      : missing_total > 0
        ? `Dynamic migration drift check passed across ${migrationLoad.files_scanned} migration file(s); ${missing_total} raw missing artifact(s) are satisfied by replacement surfaces.`
        : `Dynamic migration drift check passed across ${migrationLoad.files_scanned} migration file(s).`,
    files_scanned: migrationLoad.files_scanned,
    discovered_counts,
    missing_counts,
    missing_total,
    actionable_missing_counts: actionable_missing.counts,
    actionable_missing_total: actionable_missing.total,
    registry_tables_missing: compactList(registry_tables_missing, 50),
    missing_samples: visibleMigrationMissingSamples(missing, missing_classification, 25),
    deprecated_replaced_samples: {
      admin_tools: compactList(
        missing_classification?.classification?.admin_tools?.deprecated_replaced_by_db_bootstrap || [],
        25
      ),
    },
    missing_source_samples,
    admin_tool_route_evidence,
    missing_classification,
    migration_apply_plan,
    migration_apply_preflight,
    secrets_included: false,
  };
}

async function checkDynamicMigrationDriftSafe() {
  try {
    return await checkDynamicMigrationDrift();
  } catch (err) {
    return {
      status: "warn",
      detail: `Dynamic migration drift check unavailable: ${err?.message || "unknown error"}`,
      files_scanned: 0,
      discovered_counts: {},
      missing_counts: {},
      missing_total: null,
      registry_tables_missing: [],
      missing_samples: {},
      secrets_included: false,
    };
  }
}

async function checkPlatformSecretPromotionMonitoring() {
  const pool = getPool();
  const [[summaryViewRow]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'v_platform_secret_promotion_monitoring_summary'"
  );
  const [[issuesViewRow]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'v_platform_secret_promotion_monitoring_issues'"
  );
  if (!summaryViewRow?.cnt || !issuesViewRow?.cnt) {
    return {
      status: "fail",
      detail: "Platform secret promotion monitoring views are missing.",
      views_present: false,
      promoted_secret_rows: 0,
      issue_rows: null,
      issues: [],
      secrets_included: false,
    };
  }

  const [[summary]] = await pool.query(
    "SELECT promoted_secret_rows, passing_rows, issue_rows, storage_issue_rows, reference_issue_rows, source_connection_issue_rows FROM v_platform_secret_promotion_monitoring_summary LIMIT 1"
  );
  const issueRows = Number(summary?.issue_rows || 0);
  const [issues] = await pool.query(
    `SELECT secret_key, connection_id, issue_code, evidence_json
       FROM v_platform_secret_promotion_monitoring_issues
      ORDER BY secret_key
      LIMIT 25`
  );

  return {
    status: issueRows > 0 ? "fail" : "pass",
    detail: issueRows > 0
      ? `Platform secret promotion monitoring found ${issueRows} issue row(s).`
      : `Platform secret promotion monitoring passed for ${Number(summary?.promoted_secret_rows || 0)} promoted platform secret row(s).`,
    views_present: true,
    promoted_secret_rows: Number(summary?.promoted_secret_rows || 0),
    passing_rows: Number(summary?.passing_rows || 0),
    issue_rows: issueRows,
    storage_issue_rows: Number(summary?.storage_issue_rows || 0),
    reference_issue_rows: Number(summary?.reference_issue_rows || 0),
    source_connection_issue_rows: Number(summary?.source_connection_issue_rows || 0),
    issues,
    secrets_included: false,
  };
}

async function checkPlatformSecretPromotionMonitoringSafe() {
  try {
    return await checkPlatformSecretPromotionMonitoring();
  } catch (err) {
    return {
      status: "warn",
      detail: `Platform secret promotion monitoring unavailable: ${err?.message || "unknown error"}`,
      promoted_secret_rows: null,
      issue_rows: null,
      issues: [],
      secrets_included: false,
    };
  }
}

async function checkGptSessionArchiveMonitoring() {
  const pool = getPool();
  const [[summaryViewRow]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'v_gpt_session_archive_monitoring_summary'"
  );
  const [[issuesViewRow]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'v_gpt_session_archive_monitoring_issues'"
  );
  if (!summaryViewRow?.cnt || !issuesViewRow?.cnt) {
    return {
      status: "fail",
      detail: "GPT session archive monitoring views are missing.",
      views_present: false,
      monitored_sessions: 0,
      fail_issue_rows: null,
      warn_issue_rows: null,
      issues: [],
      secrets_included: false,
    };
  }

  const [[summary]] = await pool.query(
    `SELECT monitored_sessions, fail_issue_rows, warn_issue_rows, total_issue_rows,
            archive_ready_sessions, sessions_with_jsonl, sessions_with_one_primary_ref,
            sessions_with_multiple_primary_refs, sessions_without_active_ref
       FROM v_gpt_session_archive_monitoring_summary
      LIMIT 1`
  );
  const failIssueRows = Number(summary?.fail_issue_rows || 0);
  const warnIssueRows = Number(summary?.warn_issue_rows || 0);
  const [issues] = await pool.query(
    `SELECT session_id, issue_code, severity, evidence_json
       FROM v_gpt_session_archive_monitoring_issues
      ORDER BY severity, issue_code, session_id
      LIMIT 50`
  );

  return {
    status: failIssueRows > 0 ? "fail" : "pass",
    detail: failIssueRows > 0
      ? `GPT session archive monitoring found ${failIssueRows} fail issue row(s) and ${warnIssueRows} warning row(s).`
      : `GPT session archive monitoring passed for ${Number(summary?.monitored_sessions || 0)} monitored GPT session(s); ${warnIssueRows} warning row(s) are informational.`,
    views_present: true,
    monitored_sessions: Number(summary?.monitored_sessions || 0),
    fail_issue_rows: failIssueRows,
    warn_issue_rows: warnIssueRows,
    total_issue_rows: Number(summary?.total_issue_rows || 0),
    archive_ready_sessions: Number(summary?.archive_ready_sessions || 0),
    sessions_with_jsonl: Number(summary?.sessions_with_jsonl || 0),
    sessions_with_one_primary_ref: Number(summary?.sessions_with_one_primary_ref || 0),
    sessions_with_multiple_primary_refs: Number(summary?.sessions_with_multiple_primary_refs || 0),
    sessions_without_active_ref: Number(summary?.sessions_without_active_ref || 0),
    issues,
    secrets_included: false,
  };
}

async function checkGptSessionArchiveMonitoringSafe() {
  try {
    return await checkGptSessionArchiveMonitoring();
  } catch (err) {
    return {
      status: "warn",
      detail: `GPT session archive monitoring unavailable: ${err?.message || "unknown error"}`,
      monitored_sessions: null,
      fail_issue_rows: null,
      warn_issue_rows: null,
      issues: [],
      secrets_included: false,
    };
  }
}

async function checkDbConnectivity() {
  try {
    await getPool().query("SELECT 1");
    return { status: "pass", detail: "DB connection OK." };
  } catch (err) {
    return { status: "fail", detail: `DB connection failed: ${err.message}` };
  }
}

async function checkDrCertificationEvidenceReadiness() {
  const required = [
    { key: "dr_certification.db_isolated_restore.latest", label: "db_isolated_restore", mode: "isolated_db_restore_mariadb" },
    { key: "dr_certification.n8n_isolated_restore_boot.latest", label: "n8n_isolated_restore_boot", mode: "isolated_n8n_restore_boot" },
  ];
  try {
    const [rows] = await getPool().query(
      "SELECT config_key, config_json, status, updated_at FROM platform_runtime_config WHERE config_key IN (?)",
      [required.map((item) => item.key)]
    );
    const byKey = new Map((rows || []).map((row) => [row.config_key, row]));
    const reports = required.map((item) => {
      const row = byKey.get(item.key);
      let config = null;
      try { config = row ? JSON.parse(row.config_json || "{}") : null; } catch { config = null; }
      const checks = [
        { key: "row_present", ok: Boolean(row) },
        { key: "status_active", ok: row?.status === "active" },
        { key: "config_json_valid", ok: Boolean(config) },
        { key: "ok_true", ok: config?.ok === true },
        { key: "mode_matches", ok: config?.mode === item.mode },
        { key: "production_untouched", ok: config?.production_touched === false },
        { key: "secrets_not_included", ok: config?.secrets_included === false },
      ];
      if (item.label === "db_isolated_restore") {
        checks.push(
          { key: "full_import_attempted", ok: config?.full_import_attempted === true },
          { key: "table_count_matches", ok: Number(config?.readback?.table_count || 0) >= Number(config?.readback?.expected_table_count || 1) },
          { key: "container_removed", ok: config?.cleanup?.container_removed === true },
          { key: "plaintext_sql_removed", ok: config?.cleanup?.plaintext_sql_removed === true },
        );
      }
      if (item.label === "n8n_isolated_restore_boot") {
        checks.push(
          { key: "isolated_boot_attempted", ok: config?.isolated_boot_attempted === true },
          { key: "health_ok", ok: config?.health?.ok === true && Number(config?.health?.status || 0) === 200 },
          { key: "structural_markers_present", ok: config?.structural_restore?.markers?.has_database_sqlite === true && config?.structural_restore?.markers?.has_config === true && config?.structural_restore?.markers?.has_nodes_dir === true },
          { key: "isolated_process_stopped", ok: config?.cleanup?.isolated_process_stopped === true },
          { key: "plaintext_zip_removed", ok: config?.cleanup?.plaintext_zip_removed === true },
          { key: "extracted_restore_removed", ok: config?.cleanup?.extracted_restore_removed === true },
        );
      }
      return {
        key: item.key,
        label: item.label,
        status: checks.every((check) => check.ok) ? "pass" : "fail",
        updated_at: row?.updated_at || null,
        evidence_path_present: Boolean(config?.evidence_path),
        checks,
        secrets_included: false,
      };
    });
    const status = reports.every((report) => report.status === "pass") ? "pass" : "fail";
    return { status, reports, secrets_included: false };
  } catch (err) {
    return { status: "warn", detail: `DR certification evidence readiness check failed: ${err.message}`, reports: [], secrets_included: false };
  }
}

async function checkRuntimeProductionParityGate() {
  try {
    const parity = await getRuntimeParity("production");
    const blockingGapCount = Number(parity.blocking_gap_count || 0);
    const verified = parity.production_parity === "verified" && blockingGapCount === 0;
    return {
      status: verified ? "pass" : "fail",
      production_parity: parity.production_parity || "unknown",
      latest_run_id: parity.latest_run_id || null,
      expected_commit_sha: parity.expected_commit_sha || null,
      deployed_commit_sha: parity.deployed_commit_sha || null,
      blocking_gap_count: blockingGapCount,
      readiness_classification: parity.readiness_classification || (verified ? "ready" : "blocked"),
      detail: verified
        ? "Runtime production parity is verified with no blocking gaps."
        : "Runtime production parity must be verified with zero blocking gaps before release readiness can pass.",
      secrets_included: false,
    };
  } catch (err) {
    return {
      status: "fail",
      production_parity: "unknown",
      blocking_gap_count: 1,
      detail: `Runtime production parity gate failed: ${err.message}`,
      secrets_included: false,
    };
  }
}

async function checkPlatformToolDispatchBindingIntegrity() {
  try {
    const [[row]] = await getPool().query(
      `SELECT COUNT(*) AS binding_count,
              SUM(endpoint_not_ready) AS endpoint_not_ready,
              SUM(missing_active_export) AS missing_exports,
              SUM(missing_active_dispatch_binding) AS missing_bindings,
              SUM(mutation_missing_capability_key) AS mutation_capability_gaps,
              SUM(binding_missing_readback_policy) AS readback_policy_gaps,
              SUM(db_callable_surface_missing) AS callable_surface_gaps
         FROM v_platform_tool_dispatch_integrity
        WHERE parent_action_key = 'github_api_mcp'`
    );
    const result = {
      binding_count: Number(row?.binding_count || 0),
      endpoint_not_ready: Number(row?.endpoint_not_ready || 0),
      missing_exports: Number(row?.missing_exports || 0),
      missing_bindings: Number(row?.missing_bindings || 0),
      mutation_capability_gaps: Number(row?.mutation_capability_gaps || 0),
      readback_policy_gaps: Number(row?.readback_policy_gaps || 0),
      callable_surface_gaps: Number(row?.callable_surface_gaps || 0),
    };
    const gapCount = Object.entries(result)
      .filter(([key]) => key !== "binding_count")
      .reduce((sum, [, value]) => sum + Number(value || 0), 0);
    const passed = result.binding_count === 14 && gapCount === 0;
    return {
      status: passed ? "pass" : "fail",
      detail: passed
        ? "GitHub tool dispatch integrity is healthy for 14/14 registered bindings."
        : `GitHub tool dispatch integrity expected 14 healthy bindings and found ${result.binding_count} with ${gapCount} gap(s).`,
      ...result,
      gap_count: gapCount,
      healthy_count: Math.max(0, result.binding_count - gapCount),
      secrets_included: false,
    };
  } catch (err) {
    return {
      status: "fail",
      detail: `Platform tool dispatch binding integrity check failed: ${err?.message || "unknown error"}`,
      binding_count: 0,
      healthy_count: 0,
      gap_count: 1,
      secrets_included: false,
    };
  }
}

async function checkTableExists(table) {
  try {
    const [[row]] = await getPool().query(
      "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      [table]
    );
    return row.cnt > 0
      ? { status: "pass", detail: `Table '${table}' exists.` }
      : { status: "fail", detail: `Table '${table}' is MISSING.` };
  } catch (err) {
    return { status: "fail", detail: `Check failed for '${table}': ${err.message}` };
  }
}

async function checkSeedData() {
  const checks = {};

  const [[plans]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `plans`");
  checks.plans_seeded = plans.cnt >= 4
    ? { status: "pass", detail: `${plans.cnt} plan(s) in DB (need ≥ 4).` }
    : { status: "fail", detail: `Only ${plans.cnt} plan(s) — run: node migrate-platform-tables.mjs --seed` };

  const [[roles]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `assistance_roles`");
  checks.assistance_roles_seeded = roles.cnt >= 7
    ? { status: "pass", detail: `${roles.cnt} assistance role(s) in DB (need ≥ 7).` }
    : { status: "fail", detail: `Only ${roles.cnt} role(s) — run: node migrate-platform-tables.mjs --seed` };

  const [[quotas]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `quota_rules`");
  checks.quota_rules_seeded = quotas.cnt >= 4
    ? { status: "pass", detail: `${quotas.cnt} quota rule(s) in DB (need ≥ 4).` }
    : { status: "warn", detail: `Only ${quotas.cnt} quota rule(s) — run: node migrate-platform-tables.mjs --seed` };

  const [[tenants]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `tenants`");
  checks.tenants_bootstrapped = tenants.cnt > 0
    ? { status: "pass", detail: `${tenants.cnt} tenant(s) provisioned.` }
    : { status: "warn", detail: "No tenants yet — run: node tenantBrandBridge.mjs --apply" };

  return checks;
}

async function checkMigrationInventory() {
  const [[row]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `data_migration_inventory`");
  return row.cnt > 0
    ? { status: "pass", detail: `Migration inventory has ${row.cnt} entity classification entries.` }
    : { status: "warn", detail: "Migration inventory is empty — entity classification not recorded." };
}

async function checkMigrationInventorySafe() {
  try {
    return await checkMigrationInventory();
  } catch (err) {
    return {
      status: "warn",
      detail: `Migration inventory unavailable: ${err?.message || "table check failed"}`
    };
  }
}

async function checkGovernedMigrationLedger() {
  const pool = getPool();
  const [[tableRow]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'governed_migration_ledger'"
  );
  if (!tableRow?.cnt) {
    return {
      status: "warn",
      detail: "Governed migration ledger table is missing.",
      table_exists: false,
      expected_count: EXPECTED_GOVERNED_LEDGER_MIGRATIONS.length,
      covered_count: 0,
      missing_expected_migrations: EXPECTED_GOVERNED_LEDGER_MIGRATIONS,
      secrets_included: false,
    };
  }

  const [modeRows] = await pool.query(
    "SELECT mode, COUNT(*) AS count FROM governed_migration_ledger GROUP BY mode ORDER BY mode"
  );
  const mode_counts = Object.fromEntries((modeRows || []).map((row) => [row.mode, Number(row.count || 0)]));

  const [coverageRows] = await pool.query(
    "SELECT migration_file, migration_checksum_sha256, mode, statement_count, preflight_status, preflight_risk_count, secrets_included, applied_at FROM governed_migration_ledger WHERE migration_file IN (?) ORDER BY applied_at ASC",
    [EXPECTED_GOVERNED_LEDGER_MIGRATIONS]
  );
  const covered = new Set((coverageRows || []).map((row) => String(row.migration_file)));
  const missing_expected_migrations = EXPECTED_GOVERNED_LEDGER_MIGRATIONS.filter((file) => !covered.has(file));
  const risky_entries = (coverageRows || []).filter((row) =>
    String(row.preflight_status || "") !== "pass"
    || Number(row.preflight_risk_count || 0) > 0
    || Number(row.secrets_included || 0) !== 0
  );
  const [[latestApplyRow]] = await pool.query(
    "SELECT migration_file, migration_checksum_sha256, mode, statement_count, preflight_status, preflight_risk_count, secrets_included, applied_at FROM governed_migration_ledger WHERE mode = 'apply' ORDER BY applied_at DESC LIMIT 1"
  );
  const latest_apply = latestApplyRow || null;
  const latest_record_only = [...(coverageRows || [])].reverse().find((row) => row.mode === "record_only") || null;
  const required_checksum_mismatches = (coverageRows || []).filter((row) => {
    const expected = REQUIRED_TOOL_DISPATCH_MIGRATION_CHECKSUMS[row.migration_file];
    return expected && String(row.migration_checksum_sha256 || "").toLowerCase() !== expected;
  });
  const status = missing_expected_migrations.length || risky_entries.length || required_checksum_mismatches.length ? "warn" : "pass";

  return {
    status,
    detail: status === "pass"
      ? `Governed migration ledger covers ${coverageRows.length}/${EXPECTED_GOVERNED_LEDGER_MIGRATIONS.length} expected migration record(s).`
      : `Governed migration ledger has ${missing_expected_migrations.length} missing expected record(s), ${risky_entries.length} risky record(s), and ${required_checksum_mismatches.length} required checksum mismatch(es).`,
    table_exists: true,
    total_entries: Object.values(mode_counts).reduce((sum, count) => sum + Number(count || 0), 0),
    mode_counts,
    expected_count: EXPECTED_GOVERNED_LEDGER_MIGRATIONS.length,
    covered_count: coverageRows.length,
    missing_expected_migrations,
    risky_entries: risky_entries.slice(0, 10),
    required_checksum_mismatches: required_checksum_mismatches.map((row) => ({
      migration_file: row.migration_file,
      expected_checksum_sha256: REQUIRED_TOOL_DISPATCH_MIGRATION_CHECKSUMS[row.migration_file],
      actual_checksum_sha256: row.migration_checksum_sha256 || null,
    })),
    latest_apply,
    latest_record_only,
    checked_migrations: (coverageRows || []).map((row) => ({
      migration_file: row.migration_file,
      migration_checksum_sha256: row.migration_checksum_sha256 || null,
      mode: row.mode,
      statement_count: row.statement_count,
      preflight_status: row.preflight_status,
      preflight_risk_count: row.preflight_risk_count,
      secrets_included: row.secrets_included,
      applied_at: row.applied_at,
    })),
    secrets_included: false,
  };
}

async function checkGovernedMigrationLedgerSafe() {
  try {
    return await checkGovernedMigrationLedger();
  } catch (err) {
    return {
      status: "warn",
      detail: `Governed migration ledger unavailable: ${err?.message || "unknown error"}`,
      table_exists: false,
      total_entries: 0,
      mode_counts: {},
      expected_count: EXPECTED_GOVERNED_LEDGER_MIGRATIONS.length,
      covered_count: 0,
      missing_expected_migrations: EXPECTED_GOVERNED_LEDGER_MIGRATIONS,
      secrets_included: false,
    };
  }
}

async function checkAdminToolRegistrySmoke() {
  const pool = getPool();
  const expected = EXPECTED_ADMIN_TOOL_REGISTRY_SMOKE;
  const legacyNonRequired = LEGACY_NON_REQUIRED_ADMIN_TOOLS;
  const allToolKeys = compactList([...expected, ...legacyNonRequired], 100);
  const [[tableRow]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'admin_platform_endpoint_tools'"
  );
  if (!tableRow?.cnt) {
    return {
      status: "warn",
      detail: "Admin platform endpoint tool registry table is missing.",
      table_exists: false,
      expected_count: expected.length,
      covered_count: 0,
      missing_expected_tools: expected,
      disabled_expected_tools: [],
      invalid_expected_tools: [],
      legacy_non_required_tools: legacyNonRequired,
      secrets_included: false,
    };
  }

  const [rows] = await pool.query(
    "SELECT tool_key, is_enabled, http_method, http_path FROM admin_platform_endpoint_tools WHERE tool_key IN (?) ORDER BY tool_key",
    [allToolKeys]
  );
  const byKey = new Map((rows || []).map((row) => [String(row.tool_key), row]));
  const missing_expected_tools = expected.filter((toolKey) => !byKey.has(toolKey));
  const disabled_expected_tools = expected.filter((toolKey) => byKey.has(toolKey) && Number(byKey.get(toolKey)?.is_enabled || 0) !== 1);
  const invalid_expected_tools = expected.filter((toolKey) => {
    const row = byKey.get(toolKey);
    return row && (!String(row.http_method || "").trim() || !String(row.http_path || "").trim());
  });
  const status = missing_expected_tools.length || disabled_expected_tools.length || invalid_expected_tools.length
    ? "warn"
    : "pass";

  return {
    status,
    detail: status === "pass"
      ? `Admin tool registry smoke covers ${expected.length}/${expected.length} required tool(s); ${legacyNonRequired.length} legacy non-required tool(s) are informational only.`
      : `Admin tool registry smoke has ${missing_expected_tools.length} missing, ${disabled_expected_tools.length} disabled, and ${invalid_expected_tools.length} invalid required tool(s).`,
    table_exists: true,
    expected_count: expected.length,
    covered_count: expected.length - missing_expected_tools.length,
    enabled_expected_count: expected.filter((toolKey) => Number(byKey.get(toolKey)?.is_enabled || 0) === 1).length,
    missing_expected_tools,
    disabled_expected_tools,
    invalid_expected_tools,
    expected_tools: expected.map((toolKey) => {
      const row = byKey.get(toolKey) || {};
      return {
        tool_key: toolKey,
        present: byKey.has(toolKey),
        is_enabled: row.is_enabled ?? null,
        http_method: row.http_method || null,
        http_path: row.http_path || null,
      };
    }),
    legacy_non_required_tools: legacyNonRequired.map((toolKey) => {
      const row = byKey.get(toolKey) || {};
      return {
        tool_key: toolKey,
        present: byKey.has(toolKey),
        is_enabled: row.is_enabled ?? null,
        http_method: row.http_method || null,
        http_path: row.http_path || null,
        classification: "legacy_non_required_diagnostic",
      };
    }),
    executes_tools: false,
    secrets_included: false,
  };
}

async function checkAdminToolRegistrySmokeSafe() {
  try {
    return await checkAdminToolRegistrySmoke();
  } catch (err) {
    return {
      status: "warn",
      detail: `Admin tool registry smoke unavailable: ${err?.message || "unknown error"}`,
      table_exists: false,
      expected_count: EXPECTED_ADMIN_TOOL_REGISTRY_SMOKE.length,
      covered_count: 0,
      missing_expected_tools: EXPECTED_ADMIN_TOOL_REGISTRY_SMOKE,
      executes_tools: false,
      secrets_included: false,
    };
  }
}

function runtimePolicyFlagMatches(value, expectedBoolean) {
  const normalized = String(value || "").trim().toLowerCase();
  const actual = ["true", "1", "yes", "active", "blocking"].includes(normalized);
  return actual === expectedBoolean;
}

function listMissingTokens(text = "", tokens = []) {
  const source = String(text || "");
  return (tokens || []).filter((token) => !source.includes(token));
}

async function checkRuntimePolicySeedReadiness() {
  const pool = getPool();
  const [[tableRow]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'execution_policies'"
  );
  if (!tableRow?.cnt) {
    return { status: "fail", detail: "execution_policies table is missing; runtime policy preflight cannot load required seeds.", table_exists: false, expected_count: REQUIRED_RUNTIME_POLICY_SEEDS.length, covered_count: 0, missing_required_policies: REQUIRED_RUNTIME_POLICY_SEEDS.map((seed) => seed.check_key), policies: [], secrets_included: false };
  }

  const where = REQUIRED_RUNTIME_POLICY_SEEDS.map(() => "(policy_group = ? AND policy_key = ?)").join(" OR ");
  const params = REQUIRED_RUNTIME_POLICY_SEEDS.flatMap((seed) => [seed.policy_group, seed.policy_key]);
  const [rows] = await pool.query(
    `SELECT id, policy_group, policy_key, active, execution_scope, affects_layer, blocking,
            CASE WHEN policy_value IS NULL OR policy_value = '' THEN 0 ELSE JSON_VALID(policy_value) END AS policy_value_json_valid,
            updated_at
       FROM execution_policies
      WHERE ${where}
      ORDER BY policy_group, policy_key`,
    params
  );
  const byKey = new Map((rows || []).map((row) => [`${row.policy_group}\u001f${row.policy_key}`, row]));
  const policies = [];
  const missingRequired = [];
  const invalidRequired = [];

  for (const seed of REQUIRED_RUNTIME_POLICY_SEEDS) {
    const row = byKey.get(`${seed.policy_group}\u001f${seed.policy_key}`);
    if (!row) {
      missingRequired.push(seed.check_key);
      policies.push({ check_key: seed.check_key, present: false, expected_blocking: seed.required_blocking });
      continue;
    }
    const activeOk = runtimePolicyFlagMatches(row.active, true);
    const blockingOk = runtimePolicyFlagMatches(row.blocking, seed.required_blocking);
    const missingScopeTokens = listMissingTokens(row.execution_scope, seed.required_scope_tokens);
    const missingLayerTokens = listMissingTokens(row.affects_layer, seed.required_affects_layer_tokens);
    const jsonOk = Number(row.policy_value_json_valid || 0) === 1;
    const ok = activeOk && blockingOk && !missingScopeTokens.length && !missingLayerTokens.length && jsonOk;
    if (!ok) invalidRequired.push(seed.check_key);
    policies.push({ check_key: seed.check_key, present: true, ok, policy_group: row.policy_group, policy_key: row.policy_key, active: row.active, expected_blocking: seed.required_blocking, blocking: row.blocking, active_ok: activeOk, blocking_ok: blockingOk, policy_value_json_valid: jsonOk, missing_scope_tokens: missingScopeTokens, missing_affects_layer_tokens: missingLayerTokens, updated_at: row.updated_at });
  }

  const status = missingRequired.length || invalidRequired.length ? "fail" : "pass";
  return { status, detail: status === "pass" ? `Runtime policy seed readiness covers ${REQUIRED_RUNTIME_POLICY_SEEDS.length}/${REQUIRED_RUNTIME_POLICY_SEEDS.length} required policy seed(s).` : `Runtime policy seed readiness failed: ${missingRequired.length} missing and ${invalidRequired.length} invalid required policy seed(s).`, table_exists: true, expected_count: REQUIRED_RUNTIME_POLICY_SEEDS.length, covered_count: REQUIRED_RUNTIME_POLICY_SEEDS.length - missingRequired.length, missing_required_policies: missingRequired, invalid_required_policies: invalidRequired, policies, executes_tools: false, secrets_included: false };
}

async function checkRuntimePolicySeedReadinessSafe() {
  try {
    return await checkRuntimePolicySeedReadiness();
  } catch (err) {
    return { status: "warn", detail: `Runtime policy seed readiness unavailable: ${err?.message || "unknown error"}`, expected_count: REQUIRED_RUNTIME_POLICY_SEEDS.length, covered_count: 0, missing_required_policies: REQUIRED_RUNTIME_POLICY_SEEDS.map((seed) => seed.check_key), executes_tools: false, secrets_included: false };
  }
}

function graphMemoryCheckResult(memory = {}) {
  const assetCount = Number(memory.asset_count || 0);
  const resolved = Boolean(memory.resolved);
  return {
    status: resolved ? "pass" : "warn",
    detail: resolved
      ? `Graph memory resolved ${assetCount} asset(s) for release readiness diagnostics.`
      : memory.reason || "Graph memory returned no diagnostic assets.",
    requested: Boolean(memory.requested),
    resolved,
    asset_count: assetCount,
    asset_keys: Array.isArray(memory.assets)
      ? memory.assets.map((asset) => asset?.asset_key).filter(Boolean).slice(0, 10)
      : [],
    selection_policy: memory.selection_policy || {},
    secrets_included: false,
  };
}

async function checkGraphMemoryDiagnostics() {
  try {
    const memory = await resolvePlatformGraphMemory({
      input: {
        node_id: "platform.global",
        request_type: "release_readiness",
        diagnostic_surface: "release_readiness",
        depth: 1,
        memory_limit: 5,
      },
      limit: 5,
    });
    return graphMemoryCheckResult(memory);
  } catch (err) {
    return {
      status: "warn",
      detail: `Graph memory diagnostics unavailable: ${err?.message || "unknown error"}`,
      requested: true,
      resolved: false,
      asset_count: 0,
      asset_keys: [],
      selection_policy: {},
      secrets_included: false,
    };
  }
}

async function checkLegacyTables() {
  const results = {};
  for (const table of LEGACY_TABLES) {
    const r = await checkTableExists(table);
    results[table] = r;
  }
  return results;
}

async function checkSystemLayerDescriptorCallability() {
  try {
    const { runSystemLayerDescriptorCallabilityAudit } = await import("./routes/systemLayerRoutes.js");
    const audit = await runSystemLayerDescriptorCallabilityAudit();
    const pass = audit?.ok === true && audit?.status === "pass";
    return {
      status: pass ? "pass" : "fail",
      detail: pass
        ? `System-layer descriptor callability passed for ${audit.descriptor_tool_count || 0} tool(s) across ${audit.descriptor_source_count || 0} source(s).`
        : `System-layer descriptor callability failed for ${audit?.failed_source_count || 0} source(s) with ${audit?.missing_handler_count || 0} missing handler(s).`,
      audit,
      executes_tools: true,
      mutations_executed: false,
      secrets_included: false,
    };
  } catch (err) {
    return {
      status: "fail",
      detail: `System-layer descriptor callability audit could not complete: ${err?.message || err}`,
      reason_code: err?.code || "system_layer_descriptor_callability_exception",
      executes_tools: true,
      mutations_executed: false,
      secrets_included: false,
    };
  }
}

async function checkRepositoryIntelligenceV2Readiness() {
  const requiredToolNames = [
    "platform_resource_authority_binding_create",
    "platform_resource_authority_binding_list",
    "platform_resource_authority_binding_revoke",
    "tenant_repo_pr_reconciliation_sweep",
    "tenant_repository_intelligence_v2_readiness_smoke",
    "tenant_repository_intelligence_report",
    "tenant_repository_action_planner_dry_run",
    "tenant_repository_intelligence_v3_v4_readiness_smoke", "tenant_repository_advisory_comment_preview", "tenant_repository_advisory_comment_apply", "tenant_repository_advisory_comment_readback", "tenant_repository_advisory_comment_v5_readiness_smoke",
  ];
  const requiredRuntimeTokens = [
    "tenantRepositoryIntelligenceV2ReadinessSmoke",
    "tenantRepositoryIntelligenceV3V4ReadinessSmoke",
    "tenantRepositoryPrReconciliationSweep",
    "tenantRepositoryIntelligenceReport",
    "tenantRepositoryActionPlannerDryRun", "tenantRepositoryAdvisoryCommentV5ReadinessSmoke", "tenantRepositoryAdvisoryCommentPreview", "tenantRepositoryAdvisoryCommentApply", "tenantRepositoryAdvisoryCommentReadback", "repository_advisory_comment_preview_v5", "repository_advisory_comment_apply_v5", "repository_advisory_comment_readback_v5",
    "tenant_repository_pr_reconciliation_summary_v2",
    "tenant_repository_intelligence_report_v3",
    "tenant_repository_action_planner_v4",
    "blocked_missing_platform_resource_authority_binding",
    "approval_gated_mutations_v5_not_enabled",
    "mutations_executed: false",
  ];
  try {
    const [routesSource, moduleSource, openapiSource] = await Promise.all([
      fs.readFile(SYSTEM_LAYER_ROUTES_PATH, "utf8"),
      fs.readFile(REPOSITORY_TENANT_INTELLIGENCE_V2_PATH, "utf8"),
      fs.readFile(OPENAPI_PATH, "utf8"),
    ]);
    const missingTools = requiredToolNames.filter((toolName) => !routesSource.includes(toolName) || !moduleSource.includes(toolName));
    const missingRuntimeTokens = requiredRuntimeTokens.filter((token) => !moduleSource.includes(token));
    const openapi_documented = requiredToolNames.every((toolName) => openapiSource.includes(toolName));
    let dispatcher_smoke = null;
    try {
      const { runRepositoryIntelligenceV2DescriptorReadinessSmoke } = await import("./routes/systemLayerRoutes.js");
      dispatcher_smoke = await runRepositoryIntelligenceV2DescriptorReadinessSmoke({ limit: 1 });
    } catch (err) {
      dispatcher_smoke = {
        ok: false,
        status: "fail",
        classification: "repository_intelligence_v2_dispatcher_smoke_failed",
        reason_code: err?.code || "repository_intelligence_v2_dispatcher_smoke_error",
        message: err?.message || "Repository Intelligence V2 dispatcher smoke failed.",
        checks: [],
        apply_allowed: false,
        mutations_executed: false,
        secrets_included: false,
      };
    }
    const [bindingRows] = await getPool().query(
      `SELECT COUNT(*) AS active_real_bindings
         FROM platform_resource_authority_bindings
        WHERE status = 'active'
          AND resource_type = 'github_repo'
          AND recipe_key = 'repo.pr.reconciliation_sweep'
          AND permission_level = 'read_only'
          AND JSON_CONTAINS(allowed_modes_json, JSON_QUOTE('read_only'))`
    );
    const [evidenceRows] = await getPool().query(
      `SELECT COUNT(*) AS v2_evidence_rows
         FROM audit_payload_evidence
        WHERE evidence_type = 'tenant_repository_pr_reconciliation_summary_v2'
          AND secrets_included = 0`
    );
    const active_real_bindings = Number(bindingRows?.[0]?.active_real_bindings || 0);
    const v2_evidence_rows = Number(evidenceRows?.[0]?.v2_evidence_rows || 0);
    const issues = [];
    if (missingTools.length) issues.push(`missing tool wiring: ${missingTools.join(", ")}`);
    if (missingRuntimeTokens.length) issues.push(`missing runtime tokens: ${missingRuntimeTokens.join(", ")}`);
    if (!openapi_documented) issues.push("OpenAPI description does not document all V2 system tools");
    if (active_real_bindings < 1) issues.push("No active read_only GitHub repo authority binding found");
    if (v2_evidence_rows < 1) issues.push("No tenant_repository_pr_reconciliation_summary_v2 evidence rows found");
    if (dispatcher_smoke?.status !== "pass" || dispatcher_smoke?.ok !== true) {
      issues.push(`Public descriptor dispatcher smoke failed: ${dispatcher_smoke?.reason_code || dispatcher_smoke?.classification || "unknown"}`);
    }
    const failed_dispatcher_checks = (dispatcher_smoke?.checks || [])
      .filter((check) => check?.pass !== true)
      .map((check) => check?.name)
      .filter(Boolean);
    if (failed_dispatcher_checks.length) {
      issues.push(`Failed public dispatcher checks: ${failed_dispatcher_checks.join(", ")}`);
    }
    return {
      status: issues.length ? "fail" : "pass",
      detail: issues.length ? `Repository Intelligence V2 readiness has ${issues.length} blocking issue(s).` : "Repository Intelligence V2 public descriptors, binding, evidence, and documentation are ready.",
      required_tools: requiredToolNames,
      missing_tools: missingTools,
      missing_runtime_tokens: missingRuntimeTokens,
      openapi_documented,
      active_real_bindings,
      v2_evidence_rows,
      dispatcher_smoke,
      issues,
      executes_tools: true,
      provider_calls_made: Number(dispatcher_smoke?.positive?.summary?.provider_calls_made || 0),
      temporary_authority_binding_lifecycle_executed: true,
      repository_mutations_executed: false,
      secrets_included: false,
    };
  } catch (err) {
    return {
      status: "fail",
      detail: `Repository Intelligence V2 public dispatcher readiness check could not complete: ${err?.message || err}`,
      reason_code: err?.code || "repository_intelligence_v2_readiness_exception",
      executes_tools: true,
      repository_mutations_executed: false,
      secrets_included: false,
    };
  }
}

// ── Public: run all release readiness checks ─────────────────────────────────
export async function runReleaseReadiness({ persist = false } = {}) {
  const run_id = randomUUID();
  const report = {
    run_id,
    checked_at: new Date().toISOString(),
    overall: "pass",
    db_connectivity: null,
    platform_tables: {},
    legacy_tables: {},
    seed_data: {},
    migration_inventory: null,
    governed_migration_ledger: null,
    admin_tool_registry_smoke: null,
    migration_drift: null,
    runtime_policy_seed_readiness: null,
    system_layer_descriptor_callability: null,
    repository_intelligence_v2_readiness: null,
    platform_secret_promotion_monitoring: null,
    graph_memory_diagnostics: null,
    runtime_production_parity_gate: null,
    platform_tool_dispatch_binding_integrity: null,
  };

  // DB connectivity
  report.db_connectivity = await checkDbConnectivity();
  if (report.db_connectivity.status === "fail") {
    report.overall = "fail";
    return report;
  }

  report.runtime_production_parity_gate = await checkRuntimeProductionParityGate();
  if (report.runtime_production_parity_gate.status === "fail") report.overall = "fail";
  report.dr_certification_readiness = await checkDrCertificationEvidenceReadiness();
  if (report.dr_certification_readiness.status === "fail") report.overall = "fail";
  else if (report.dr_certification_readiness.status === "warn" && report.overall !== "fail") report.overall = "warn";

  // Platform table checks (parallel)
  const tableResults = await Promise.all(REQUIRED_TABLES.map((t) => checkTableExists(t)));
  for (let i = 0; i < REQUIRED_TABLES.length; i++) {
    report.platform_tables[REQUIRED_TABLES[i]] = tableResults[i];
    if (tableResults[i].status === "fail") report.overall = "fail";
  }

  // Legacy table checks (parallel)
  report.legacy_tables = await checkLegacyTables();
  for (const [, r] of Object.entries(report.legacy_tables)) {
    if (r.status === "fail" && report.overall !== "fail") report.overall = "warn";
  }

  // Seed data checks
  report.seed_data = await checkSeedData();
  for (const [, r] of Object.entries(report.seed_data)) {
    if (r.status === "fail" && report.overall !== "fail") report.overall = "fail";
    else if (r.status === "warn" && report.overall === "pass") report.overall = "warn";
  }

  // Migration inventory
  report.migration_inventory = await checkMigrationInventorySafe();
  if (report.migration_inventory.status === "warn" && report.overall === "pass") report.overall = "warn";

  // Governed migration ledger — non-mutating coverage evidence for migrations
  // that were applied or historically backfilled through the governed runner.
  report.governed_migration_ledger = await checkGovernedMigrationLedgerSafe();
  if (report.governed_migration_ledger.status === "warn" && report.overall === "pass") report.overall = "warn";

  report.platform_tool_dispatch_binding_integrity = await checkPlatformToolDispatchBindingIntegrity();
  if (report.platform_tool_dispatch_binding_integrity.status === "fail") report.overall = "fail";

  // Admin tool registry smoke — read-only registry verification only. This does
  // not dispatch any high-risk admin tool.
  report.admin_tool_registry_smoke = await checkAdminToolRegistrySmokeSafe();
  if (report.admin_tool_registry_smoke.status === "warn" && report.overall === "pass") report.overall = "warn";

  // Dynamic migration drift — non-mutating comparison between repo migrations
  // and the current runtime DB. This catches future governance migrations without
  // adding their table/tool/engine names to a static release readiness list.
  report.migration_drift = await checkDynamicMigrationDriftSafe();
  if (report.migration_drift.status === "warn" && report.overall === "pass") report.overall = "warn";
  if (report.migration_drift.status === "fail") report.overall = "fail";

  // Runtime policy seed readiness — verifies the live DB has the policy rows
  // required by governedExecutionPreflight. This catches missing seed rows that
  // source-code and migration-file checks alone cannot detect.
  report.runtime_policy_seed_readiness = await checkRuntimePolicySeedReadinessSafe();
  if (report.runtime_policy_seed_readiness.status === "warn" && report.overall === "pass") report.overall = "warn";
  if (report.runtime_policy_seed_readiness.status === "fail") report.overall = "fail";

  report.system_layer_descriptor_callability = await checkSystemLayerDescriptorCallability();
  if (report.system_layer_descriptor_callability.status === "fail") report.overall = "fail";

  report.repository_intelligence_v2_readiness = await checkRepositoryIntelligenceV2Readiness();
  if (report.repository_intelligence_v2_readiness.status === "warn" && report.overall === "pass") report.overall = "warn";
  if (report.repository_intelligence_v2_readiness.status === "fail") report.overall = "fail";

  report.platform_secret_promotion_monitoring = await checkPlatformSecretPromotionMonitoringSafe();
  if (report.platform_secret_promotion_monitoring.status === "warn" && report.overall === "pass") report.overall = "warn";
  if (report.platform_secret_promotion_monitoring.status === "fail") report.overall = "fail";

  report.gpt_session_archive_monitoring = await checkGptSessionArchiveMonitoringSafe();
  if (report.gpt_session_archive_monitoring.status === "warn" && report.overall === "pass") report.overall = "warn";
  if (report.gpt_session_archive_monitoring.status === "fail") report.overall = "fail";

  // Runtime policy seed readiness — verifies the live DB has the policy rows
  // required by governedExecutionPreflight. This catches missing seed rows that
  // source-code and migration-file checks alone cannot detect.
  report.runtime_policy_seed_readiness = await checkRuntimePolicySeedReadinessSafe();
  if (report.runtime_policy_seed_readiness.status === "warn" && report.overall === "pass") report.overall = "warn";
  if (report.runtime_policy_seed_readiness.status === "fail") report.overall = "fail";

  // Graph memory diagnostics — non-blocking admin context enrichment.
  report.graph_memory_diagnostics = await checkGraphMemoryDiagnostics();

  // Summary counts
  const allChecks = [
    report.db_connectivity,
    ...Object.values(report.platform_tables),
    ...Object.values(report.legacy_tables),
    ...Object.values(report.seed_data),
    report.migration_inventory,
    report.governed_migration_ledger,
    report.platform_tool_dispatch_binding_integrity,
    report.admin_tool_registry_smoke,
    report.migration_drift,
    report.runtime_policy_seed_readiness,
    report.repository_intelligence_v2_readiness,
    report.gpt_session_archive_monitoring,
    report.graph_memory_diagnostics,
  ];
  report.summary = {
    total: allChecks.length,
    pass: allChecks.filter((c) => c.status === "pass").length,
    warn: allChecks.filter((c) => c.status === "warn").length,
    fail: allChecks.filter((c) => c.status === "fail").length,
    platform_tables_total: REQUIRED_TABLES.length,
    platform_tables_ok: Object.values(report.platform_tables).filter((c) => c.status === "pass").length,
    governed_migration_ledger_status: report.governed_migration_ledger?.status || null,
    governed_migration_ledger_total_entries: report.governed_migration_ledger?.total_entries ?? null,
    governed_migration_ledger_apply_count: report.governed_migration_ledger?.mode_counts?.apply ?? 0,
    governed_migration_ledger_record_only_count: report.governed_migration_ledger?.mode_counts?.record_only ?? 0,
    governed_migration_ledger_expected_count: report.governed_migration_ledger?.expected_count ?? null,
    governed_migration_ledger_covered_count: report.governed_migration_ledger?.covered_count ?? null,
    governed_migration_ledger_missing_expected_count: report.governed_migration_ledger?.missing_expected_migrations?.length ?? null,
    governed_migration_ledger_checksum_mismatch_count: report.governed_migration_ledger?.required_checksum_mismatches?.length ?? null,
    latest_governed_migration_apply: report.governed_migration_ledger?.latest_apply?.migration_file || null,
    tool_dispatch_binding_integrity_status: report.platform_tool_dispatch_binding_integrity?.status || null,
    tool_dispatch_binding_count: report.platform_tool_dispatch_binding_integrity?.binding_count ?? null,
    tool_dispatch_binding_healthy_count: report.platform_tool_dispatch_binding_integrity?.healthy_count ?? null,
    tool_dispatch_binding_gap_count: report.platform_tool_dispatch_binding_integrity?.gap_count ?? null,
    admin_tool_registry_smoke_status: report.admin_tool_registry_smoke?.status || null,
    admin_tool_registry_smoke_expected_count: report.admin_tool_registry_smoke?.expected_count ?? null,
    admin_tool_registry_smoke_covered_count: report.admin_tool_registry_smoke?.covered_count ?? null,
    admin_tool_registry_smoke_missing_count: report.admin_tool_registry_smoke?.missing_expected_tools?.length ?? null,
    admin_tool_registry_smoke_disabled_count: report.admin_tool_registry_smoke?.disabled_expected_tools?.length ?? null,
    admin_tool_registry_smoke_invalid_count: report.admin_tool_registry_smoke?.invalid_expected_tools?.length ?? null,
    admin_tool_registry_smoke_executes_tools: Boolean(report.admin_tool_registry_smoke?.executes_tools),
    migration_drift_missing_total: report.migration_drift?.missing_total ?? null,
    migration_drift_actionable_missing_total: report.migration_drift?.actionable_missing_total ?? null,
    migration_drift_files_scanned: report.migration_drift?.files_scanned ?? 0,
    migration_drift_classification_counts: report.migration_drift?.missing_classification?.counts || {},
    runtime_policy_seed_readiness_status: report.runtime_policy_seed_readiness?.status || null,
    runtime_policy_seed_expected_count: report.runtime_policy_seed_readiness?.expected_count ?? null,
    runtime_policy_seed_covered_count: report.runtime_policy_seed_readiness?.covered_count ?? null,
    runtime_policy_seed_missing_count: report.runtime_policy_seed_readiness?.missing_required_policies?.length ?? null,
    runtime_policy_seed_invalid_count: report.runtime_policy_seed_readiness?.invalid_required_policies?.length ?? null,
    system_layer_descriptor_callability_status: report.system_layer_descriptor_callability?.status || null,
      system_layer_descriptor_source_count: report.system_layer_descriptor_callability?.audit?.descriptor_source_count ?? null,
      system_layer_descriptor_tool_count: report.system_layer_descriptor_callability?.audit?.descriptor_tool_count ?? null,
      system_layer_descriptor_failed_source_count: report.system_layer_descriptor_callability?.audit?.failed_source_count ?? null,
      system_layer_descriptor_missing_handler_count: report.system_layer_descriptor_callability?.audit?.missing_handler_count ?? null,
      repository_intelligence_v2_status: report.repository_intelligence_v2_readiness?.status || null,
    repository_intelligence_v2_active_real_bindings: report.repository_intelligence_v2_readiness?.active_real_bindings ?? null,
    repository_intelligence_v2_evidence_rows: report.repository_intelligence_v2_readiness?.v2_evidence_rows ?? null,
    repository_intelligence_v2_openapi_documented: report.repository_intelligence_v2_readiness?.openapi_documented ?? null,
    migration_drift_candidate_files: report.migration_drift?.migration_apply_plan?.candidate_files || [],
    migration_apply_preflight_status: report.migration_drift?.migration_apply_preflight?.status || null,
    migration_apply_preflight_risk_count: report.migration_drift?.migration_apply_preflight?.risk_count ?? null,
    gpt_session_archive_monitoring_status: report.gpt_session_archive_monitoring?.status || null,
    gpt_session_archive_monitored_sessions: report.gpt_session_archive_monitoring?.monitored_sessions ?? null,
    gpt_session_archive_fail_issue_rows: report.gpt_session_archive_monitoring?.fail_issue_rows ?? null,
    gpt_session_archive_warn_issue_rows: report.gpt_session_archive_monitoring?.warn_issue_rows ?? null,
    gpt_session_archive_sessions_with_one_primary_ref: report.gpt_session_archive_monitoring?.sessions_with_one_primary_ref ?? null,
    gpt_session_archive_sessions_without_active_ref: report.gpt_session_archive_monitoring?.sessions_without_active_ref ?? null,
    graph_memory_resolved: Boolean(report.graph_memory_diagnostics?.resolved),
    graph_memory_asset_count: Number(report.graph_memory_diagnostics?.asset_count || 0),
    secrets_included: false,
  };

  if (persist) {
    try {
      const pool = getPool();
      const entries = [
        ["db_connectivity", report.db_connectivity],
        ...Object.entries(report.platform_tables),
        ...Object.entries(report.legacy_tables).map(([k, v]) => [`legacy.${k}`, v]),
        ...Object.entries(report.seed_data),
        ["migration_inventory", report.migration_inventory],
        ["governed_migration_ledger", report.governed_migration_ledger],
        ["platform_tool_dispatch_binding_integrity", report.platform_tool_dispatch_binding_integrity],
        ["admin_tool_registry_smoke", report.admin_tool_registry_smoke],
        ["migration_drift", report.migration_drift],
        ["gpt_session_archive_monitoring", report.gpt_session_archive_monitoring],
        ["graph_memory_diagnostics", report.graph_memory_diagnostics],
      ];
      await Promise.all(entries.map(([key, r]) =>
        pool.query(
          "INSERT INTO `release_readiness_log` (run_id, check_key, status, detail) VALUES (?, ?, ?, ?)",
          [run_id, key, r.status, r.detail || null]
        )
      ));
    } catch { /* non-blocking */ }
  }

  return report;
}
