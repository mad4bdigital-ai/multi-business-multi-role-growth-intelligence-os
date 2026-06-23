import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateByJsonSchema } from "./schemaValidation.js";

const migration = readFileSync(
  new URL(
    "./migrations/1025_sprint69_github_add_labels_200_contract_reconciliation.sql",
    import.meta.url
  ),
  "utf8"
);

for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `missing migration safety marker ${marker}`);
}

for (const expected of [
  "UPDATE endpoints",
  "'$.responses.200'",
  "'description', 'Labels added'",
  "'type', 'array'",
  "'required', JSON_ARRAY('id', 'node_id', 'url', 'name', 'color', 'default')",
  "WHERE endpoint_id = 'ACT-GH-REST-039'",
  "parent_action_key = 'github_api_mcp'",
  "endpoint_key = 'github_add_issue_labels'",
]) {
  assert.ok(migration.includes(expected), `missing response-contract token: ${expected}`);
}

assert.equal((migration.match(/\bUPDATE endpoints\b/g) || []).length, 1);
assert.doesNotMatch(migration, /\bINSERT\s+INTO\b/i);
assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
assert.doesNotMatch(migration, /\bDROP\b/i);
assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
assert.doesNotMatch(migration, /\bALTER\b/i);
assert.doesNotMatch(migration, /admin_platform_endpoint_tools/);
assert.doesNotMatch(migration, /platform_endpoint_tool_exports/);
assert.doesNotMatch(migration, /platform_tool_dispatch_bindings/);
assert.doesNotMatch(migration, /fetch\s*\(/);
assert.doesNotMatch(migration, /axios\s*\(/);

const labelResponseSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: true,
    required: ["id", "node_id", "url", "name", "color", "default"],
    properties: {
      id: { type: "integer" },
      node_id: { type: "string" },
      url: { type: "string" },
      name: { type: "string" },
      color: { type: "string" },
      default: { type: "boolean" },
      description: { type: ["string", "null"] },
    },
  },
};

const githubResponse = [
  {
    id: 11232662210,
    node_id: "LA_kwDOSFDYfs8AAAACnYTSwg",
    url: "https://api.github.com/repos/example/example/labels/superseded",
    name: "superseded",
    color: "ededed",
    default: false,
    description: null,
  },
];

assert.deepEqual(validateByJsonSchema(labelResponseSchema, githubResponse, "response"), []);
assert.ok(
  validateByJsonSchema(labelResponseSchema, [{ ...githubResponse[0], default: "false" }], "response")
    .some((error) => error.includes("expected boolean got string")),
  "wrong label field types must remain rejected"
);
assert.ok(
  validateByJsonSchema(labelResponseSchema, [{ ...githubResponse[0], name: undefined }], "response")
    .some((error) => error.includes("expected string got undefined")),
  "present-but-invalid required label fields must remain rejected"
);
const { name: _name, ...missingName } = githubResponse[0];
assert.ok(
  validateByJsonSchema(labelResponseSchema, [missingName], "response")
    .some((error) => error.includes("missing required property")),
  "missing required label fields must remain rejected"
);

console.log("GitHub add-labels 200 contract reconciliation tests passed");
