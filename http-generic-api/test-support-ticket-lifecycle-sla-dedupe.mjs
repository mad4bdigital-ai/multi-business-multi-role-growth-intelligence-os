import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  computeSupportTicketDedupeKeyV2,
  computeSupportTicketSlaStatusV2,
  deriveSupportTicketIntegrity,
  resolveSupportTicketLifecyclePatch,
} from "./supportTicketLifecycleIntegrityService.js";

const baseEnvelope = {
  tenant_id: "tenant-a",
  user_id: "user-a",
  ticket_type: "managed_service_request",
  target_capability: "wordpress_tenant_safe_self_repair",
  resource: { type: "site", ref: "site://wovacation", relationship: "subject" },
};

const parentA = computeSupportTicketDedupeKeyV2({
  ...baseEnvelope,
  intended_parent_ticket_id: "b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4",
});
const parentB = computeSupportTicketDedupeKeyV2({
  ...baseEnvelope,
  intended_parent_ticket_id: "bae08982-cec1-4527-8be2-68d501706345",
});
assert.notEqual(parentA, parentB, "intended parent ticket must participate in dedupe identity");
assert.equal(parentA, computeSupportTicketDedupeKeyV2({
  ...baseEnvelope,
  intended_parent_ticket_id: "b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4",
}), "canonical dedupe key must be stable");
assert.match(parentA, /^ticket:v2:[a-f0-9]{64}$/);

const capabilityA = computeSupportTicketDedupeKeyV2({ ...baseEnvelope, target_capability: "capability-a" });
const capabilityB = computeSupportTicketDedupeKeyV2({ ...baseEnvelope, target_capability: "capability-b" });
assert.notEqual(capabilityA, capabilityB, "target capability must participate in dedupe identity");

const testTicket = deriveSupportTicketIntegrity({
  title: "Smoke test - support ticket email routing after governed outbox tools",
  environment: "production",
});
assert.equal(testTicket.is_test, true);
assert.equal(testTicket.environment, "production");
assert.equal(testTicket.visibility_class, "internal_test");

const simulationTicket = deriveSupportTicketIntegrity({
  title: "Tenant user simulation: WhatsApp channel repair link",
  metadata_json: { admin_simulation: true },
});
assert.equal(simulationTicket.is_test, true);
assert.equal(simulationTicket.visibility_class, "internal_test");

const customerTicket = deriveSupportTicketIntegrity({
  title: "Brand-scoped manager invitation required",
  environment: "production",
});
assert.equal(customerTicket.is_test, false);
assert.equal(customerTicket.visibility_class, "customer_visible");

const now = new Date("2026-08-01T12:00:00Z");
const completedMilestones = computeSupportTicketSlaStatusV2({
  status: "open",
  first_response_due_at: "2026-08-01T08:00:00Z",
  first_response_at: "2026-08-01T07:55:00Z",
  triage_due_at: "2026-08-01T09:00:00Z",
  triaged_at: "2026-08-01T08:30:00Z",
  resolution_due_at: "2026-08-03T00:00:00Z",
}, now);
assert.equal(completedMilestones.status, "on_track", "completed milestones must not breach after their due timestamps");
assert.deepEqual(completedMilestones.breached_milestones, []);

const resolutionBreach = computeSupportTicketSlaStatusV2({
  status: "open",
  first_response_due_at: "2026-08-01T08:00:00Z",
  first_response_at: "2026-08-01T07:55:00Z",
  triage_due_at: "2026-08-01T09:00:00Z",
  triaged_at: "2026-08-01T08:30:00Z",
  resolution_due_at: "2026-08-01T10:00:00Z",
}, now);
assert.equal(resolutionBreach.status, "breached");
assert.equal(resolutionBreach.reason, "resolution_past_due");
assert.deepEqual(resolutionBreach.breached_milestones, ["resolution"]);

const lifecycleContradiction = resolveSupportTicketLifecyclePatch({
  ticket_id: "685dc4d9-c137-4941-81f4-de13306a8508",
  status: "open",
  lifecycle_state: "resolved_runtime_validated",
  customer_status: "resolved_runtime_validated",
});
assert.equal(lifecycleContradiction.should_update, true);
assert.equal(lifecycleContradiction.status, "resolved");

const migration = await readFile(new URL("./migrations/1042_sprint69_support_ticket_lifecycle_sla_dedupe.sql", import.meta.url), "utf8");
for (const column of [
  "is_test",
  "environment",
  "visibility_class",
  "target_capability",
  "related_ticket_id",
  "parent_ticket_id",
  "supersedes_ticket_id",
  "first_response_at",
  "triaged_at",
]) {
  assert.match(migration, new RegExp(`\\b${column}\\b`), `migration must contain ${column}`);
}
assert.match(migration, /310f39c8-d2f7-4523-95db-9a783c59f9cf/);
assert.match(migration, /b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4/);
assert.match(migration, /685dc4d9-c137-4941-81f4-de13306a8508/);
assert.match(migration, /GREATEST\(/);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|INDEX)/i);
assert.doesNotMatch(migration, /DELETE\s+FROM/i);

const routeSource = await readFile(new URL("./routes/supportTicketLifecycleIntegrityRoutes.js", import.meta.url), "utf8");
assert.match(routeSource, /router\.post\("\/me\/support\/tickets"/);
assert.match(routeSource, /router\.get\("\/me\/support\/tickets"/);
assert.match(routeSource, /include_test:\s*false/);
assert.match(routeSource, /APPLY_SUPPORT_TICKET_INTEGRITY_RECONCILIATION/);
assert.match(routeSource, /import\s+\{\s*createUserJwtMiddleware\s*\}\s+from\s+"\.\.\/userJwtAuth\.js"/);
assert.match(routeSource, /deps\.requireUserJwt\s*\|\|\s*createUserJwtMiddleware/);
assert.doesNotMatch(routeSource, /from\s+["']jsonwebtoken["']/);
assert.doesNotMatch(routeSource, /development_fallback_secret_only/);
assert.doesNotMatch(routeSource, /function\s+(?:verifyUserJwt|requireUserJwt)\s*\(/);

const indexSource = await readFile(new URL("./routes/index.js", import.meta.url), "utf8");
const integrityMount = indexSource.indexOf("buildSupportTicketLifecycleIntegrityRoutes");
const legacyMount = indexSource.indexOf("buildSupportTicketRoutes");
assert.ok(integrityMount >= 0, "integrity router must be registered");
assert.ok(legacyMount >= 0, "legacy support router must remain registered");
assert.ok(integrityMount < legacyMount, "integrity router must mount before legacy support router");

console.log("support ticket lifecycle, SLA, test visibility, dedupe integrity, and centralized JWT auth tests passed");
