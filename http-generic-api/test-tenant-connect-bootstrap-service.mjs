import assert from "node:assert/strict";
import { orchestrateTenantConnectBootstrap } from "./tenantConnectBootstrapService.js";

const fixedNow = () => new Date("2026-07-18T00:00:00.000Z");

function verifiedBootstrap(overrides = {}) {
  return {
    tenant_id: "tenant-1",
    membership: { tenant_id: "tenant-1", role: "owner" },
    connection: { tenant_id: "tenant-1", connection_mode: "managed", status: "active" },
    workspace_created: true,
    activated: true,
    readback: { verified: true, before_commit: true },
    ...overrides,
  };
}

{
  let appliedInput = null;
  const result = await orchestrateTenantConnectBootstrap({
    user_id: "user-1",
    workspace_name: "Growth workspace",
  }, {
    applyManagedBootstrap: async (input) => {
      appliedInput = input;
      return verifiedBootstrap();
    },
    resolveState: async () => ({
      onboarding: { state: "activated_no_device", allowed_actions: ["install_device"] },
    }),
    now: fixedNow,
  });
  assert.deepEqual(appliedInput, {
    userId: "user-1",
    jwtTenantId: null,
    displayName: "Growth workspace",
    source: "connect_bootstrap",
  });
  assert.equal(result.bootstrap.workspace, "created");
  assert.equal(result.bootstrap.connection, "activated");
  assert.equal(result.activation.validation_status, "verified");
  assert.equal(result.principal.workspace_key, "tenant-1");
  assert.deepEqual(result.next_actions, ["install_device"]);
  assert.equal(result.readback.checked_at, "2026-07-18T00:00:00.000Z");
  assert.equal(result.secrets_included, false);
}

{
  const result = await orchestrateTenantConnectBootstrap({ user_id: "user-1" }, {
    applyManagedBootstrap: async () => verifiedBootstrap({
      workspace_created: false,
      activated: false,
    }),
    resolveState: async () => {
      throw Object.assign(new Error("optional readiness unavailable"), { code: "READINESS_DOWN" });
    },
    now: fixedNow,
  });
  assert.equal(result.ok, true, "post-commit enrichment must not turn a verified mutation into a failed response");
  assert.equal(result.bootstrap.workspace, "existing");
  assert.equal(result.bootstrap.connection, "existing");
  assert.equal(result.onboarding, null);
  assert.deepEqual(result.next_actions, []);
}

{
  await assert.rejects(
    () => orchestrateTenantConnectBootstrap({ user_id: "user-1" }, {
      applyManagedBootstrap: async () => verifiedBootstrap({ readback: { verified: false } }),
    }),
    (error) => error?.code === "activation_validation_failed" && error?.status === 503,
  );
}

{
  let applied = false;
  await assert.rejects(
    () => orchestrateTenantConnectBootstrap({ user_id: "user-1", mode: "dedicated" }, {
      applyManagedBootstrap: async () => { applied = true; },
    }),
    (error) => error?.code === "bootstrap_managed_only" && error?.status === 400,
  );
  assert.equal(applied, false);
}

console.log("PASS tenant-connect-bootstrap-service");
