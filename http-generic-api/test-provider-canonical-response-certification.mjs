import assert from "node:assert/strict";
import { assessProviderCanonicalResponseSchemaParity } from "./providerCanonicalResponseCertification.js";

const canonical = {
  openapi: "3.0.3",
  paths: {
    "/repos/{owner}/{repo}/issues/{issue_number}/comments": {
      post: {
        responses: {
          "201": {
            description: "Created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Comment" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Comment: {
        type: "object",
        required: ["id", "body"],
        properties: { id: { type: "integer" }, body: { type: "string" } },
        additionalProperties: true,
      },
    },
  },
};
const exactRuntime = {
  responses: {
    "201": {
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["id", "body"],
            properties: { id: { type: "integer" }, body: { type: "string" } },
            additionalProperties: true,
          },
        },
      },
    },
  },
};
const genericRuntime = {
  responses: {
    "201": { content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
  },
};

const exact = assessProviderCanonicalResponseSchemaParity({
  canonicalOpenApi: canonical,
  path: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
  method: "POST",
  status: 201,
  runtimeSchema: exactRuntime,
});
assert.equal(exact.status, "pass");
assert.equal(exact.parity, true);

const drift = assessProviderCanonicalResponseSchemaParity({
  canonicalOpenApi: canonical,
  path: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
  method: "POST",
  status: 201,
  runtimeSchema: genericRuntime,
});
assert.equal(drift.status, "block");
assert.equal(drift.reason_code, "provider_canonical_response_schema_drift");

const wrongStatus = assessProviderCanonicalResponseSchemaParity({
  canonicalOpenApi: canonical,
  path: "/repos/{owner}/{repo}/issues/{issue_number}/comments",
  method: "POST",
  status: 200,
  runtimeSchema: genericRuntime,
});
assert.equal(wrongStatus.status, "block");
assert.equal(wrongStatus.reason_code, "provider_canonical_response_schema_missing");

console.log("provider canonical response certification tests passed");
