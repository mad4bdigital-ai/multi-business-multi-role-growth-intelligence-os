#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  assessMigrationSqlPreflight,
  extractMigrationReadinessRequirementsFromSql,
  splitSqlStatements,
} from "../releaseReadiness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(API_DIR, "migrations");

const LEGACY_BOOTSTRAP_ALLOWED_MIGRATIONS = new Set([
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
  "197_sprint66_tenant_database_query_readonly_tool.sql",
  "198_sprint66_tenant_ssh_probe_tool.sql",
  "199_sprint66_tenant_ssh_cli_dry_run_tool.sql",
  "200_sprint66_tenant_ssh_cli_approval_request_tool.sql",
  "201_sprint66_tenant_ssh_cli_approval_decision_tools.sql",
  "202_sprint66_tenant_ssh_cli_allowlisted_execute_tool.sql",
  "203_sprint66_tenant_ssh_execute_runtime_config.sql",
  "204_sprint66_tenant_ssh_cli_execute_job_result_tool.sql",
  "205_sprint66_tenant_ssh_password_and_intake_wait.sql",
  "206_sprint66_credential_intake_webhook_outbox.sql",
  "199_sprint67_runtime_policy_resolver_monitoring_and_mirror_classification.sql",
  "200_sprint67_runtime_policy_target_rule_backfill.sql",
  "202_sprint67_policy_only_runtime_policy_target_rules.sql",
  "203_sprint67_execution_log_context_dimensions.sql",
  "204_sprint67_core_runtime_context_dimensions.sql",
  "205_sprint67_runtime_context_dimension_enrichment.sql",
  "206_sprint67_deterministic_workflow_execution_identity.sql",
  "207_sprint67_platform_relationship_integrity_views.sql",
  "208_sprint67_user_app_connection_runtime_collation_repair.sql",
  "209_sprint67_execution_plan_workflow_identity_backfill.sql",
  "210_sprint67_openrouter_docs_agent_provider_contract.sql",
  "210_sprint67_approval_hold_tenant_ssh_relationship_alignment.sql",
  "215_sprint67_dynamic_platform_secret_promotion.sql",
  "216_sprint67_openrouter_provider_smoke_tool.sql",
  "217_sprint67_openrouter_model_policy_control.sql",
  "218_sprint67_activate_openclaude_openrouter_provider.sql",
  "219_sprint67_openclaude_live_dispatch_certification.sql",
  "220_sprint67_codex_dual_mode_policy.sql",
  "221_sprint67_dynamic_capability_resolution_graph.sql",
  "222_sprint67_dynamic_capability_resolution_risk_refinement.sql",
  "223_sprint67_dynamic_capability_simulation_suite.sql",
  "224_sprint67_capability_simulation_findings_refinement.sql",
  "225_sprint67_capability_resolution_envelope_ledger.sql",
  "226_sprint67_wordpress_capability_envelope_requirement.sql",
  "227_sprint67_hostinger_deploy_capability_envelope_requirement.sql",
  "228_sprint67_n8n_capability_envelope_requirement.sql",
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
  "263_sprint68_session_insight_promotion_review_tools.sql",
  "265_sprint68_session_insight_promotion_dry_run_executor.sql",
  "266_sprint68_session_insight_promotion_apply_request_skeleton.sql",
  "267_sprint68_session_insight_target_adapter_registry.sql",
  "268_sprint68_session_insight_adapter_dry_run_contracts.sql",
  "269_sprint68_session_insight_contract_payload_preview.sql",
  "270_sprint68_session_insight_payload_preview_review.sql",
  "271_sprint68_session_insight_adapter_apply_readiness_gate.sql",
  "272_sprint68_session_insight_capability_envelope_planner.sql",
  "273_sprint68_session_insight_capability_envelope_request_gate.sql",
  "274_sprint68_session_insight_capability_envelope_request_review.sql",
  "275_sprint68_session_insight_capability_envelope_dispatch_dry_run.sql",
  "277_sprint68_session_insight_capability_envelope_dispatch_dry_run_review.sql",
  "278_sprint68_session_insight_capability_envelope_actual_request_preflight.sql",
  "279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql",
  "280_sprint68_session_insight_capability_envelope_approval_gate.sql",
  "281_sprint68_session_insight_capability_envelope_dispatch_readback.sql",
  "282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql",
  "283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql",
  "284_sprint68_session_insight_backlog_target_write_executor.sql",
  "306_sprint69_session_insight_target_write_readback.sql",
  "276_sprint68_activation_positive_surface_fixtures.sql",
  "277_sprint68_execution_log_runtime_evidence.sql",
  "284_sprint68_execution_log_full_context_evidence.sql",
  "260_sprint68_platform_development_constitution_policies.sql",
  "261_sprint68_orchestration_intelligence_foundation.sql",
  "263_sprint68_ads_governance_snapshot_proposal.sql",
  "264_sprint68_ads_governance_snapshot_record_gate.sql",
  "270_sprint68_support_ticket_lifecycle_orchestration_readback.sql",
  "272_sprint68_support_ticket_lifecycle_snapshot_proposal.sql",
  "273_sprint68_support_ticket_lifecycle_snapshot_record_gate.sql",
  "904_sprint68_support_ticket_lifecycle_snapshot_apply_binding.sql",
  "905_sprint68_support_ticket_lifecycle_snapshot_apply_policy_readback_alignment.sql",
  "906_sprint68_ticket_external_delivery_completion_certification.sql",
  "997_sprint68_openrouter_provider_smoke_capability_binding.sql",
  "998_sprint68_openrouter_provider_smoke_app_map_binding.sql",
  "999_sprint68_repository_intelligence_v3_v4_tenant_tool_wiring.sql",
  "1000_sprint68_dr_certification_and_tool_bus_gated_read_only.sql",
  "1001_sprint68_repository_advisory_comment_v5_tenant_tool_wiring.sql",
  "907_sprint68_ticket_external_live_smtp_registry_alignment.sql",
  "908_sprint68_ticket_external_hostinger_gmail_provider_options.sql",
  "909_sprint68_ticket_external_dynamic_recipient_allowlist.sql",
  "910_sprint68_session_insight_capability_binding_hardening.sql",
  "260_sprint68_platform_development_constitution_policies.sql",
  "261_sprint68_orchestration_intelligence_foundation.sql",
  "229_sprint67_workspace_brands_list_tool.sql",
  "230_sprint67_gpt_session_conversation_ref_capture_current.sql",
  "231_sprint67_hostinger_runner_durable_submit.sql",
  "233_sprint68_ticket_lifecycle_authority_foundation.sql",
  "234_sprint68_ticket_lifecycle_reconciliation_tool.sql",
  "235_sprint68_ticket_lifecycle_runtime_links.sql",
  "236_sprint68_ticket_lifecycle_execution_plans.sql",
  "237_sprint68_ticket_lifecycle_workflow_runs.sql",
  "238_sprint68_ticket_lifecycle_step_runs.sql",
  "239_sprint68_ticket_lifecycle_diagnostic_steps.sql",
  "240_sprint68_ticket_lifecycle_diagnostic_chain.sql",
  "241_sprint68_ticket_lifecycle_brand_mapping_remediation.sql",
  "242_sprint68_ticket_lifecycle_approval_remediation.sql",
  "243_sprint68_ticket_lifecycle_brand_ref_resolution.sql",
  "244_sprint68_ticket_lifecycle_brand_ref_selection.sql",
  "245_sprint68_ticket_lifecycle_brand_ref_selection_completion.sql",
  "246_sprint68_ticket_lifecycle_new_brand_ref_approval.sql",
  "249_sprint68_ticket_lifecycle_verified_apply_rollback.sql",
  "250_sprint68_ticket_lifecycle_finalize_brand_mapping_remediation.sql",
  "252_sprint68_ticket_activation_inbox_feedback.sql",
  "253_sprint68_ticket_auto_resolve_policy_engine.sql",
  "254_sprint68_ticket_notification_delivery_cycle.sql",
  "255_sprint68_ticket_notification_delivery_adapters.sql",
  "256_sprint68_ticket_external_delivery_approval_policy.sql",
  "257_sprint68_ticket_external_send_execution_adapter.sql",
  "258_sprint68_ticket_external_delivery_credential_binding.sql",
  "259_sprint68_ticket_external_secret_intake_surface.sql",
  "260_sprint68_ticket_external_credential_activation_binding.sql",
  "261_sprint68_ticket_external_credential_orchestration.sql",
  "262_sprint68_ticket_external_send_provider_gate.sql",
  "265_sprint68_ticket_external_provider_adapter_contracts.sql",
  "266_sprint68_ticket_external_provider_enablement_proposal.sql",
  "267_sprint68_ticket_external_adapter_readiness_checklist.sql",
  "268_sprint68_ticket_external_adapter_readiness_decision.sql",
  "269_sprint68_ticket_external_adapter_future_pr_scope.sql",
  "272_sprint68_ticket_external_provider_gate_registry_resolver.sql",
  "274_sprint68_execution_policy_enforcement_closure.sql",
  "274_sprint68_schema_split_importer_v2_reference_preservation.sql",
  "284_sprint68_wordpress_schema_import_completion_registry.sql",
  "285_sprint68_governed_migration_authorization_registry.sql",
  "286_sprint68_platform_schema_contract_completion_registry.sql",
  "900_sprint68_governed_repository_intelligence_engine.sql",
  "901_sprint68_resource_manifest_create_gate_authority.sql",
  "902_sprint68_dynamic_capability_apply_authorization_policy.sql",
  "903_sprint68_google_drive_multipart_upload_schema_contract.sql",
  "904_sprint68_resource_manifest_positive_smoke_certification.sql",
  "950_sprint68_platform_resource_authority_bindings.sql",
  "952_sprint68_resource_graph_projection_apply_gate.sql",
  "953_sprint68_resource_graph_projection_positive_smoke_certification.sql",
  "954_sprint68_compact_operational_views_and_github_resource_coverage.sql", "955_sprint68_external_delivery_admin_control_surface.sql", "956_sprint68_external_delivery_allowlist_readiness_view_updated_at.sql",
  "957_sprint68_capability_baseline_branch_hygiene_github_file_inspect.sql",
  "958_sprint68_github_file_content_gate_and_patch_plan_registry.sql",
  "959_sprint68_github_file_patch_plan_diff_only_runtime.sql",
  "960_sprint68_remaining_resource_capability_completion_gates.sql",
  "961_sprint68_f5_f6_positive_smoke_certification.sql",
  "962_sprint68_smoke_branch_cleanup_gate.sql",
  "963_sprint68_hostinger_deploy_restart_tool_exports.sql",
  "964_sprint68_hostinger_stored_credential_apply_policy.sql",
  "965_sprint68_hostinger_apply_policy_safe_field_names.sql",
  "262_sprint68_orchestration_readback_surface.sql",
  "263_sprint68_ads_governance_snapshot_proposal.sql",
  "264_sprint68_ads_governance_snapshot_record_gate.sql",
  "265_sprint68_platform_orchestration_capability_binding.sql",
  "269_sprint68_activation_authorized_surface_registry.sql",
  "270_sprint68_activation_tenant_smoke_fixture.sql",
  "271_sprint68_activation_expanded_authorized_surfaces.sql",
  "273_sprint68_activation_catalog_authorized_surfaces.sql",
  "256_sprint68_dynamic_audit_pipeline_readiness.sql",
  "233_sprint68_general_mode_choice_governance.sql",
  "244_sprint68_cms_grant_dedupe_and_null_guard.sql",
  "240_sprint68_live_checkout_cleanup_tool.sql",
  "234_sprint67_repo_patch_capability_envelope_requirement.sql",
  "235_sprint67_capability_envelope_approval_tool.sql",
  "236_sprint67_budget_quota_authority_registry.sql",
  "238_sprint67_google_ads_budget_change_preflight.sql",
  "239_sprint67_google_ads_budget_preflight_binding.sql",
  "241_sprint67_google_ads_budget_preflight_ledger.sql",
  "242_sprint67_preflight_ledger_validator.sql",
  "243_sprint67_preflight_execution_gate_helper.sql",
  "244_sprint67_preflight_execution_gate_policy_readback_fix.sql",
  "245_sprint67_google_ads_execution_adapter_skeleton.sql",
  "246_sprint67_google_ads_credential_readiness_gate.sql",
  "247_sprint67_google_ads_credential_readiness_policy_fix.sql",
  "246_sprint68_platform_resource_recipe_capability.sql",
  "248_sprint67_execution_enablement_registry.sql",
  "249_sprint67_execution_enablement_approval_flow.sql",
  "250_sprint67_google_ads_credential_readiness_ledger.sql",
  "251_sprint67_ads_provider_capability_profile_registry.sql",
  "252_sprint67_ads_provider_profile_onboarding_flow.sql",
  "253_sprint67_ads_provider_preflight_contract.sql",
  "254_sprint67_ads_provider_preflight_surface_blueprint.sql",
  "219_sprint67_gpt_session_turn_batch_write_tool.sql",
  "236_sprint68_admin_branch_reconciliation_policy.sql",
  "248_sprint68_github_branch_fast_forward_policy.sql",
  "251_sprint68_github_branch_fast_forward_smoke_policy.sql",
  "255_sprint68_live_checkout_cleanup_capability_gate.sql",
  "256_sprint68_dynamic_audit_pipeline_readiness.sql",
  "257_sprint68_agent_runtime_ledger_readiness.sql",
  "216_sprint67_platform_secret_promotion_monitoring.sql",
  "222_sprint67_async_job_timeout_recovery.sql",
  "223_sprint67_gpt_session_conversation_refs.sql",
  "225_sprint67_gpt_session_conversation_ref_primary.sql",
  "223_sprint67_hostinger_ssh_probe_fast_timeout.sql",
  "224_sprint67_hostinger_ssh_probe_runner_modes.sql",
  "201_sprint68_lifecycle_owner_engine_registry_alignment.sql",
  "231_sprint68_shared_reconciliation_continuation_policy.sql",
  "232_sprint68_chunked_tool_response_continuation_policy.sql",
  "233_sprint68_local_connector_tunnel_provisioning_continuation_policy.sql",
  "235_sprint68_local_manager_chatgpt_url_capture_action.sql",
]);

