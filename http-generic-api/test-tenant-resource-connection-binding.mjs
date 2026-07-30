import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveExactResourceConnection } from "./tenantResourceConnectionResolver.js";

function poolFixture({ linked = [], credentials = [], cms = [] } = {}) {
  return {
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, " ");
      if (compact.includes("FROM workspace_app_links")) return [linked];
      if (compact.includes("FROM credential_bindings")) return [credentials];
      if (compact.includes("FROM cms_site_access_grants")) return [cms];
      throw new Error(`unexpected query: ${compact}`);
    },
  };
}

const arbitraryScope = {
  tenantId: "tenant-fixture-001",
  userId: "user-fixture-001",
  workspaceId: "workspace-fixture-001",
  appKey: "cms_fixture",
  resourceRef: "brand-fixture.example",
};

const exact = await resolveExactResourceConnection(arbitraryScope, {
  pool: poolFixture({
    linked: [{ connection_id: "connection-a", validation_status: "validated", status: "active" }],
    credentials: [{ connection_id: "connection-a", target_key: "brand-fixture.example" }],
  }),
});
assert.equal(exact.ok, true);
assert.equal(exact.selected_connection_id, "connection-a");

const mismatch = await resolveExactResourceConnection({ ...arbitraryScope, requestedConnectionId: "connection-b" }, {
  pool: poolFixture({
    linked: [{ connection_id: "connection-a" }, { connection_id: "connection-b" }],
    credentials: [{ connection_id: "connection-a", target_key: "brand-fixture.example" }],
  }),
});
assert.equal(mismatch.status, "connection_resource_mismatch");

const ambiguous = await resolveExactResourceConnection(arbitraryScope, {
  pool: poolFixture({
    linked: [{ connection_id: "connection-a" }, { connection_id: "connection-b" }],
    credentials: [
      { connection_id: "connection-a", target_key: "brand-fixture.example" },
      { connection_id: "connection-b", target_key: "brand-fixture.example" },
    ],
  }),
});
assert.equal(ambiguous.status, "ambiguous_resource_connection");

const source = fs.readFileSync(new URL("./tenantResourceConnectionResolver.js", import.meta.url), "utf8").toLowerCase();
assert.equal(source.includes("allroyalegypt"), false, "implementation must not hard-code a Tenant or Brand");
assert.match(source, /credential_bindings/);
assert.match(source, /cms_site_access_grants/);
assert.match(source, /brand_site_bindings/);
assert.match(source, /resource_ref_required/);
assert.match(source, /connection_resource_mismatch/);
console.log("tenant resource connection binding tests passed");
