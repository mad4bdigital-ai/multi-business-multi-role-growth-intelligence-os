import assert from "node:assert/strict";
import { createTenantResolutionCase, _testingTenantResolutionCaseService } from "./tenantResolutionCaseService.js";

const { normalizeCaseInput, activeCaseKeyFor, sanitizeValue } = _testingTenantResolutionCaseService;

const subject = { tenant_id: "tenant_1", user_id: "user_1" };
const input = {
  problem_key: "problem.abc",
  root_family: "wordpress_site_health",
  recommended_playbook_key: "wordpress_site_doctor_v1",
  workspace_id: "workspace_1",
  severity: "critical",
  impact_summary: "WordPress publishing is blocked.",
  source_alert_keys: ["alert.wpml", "alert.wpml"],
  source_refs: ["execution-log://1"],
};
const normalized = normalizeCaseInput(input, subject);
assert.equal(normalized.rootFamily, "wordpress_site_health");
assert.equal(normalized.playbookKey, "wordpress_site_doctor_v1");
assert.equal(normalized.severity, "critical");
assert.equal(normalized.sourceAlertKeys.length, 1);
assert.match(activeCaseKeyFor(subject, normalized), /^case\.[a-f0-9]{64}$/);
assert.deepEqual(sanitizeValue({ token: "hide", safe: "show", nested: { api_key: "hide", reason: "ok" } }), { safe: "show", nested: { reason: "ok" } });

class FakeConnection {
  constructor(existing = null) {
    this.existing = existing;
    this.insertedCase = null;
    this.insertedEvent = null;
    this.transactions = [];
  }
  async beginTransaction() { this.transactions.push("begin"); }
  async commit() { this.transactions.push("commit"); }
  async rollback() { this.transactions.push("rollback"); }
  release() { this.transactions.push("release"); }
  async query(sql, params = []) {
    if (sql.includes("FROM tenant_resolution_playbooks")) {
      return [[{ playbook_key: "wordpress_site_doctor_v1", root_family: "wordpress_site_health", risk_level: "high", approval_required: 0, readback_required: 1, status: "active", tenant_visible: 1 }]];
    }
    if (sql.includes("FROM tenant_resolution_cases") && sql.includes("active_case_key")) {
      return [[this.existing].filter(Boolean)];
    }
    if (sql.includes("INSERT INTO tenant_resolution_cases")) {
      this.insertedCase = {
        case_id: params[0], tenant_id: params[1], workspace_id: params[2], resource_ref: params[3], root_family: params[4], playbook_key: params[5],
        status: "detected", severity: params[6], root_fingerprint_sha256: params[7], active_case_key: params[8], source_alert_keys_json: params[9],
        source_refs_json: params[10], impact_summary: params[11], current_step_key: params[12], owner_user_id: params[13], readback_status: "not_run",
        created_at: "2026-07-10T00:00:00.000Z", updated_at: "2026-07-10T00:00:00.000Z", closed_at: null,
      };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO tenant_resolution_case_events")) {
      this.insertedEvent = { event_id: params[0], case_id: params[1], actor_id: params[2], evidence_ref: params[3], event_json: params[4] };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM tenant_resolution_cases") && sql.includes("case_id")) {
      return [[this.insertedCase]];
    }
    throw new Error(`unexpected query: ${sql}`);
  }
}

class FakePool {
  constructor(conn) { this.conn = conn; }
  async getConnection() { return this.conn; }
}

const createdConn = new FakeConnection();
const created = await createTenantResolutionCase({
  explicitSubject: subject,
  input,
  pool: new FakePool(createdConn),
  uuid: (() => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    return () => ids.shift();
  })(),
});
assert.equal(created.ok, true);
assert.equal(created.created, true);
assert.equal(created.case.case_id, "11111111-1111-4111-8111-111111111111");
assert.equal(created.case.playbook_key, "wordpress_site_doctor_v1");
assert.equal(created.case.provider_call_allowed, undefined);
assert.equal(created.policy.provider_call_allowed, false);
assert.equal(created.policy.external_write_allowed, false);
assert.equal(created.policy.repair_apply_allowed, false);
assert.equal(created.secrets_included, false);
assert.deepEqual(createdConn.transactions, ["begin", "commit", "release"]);
assert.equal(JSON.parse(createdConn.insertedEvent.event_json).provider_call_allowed, false);

const existingConn = new FakeConnection(createdConn.insertedCase);
const existing = await createTenantResolutionCase({ explicitSubject: subject, input, pool: new FakePool(existingConn) });
assert.equal(existing.ok, true);
assert.equal(existing.created, false);
assert.equal(existing.idempotency.existing_case_returned, true);
assert.equal(existing.case.case_id, created.case.case_id);
assert.deepEqual(existingConn.transactions, ["begin", "commit", "release"]);

await assert.rejects(
  () => createTenantResolutionCase({ explicitSubject: {}, input, pool: new FakePool(new FakeConnection()) }),
  /Tenant scope is required/
);
await assert.rejects(
  () => createTenantResolutionCase({ explicitSubject: subject, input: { root_family: "unknown" }, pool: new FakePool(new FakeConnection()) }),
  /root_family is required/
);

console.log("tenant resolution case create tests passed");
