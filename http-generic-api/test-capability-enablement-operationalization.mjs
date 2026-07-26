import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [migration, dashboardSurface, attentionSurface, runbook] = await Promise.all([
  read("./migrations/1040_sprint69_capability_enablement_operational_dashboard.sql"),
  read("./activation-surfaces/capability_enablement_operational_dashboard.json"),
  read("./activation-surfaces/capability_enablement_operational_attention.json"),
  read("../docs/capability-enablement-operational-runbook.md"),
]);

assert.match(migration, /v_capability_enablement_operational_dashboard/);
assert.match(migration, /v_capability_enablement_operational_attention/);
assert.match(migration, /github_superseded_branch_cleanup/);
assert.match(migration, /secrets_included'\s*,\s*false/i);
assert.equal(/DROP\s+TABLE/i.test(migration), false);
assert.equal(/DELETE\s+FROM\s+capability_enablement_requests/i.test(migration), false);

const dashboard = JSON.parse(dashboardSurface);
assert.equal(dashboard.source_table, "v_capability_enablement_operational_dashboard");
assert.equal(dashboard.include_for_admin, true);
assert.equal(dashboard.include_for_tenant, true);
assert.equal(dashboard.result_columns.includes("safety_redaction_rows"), true);
assert.equal(dashboard.result_columns.includes("secret_rows"), false);
assert.equal(dashboard.result_columns.includes("classification_json"), false);

const attention = JSON.parse(attentionSurface);
assert.equal(attention.source_table, "v_capability_enablement_operational_attention");
assert.equal(attention.include_for_admin, true);
assert.equal(attention.include_for_tenant, true);
assert.equal(attention.result_columns.includes("reason_code"), true);
assert.equal(attention.result_columns.includes("reason_codes_json"), false);

assert.match(runbook, /Ready handoff contract/);
assert.match(runbook, /secrets_included = false/);

console.log(JSON.stringify({ ok: true, test: "capability_enablement_operationalization", secrets_included: false }));
