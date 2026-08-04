import assert from "node:assert/strict";
import { extractRegistryToolKeys, extractRegistryToolRegistrations } from "./scripts/surface-contract-sql-registry-extractor.mjs";

const reorderedColumns = `
INSERT INTO tenant_platform_endpoint_tools (display_name, http_path, tool_key, input_schema, http_method) VALUES
('One', '/one/{id}', 'tool_one', JSON_OBJECT('sample', 'fake_request'), 'get'),
('Two', '/two', 'tool_two', JSON_OBJECT('sample', 'fake_create'), 'POST');
`;
assert.deepEqual(extractRegistryToolKeys(reorderedColumns), ['tool_one', 'tool_two']);
assert.deepEqual(extractRegistryToolRegistrations(reorderedColumns), [
  { registry_table: 'tenant_platform_endpoint_tools', tool_key: 'tool_one', http_method: 'GET', http_path: '/one/{id}' },
  { registry_table: 'tenant_platform_endpoint_tools', tool_key: 'tool_two', http_method: 'POST', http_path: '/two' },
]);

assert.deepEqual(extractRegistryToolRegistrations(`
INSERT INTO admin_platform_endpoint_tools (tool_key, display_name, http_method, http_path) VALUES
('admin_preview', 'Admin Preview', 'GET', '/admin/preview');
`), [
  { registry_table: 'admin_platform_endpoint_tools', tool_key: 'admin_preview', http_method: 'GET', http_path: '/admin/preview' },
]);

assert.deepEqual(extractRegistryToolKeys(`
CREATE INDEX idx_request_created ON demo(created_at);
SELECT 'invitation_accept', 'preview_created';
`), []);
assert.deepEqual(extractRegistryToolKeys(`
INSERT INTO unrelated_registry (tool_key, description) VALUES ('quoted''tool', 'ignored invalid identifier');
`), []);
assert.deepEqual(extractRegistryToolRegistrations(`
INSERT INTO tenant_platform_endpoint_tools (tool_key, http_method, http_path) VALUES
('invalid_method', 'TRACE', '/trace'),
('invalid_path', 'GET', 'relative/path');
`), [
  { registry_table: 'tenant_platform_endpoint_tools', tool_key: 'invalid_method', http_method: null, http_path: '/trace' },
  { registry_table: 'tenant_platform_endpoint_tools', tool_key: 'invalid_path', http_method: 'GET', http_path: null },
]);

console.log('surface contract SQL registry extractor tests passed');
