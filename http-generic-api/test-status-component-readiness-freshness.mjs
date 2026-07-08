import assert from "node:assert/strict";
import { projectComponentReadiness } from "./routes/statusRoutes.js";

const now = Date.parse("2026-07-02T08:00:00.000Z");

const registeredOnly = projectComponentReadiness({
  registered: true,
  reachable: false,
  observed_count: null,
  last_observed_at: null,
  now_ms: now,
});
assert.equal(registeredOnly.readiness_status, "not_ready");
assert.equal(registeredOnly.health_status, "degraded");
assert(registeredOnly.blocked_reasons.includes("component_probe_failed"));
assert(registeredOnly.blocked_reasons.includes("component_has_no_runtime_observations"));
assert(registeredOnly.blocked_reasons.includes("component_freshness_missing"));

const reachableButEmpty = projectComponentReadiness({
  registered: true,
  reachable: true,
  observed_count: 0,
  last_observed_at: "2026-07-02T07:59:00.000Z",
  now_ms: now,
});
assert.equal(reachableButEmpty.readiness_status, "not_ready");
assert.equal(reachableButEmpty.health_status, "degraded");
assert(registeredOnly.secrets_included === false);
assert(reachableButEmpty.blocked_reasons.includes("component_has_no_runtime_observations"));

const stale = projectComponentReadiness({
  registered: true,
  reachable: true,
  observed_count: 3,
  last_observed_at: "2026-07-02T07:00:00.000Z",
  freshness_ms: 15 * 60 * 1000,
  now_ms: now,
});
assert.equal(stale.freshness_status, "stale");
assert.equal(stale.health_status, "degraded");
assert(stale.blocked_reasons.includes("component_freshness_stale"));

const ready = projectComponentReadiness({
  registered: true,
  reachable: true,
  observed_count: 4,
  last_observed_at: "2026-07-02T07:59:00.000Z",
  freshness_ms: 15 * 60 * 1000,
  now_ms: now,
});
assert.equal(ready.readiness_status, "ready");
assert.equal(ready.health_status, "healthy");
assert.equal(ready.freshness_status, "fresh");
assert.deepEqual(ready.blocked_reasons, []);
assert.equal(ready.secrets_included, false);

console.log("status component readiness freshness tests passed");
