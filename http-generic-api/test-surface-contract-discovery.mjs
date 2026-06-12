import assert from "node:assert/strict";
import fs from "node:fs";
import { discoverSurfaces, renderGapQueueMarkdown, renderSurfaceContractMarkdown } from "./scripts/surface-contract-discovery.mjs";

const report = discoverSurfaces({ limit: 200 });
assert.equal(report.ok, true, "surface discovery report must be ok");
assert.equal(report.schema_version, "surface-contract-discovery-v3", "surface discovery must expose v3 actionable queue contract");
assert.equal(report.gap_queue.schema_version, "surface-contract-gap-queue-v1", "gap queue must expose a versioned machine contract");
assert.equal(report.legacy_backlog_closure.schema_version, "surface-contract-legacy-backlog-closure-v1", "legacy backlog closure must expose a versioned machine contract");
assert(report.legacy_backlog_closure.closed_migration_count > 0, "legacy backlog closure must classify historical migrations without applying runtime mutations");
assert(report.all_migrations.length >= report.migrations.length, "machine report must include all migrations, not only rendered latest rows");
assert(report.coverage_summary.migrations_with_surfaces >= report.migrations.length, "coverage summary must cover all discovered surface migrations");
assert.equal(report.safety.secrets_included, false, "surface discovery must never include secrets");
assert.equal(report.safety.executes_provider_calls, false, "surface discovery must not execute provider calls");
assert.equal(report.safety.writes_database, false, "surface discovery must not write database rows");
assert.equal(report.safety.external_sends, false, "surface discovery must not send externally");
assert.equal(report.safety.deploys, false, "surface discovery must not deploy");
assert.equal(report.gap_queue.safety.secrets_included, false, "gap queue must not include secrets");
assert.equal(report.gap_queue.safety.executes_provider_calls, false, "gap queue must not execute provider calls");
assert.equal(report.gap_queue.safety.writes_database, false, "gap queue must not write database rows");

assert.equal(typeof report.coverage_summary.docs_completion_percent, "number", "coverage summary must expose docs completion percent");
assert.equal(typeof report.coverage_summary.gap_severity_counts.high, "number", "coverage summary must count high-risk docs gaps");
assert.equal(typeof report.coverage_summary.surface_totals.routes, "number", "coverage summary must count route surfaces");
assert.equal(typeof report.coverage_summary.route_coverage.openapi_sql_route_coverage_percent, "number", "coverage summary must score SQL route/OpenAPI coverage");
assert.equal(typeof report.coverage_summary.route_coverage.openapi_exempt_sql_route_count, "number", "coverage summary must count OpenAPI-exempt route-like surfaces");
assert.equal(typeof report.coverage_summary.route_coverage.route_class_counts.admin_tool_registry_route, "number", "coverage summary must count admin tool registry route classifications");
assert(Array.isArray(report.coverage_summary.route_coverage.route_openapi_gaps), "coverage summary must list route/OpenAPI gaps");
assert(report.coverage_summary.missing_doc_target_counts["Updating Registry Patch Index.md"] >= 0, "coverage summary must count missing docs by target");
assert(report.coverage_summary.safety_marker_counts.secrets_included_false >= 0, "coverage summary must count safety marker coverage");
assert(report.gap_queue.total_items >= 1, "gap queue must contain actionable items when coverage gaps exist");
assert(Array.isArray(report.gap_queue.top_items), "gap queue must expose top_items");
assert(report.gap_queue.top_items.every((item) => item.score > 0), "gap queue top items must be scored");
assert(report.gap_queue.top_items.every((item) => Array.isArray(item.remediation)), "gap queue items must include remediation actions");

const migration287 = report.all_migrations.find((entry) => entry.migration_file === "287_sprint68_external_delivery_orchestration_graph_plugin.sql");
assert(migration287, "migration 287 must be discoverable as a SQL-backed surface migration");
assert(migration287.surfaces.plugins.includes("support_ticket_external_delivery_orchestrator"), "migration 287 plugin must be detected");
assert(migration287.surfaces.views.includes("v_platform_orchestration_external_delivery_readiness"), "migration 287 readback view must be detected");
assert(migration287.surfaces.policies.includes("support_ticket_external_delivery_orchestration_readback_policy_v1"), "migration 287 policy must be detected");
assert.equal(migration287.surfaces.safety.no_external_send, true, "migration 287 no_external_send marker must be detected");
assert.equal(migration287.surfaces.safety.secrets_included_false, true, "migration 287 secrets_included=false marker must be detected");
assert.equal(migration287.coverage.gap_severity, "none", "documented migration 287 must not be treated as an active docs gap");

