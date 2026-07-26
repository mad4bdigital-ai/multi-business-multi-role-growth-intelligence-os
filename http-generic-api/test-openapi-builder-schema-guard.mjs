import assert from "node:assert/strict";
import { validateOpenApiDocument } from "./scripts/openapi-builder-schema-guard.mjs";

function baseDoc(schema) {
  return {
    openapi: "3.1.0",
    info: { title: "guard fixture", version: "1.0.0" },
    paths: {
      "/fixture": {
        post: {
          operationId: "fixture",
          requestBody: {
            content: {
              "application/json": { schema },
            },
          },
          responses: {
            200: {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

{
  const issues = validateOpenApiDocument(baseDoc({
    type: "object",
    additionalProperties: true,
    properties: {},
  }));
  assert.equal(issues.length, 0, "explicit polymorphic properties must pass");
}

{
  const issues = validateOpenApiDocument(baseDoc({
    type: "object",
    additionalProperties: true,
  }));
  assert.ok(issues.some((issue) => issue.code === "top_level_object_properties_required"));
}

{
  const doc = baseDoc({
    type: "object",
    properties: { execution_guardrail: null },
  });
  const issues = validateOpenApiDocument(doc);
  assert.ok(issues.some((issue) => issue.code === "property_schema_null"));
}

{
  const doc = baseDoc({
    type: "array",
  });
  const issues = validateOpenApiDocument(doc);
  assert.ok(issues.some((issue) => issue.code === "array_items_required"));
}

{
  const doc = baseDoc({ $ref: "#/components/schemas/Missing" });
  const issues = validateOpenApiDocument(doc);
  assert.ok(issues.some((issue) => issue.code === "unresolved_local_ref"));
}

console.log("OpenAPI Builder schema guard regression tests passed.");
