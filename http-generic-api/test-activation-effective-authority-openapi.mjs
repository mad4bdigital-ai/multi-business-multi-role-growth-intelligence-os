import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const openapi = YAML.parse(readFileSync("openapi.yaml", "utf8"));
assert.equal(openapi.openapi, "3.1.0");

const schemas = openapi.components?.schemas || {};
const projection = schemas.ActivationEffectiveAuthorityProjection;
const authorizedAccess = schemas.ActivationAuthorizedAccess;
assert.ok(projection, "ActivationEffectiveAuthorityProjection schema is required");
assert.ok(authorizedAccess, "ActivationAuthorizedAccess schema is required");

assert.equal(projection.additionalProperties, false);
assert.deepEqual(projection.properties.authority_granted.enum, [false]);
assert.deepEqual(projection.properties.enforcement_mode.enum, ["shadow_only"]);
assert.deepEqual(projection.properties.legacy_runtime_authoritative.enum, [true]);
assert.deepEqual(projection.properties.execution_authority_changed.enum, [false]);
assert.deepEqual(
  projection.properties.projection_eligibility.properties.execution.enum,
  [false]
);
assert.deepEqual(projection.properties.provider_calls.enum, [false]);
assert.deepEqual(projection.properties.credential_payload_reads.enum, [false]);
assert.deepEqual(projection.properties.external_writes.enum, [false]);
assert.deepEqual(projection.properties.secrets_included.enum, [false]);
assert.ok(projection.required.includes("subject_scope"));
assert.ok(projection.required.includes("drift_issue_codes"));

assert.equal(authorizedAccess.additionalProperties, true);
assert.equal(
  authorizedAccess.properties.effective_authority.$ref,
  "#/components/schemas/ActivationEffectiveAuthorityProjection"
);
assert.equal(
  (authorizedAccess.required || []).includes("effective_authority"),
  false,
  "effective_authority must remain optional"
);
assert.deepEqual(authorizedAccess.properties.secrets_included.enum, [false]);

const sessionContextSchema =
  openapi.paths?.["/activation/session-context"]?.get?.responses?.["200"]?.content?.[
    "application/json"
  ]?.schema;
assert.ok(sessionContextSchema, "Session Context response schema is required");
assert.equal(
  sessionContextSchema.properties?.authorized_access?.$ref,
  "#/components/schemas/ActivationAuthorizedAccess"
);
assert.equal(
  (sessionContextSchema.required || []).includes("authorized_access"),
  false,
  "authorized_access must remain optional for backward compatibility"
);

console.log("Activation effective-authority OpenAPI tests passed");
