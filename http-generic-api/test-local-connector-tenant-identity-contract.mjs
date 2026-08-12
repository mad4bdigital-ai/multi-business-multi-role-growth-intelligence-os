import assert from "node:assert/strict";
import { _testingLocalConnectorRoutes } from "./routes/localConnectorRoutes.js";

const { resolveLocalConnectorIdentity } = _testingLocalConnectorRoutes;

{
  const resolved = resolveLocalConnectorIdentity({
    auth: { mode: "user_jwt", user_id: "user-a", tenant_id: "tenant-a" },
    body: { device_id: "device-a", alias: "health" },
    query: {},
  });
  assert.deepEqual(resolved, {
    user_id: "user-a",
    tenant_id: "tenant-a",
    auth_derived: true,
    identity_conflict: false,
  });
}

{
  const resolved = resolveLocalConnectorIdentity({
    auth: { mode: "api_credential", user_id: "user-b", tenant_id: "tenant-b" },
    body: { user_id: "user-other", tenant_id: "tenant-b" },
    query: {},
  });
  assert.equal(resolved.auth_derived, true);
  assert.equal(resolved.user_id, "user-b");
  assert.equal(resolved.tenant_id, "tenant-b");
  assert.equal(resolved.identity_conflict, true);
}

{
  const resolved = resolveLocalConnectorIdentity({
    auth: { mode: "backend_api_key", is_admin: true },
    body: { user_id: "user-admin-target", tenant_id: "tenant-admin-target" },
    query: {},
  });
  assert.deepEqual(resolved, {
    user_id: "user-admin-target",
    tenant_id: "tenant-admin-target",
    auth_derived: false,
    identity_conflict: false,
  });
}

console.log("local connector tenant identity contract tests passed");