const RUNNER_VERSION = "governed-migration-runner-v2";

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { mode: "dry_run", migration: "", confirm: "", recordOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--dry-run") parsed.mode = "dry_run";
    else if (arg === "--apply") parsed.mode = "apply";
    else if (arg === "--record-ledger") parsed.recordOnly = true;
    else if (arg === "--migration") parsed.migration = String(argv[++i] || "");
    else if (arg.startsWith("--migration=")) parsed.migration = arg.slice("--migration=".length);
    else if (arg === "--confirm") parsed.confirm = String(argv[++i] || "");
    else if (arg.startsWith("--confirm=")) parsed.confirm = arg.slice("--confirm=".length);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return parsed;
}

function confirmationFor(filename = "", { recordOnly = false } = {}) {
  const prefix = recordOnly ? "RECORD" : "APPLY";
  return `${prefix}_${String(filename).replace(/\.sql$/i, "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

function artifactNames(requirements = {}) {
  return Object.fromEntries(
    Object.entries(requirements).map(([key, values]) => [key, Array.isArray(values) ? values.slice(0, 100) : []])
  );
}

async function existingSchemaObjects(names = []) {
  const wanted = [...new Set((names || []).filter(Boolean))];
  if (!wanted.length) return [];
  const [rows] = await getPool().query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?) ORDER BY table_name",
    [wanted]
  );
  return rows.map((row) => row.table_name);
}

async function applyStatements(statements = []) {
  const pool = getPool();
  const results = [];
  for (const statement of statements) {
    const [result] = await pool.query(statement);
    results.push({
      statement: statement.slice(0, 140),
      affectedRows: result?.affectedRows ?? null,
      changedRows: result?.changedRows ?? null,
      warningStatus: result?.warningStatus ?? null,
      insertId: result?.insertId ?? null,
    });
  }
  return results;
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

async function findLedgerEntry(migration, checksum, mode = "record_only") {
  try {
    const [rows] = await getPool().query(
      "SELECT run_id, migration_file, migration_checksum_sha256, mode, applied_at FROM governed_migration_ledger WHERE migration_file = ? AND migration_checksum_sha256 = ? AND mode = ? ORDER BY applied_at DESC LIMIT 1",
      [migration, checksum, mode]
    );
    return rows?.[0] || null;
  } catch (error) {
    if (/doesn't exist|ER_NO_SUCH_TABLE/i.test(String(error?.message || ""))) return null;
    throw error;
  }
}

async function getMigrationAuthorization(migration, { mode = "dry_run" } = {}) {
  try {
    const [rows] = await getPool().query(
      `SELECT migration_file, authorization_status, authorization_source, policy_key,
              risk_tier, requires_preflight, requires_confirmation, allow_record_only, allow_apply
         FROM governed_migration_authorization_registry
        WHERE migration_file = ?
        LIMIT 1`,
      [migration]
    );
    const row = rows?.[0] || null;
    if (!row) {
      return { authorized: false, source: "db_registry", reason: "migration_not_authorized_in_db_registry" };
    }
    if (row.authorization_status !== "authorized") {
      return { authorized: false, source: "db_registry", reason: `authorization_status_${row.authorization_status}`, row };
    }
    if (mode === "apply" && Number(row.allow_apply) !== 1) {
      return { authorized: false, source: "db_registry", reason: "apply_not_allowed", row };
    }
    return { authorized: true, source: "db_registry", row };
  } catch (error) {
    if (!/doesn't exist|ER_NO_SUCH_TABLE/i.test(String(error?.message || ""))) throw error;
    const legacyAuthorized = LEGACY_BOOTSTRAP_ALLOWED_MIGRATIONS.has(migration);
    return {
      authorized: legacyAuthorized,
      source: "legacy_bootstrap_fallback",
      reason: legacyAuthorized ? "authorization_registry_missing_bootstrap_allowed" : "authorization_registry_missing_and_not_bootstrap_allowed",
      bootstrap_required: true,
    };
  }
}

async function recordMigrationLedger({
  migration,
  checksum,
  preflight,
  statement_count,
  requirements,
  results,
  before_schema_objects,
  after_schema_objects,
  ledgerMode = "apply",
  appliedBy = process.env.GOVERNED_MIGRATION_APPLIED_BY || "governed_migration_runner",
  extraMetadata = {},
}) {
  const run_id = randomUUID();
  const metadata = {
    node_version: process.version,
    platform: process.platform,
    runner_pid: process.pid,
    ...extraMetadata,
  };
  await getPool().query(
    `INSERT INTO governed_migration_ledger
      (run_id, migration_file, migration_checksum_sha256, applied_by, runner_version, mode,
       statement_count, preflight_status, preflight_risk_count, requirements_json, results_json,
       before_schema_objects_json, after_schema_objects_json, metadata_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      run_id,
      migration,
      checksum,
      appliedBy,
      RUNNER_VERSION,
      ledgerMode,
      statement_count,
      preflight?.status || "unknown",
      Number(preflight?.risk_count || 0),
      JSON.stringify(artifactNames(requirements)),
      JSON.stringify(results || []),
      JSON.stringify(before_schema_objects || []),
      JSON.stringify(after_schema_objects || []),
      JSON.stringify(metadata),
    ]
  );
  return { run_id, runner_version: RUNNER_VERSION, recorded: true };
}