const migration910 = report.all_migrations.find((entry) => entry.migration_file === "910_sprint68_session_insight_capability_binding_hardening.sql");
assert(migration910, "migration 910 must stay discoverable after deep coverage changes");
assert.equal(migration910.documentation_complete, true, "migration 910 documentation coverage must remain complete");
assert.equal(migration910.coverage.requires_docs_review, false, "migration 910 must not require docs review after completion");

const migration954 = report.all_migrations.find((entry) => entry.migration_file === "954_sprint68_compact_operational_views_and_github_resource_coverage.sql");
assert(migration954, "migration 954 must be captured by all-migration coverage after auto-sync");
assert(migration954.surfaces.views.includes("v_release_readiness_compact"), "migration 954 compact readiness view must be detected");
const queue954 = report.gap_queue.top_items.find((entry) => entry.migration_file === "954_sprint68_compact_operational_views_and_github_resource_coverage.sql");
if (migration954.coverage.gap_severity !== "none") {
  assert.equal(migration954.coverage.requires_docs_review, true, "undocumented migration 954 must remain marked for docs review");
  if (queue954) {
    assert(queue954.remediation.some((action) => action.action_key === "document_surface_contract"), "migration 954 must recommend documentation remediation when ranked in top queue");
    assert(queue954.remediation.some((action) => action.action_key === "verify_readback_view"), "migration 954 must recommend readback view verification when ranked in top queue");
    assert(queue954.safety.secrets_included === false, "queue item must not include secrets");
  }
} else {
  assert.equal(migration954.documentation_complete, true, "documented migration 954 may leave actionable gap queue only after docs are complete");
}

const migration955 = report.all_migrations.find((entry) => entry.migration_file === "955_sprint68_external_delivery_admin_control_surface.sql");
assert(migration955, "migration 955 must be discoverable for route classification regression coverage");
assert.equal(migration955.coverage.route_coverage.missing_count, 0, "admin tool registry routes in migration 955 must not be treated as OpenAPI gaps");
assert.equal(migration955.coverage.route_coverage.exempted_route_count, 5, "migration 955 external delivery control routes must be OpenAPI-exempt registry routes");
assert(migration955.coverage.route_coverage.route_classifications.every((entry) => entry.route_class === "admin_tool_registry_route"), "migration 955 route literals must be classified as admin_tool_registry_route");

const migration286 = report.all_migrations.find((entry) => entry.migration_file === "286_sprint68_platform_schema_contract_completion_registry.sql");
assert(migration286, "migration 286 must be discoverable for synthetic endpoint schema route classification");
assert.equal(migration286.coverage.route_coverage.missing_count, 0, "synthetic endpoint-native schema routes in migration 286 must not be treated as OpenAPI gaps");
assert(migration286.coverage.route_coverage.route_classifications.every((entry) => entry.route_class === "registry_only_surface"), "migration 286 route literals must be registry_only_surface classifications");

const markdown = renderSurfaceContractMarkdown(report);
assert(markdown.includes("Surface Contract Discovery Status"), "markdown must render status title");
assert(markdown.includes("Coverage Summary"), "markdown must render deep coverage summary");
assert(markdown.includes("Actionable Gap Queue"), "markdown must render actionable gap queue summary");
assert(markdown.includes("SQL Route OpenAPI Gaps"), "markdown must render route/OpenAPI gap section");
assert(markdown.includes("Route Classification Coverage"), "markdown must render route classification coverage section");
assert(markdown.includes("surface-contract-discovery-status.json"), "markdown must point to machine-readable JSON output");
assert(markdown.includes("surface-contract-gap-queue.json"), "markdown must point to machine-readable gap queue output");
assert(markdown.includes("support_ticket_external_delivery_orchestrator"), "markdown must include discovered plugin evidence");
assert(markdown.includes("OpenAPI route autofill"), "markdown must explain relationship to OpenAPI autofill");

const queueMarkdown = renderGapQueueMarkdown(report.gap_queue);
assert(queueMarkdown.includes("Surface Contract Gap Queue"), "gap queue markdown must render title");
assert(queueMarkdown.includes("Remediation actions"), "gap queue markdown must include remediation actions");
assert(queueMarkdown.includes("surface-contract-gap-queue.json"), "gap queue markdown must reference JSON queue");

const maintenanceSync = fs.readFileSync("scripts/repo-maintenance-sync.mjs", "utf8");
assert(maintenanceSync.includes("surface-contract-discovery.mjs"), "repo maintenance sync must run surface contract discovery");

const workflow = fs.readFileSync("../.github/workflows/openapi-auto-sync.yml", "utf8");
assert(workflow.includes('"http-generic-api/migrations/**"'), "OpenAPI auto-sync workflow must trigger on migrations");
assert(workflow.includes('"http-generic-api/scripts/surface-contract-discovery.mjs"'), "OpenAPI auto-sync workflow must trigger on surface discovery script changes");

console.log("surface contract discovery actionable gap queue guard passed");
