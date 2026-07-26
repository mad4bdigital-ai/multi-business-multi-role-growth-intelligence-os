import assert from "node:assert/strict";
import fs from "node:fs";

const statusRoutes = fs.readFileSync(new URL("./routes/statusRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const manifest = fs.readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");

assert(statusRoutes.includes("getDatabaseLifecycleOperationalStatus"));
assert(statusRoutes.includes('id: "database_lifecycle"'));
assert(statusRoutes.includes('label: "Database Lifecycle"'));
assert(statusRoutes.includes('operational_state: lifecycle.operational_state'));
assert(statusRoutes.includes('snapshot_freshness: lifecycle.snapshot_freshness'));
assert(statusRoutes.includes('secrets_included: false'));
assert(statusRoutes.includes('status: lifecycle.ok ? "operational" : "degraded"'));
assert(!statusRoutes.includes("report_json"), "public status route must not expose full lifecycle reports");
assert(!statusRoutes.includes("summary_json"), "public status route must not expose raw lifecycle summary JSON columns");

assert(openapi.includes("database_lifecycle"));
assert(manifest.includes("node test-status-database-lifecycle-component.mjs"));

console.log("status database lifecycle component tests passed");
