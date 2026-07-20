import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  collectOpenApiResponseObjectIssues,
  validateOpenApiResponseFiles,
} from "./scripts/openapi-response-object-guard.mjs";

const malformed = YAML.parse(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /cases/{caseId}:
    post:
      operationId: updateCase
      responses:
        "409": { description: Incompatible case, binding mismatch, or concurrent update., content: { application/json: { schema: { type: object } } } }
`);

const malformedIssues = collectOpenApiResponseObjectIssues(malformed, { source: "malformed-inline.yaml" });
assert.deepEqual(
  malformedIssues
    .filter((entry) => entry.code === "unexpected_response_property")
    .map((entry) => entry.message)
    .sort(),
  [
    'Response Object property "binding mismatch" is not allowed by OpenAPI 3.1',
    'Response Object property "or concurrent update." is not allowed by OpenAPI 3.1',
  ],
);

const valid = YAML.parse(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /cases/{caseId}:
    post:
      operationId: updateCase
      responses:
        "409":
          description: "Incompatible case, binding mismatch, or concurrent update."
          content:
            application/json:
              schema:
                type: object
`);
assert.deepEqual(collectOpenApiResponseObjectIssues(valid, { source: "valid.yaml" }), []);

const generatedDir = path.resolve("openapi");
const actualFiles = [
  path.resolve("openapi.yaml"),
  ...fs.readdirSync(generatedDir)
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => path.join(generatedDir, name)),
];
assert.deepEqual(
  validateOpenApiResponseFiles(actualFiles),
  [],
  "canonical and generated OpenAPI files must contain only valid Response Object properties",
);

console.log("OpenAPI Response Object guard regression tests passed.");
