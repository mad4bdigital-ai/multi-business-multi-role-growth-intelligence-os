import assert from "node:assert/strict";

import {
  AUTHORITY_PROJECTION_COMPILER_VERSION,
  AUTHORITY_PROJECTION_SURFACES,
  compileAuthoritySurfaceProjections,
} from "./authorityProjectionCompiler.js";

const NOW = new Date("2030-01-01T00:00:00.000Z");

function manifest(overrides = {}) {
  return {
    decisionId: "decision-01",
    decision: "ready",
    readiness: {
      dynamic_tabs: "ready",
      dashboard: "ready",
      tool_catalog: "ready",
      execution: "ready",
    },
    projectionEligibility: {
      dynamic_tabs: true,
      dashboard: true,
      tool_catalog: true,
      execution: true,
    },
    gaps: [],
    versions: {
      authority: "authority-revision-01",
      capability: "capability-revision-01",
    },
    evaluatedAt: "2029-12-31T23:59:00.000Z",
    expiresAt: "2030-01-01T00:05:00.000Z",
    secretsIncluded: false,
    ...overrides,
  };
}

const registrations = {
  dynamic_tabs: [
    {
      key: "insights",
      label: "Insights",
      capability_key: "growth.read",
      resource_type: "brand",
      resource_id: "brand-01",
      public_metadata: { order: 2, token: "drop-me" },
    },
    {
      key: "overview",
      label: "Overview",
      capability_key: "growth.read",
      resource_type: "brand",
      resource_id: "brand-01",
      public_metadata: { order: 1 },
    },
  ],
  dashboard: [
    {
      key: "growth-score",
      label: "Growth score",
      capability_key: "growth.read",
      public_metadata: { href: "https://user:pass@example.com/path?api_key=secret&view=summary" },
    },
  ],
  tool_catalog: [
    {
      key: "project_custom_read_model",
      label: "Project custom read model",
      capability_key: "repo.read",
      operation: "repository.inspect",
      public_metadata: { transport: "mcp", authorization: "Bearer forbidden" },
    },
  ],
};

const ready = compileAuthoritySurfaceProjections({ manifest: manifest(), registrations, now: NOW });
assert.equal(ready.contract, AUTHORITY_PROJECTION_COMPILER_VERSION);
assert.deepEqual(AUTHORITY_PROJECTION_SURFACES, ["dynamic_tabs", "dashboard", "tool_catalog"]);
assert.equal(ready.authority_decision_id, "decision-01");
assert.equal(ready.projection_only, true);
assert.equal(ready.creates_authority, false);
assert.equal(ready.runtime_enforcement_enabled, false);
assert.equal(ready.execution_authorized, false);
assert.equal(ready.action_grant_emitted, false);
assert.equal(ready.provider_called, false);
assert.equal(ready.database_mutated, false);
assert.equal(ready.secrets_included, false);

assert.equal(ready.surfaces.dynamic_tabs.visible, true);
assert.deepEqual(ready.surfaces.dynamic_tabs.items.map((item) => item.key), ["insights", "overview"]);
assert.equal(Object.hasOwn(ready.surfaces.dynamic_tabs.items[0].public_metadata, "token"), false);
assert.equal(ready.surfaces.dashboard.items[0].public_metadata.href.includes("user:pass@"), false);
assert.match(ready.surfaces.dashboard.items[0].public_metadata.href, /api_key=%5Bredacted%5D/u);

const tool = ready.surfaces.tool_catalog.items[0];
assert.equal(tool.visible, true);
assert.equal(tool.action_eligible, true, "ready projection may mark an action eligible for later PEP evaluation");
assert.equal(tool.execution_authorized, false, "projection eligibility never authorizes execution");
assert.equal(tool.action_grant_emitted, false);
assert.equal(Object.hasOwn(tool.public_metadata, "authorization"), false);

