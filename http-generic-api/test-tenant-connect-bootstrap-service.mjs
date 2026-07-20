import assert from "node:assert/strict";
import { orchestrateTenantConnectBootstrap } from "./tenantConnectBootstrapService.js";

const fixedNow = () => new Date("2026-07-18T00:00:00.000Z");

{
  let created = 0;
  let activated = 0;
  const states = [
    { user: { user_id: "user-1" }, memberships: [], resolvedTenantId: null },
    {
      user: { user_id: "user-1" },
      memberships: [{ tenant_id: "tenant-1", role: "owner", tenant_status: "active" }],
      resolvedTenantId: "tenant-1",
      membership: { tenant_id: "tenant-1", role: "owner" },
      connection: { connection_mode: "managed", status: "active" },
      onboarding: { state: "activated_no_device", allowed_actions: ["install_device"] },
    },
  ];
  const result = await orchestrateTenantConnectBootstrap({ user_id: "user-1" }, {
    resolveState: async () => states.shift(),
    createWorkspace: async () => { created += 1; return { created: true, tenant_id: "tenant-1" }; },
    activateManaged: async () => { activated += 1; return { activated: true, connection: { connection_mode: "managed", status: "active" } }; },
    now: fixedNow,
  });
  assert.equal(created, 1);
  assert.equal(activated, 1);
  assert.equal(result.bootstrap.workspace, "created");
  assert.equal(result.activation.validation_status, "verified");
  assert.equal(result.principal.workspace_key, "tenant-1");
  assert.equal(result.secrets_included, false);
}

{
  await assert.rejects(
    () => orchestrateTenantConnectBootstrap({ user_id: "user-1" }, {
      resolveState: async () => ({
        user: { user_id: "user-1" },
        memberships: [
          { tenant_id: "tenant-a", role: "owner", tenant_status: "active", tenant_display_name: "A" },
          { tenant_id: "tenant-b", role: "member", tenant_status: "active", tenant_display_name: "B" },
        ],
      }),
      createWorkspace: async () => { throw new Error("must not create"); },
      activateManaged: async () => { throw new Error("must not activate"); },
    }),
    (error) => error?.code === "tenant_selection_required" && error?.status === 409 && error?.details?.workspaces?.length === 2,
  );
}

{
  await assert.rejects(
    () => orchestrateTenantConnectBootstrap({ user_id: "user-1", jwt_tenant_id: "tenant-suspended" }, {
      resolveState: async () => ({
        user: { user_id: "user-1" },
        memberships: [{ tenant_id: "tenant-suspended", role: "owner", tenant_status: "suspended" }],
      }),
      createWorkspace: async () => { throw new Error("must not create"); },
      activateManaged: async () => { throw new Error("must not activate"); },
    }),
    (error) => error?.code === "tenant_suspended" && error?.status === 403,
  );
}

{
  await assert.rejects(
    () => orchestrateTenantConnectBootstrap({ user_id: "user-1", mode: "dedicated" }, {
      resolveState: async () => ({}),
      createWorkspace: async () => ({}),
      activateManaged: async () => ({}),
    }),
    (error) => error?.code === "bootstrap_managed_only" && error?.status === 400,
  );
}

console.log("PASS tenant-connect-bootstrap-service");
