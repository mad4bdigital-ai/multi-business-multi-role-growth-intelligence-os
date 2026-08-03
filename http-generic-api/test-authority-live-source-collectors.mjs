import assert from "node:assert/strict";

import {
  AUTHORITY_EVIDENCE_SOURCE_FAMILIES,
  buildAuthorityEvidenceSourceBundle,
} from "./authorityEvidenceSourceAdapters.js";
import {
  AUTHORITY_LIVE_SOURCE_ROW_LIMIT,
  AuthorityLiveSourceCollectorError,
  createAuthorityLiveSourceCollectors,
} from "./authorityLiveSourceCollectors.js";

const rowsByQuery = {
  system_tool_registry: [
    { scope_kind: "admin", tool_key: "admin_system_tools_list", http_method: "GET", http_path: "/admin/system/tools", tags: "system", is_enabled: 1 },
    { scope_kind: "tenant", tool_key: "connect_status", http_method: "GET", http_path: "/connect/status", tags: "connect", is_enabled: 1 },
  ],
  admin_endpoint_catalog: [
    {
      endpoint_id: "endpoint-1",
      endpoint_key: "connector.inventory.read",
      parent_action_key: "connector.inventory",
      method: "GET",
      endpoint_path_or_function: "/authority/connectors",
      route_target: "getConnectorInventory",
      openai_action_name: "connector_inventory_read",
      module_binding: "authority_routes",
      status: "active",
      execution_mode: "read_only",
    },
  ],
  direct_http_routes: [
    {
      endpoint_id: "endpoint-1",
      endpoint_key: "connector.inventory.read",
      parent_action_key: "connector.inventory",
      method: "GET",
      endpoint_path_or_function: "/authority/connectors",
      route_target: "getConnectorInventory",
      openai_action_name: "connector_inventory_read",
      module_binding: "authority_routes",
      status: "active",
      execution_mode: "read_only",
    },
  ],
  runtime_action_registry: [
    {
      action_key: "connector.inventory",
      status: "active",
      module_binding: "authority_actions",
      connector_family: "internal",
      runtime_callable: "TRUE",
      primary_executor: "authorityResolver",
    },
  ],
  descriptor_catalog: [
    {
      export_key: "connector_inventory_export",
      parent_action_key: "connector.inventory",
      endpoint_key: "connector.inventory.read",
      tool_name: "connector_inventory_read",
      status: "active",
    },
  ],
  provider_binding_catalog: [
    {
      binding_kind: "action",
      binding_table: "app_integration_action_bindings",
      binding_id: "binding-1",
      app_key: "github",
      action_key: "connector.inventory",
      tool_key: null,
      tool_surface: null,
      status: "active",
    },
  ],
  local_device_catalog: [
    { scope_kind: "admin", tool_key: "connector_health", http_method: "GET", http_path: "/connector/{device_id}/health", tags: "device", is_enabled: 1 },
  ],
  compatibility_alias_registry: [
    {
      endpoint_key: "connector.inventory.read",
      method: "GET",
      endpoint_path_or_function: "/authority/connectors",
      route_target: "getConnectorInventory",
      alias_key: "connector_inventory_read",
      openai_action_name: "connector_inventory_read",
      tool_name: null,
      status: "active",
    },
  ],
};

const observedAt = new Date("2030-01-01T00:00:00.000Z");
const collectors = createAuthorityLiveSourceCollectors({
  clock: () => observedAt,
  queryRows: async ({ queryKey, sql, params }) => {
    assert.match(sql, /^SELECT\b/i);
    assert.deepEqual(params, []);
    return structuredClone(rowsByQuery[queryKey] || []);
  },
});

const sourceContext = (family) => Object.freeze({
  contract: "mad4b.ueacp.authority-live-evidence-collector-context.v1",
  operation_ref: "ueacp.live-evidence.test-20300101",
  environment: "production_runtime",
  target_schema: "platform",
  authorization_issued_at: "2029-12-31T23:55:00.000Z",
  authorization_expires_at: "2030-01-01T00:55:00.000Z",
  source_family: family,
  read_only: true,
  applies_sql: false,
  provider_calls: false,
  credential_payload_read: false,
  external_writes: false,
  secrets_included: false,
});

assert.deepEqual(Object.keys(collectors).sort(), [...AUTHORITY_EVIDENCE_SOURCE_FAMILIES].sort());
const sources = [];
for (const family of AUTHORITY_EVIDENCE_SOURCE_FAMILIES) {
  const source = await collectors[family](sourceContext(family));
  assert.equal(source.source_family, family);
  assert.equal(source.observed_at, observedAt.toISOString());
  assert.equal(source.pagination.complete, true);
  assert.equal(source.pagination.next_cursor, null);
  assert.equal(source.safety.read_only, true);
  assert.equal(source.safety.provider_calls, false);
  assert.equal(source.safety.credential_payload_read, false);
  assert.equal(source.safety.external_writes, false);
  assert.equal(source.safety.secrets_included, false);
  sources.push(source);
}

const bundle = buildAuthorityEvidenceSourceBundle({ sources });
assert.equal(bundle.status, "ready_for_ownership_review");
assert.equal(bundle.blocking_gap_count, 0);
assert.equal(bundle.source_family_count, 8);
assert.equal(bundle.inventory.status, "ready_for_human_closure_review");
assert.equal(bundle.inventory.summary.canonical_path_count, 8);
const endpoint = bundle.inventory.paths.find((item) => item.path_key === "endpoint.connector.inventory.read");
assert.ok(endpoint);
assert.deepEqual(endpoint.source_registries, ["admin_endpoint_catalog", "direct_http_routes"]);
assert.equal(endpoint.route, "/authority/connectors");
assert.equal(endpoint.method, "GET");
assert.equal(endpoint.operation_mode, "read_only");
assert.equal(endpoint.requirements.readback, false);
assert.equal(endpoint.secrets_included, false);

const secretCollectors = createAuthorityLiveSourceCollectors({
  queryRows: async ({ queryKey }) => queryKey === "runtime_action_registry"
    ? [{ action_key: "unsafe", status: "active", access_token: "forbidden" }]
    : structuredClone(rowsByQuery[queryKey] || []),
});
await assert.rejects(
  () => secretCollectors.runtime_action_registry(sourceContext("runtime_action_registry")),
  (error) => error instanceof AuthorityLiveSourceCollectorError
    && error.code === "authority_live_source_sensitive_value_forbidden",
);

const oversizedCollectors = createAuthorityLiveSourceCollectors({
  queryRows: async ({ queryKey }) => queryKey === "runtime_action_registry"
    ? Array.from({ length: AUTHORITY_LIVE_SOURCE_ROW_LIMIT + 1 }, (_, index) => ({ action_key: `action.${index}`, status: "active" }))
    : [],
});
await assert.rejects(
  () => oversizedCollectors.runtime_action_registry(sourceContext("runtime_action_registry")),
  (error) => error instanceof AuthorityLiveSourceCollectorError
    && error.code === "authority_live_source_row_limit_exceeded",
);

await assert.rejects(
  () => collectors.system_tool_registry({ ...sourceContext("system_tool_registry"), read_only: false }),
  (error) => error instanceof AuthorityLiveSourceCollectorError
    && error.code === "authority_live_source_unsafe_context",
);

assert.throws(
  () => createAuthorityLiveSourceCollectors(),
  (error) => error instanceof AuthorityLiveSourceCollectorError
    && error.code === "authority_live_source_query_reader_required",
);

console.log("authority live source collector tests passed");