const shadow = compileAuthoritySurfaceProjections({
  manifest: manifest({ decision: "shadow_ready" }),
  registrations,
  now: NOW,
});
assert.equal(shadow.surfaces.tool_catalog.visible, true);
assert.equal(shadow.surfaces.tool_catalog.items[0].action_eligible, false);
assert.deepEqual(shadow.surfaces.tool_catalog.items[0].action_blocked_reason_codes, ["AUTHORITY_EXECUTION_NOT_ELIGIBLE"]);
assert.equal(shadow.execution_authorized, false);

const executionBlocked = compileAuthoritySurfaceProjections({
  manifest: manifest({
    readiness: { ...manifest().readiness, execution: "blocked" },
  }),
  registrations,
  now: NOW,
});
assert.equal(executionBlocked.surfaces.tool_catalog.items[0].action_eligible, false);

const hidden = compileAuthoritySurfaceProjections({
  manifest: manifest({
    projectionEligibility: {
      dynamic_tabs: false,
      dashboard: false,
      tool_catalog: false,
      execution: true,
    },
  }),
  registrations: {
    dynamic_tabs: [
      { key: "secret-tab", label: "Must not leak" },
      { key: "secret-tab", label: "Duplicate must not be inspected" },
    ],
    dashboard: "malformed-hidden-dashboard-registration-must-not-be-inspected",
    tool_catalog: [{ label: "missing-key-must-not-be-inspected" }],
  },
  now: NOW,
});
for (const surface of AUTHORITY_PROJECTION_SURFACES) {
  const projection = hidden.surfaces[surface];
  assert.equal(projection.visible, false);
  assert.deepEqual(projection.items, []);
  assert.equal(projection.candidate_count_disclosed, false);
  assert.deepEqual(projection.reason_codes, ["AUTHORITY_PROJECTION_NOT_ELIGIBLE"]);
}
const hiddenJson = JSON.stringify(hidden);
assert.equal(hiddenJson.includes("secret-tab"), false);
assert.equal(hiddenJson.includes("malformed-hidden-dashboard"), false);
assert.equal(hiddenJson.includes("missing-key-must-not-be-inspected"), false);

const expired = compileAuthoritySurfaceProjections({
  manifest: manifest({ expiresAt: "2029-12-31T23:59:59.000Z" }),
  registrations: {
    dynamic_tabs: [{ key: "expired-secret", label: "Must not leak" }, { key: "expired-secret" }],
    dashboard: { malformed: true },
    tool_catalog: [{ label: "expired-missing-key" }],
  },
  now: NOW,
});
assert.equal(expired.manifest_expired, true);
for (const surface of AUTHORITY_PROJECTION_SURFACES) {
  assert.equal(expired.surfaces[surface].visible, false);
  assert.deepEqual(expired.surfaces[surface].reason_codes, ["AUTHORITY_MANIFEST_EXPIRED"]);
  assert.deepEqual(expired.surfaces[surface].items, []);
}
assert.equal(JSON.stringify(expired).includes("expired-secret"), false);

const permuted = compileAuthoritySurfaceProjections({
  manifest: manifest(),
  registrations: {
    ...registrations,
    dynamic_tabs: [...registrations.dynamic_tabs].reverse(),
  },
  now: NOW,
});
assert.deepEqual(
  permuted.surfaces.dynamic_tabs.items.map((item) => item.key),
  ready.surfaces.dynamic_tabs.items.map((item) => item.key),
  "projection output must be deterministic under registration order changes",
);

assert.throws(
  () => compileAuthoritySurfaceProjections({
    manifest: manifest(),
    registrations: { dynamic_tabs: [{ key: "duplicate" }, { key: "duplicate" }] },
    now: NOW,
  }),
  (error) => error?.code === "AUTHORITY_PROJECTION_REGISTRATION_AMBIGUOUS",
);

assert.throws(
  () => compileAuthoritySurfaceProjections({
    manifest: manifest({ secretsIncluded: true }),
    registrations,
    now: NOW,
  }),
  (error) => error?.code === "AUTHORITY_PROJECTION_SECRET_EVIDENCE_FORBIDDEN",
);

console.log("shared authority projection compiler tests passed");
