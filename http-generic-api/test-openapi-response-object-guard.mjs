import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  collectOpenApiResponseObjectIssues,
  validateOpenApiResponseFiles,
} from "./scripts/openapi-response-object-guard.mjs";

function collect(yaml, source) {
  return collectOpenApiResponseObjectIssues(YAML.parse(yaml), { source });
}

function unexpectedMessages(issues) {
  return issues
    .filter((entry) => entry.code === "unexpected_response_property")
    .map((entry) => entry.message)
    .sort();
}

const malformedDescription = collect(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /cases/{caseId}:
    post:
      operationId: updateCase
      responses:
        "409": { description: Incompatible case, binding mismatch, or concurrent update., content: { application/json: { schema: { type: object } } } }
`, "malformed-description.yaml");
assert.deepEqual(unexpectedMessages(malformedDescription), [
  'Response Object property "binding mismatch" is not allowed by OpenAPI 3.1',
  'Response Object property "or concurrent update." is not allowed by OpenAPI 3.1',
]);

const malformedComponentDescription = collect(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths: {}
components:
  responses:
    NotFound: { description: Agent, skill, or request not found, content: { application/json: { schema: { type: object } } } }
`, "malformed-component-description.yaml");
assert.deepEqual(unexpectedMessages(malformedComponentDescription), [
  'Response Object property "or request not found" is not allowed by OpenAPI 3.1',
  'Response Object property "skill" is not allowed by OpenAPI 3.1',
]);

const quotedComponentDescription = collect(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths: {}
components:
  responses:
    NotFound:
      description: "Agent, skill, or request not found"
      content:
        application/json:
          schema: { type: object }
    Conflict:
      description: "Approval lifecycle, scope, idempotency, or readback conflict"
      content:
        application/json:
          schema: { type: object }
`, "quoted-component-description.yaml");
assert.deepEqual(quotedComponentDescription, []);

const malformedHeadersAndLinks = collect(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /cases:
    post:
      operationId: createCase
      responses:
        "201": { description: Created resource, follow link, links: { GetCase: { operationId: getCase } } }
        "429": { description: Rate limited, retry later, headers: { Retry-After: { schema: { type: integer } } } }
`, "malformed-headers-links.yaml");
assert.deepEqual(unexpectedMessages(malformedHeadersAndLinks), [
  'Response Object property "follow link" is not allowed by OpenAPI 3.1',
  'Response Object property "retry later" is not allowed by OpenAPI 3.1',
]);

const validHeadersLinksAndExtensions = collect(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /cases:
    post:
      operationId: createCase
      responses:
        "201":
          description: "Created resource, follow the documented link."
          headers:
            X-RateLimit-Remaining:
              description: Remaining requests
              schema: { type: integer }
          links:
            GetCase:
              operationId: getCase
              parameters:
                caseId: '$response.body#/id'
          x-alert-context:
            owner: platform
          x-null-extension: null
components:
  responses:
    SharedCaseResponse:
      $ref: "#/components/responses/CreatedCaseResponse"
      summary: Shared case response
      description: Reference metadata is allowed in OpenAPI 3.1.
      x-trace-enabled: true
    CreatedCaseResponse:
      description: Created case
      headers: {}
      links: {}
`, "valid-headers-links-extensions.yaml");
assert.deepEqual(validHeadersLinksAndExtensions, []);

const invalidReferenceSibling = collect(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths: {}
components:
  responses:
    InvalidReference:
      $ref: "#/components/responses/CreatedCaseResponse"
      content: {}
    CreatedCaseResponse:
      description: Created case
`, "invalid-reference-sibling.yaml");
assert.deepEqual(unexpectedMessages(invalidReferenceSibling), [
  'Response Object property "content" is not allowed by OpenAPI 3.1',
]);

const invalidExtensionCase = collect(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /cases:
    get:
      operationId: listCases
      responses:
        "200":
          description: Cases
          X-internal-note: true
`, "invalid-extension-case.yaml");
assert.deepEqual(unexpectedMessages(invalidExtensionCase), [
  'Response Object property "X-internal-note" is not allowed by OpenAPI 3.1',
]);

const missingDescription = collect(`
openapi: 3.1.0
info: { title: Test, version: 1.0.0 }
paths:
  /cases:
    get:
      operationId: listCases
      responses:
        "200":
          headers: {}
          links: {}
          x-internal: true
`, "missing-description.yaml");
assert.deepEqual(
  missingDescription.map((entry) => entry.code),
  ["missing_response_description"],
);

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
