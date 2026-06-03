import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildDatabaseLifecycleIncidentBridgePlan,
  runDatabaseLifecycleIncidentBridge,
} from "./databaseTableLifecycle.js";

const source = fs.readFileSync(new URL("./databaseTableLifecycle.js", import.meta.url), "utf8");
const routes = fs.readFileSync(new URL("./routes/platformEngineRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const manifest = fs.readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");

const readyPlan = buildDatabaseLifecycleIncidentBridgePlan({
  ok: true,
  operational_state: "ready",
  blockers: [],
  latest_snapshot: { snapshot_id: "snap_ready" },
  snapshot_freshness: { fresh: true },
});
assert.equal(readyPlan.should_open_incident, false);
assert.equal(readyPlan.incident_candidate, null);
assert.equal(readyPlan.secrets_included, false);

const degradedPlan = buildDatabaseLifecycleIncidentBridgePlan({
  ok: false,
  operational_state: "needs_attention",
  blockers: ["latest_lifecycle_report_snapshot_stale"],
  latest_snapshot: { snapshot_id: "snap_old" },
  snapshot_freshness: { fresh: false, age_hours: 300, max_age_hours: 192 },
});
assert.equal(degradedPlan.should_open_incident, true);
assert.equal(degradedPlan.incident_candidate.severity, "medium");
assert.equal(degradedPlan.incident_candidate.category, "operational");
assert(degradedPlan.incident_candidate.description.includes("latest_lifecycle_report_snapshot_stale"));

const missingSnapshotPlan = buildDatabaseLifecycleIncidentBridgePlan({
  ok: false,
  operational_state: "needs_attention",
  blockers: ["no_lifecycle_report_snapshot_recorded"],
});
assert.equal(missingSnapshotPlan.incident_candidate.severity, "high");

let inserted = false;
const applyResult = await runDatabaseLifecycleIncidentBridge({
  apply: true,
  confirm: "APPLY_DATABASE_LIFECYCLE_INCIDENT_BRIDGE",
  status: {
    ok: false,
    operational_state: "needs_attention",
    blockers: ["latest_lifecycle_report_snapshot_stale"],
    latest_snapshot: { snapshot_id: "snap_old" },
    snapshot_freshness: { fresh: false },
  },
}, {
  pool: {
    async query(sql) {
      if (sql.includes("SELECT incident_id")) return [[]];
      if (sql.includes("INSERT INTO incidents")) {
        inserted = true;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  },
});
assert.equal(applyResult.mode, "apply");
assert.equal(applyResult.write_result.created, true);
assert.equal(inserted, true);

const existingResult = await runDatabaseLifecycleIncidentBridge({
  apply: true,
  confirm: "APPLY_DATABASE_LIFECYCLE_INCIDENT_BRIDGE",
  status: {
    ok: false,
    operational_state: "needs_attention",
    blockers: ["scheduler_binding_guard_violation"],
  },
}, {
  pool: {
    async query(sql) {
      if (sql.includes("SELECT incident_id")) return [[{ incident_id: "inc_existing", status: "open" }]];
      if (sql.includes("INSERT INTO incidents")) throw new Error("duplicate insert must not happen");
      throw new Error(`unexpected query: ${sql}`);
    },
  },
});
assert.equal(existingResult.existing_incident.incident_id, "inc_existing");
assert.equal(existingResult.write_result, null);

await assert.rejects(
  () => runDatabaseLifecycleIncidentBridge({ apply: true, confirm: "WRONG" }),
  /APPLY_DATABASE_LIFECYCLE_INCIDENT_BRIDGE/
);

assert(source.includes("DATABASE_LIFECYCLE_INCIDENT_BRIDGE_CONFIRMATION"));
assert(routes.includes('router.post("/platform/engines/database-lifecycle/incident-bridge"'));
assert(openapi.includes("/platform/engines/database-lifecycle/incident-bridge"));
assert(openapi.includes("operationId: databaseLifecycleIncidentBridge"));
assert(openapi.includes("x-openai-isConsequential: true"));
assert(manifest.includes("node test-database-lifecycle-incident-bridge.mjs"));

console.log("database lifecycle incident bridge tests passed");
