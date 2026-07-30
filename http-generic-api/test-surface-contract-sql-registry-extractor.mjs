import assert from "node:assert/strict";
import { extractRegistryToolKeys } from "./scripts/surface-contract-sql-registry-extractor.mjs";

assert.deepEqual(extractRegistryToolKeys(`
INSERT INTO tenant_platform_endpoint_tools (display_name, tool_key, input_schema) VALUES
('One', 'tool_one', JSON_OBJECT('sample', 'fake_request')),
('Two', 'tool_two', JSON_OBJECT('sample', 'fake_create'));
`), ['tool_one', 'tool_two']);
assert.deepEqual(extractRegistryToolKeys(`
CREATE INDEX idx_request_created ON demo(created_at);
SELECT 'invitation_accept', 'preview_created';
`), []);
assert.deepEqual(extractRegistryToolKeys(`
INSERT INTO unrelated_registry (tool_key, description) VALUES ('quoted''tool', 'ignored invalid identifier');
`), []);
console.log('surface contract SQL registry extractor tests passed');
