// frontend-surface-operation: POST /connect/bootstrap
import assert from "node:assert/strict";
import { executeTenantConnectBootstrapTransaction } from "./tenantConnectBootstrapTransaction.js";

function clone(value) {
  return structuredClone(value);
}

function createHarness({
  user = { user_id: "user-1", email: "owner@example.com", display_name: "Owner", status: "active" },
  tenants = [],
  memberships = [],
  connections = [],
  failPolicy = false,
  omitConnectionReadback = false,
  rollbackFails = false,
} = {}) {
  let persisted = clone({ user, tenants, memberships, connections });
  let staged = null;
  let connectionReads = 0;
  const calls = [];

  function membershipRows(params, exact) {
    const [userId, tenantId] = params;
    return staged.memberships
      .filter((membership) => membership.user_id === userId && (!exact || membership.tenant_id === tenantId))
      .map((membership) => {
        const tenant = staged.tenants.find((item) => item.tenant_id === membership.tenant_id) || {};
        return {
          tenant_id: membership.tenant_id,
          role: membership.role,
          membership_status: membership.status,
          tenant_status: tenant.status,
          tenant_display_name: tenant.display_name,
        };
      });
  }

  const connection = {
    async beginTransaction() {
      calls.push("begin");
      staged = clone(persisted);
    },
    async query(sql, params = []) {
      calls.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("FROM `users`")) {
        const active = staged.user?.user_id === params[0] && staged.user?.status === "active";
        return [active ? [{
          user_id: staged.user.user_id,
          email: staged.user.email,
          display_name: staged.user.display_name,
        }] : []];
      }
      if (sql.includes("FROM memberships m") && sql.includes("m.tenant_id = ?")) {
        return [membershipRows(params, true)];
      }
      if (sql.includes("FROM memberships m")) return [membershipRows(params, false)];
      if (sql.includes("INSERT INTO `tenants`")) {
        staged.tenants.push({ tenant_id: params[0], display_name: params[1], status: "active" });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO `memberships`")) {
        staged.memberships.push({ user_id: params[0], tenant_id: params[1], role: "owner", status: "active" });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("UPDATE `onboarding_escalations`")) return [{ affectedRows: 0 }];
      if (sql.includes("SELECT * FROM `tenant_backend_connections`")) {
        connectionReads += 1;
        if (omitConnectionReadback && connectionReads > 1) return [[]];
        return [[staged.connections.find((item) => item.tenant_id === params[0])].filter(Boolean)];
      }
      if (sql.includes("INSERT INTO `tenant_backend_connections`")) {
        const existing = staged.connections.find((item) => item.tenant_id === params[1]);
        const activated = {
          connection_id: existing?.connection_id || params[0],
          tenant_id: params[1],
          connection_mode: "managed",
          cloudflare_mode: "managed",
          google_auth_mode: "managed",
          n8n_activation_mode: "managed_main_server",
          status: "active",
        };
        if (existing) Object.assign(existing, activated);
        else staged.connections.push(activated);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in bootstrap transaction test: ${sql}`);
    },
    async commit() {
      calls.push("commit");
      persisted = clone(staged);
      staged = null;
    },
    async rollback() {
      calls.push("rollback");
      if (rollbackFails) throw Object.assign(new Error("rollback transport failed"), { code: "ROLLBACK_IO" });
      staged = null;
    },
    release() {
      calls.push("release");
    },
  };
  const pool = { async getConnection() { calls.push("getConnection"); return connection; } };
  const upsertIntegrationPolicies = async ({ db }) => {
    calls.push("integrationPolicies");
    assert.equal(db, connection, "integration policies must use the active bootstrap transaction");
    if (failPolicy) throw Object.assign(new Error("policy write failed"), { code: "POLICY_WRITE_FAILED" });
    return { updated: 0, skipped: true };
  };
  return {
    pool,
    upsertIntegrationPolicies,
    calls,
    persisted: () => clone(persisted),
  };
}

async function execute(harness, input = {}) {
  const ids = ["tenant-new", "connection-new"];
  return executeTenantConnectBootstrapTransaction({
    userId: "user-1",
    displayName: "New workspace",
    ...input,
  }, {
    pool: harness.pool,
    upsertIntegrationPolicies: harness.upsertIntegrationPolicies,
    idFactory: () => ids.shift(),
  });
}

{
  const harness = createHarness();
  const result = await execute(harness);
  assert.equal(result.tenant_id, "tenant-new");
  assert.equal(result.workspace_created, true);
  assert.equal(result.activated, true);
  assert.deepEqual(result.readback, { verified: true, before_commit: true });
  assert.equal(harness.persisted().tenants.length, 1);
  assert.equal(harness.persisted().memberships.length, 1);
  assert.equal(harness.persisted().connections.length, 1);
  assert(harness.calls.some((entry) => entry.includes("FROM `users`") && entry.includes("FOR UPDATE")), "the signed principal must be locked before tenantless creation");
  assert(harness.calls.indexOf("commit") > harness.calls.findIndex((entry) => entry.includes("SELECT * FROM `tenant_backend_connections`") && !entry.includes("FOR UPDATE")));
  assert.equal(harness.calls.at(-1), "release");
}

{
  const harness = createHarness({ failPolicy: true });
  await assert.rejects(() => execute(harness), (error) => error?.code === "POLICY_WRITE_FAILED");
  assert.equal(harness.calls.includes("rollback"), true);
  assert.deepEqual(harness.persisted().tenants, [], "workspace insert must not survive a later activation-policy failure");
  assert.deepEqual(harness.persisted().memberships, []);
  assert.deepEqual(harness.persisted().connections, []);
  assert.equal(harness.calls.at(-1), "release");
}

{
  const harness = createHarness({ omitConnectionReadback: true });
  await assert.rejects(
    () => execute(harness),
    (error) => error?.code === "activation_validation_failed" && error?.status === 503,
  );
  assert.equal(harness.calls.includes("rollback"), true);
  assert.deepEqual(harness.persisted().tenants, [], "failed transactional readback must roll every staged mutation back");
}

{
  const existingTenant = { tenant_id: "tenant-existing", display_name: "Existing", status: "active" };
  const harness = createHarness({
    tenants: [existingTenant],
    memberships: [{ user_id: "user-1", tenant_id: "tenant-existing", role: "member", status: "active" }],
    connections: [{
      connection_id: "connection-existing",
      tenant_id: "tenant-existing",
      connection_mode: "managed",
      status: "active",
    }],
  });
  const result = await execute(harness, { jwtTenantId: "tenant-existing" });
  assert.equal(result.workspace_created, false);
  assert.equal(result.activated, false);
  assert.equal(result.membership.role, "member");
  assert.equal(harness.persisted().tenants.length, 1);
  assert.equal(harness.persisted().connections.length, 1);
  assert.equal(harness.calls.some((entry) => entry.includes("INSERT INTO `tenants`")), false);
  assert.equal(harness.calls.some((entry) => entry.includes("INSERT INTO `tenant_backend_connections`")), false);
  assert.equal(harness.calls.includes("commit"), true);
}

{
  const harness = createHarness({
    tenants: [
      { tenant_id: "tenant-a", display_name: "A", status: "active" },
      { tenant_id: "tenant-b", display_name: "B", status: "active" },
    ],
    memberships: [
      { user_id: "user-1", tenant_id: "tenant-a", role: "owner", status: "active" },
      { user_id: "user-1", tenant_id: "tenant-b", role: "member", status: "active" },
    ],
  });
  await assert.rejects(
    () => execute(harness),
    (error) => error?.code === "tenant_selection_required"
      && error?.status === 409
      && error?.details?.workspaces?.length === 2,
  );
  assert.equal(harness.calls.includes("rollback"), true);
  assert.equal(harness.calls.some((entry) => entry.includes("INSERT INTO")), false);
}

{
  const harness = createHarness({
    tenants: [{ tenant_id: "tenant-suspended", display_name: "Suspended", status: "suspended" }],
    memberships: [{ user_id: "user-1", tenant_id: "tenant-suspended", role: "owner", status: "active" }],
  });
  await assert.rejects(
    () => execute(harness, { jwtTenantId: "tenant-suspended" }),
    (error) => error?.code === "tenant_suspended" && error?.status === 403,
  );
  assert.equal(harness.calls.includes("rollback"), true);
  assert.equal(harness.calls.some((entry) => entry.includes("INSERT INTO")), false);
}

{
  const harness = createHarness({
    tenants: [{ tenant_id: "tenant-other", display_name: "Other", status: "active" }],
    memberships: [{ user_id: "user-1", tenant_id: "tenant-other", role: "member", status: "active" }],
  });
  await assert.rejects(
    () => execute(harness, { jwtTenantId: "tenant-forbidden" }),
    (error) => error?.code === "tenant_membership_required" && error?.status === 403,
  );
  assert.equal(harness.calls.includes("rollback"), true);
  assert.equal(harness.calls.some((entry) => entry.includes("INSERT INTO")), false);
}

{
  const harness = createHarness({ failPolicy: true, rollbackFails: true });
  await assert.rejects(
    () => execute(harness),
    (error) => error?.code === "connect_bootstrap_transaction_rollback_failed"
      && error?.status === 500
      && error?.details?.state === "indeterminate"
      && error?.details?.original_code === "POLICY_WRITE_FAILED"
      && error?.details?.rollback_code === "ROLLBACK_IO",
  );
  assert.equal(harness.calls.at(-1), "release");
}

{
  await assert.rejects(
    () => executeTenantConnectBootstrapTransaction({ userId: "user-1" }, { pool: {} }),
    (error) => error?.code === "connect_bootstrap_transaction_unavailable" && error?.status === 503,
  );
}

console.log("PASS tenant-connect-bootstrap-transaction");
