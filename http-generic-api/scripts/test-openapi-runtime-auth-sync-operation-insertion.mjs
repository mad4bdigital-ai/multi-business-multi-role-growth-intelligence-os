#!/usr/bin/env node
import assert from "node:assert/strict";
import YAML from "yaml";
import { patchSecurity } from "./openapi-runtime-auth-sync.mjs";

const source = `openapi: 3.1.0
security: []
components:
  securitySchemes:
    userJwtAuth:
      type: http
      scheme: bearer
    adminBearerAuth:
      type: http
      scheme: bearer
    backendApiKeyAuth:
      type: apiKey
      in: header
      name: x-api-key
paths:
  /public/status:
    get:
      responses: {}
  /me/support/tickets:
    post:
      responses: {}
  /admin/support/tickets:
    get:
      security: []
      responses: {}
`;

const primarySchemes = YAML.parse(source).components.securitySchemes;
const output = patchSecurity(source, [
  {
    signature: "POST /me/support/tickets",
    expected: [["userJwtAuth"]],
    openapi_auth: {
      security_declared: false,
      security_path: ["paths", "/me/support/tickets", "post", "security"],
    },
  },
  {
    signature: "GET /admin/support/tickets",
    expected: [["adminBearerAuth"], ["backendApiKeyAuth"]],
    openapi_auth: {
      security_declared: true,
      security_path: ["paths", "/admin/support/tickets", "get", "security"],
    },
  },
], { primarySchemes });

const document = YAML.parse(output);
assert.deepEqual(document.security, [], "document-level public default must remain unchanged");
assert.equal(document.paths["/public/status"].get.security, undefined, "unrelated inherited public operation must remain untouched");
assert.deepEqual(
  document.paths["/me/support/tickets"].post.security,
  [{ userJwtAuth: [] }],
  "inherited mixed-profile drift must receive exact operation-level user security",
);
assert.deepEqual(
  document.paths["/admin/support/tickets"].get.security,
  [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }],
  "explicit public security must be replaced with exact admin alternatives",
);
assert.equal((output.match(/\/me\/support\/tickets:/gu) || []).length, 1, "auth insertion must not duplicate the operation path");

const missingSchemeSource = `openapi: 3.1.0
security: []
components:
  securitySchemes:
    userJwtAuth:
      type: http
      scheme: bearer
paths:
  /admin/runtime:
    post:
      responses: {}
`;
const missingSchemePrimary = {
  ...YAML.parse(missingSchemeSource).components.securitySchemes,
  backendApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
};
const withInsertedScheme = patchSecurity(missingSchemeSource, [
  {
    signature: "POST /admin/runtime",
    expected: [["backendApiKeyAuth"]],
    openapi_auth: {
      security_declared: false,
      security_path: ["paths", "/admin/runtime", "post", "security"],
    },
  },
], { primarySchemes: missingSchemePrimary });
const insertedDocument = YAML.parse(withInsertedScheme);
assert.deepEqual(insertedDocument.paths["/admin/runtime"].post.security, [{ backendApiKeyAuth: [] }]);
assert.deepEqual(insertedDocument.components.securitySchemes.backendApiKeyAuth, missingSchemePrimary.backendApiKeyAuth);

console.log(JSON.stringify({
  ok: true,
  tests: 2,
  gate: "openapi_runtime_auth_exact_operation_insertion",
  document_default_preserved: true,
  secrets_included: false,
}));