async function main() {
  const args = parseArgs();
  const migration = path.basename(args.migration || "");
  if (!migration) throw new Error("--migration is required.");
  const authorization = await getMigrationAuthorization(migration, { mode: args.mode });
  if (!authorization.authorized) {
    throw new Error(`Migration is not authorized for governed runner: ${migration} (${authorization.reason})`);
  }

  const migrationPath = path.join(MIGRATIONS_DIR, migration);
  const sql = await fs.readFile(migrationPath, "utf8");
  const migration_checksum_sha256 = sha256(sql);
  const preflight = assessMigrationSqlPreflight(migration, sql);
  const requirements = extractMigrationReadinessRequirementsFromSql(sql);
  const statements = splitSqlStatements(sql);
  const statement_count = statements.length;
  const preflight_statement_count = Number(preflight?.counts?.statements || 0);
  const before_schema_objects = await existingSchemaObjects(requirements.schema_objects);

  if (preflight_statement_count !== statement_count) {
    console.log(JSON.stringify({
      ok: false,
      mode: args.mode,
      migration,
      blocked_reason: "preflight_statement_count_mismatch",
      preflight_statement_count,
      statement_count,
      preflight,
      requirements: artifactNames(requirements),
      before_schema_objects,
      applies_sql: false,
      secrets_included: false,
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  if (preflight.status !== "pass") {
    console.log(JSON.stringify({
      ok: false,
      mode: args.mode,
      migration,
      blocked_reason: "preflight_not_pass",
      preflight,
      requirements: artifactNames(requirements),
      before_schema_objects,
      applies_sql: false,
      secrets_included: false,
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const existingRecordOnlyLedger = args.recordOnly
    ? await findLedgerEntry(migration, migration_checksum_sha256, "record_only")
    : null;

  if (args.mode !== "apply") {
    console.log(JSON.stringify({
      ok: true,
      mode: args.recordOnly ? "record_only_dry_run" : "dry_run",
      migration,
      migration_checksum_sha256,
      applies_sql: false,
      records_ledger_only: Boolean(args.recordOnly),
      existing_record_only_ledger: existingRecordOnlyLedger,
      authorization,
      preflight,
      statement_count: statements.length,
      requirements: artifactNames(requirements),
      before_schema_objects,
      required_confirmation: confirmationFor(migration, { recordOnly: args.recordOnly }),
      secrets_included: false,
    }, null, 2));
    return;
  }

  const requiredConfirm = confirmationFor(migration, { recordOnly: args.recordOnly });
  if (args.confirm !== requiredConfirm) {
    throw new Error(`${args.recordOnly ? "Record-only ledger backfill" : "Apply"} requires --confirm=${requiredConfirm}`);
  }

  if (args.recordOnly) {
    if (existingRecordOnlyLedger) {
      console.log(JSON.stringify({
        ok: true,
        mode: "record_only",
        migration,
        migration_checksum_sha256,
        applies_sql: false,
        recorded: false,
        duplicate: true,
        existing_ledger: existingRecordOnlyLedger,
        preflight,
        statement_count,
        requirements: artifactNames(requirements),
        before_schema_objects,
        secrets_included: false,
      }, null, 2));
      return;
    }
    const ledger = await recordMigrationLedger({
      migration,
      checksum: migration_checksum_sha256,
      preflight,
      statement_count,
      requirements,
      results: [],
      before_schema_objects,
      after_schema_objects: before_schema_objects,
      ledgerMode: "record_only",
      appliedBy: "governed_migration_runner_backfill",
      extraMetadata: { record_only_backfill: true, sql_applied_by_this_run: false },
    });
    console.log(JSON.stringify({
      ok: true,
      mode: "record_only",
      migration,
      migration_checksum_sha256,
      applies_sql: false,
      recorded: true,
      preflight,
      statement_count,
      requirements: artifactNames(requirements),
      before_schema_objects,
      ledger,
      secrets_included: false,
    }, null, 2));
    return;
  }

  const results = await applyStatements(statements);
  const after_schema_objects = await existingSchemaObjects(requirements.schema_objects);
  const ledger = await recordMigrationLedger({
    migration,
    checksum: migration_checksum_sha256,
    preflight,
    statement_count,
    requirements,
    results,
    before_schema_objects,
    after_schema_objects,
  });

  console.log(JSON.stringify({
    ok: true,
    mode: "apply",
    migration,
    migration_checksum_sha256,
    applies_sql: true,
    preflight,
    statements_executed: results.length,
    results,
    requirements: artifactNames(requirements),
    before_schema_objects,
    after_schema_objects,
    ledger,
    secrets_included: false,
  }, null, 2));
}

async function closePoolQuietly() {
  try {
    await getPool().end();
  } catch {
    // Best-effort cleanup only. Do not mask the runner result.
  }
}

main()
  .then(async () => {
    await closePoolQuietly();
  })
  .catch(async (error) => {
    console.error(JSON.stringify({ ok: false, error: error?.message || String(error), secrets_included: false }, null, 2));
    await closePoolQuietly();
    process.exit(1);
  });
