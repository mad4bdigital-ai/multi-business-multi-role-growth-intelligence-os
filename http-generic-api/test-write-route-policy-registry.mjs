import assert from "node:assert/strict";
import { listWriteRoutePolicies, normalizeWriteRoutePolicy, resolveWriteRoutePolicy } from "./writeRoutePolicyRegistry.js";

const baseRow = {
  policy_id: 7,
  route_id: "tenant.example.write",
  bundle: "Admin/Tenant",
  risk_class: "high",
  environment: "staging",
  mode: "shadow",
  status: "active",
  enabled: 1,
  allowlisted: 1,
  approval_required: 1,
  ttl_seconds: 300,
  quota_limit: 1,
  lease_seconds: 60,
  rollback_policy_json: JSON.stringify({ required: true }),
  readback_policy_json: JSON.stringify({ required: true }),
  kill_switch_key: "kill:tenant.example.write",
  policy_version: 3,
  policy_hash: "a".repeat(64),
};

const pool = {
  async query(sql, params) {
    assert.match(sql, /write_route_policy_registry/);
    if (sql.includes("LIMIT 1")) {
      return [[params?.[1] === "production" ? { ...baseRow, environment: "production", mode: "production-live" } : baseRow]];
    }
    return [[baseRow]];
  },
};

const normalized = normalizeWriteRoutePolicy(baseRow);
assert.equal(normalized.enabled, true);
assert.equal(normalized.secrets_included, false);
assert.deepEqual(normalized.rollback_policy, { required: true });

const resolved = await resolveWriteRoutePolicy({ routeId: baseRow.route_id, environment: "staging", mode: "shadow" }, { pool });
assert.equal(resolved.ok, true);
assert.equal(resolved.policy.route_id, baseRow.route_id);

const mismatched = await resolveWriteRoutePolicy({ routeId: baseRow.route_id, environment: "staging", mode: "staging" }, { pool });
assert.equal(mismatched.ok, false);
assert.equal(mismatched.reason_code, "write_route_policy_mode_mismatch");

const production = await resolveWriteRoutePolicy({ routeId: baseRow.route_id, environment: "production", mode: "production-live" }, { pool });
assert.equal(production.ok, false);
assert.equal(production.reason_code, "production_write_route_activation_requires_separate_promotion");

const list = await listWriteRoutePolicies({ environment: "staging", mode: "shadow" }, { pool });
assert.equal(list.ok, true);
assert.equal(list.policy_count, 1);
assert.equal(list.policies[0].enabled, true);

const missingTable = { query: async () => { throw new Error("ER_NO_SUCH_TABLE: write_route_policy_registry"); } };
const blocked = await resolveWriteRoutePolicy({ routeId: baseRow.route_id }, { pool: missingTable });
assert.equal(blocked.ok, false);
assert.equal(blocked.reason_code, "write_route_policy_registry_not_migrated");

console.log(JSON.stringify({ ok: true, contract: "mad4b.write-route-policy-registry.v1", production_live_default: false, secrets_included: false }, null, 2));
