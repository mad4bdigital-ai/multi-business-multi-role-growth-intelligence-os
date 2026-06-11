import assert from "node:assert/strict";
import fs from "node:fs";
import { discoverSurfaces, renderSurfaceContractMarkdown } from "./scripts/surface-contract-discovery.mjs";

const report = discoverSurfaces({ limit: 200 });
assert.equal(report.ok, true, "surface discovery report must be ok");
assert.equal(report.schema_version, "surface-contract-discovery-v2", "surface discovery must expose a versioned machine contract");
assert(report.all_migrations.length >= report.migrations.length, "machine report must include all migrations, not only rendered latest rows");
assert(report.coverage_summary.migrations_with_surfaces >= report.migrations.length, "coverage summary must cover all discovered surface migrations");
assert.equal(report.safety.secrets_included, false, "surface discovery must never include secrets");
assert.equal(report.safety.executes_provider_calls, false, "surface discovery must not execute provider calls");
assert.equal(report.safety.writes_database, false, "surface discovery must not write database rows");
assert.equal(report.safety.external_sends, false, "surface discovery must not send externally");
assert.equal(report.safety.deploys, false, "surface discovery must not deploy");

assert.equal(typeof report.coverage_summary.docs_completion_percent, "number", "coverage summary must expose docs completion percent");
assert.equal(typeof report.coverage_summary.gap_severity_counts.high, "number", "coverage summary must count high-risk docs gaps");
assert.equal(typeof report.coverage_summary.surface_totals.routes, "number", "coverage summary must count route surfaces");
assert.equal(typeof report.coverage_summary.route_coverage.openapi_sql_route_coverage_percent, "number", "coverage summary must score SQL route/OpenAPI coverage");
assert(Array.isArray(report.coverage_summary.route_coverage.route_openapi_gaps), "coverage summary must list route/OpenAPI gaps");
assert(report.coverage_summary.missing_doc_target_counts["Updating Registry Patch Index.md"] >= 0, "coverage summary must count missing docs by target");
assert(report.coverage_summary.safety_marker_counts.secrets_included_false >= 0, "coverage summary must count safety marker coverage");

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
assert(migration954.coverage.gap_severity !== "none", "new undocumented surface migrations must be classified as gaps");

const markdown = renderSurfaceContractMarkdown(report);
assert(markdown.includes("Surface Contract Discovery Status"), "markdown must render status title");
assert(markdown.includes("Coverage Summary"), "markdown must render deep coverage summary");
assert(markdown.includes("SQL Route OpenAPI Gaps"), "markdown must render route/OpenAPI gap section");
assert(markdown.includes("surface-contract-discovery-status.json"), "markdown must point to machine-readable JSON output");
assert(markdown.includes("support_ticket_external_delivery_orchestrator"), "markdown must include discovered plugin evidence");
assert(markdown.includes("OpenAPI route autofill"), "markdown must explain relationship to OpenAPI autofill");

const maintenanceSync = fs.readFileSync("scripts/repo-maintenance-sync.mjs", "utf8");
assert(maintenanceSync.includes("surface-contract-discovery.mjs"), "repo maintenance sync must run surface contract discovery");

const workflow = fs.readFileSync("../.github/workflows/openapi-auto-sync.yml", "utf8");
assert(workflow.includes('"http-generic-api/migrations/**"'), "OpenAPI auto-sync workflow must trigger on migrations");
assert(workflow.includes('"http-generic-api/scripts/surface-contract-discovery.mjs"'), "OpenAPI auto-sync workflow must trigger on surface discovery script changes");

console.log("surface contract discovery deep coverage guard passed");
