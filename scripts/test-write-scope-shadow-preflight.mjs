import assert from "node:assert/strict";
import {
  CONTRACT,
  buildShadowEvidence,
  readJson,
} from "./write-scope-shadow-preflight.mjs";

const inventory = readJson(new URL("../http-generic-api/remote-mcp-write-scope-inventory.generated.json", import.meta.url).pathname);
const catalog = readJson(new URL("../http-generic-api/remote-mcp-scope-catalog.generated.json", import.meta.url).pathname);
const evidence = buildShadowEvidence({ inventory, catalog });

assert.equal(evidence.contract, CONTRACT);
assert.equal(evidence.environment, "staging");
assert.equal(evidence.mode, "shadow");
assert.equal(evidence.summary.scope_count, inventory.write_scope_count);
assert.equal(evidence.summary.all_preflight_decisions_denied, true);
assert.equal(evidence.summary.all_execution_attempts_false, true);
assert.equal(evidence.summary.all_rollback_plans_validated, true);
assert.equal(evidence.safety.production_allowed, false);
assert.equal(evidence.safety.write_activation_allowed, false);
assert.equal(evidence.safety.provider_mutation_allowed, false);
assert.equal(evidence.safety.migration_apply_allowed, false);
assert.equal(evidence.safety.mutation_execution, false);
assert.equal(evidence.safety.provider_calls, false);
assert.equal(evidence.safety.database_writes, false);
assert.equal(evidence.safety.external_send, false);
assert.equal(evidence.safety.credential_payload_reads, false);
assert.equal(evidence.safety.secrets_included, false);

for (const scope of evidence.scopes) {
  assert.equal(scope.status, "shadow");
  assert.equal(scope.default_request, false);
  assert.equal(scope.tool_bound, false);
  assert.equal(scope.preflight.decision, "deny_shadow_execution");
  assert.equal(scope.execution.attempted, false);
  assert.equal(scope.execution.mutation_execution, false);
  assert.equal(scope.execution.provider_calls, false);
  assert.equal(scope.execution.database_writes, false);
  assert.equal(scope.execution.migration_apply, false);
  assert.equal(scope.rollback.required, true);
  assert.equal(scope.rollback.plan_validated, true);
  assert.equal(scope.rollback.compensation_executed, false);
  assert.equal(scope.audit_receipt.secrets_included, false);
}

assert.throws(
  () => buildShadowEvidence({ inventory, catalog, selectedScopeKeys: ["unknown.write"] }),
  /Unknown write scopes: unknown\.write/,
);

console.log(`write-scope shadow preflight self-test passed: ${evidence.summary.scope_count} scopes, ${evidence.summary.route_count} route references, execution=false`);
