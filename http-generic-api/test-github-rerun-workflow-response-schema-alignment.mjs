import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL(
    "./migrations/20260712_github_rerun_workflow_response_schema_alignment.sql",
    import.meta.url,
  ),
  "utf8",
);
const source = fs.readFileSync(
  new URL("./migrations/1038_sprint69_github_actions_workflow_control_dispatch.sql", import.meta.url),
  "utf8",
);

assert(source.includes("'ACT-GH-REST-044'"));
assert(source.includes("'github_rerun_workflow_run'"));
assert(source.includes("'201'"));

assert(migration.includes("$.responses.201.content"));
assert(migration.includes("'application/json'"));
assert(migration.includes("'type', 'object'"));
assert(migration.includes("'additionalProperties', TRUE"));
assert(migration.includes("platform_endpoint_tool_exports"));
assert(migration.includes("export_row.input_schema_json = endpoint_row.schema_json"));
assert(migration.includes("endpoint_row.endpoint_id = 'ACT-GH-REST-044'"));
assert(migration.includes("endpoint_row.endpoint_key = 'github_rerun_workflow_run'"));

const executableSql = migration.replace(/^\s*--.*$/gm, "");
for (const forbidden of [/\bDROP\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bCALL\b/i]) {
  assert.equal(forbidden.test(executableSql), false);
}
assert(migration.includes("no_provider_call=true"));
assert(migration.includes("no_external_write=true"));
assert(migration.includes("secrets_included=false"));

console.log("github rerun workflow response schema alignment tests passed");
