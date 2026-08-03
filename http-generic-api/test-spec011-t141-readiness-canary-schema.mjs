import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaPath = new URL(
  "../specs/011-durable-governed-execution-and-agent-delegation/schemas/t141-readiness-canary-contract.schema.json",
  import.meta.url,
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(schema.oneOf.length, 3);
assert.equal(
  schema.$defs.version.const,
  "spec011-t141-readiness-canary-contract-v1",
);
assert.deepEqual(schema.$defs.environment.enum, ["staging", "production"]);
assert.match(schema.$defs.sha256.pattern, /64/);
assert.match(schema.$defs.commitSha.pattern, /40/);
assert.match(schema.$defs.uuid.pattern, /12/);

for (const mutation of [
  "primary_create",
  "primary_revoke",
  "expiry_create",
  "expiry_expire",
]) {
  assert(schema.$defs.contract.properties.plans.required.includes(mutation));
  assert(schema.$defs.contract.properties.authorization_bindings.required.includes(mutation));
}

assert.equal(schema.$defs.contract.properties.execution_performed.const, false);
assert.equal(schema.$defs.contract.properties.migration_applied_by_this_contract.const, false);
assert.equal(schema.$defs.contract.properties.delegation_mutated.const, false);
assert.equal(schema.$defs.contract.properties.runtime_authority_changed.const, false);
assert.equal(schema.$defs.contract.properties.public_route_added.const, false);
assert.equal(schema.$defs.contract.properties.secrets_included.const, false);
assert.equal(schema.$defs.contract.properties.steps.minItems, 10);
assert.equal(schema.$defs.contract.properties.steps.maxItems, 10);
assert.equal(
  schema.$defs.step.properties.retry_allowed_after_unknown_outcome.const,
  false,
);
assert.equal(schema.$defs.step.properties.same_cycle_readback_required.const, true);

for (const status of [
  "reconciliation_required",
  "failed_closed",
  "staging_canary_verified",
  "production_canary_verified",
]) {
  assert(schema.$defs.outcome.properties.status.enum.includes(status));
}
assert.equal(
  schema.$defs.outcome.properties.automatic_mutation_retry_allowed.const,
  false,
);
assert.equal(schema.$defs.outcome.properties.secrets_included.const, false);

const nonProductionConditional = schema.$defs.outcome.allOf[0];
assert(nonProductionConditional.if.properties.status.enum.includes("staging_canary_verified"));
assert.equal(
  nonProductionConditional.then.properties.t141_completion_eligible.const,
  false,
);
assert.equal(
  nonProductionConditional.then.properties.t261_completion_eligible.const,
  false,
);
assert.equal(
  nonProductionConditional.then.properties.t263_completion_eligible.const,
  false,
);

const reconciliationConditional = schema.$defs.outcome.allOf[1];
assert.equal(
  reconciliationConditional.if.properties.status.const,
  "reconciliation_required",
);
assert.equal(
  reconciliationConditional.then.properties.execution_verified.const,
  false,
);

console.log("Spec 011 T141 readiness canary schema tests passed");
