import assert from "node:assert/strict";
import { _testingTenantActivationSnapshot } from "./tenantActivationSnapshot.js";

const { METRICS, countMetric } = _testingTenantActivationSnapshot;
const columns = ["tenant_id", "user_id", "owner_scope", "activation_visibility", "status", "blocker_level"];

function poolForCount(count = 4) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params: [...params] });
      if (String(sql).includes("information_schema.columns")) {
        return [columns.map((column_name) => ({ column_name }))];
      }
      return [[{ count }]];
    },
  };
}

const openDefinition = METRICS.find((metric) => metric.key === "pending_tasks_open");
const blockedDefinition = METRICS.find((metric) => metric.key === "pending_tasks_blocked");
assert(openDefinition && blockedDefinition);

{
  const pool = poolForCount(4);
  const metric = await countMetric(pool, openDefinition, {
    profile: "tenant",
    tenantId: "tenant-a",
    userId: "owner-a",
    role: "owner",
  });
  assert.equal(metric.value, 4);
  assert.equal(metric.scope, "tenant_owner_visible");
  const query = pool.queries.at(-1);
  assert.match(query.sql, /tenant_id = \?/);
  assert.match(query.sql, /activation_visibility = 1/);
  assert.match(query.sql, /owner_scope.*IN \('tenant','user'\)/);
  assert.match(query.sql, /status.*IN \(\?,\?,\?\)/);
  assert.deepEqual(query.params, ["tenant-a", "pending", "in_progress", "blocked"]);
}

{
  const pool = poolForCount(2);
  const metric = await countMetric(pool, openDefinition, {
    profile: "tenant",
    tenantId: "tenant-a",
    userId: "member-a",
    role: "member",
  });
  assert.equal(metric.value, 2);
  assert.equal(metric.scope, "tenant_user_visible");
  const query = pool.queries.at(-1);
  assert.match(query.sql, /owner_scope.*= 'tenant'/);
  assert.match(query.sql, /owner_scope.*= 'user'.*user_id = \?/);
  assert.deepEqual(query.params, ["tenant-a", "member-a", "pending", "in_progress", "blocked"]);
}

{
  const pool = poolForCount(1);
  const metric = await countMetric(pool, blockedDefinition, {
    profile: "tenant",
    tenantId: "tenant-a",
    userId: "member-a",
    role: "member",
  });
  assert.equal(metric.value, 1);
  const query = pool.queries.at(-1);
  assert.deepEqual(query.params, ["tenant-a", "member-a", "blocked"]);
}

console.log("tenant activation pending-task summary tests passed");
