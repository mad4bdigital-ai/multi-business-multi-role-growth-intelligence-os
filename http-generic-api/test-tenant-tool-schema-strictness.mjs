import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertTenantToolSchemaAllows,
  buildTenantToolSchemaBlocks,
  filterTenantToolsByStrictSchema,
  inspectTenantToolInputSchema,
  loadTenantToolSchemaBlocks,
} from "./tenantToolSchemaGuard.js";

assert.deepEqual(inspectTenantToolInputSchema(null), {
  strict: false,
  reason: "missing_input_schema",
});
assert.deepEqual(inspectTenantToolInputSchema("not-json"), {
  strict: false,
  reason: "invalid_json_schema",
});
assert.deepEqual(inspectTenantToolInputSchema([]), {
  strict: false,
  reason: "schema_must_be_object",
});
assert.deepEqual(inspectTenantToolInputSchema({ type: "string", additionalProperties: false }), {
  strict: false,
  reason: "schema_type_must_be_object",
});
assert.deepEqual(inspectTenantToolInputSchema({ type: "object" }), {
  strict: false,
  reason: "additional_properties_must_be_false",
});
assert.deepEqual(inspectTenantToolInputSchema({ type: "object", additionalProperties: true }), {
  strict: false,
  reason: "additional_properties_must_be_false",
});
assert.deepEqual(
  inspectTenantToolInputSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      payload: {
        type: "object",
        additionalProperties: true,
      },
    },
  }),
  { strict: true, reason: null }
);

const blocked = buildTenantToolSchemaBlocks([
  { tool_key: "missing_tool", input_schema: null },
  { tool_key: "open_tool", input_schema: JSON.stringify({ type: "object" }) },
  { tool_key: "strict_tool", input_schema: JSON.stringify({ type: "object", additionalProperties: false }) },
]);
assert.deepEqual([...blocked.entries()], [
  ["missing_tool", "missing_input_schema"],
  ["open_tool", "additional_properties_must_be_false"],
]);

assert.deepEqual(
  filterTenantToolsByStrictSchema(
    [{ tool_key: "missing_tool" }, { tool_key: "strict_tool" }, { tool_key: "unlisted_tool" }],
    blocked
  ).map((row) => row.tool_key),
  ["strict_tool", "unlisted_tool"]
);

assert.doesNotThrow(() => assertTenantToolSchemaAllows("admin", "missing_tool", blocked));
assert.doesNotThrow(() => assertTenantToolSchemaAllows("tenant", "strict_tool", blocked));
assert.throws(
  () => assertTenantToolSchemaAllows("tenant", "missing_tool", blocked),
  (error) => {
    assert.equal(error.status, 403);
    assert.equal(error.code, "tenant_tool_input_schema_not_strict");
    assert.deepEqual(error.details, {
      tool_key: "missing_tool",
      reason: "missing_input_schema",
      required_contract: {
        type: "object",
        additionalProperties: false,
      },
    });
    return true;
  }
);

let observedSql = "";
const loaded = await loadTenantToolSchemaBlocks({
  async query(sql) {
    observedSql = sql;
    return [[
      { tool_key: "open_tool", input_schema: JSON.stringify({ type: "object" }) },
      { tool_key: "strict_tool", input_schema: JSON.stringify({ type: "object", additionalProperties: false }) },
    ]];
  },
});
assert.equal(loaded.get("open_tool"), "additional_properties_must_be_false");
assert.equal(loaded.has("strict_tool"), false);
assert.match(observedSql, /tenant_platform_endpoint_tools/);
assert.match(observedSql, /WHERE is_enabled = 1/);

const routeSource = fs.readFileSync("./routes/gptToolsRoutes.js", "utf8");
assert.match(routeSource, /sqlCacheKey\("tools", callerType, "list", "v3"\)/);
assert.doesNotMatch(routeSource, /sqlCacheKey\("tools", callerType, "list", "v2"\)/);
assert.match(routeSource, /filterTenantToolsByStrictSchema\(/);
assert.match(routeSource, /assertTenantToolSchemaAllows\(callerType, toolKey, blockedTenantSchemas\)/);
const dispatchSource = routeSource.slice(routeSource.indexOf("async function dispatchTool(callerType, toolKey, args, req)"));
const schemaGuardIndex = dispatchSource.indexOf("assertTenantToolSchemaAllows(callerType, toolKey, blockedTenantSchemas)");
const preflightIndex = dispatchSource.indexOf("resolveToolPreflightDescriptor(callerType, toolKey)");
assert.ok(schemaGuardIndex >= 0 && schemaGuardIndex < preflightIndex, "schema guard must run before dispatch preflight");

const migration = fs.readFileSync("./migrations/20260720_tenant_tool_input_schema_strictness.sql", "utf8");
assert.match(migration, /UPDATE tenant_platform_endpoint_tools/);
assert.match(migration, /input_schema = JSON_OBJECT\(/);
assert.match(migration, /JSON_SET\(input_schema, '\$\.additionalProperties', FALSE\)/);
assert.match(migration, /chk_tenant_platform_enabled_input_schema_strict/);
assert.match(migration, /CHECK \(is_enabled = 0 OR/);
assert.match(migration, /JSON_VALID\(input_schema\) = 1/);
assert.match(migration, /JSON_EXTRACT\(input_schema, ''\$\.type''\)/);
assert.match(migration, /JSON_EXTRACT\(input_schema, ''\$\.additionalProperties''\)/);
for (const forbidden of [/\bDROP\b/i, /\bTRUNCATE\b/i, /\bDELETE\b/i, /provider_call/i, /credential_payload/i, /raw_secret/i]) {
  assert.equal(forbidden.test(migration.replace(/^\s*--.*$/gm, "")), false, `migration must not match ${forbidden}`);
}

const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));
assert.match(packageJson.scripts["schemas:guard"], /test-tenant-tool-schema-strictness\.mjs/);
const manifestSource = fs.readFileSync("./scripts/test-manifest.mjs", "utf8");
assert.match(manifestSource, /node test-tenant-tool-schema-strictness\.mjs/);

console.log("Tenant tool schema strictness tests passed.");
