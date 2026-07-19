import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("./migrations/20260718_growth_intelligence_report_read_tool.sql", import.meta.url),
  "utf8"
);

assert.match(migration, /growth_intelligence_report_read/);
assert.match(migration, /'GET'/);
assert.match(migration, /\/growth-intelligence\/reports\/\{report_id\}/);
assert.match(migration, /JSON_ARRAY\('report_id'\)/);
assert.match(migration, /'tenant_id'/);
assert.match(migration, /'report_id'/);
assert.match(migration, /'additionalProperties', FALSE/);
assert.match(migration, /'read_only'/);
assert.match(migration, /'no_provider_write'/);
assert.match(migration, /'no_external_send'/);
assert.match(migration, /'no_execution'/);
assert.match(migration, /ON DUPLICATE KEY UPDATE/);
assert(!/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(migration));
assert(!/\bPOST\b|\bPATCH\b|\bPUT\b/i.test(migration));

const clientSource = fs.readFileSync(
  new URL("./scripts/dev-governed-migration-client.mjs", import.meta.url),
  "utf8"
);
assert.match(clientSource, /growth_intelligence_report_read/);
assert.match(clientSource, /validateGrowthIntelligenceReportReadArgs/);

console.log("growth intelligence report read tool tests passed");
