import assert from "node:assert/strict";
import {
  buildActivationAuthorizedAccess,
  resolveSessionContextSubject,
} from "./routes/activationRoutes.js";

const placeholderTenant = "00000000-0000-0000-0000-000000000000";
const subject = resolveSessionContextSubject({
  auth: { mode: "backend_api_key", is_admin: true, tenant_id: placeholderTenant },
  query: {},
});

assert.equal(subject.tenant_id, null);
assert.equal(subject.scope_mode, "platform_global");
assert.equal(subject.context_source, "admin_platform_global_context");

const connectedSystemQueries = [];
const query = async (sql, params = []) => {
  if (sql.includes("FROM `connected_systems`")) {
    connectedSystemQueries.push({ sql, params });
    return {
      ok: true,
      rows: [
        { system_id: "system-a", tenant_id: "tenant-a", system_key: "a", display_name: "A", provider_family: "provider-a", connector_family: "connector-a", status: "active" },
        { system_id: "system-b", tenant_id: "tenant-b", system_key: "b", display_name: "B", provider_family: "provider-b", connector_family: "connector-b", status: "pending" },
      ],
    };
  }
  if (sql.includes("FROM `installations`")) return { ok: true, rows: [] };
  if (sql.includes("FROM `actions`")) return { ok: true, rows: [] };
  if (sql.includes("FROM `admin_platform_endpoint_tools`")) return { ok: true, rows: [] };
  if (sql.includes("FROM `activation_authorized_surface_registry`")) return { ok: true, rows: [] };
  if (sql.includes("FROM `tenant_gpt_activation_contexts`")) return { ok: true, rows: [] };
  return { ok: true, rows: [] };
};

const access = await buildActivationAuthorizedAccess(
  { auth: { mode: "backend_api_key", is_admin: true, tenant_id: placeholderTenant }, query: {} },
  subject,
  { query },
);

assert.equal(access.counts.connected_systems, 2);
assert.equal(access.auth_gaps.includes("no_visible_connected_systems"), false);
assert.equal(connectedSystemQueries.length, 1);
assert.deepEqual(connectedSystemQueries[0].params, [null, null]);
assert.equal(JSON.stringify(access).includes("credential_ref"), false);
assert.equal(access.secrets_included, false);

console.log("UEACP activation scope regression tests passed");
