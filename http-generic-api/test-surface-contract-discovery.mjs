import assert from "node:assert/strict";
import fs from "node:fs";
import { discoverSurfaces, renderSurfaceContractMarkdown } from "./scripts/surface-contract-discovery.mjs";

const report = discoverSurfaces({ limit: 200 });
assert.equal(report.ok, true, "surface discovery report must be ok");
assert.equal(report.safety.secrets_included, false, "surface discovery must never include secrets");
assert.equal(report.safety.executes_provider_calls, false, "surface discovery must not execute provider calls");
assert.equal(report.safety.writes_database, false, "surface discovery must not write database rows");

const migration287 = report.migrations.find((entry) => entry.migration_file === "287_sprint68_external_delivery_orchestration_graph_plugin.sql");
assert(migration287, "migration 287 must be discoverable as a SQL-backed surface migration");
assert(migration287.surfaces.plugins.includes("support_ticket_external_delivery_orchestrator"), "migration 287 plugin must be detected");
assert(migration287.surfaces.views.includes("v_platform_orchestration_external_delivery_readiness"), "migration 287 readback view must be detected");
assert(migration287.surfaces.policies.includes("support_ticket_external_delivery_orchestration_readback_policy_v1"), "migration 287 policy must be detected");
assert.equal(migration287.surfaces.safety.no_external_send, true, "migration 287 no_external_send marker must be detected");
assert.equal(migration287.surfaces.safety.secrets_included_false, true, "migration 287 secrets_included=false marker must be detected");

const markdown = renderSurfaceContractMarkdown(report);
assert(markdown.includes("Surface Contract Discovery Status"), "markdown must render status title");
assert(markdown.includes("support_ticket_external_delivery_orchestrator"), "markdown must include discovered plugin evidence");
assert(markdown.includes("OpenAPI route autofill"), "markdown must explain relationship to OpenAPI autofill");

const maintenanceSync = fs.readFileSync("scripts/repo-maintenance-sync.mjs", "utf8");
assert(maintenanceSync.includes("surface-contract-discovery.mjs"), "repo maintenance sync must run surface contract discovery");

const workflow = fs.readFileSync("../.github/workflows/openapi-auto-sync.yml", "utf8");
assert(workflow.includes('"http-generic-api/migrations/**"'), "OpenAPI auto-sync workflow must trigger on migrations");
assert(workflow.includes('"http-generic-api/scripts/surface-contract-discovery.mjs"'), "OpenAPI auto-sync workflow must trigger on surface discovery script changes");

console.log("surface contract discovery automation guard passed");
