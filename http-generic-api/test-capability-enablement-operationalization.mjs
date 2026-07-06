import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [migration, operationalIntelligence, dashboardSurface, attentionSurface] = await Promise.all([
  read("./migrations/1039_sprint69_capability_enablement_operational_dashboard.sql"),
  read("./activationOperationalIntelligenceEvidence.js"),
  read("./activation-surfaces/capability_enablement_operational_dashboard.json"),
  read("./activation-surfaces/capability_enablement_operational_attention.json"),
]);

assert.match(migration, /v_capability_enablement_operational_dashboard/);
assert.match(migration, /v_capability_enablement_operational_attention/);
assert.match(migration, /github_superseded_branch_cleanup/);
assert.match(migration, /secrets_included=false|secrets_included'\s*,\s*false/i);
assert.equal(/DROP\s+TABLE/i.test(migration), false);
assert.equal(/DELETE\s+FROM\s+capability_enablement_requests/i.test(migration), false);

assert.match(operationalIntelligence, /buildCapabilityEnablementDashboard/);
assert.match(operationalIntelligence, /capabilityEnablementRequests/);
assert.match(operationalIntelligence, /capability_enablement/);
assert.match(operationalIntelligence, /capability\.approve_envelope/);
assert.match(operationalIntelligence, /capability\.resolve_gap/);

const dashboard = JSON.parse(dashboardSurface);
assert.equal(dashboard.source_table, "v_capability_enablement_operational_dashboard");
assert.equal(dashboard.include_for_admin, true);
assert.equal(dashboard.include_for_tenant, true);
assert.equal(dashboard.result_columns.includes("secret_rows"), true);
assert.equal(dashboard.result_columns.includes("classification_json"), false);

const attention = JSON.parse(attentionSurface);
assert.equal(attention.source_table, "v_capability_enablement_operational_attention");
assert.equal(attention.include_for_admin, true);
assert.equal(attention.include_for_tenant, true);
assert.equal(attention.result_columns.includes("reason_code"), true);
assert.equal(attention.result_columns.includes("reason_codes_json"), false);

console.log(JSON.stringify({
  ok: true,
  test: "capability_enablement_operationalization",
  checked: {
    migration: true,
    operational_intelligence: true,
    dashboard_surface: true,
    attention_surface: true
  },
  secrets_included: false
}));
