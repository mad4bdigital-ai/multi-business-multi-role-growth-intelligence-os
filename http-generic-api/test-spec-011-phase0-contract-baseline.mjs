import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const specRootUrl = new URL("../specs/011-durable-governed-execution-and-agent-delegation/", import.meta.url);
const specRoot = fileURLToPath(specRootUrl);
const read = (relativePath) => readFileSync(new URL(relativePath, specRootUrl), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath));

const manifest = readJson("manifest.json");
const completion = readJson("completion.json");
const tasks = read("tasks.md");
const inventory = read("phase0-inventory-and-reuse.md");
const adapters = read("compatibility-adapters.md");
const draftGovernance = read("openapi-draft-governance.md");
const errorCodes = read("contracts/error-codes.md");
const draftOpenApi = read("contracts/durable-governed-execution.openapi.yaml");
const canonicalOpenApi = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

assert.equal(manifest.database_migrations, false);
assert.equal(manifest.deployment, false);
assert.equal(manifest.merge, false);
assert.equal(completion.status, "in_progress");
assert.equal(completion.evidence.phase0.status, "complete_on_main");
assert.equal(completion.evidence.phase0.runtime_implementation, false);
assert.equal(completion.evidence.phase0.database_migration, false);
assert.equal(completion.evidence.phase0.provider_write, false);

for (const taskId of ["T010", "T011", "T012", "T013", "T014", "T015"]) {
  assert.match(tasks, new RegExp(`- \\[x\\] ${taskId}\\b`), `${taskId} must be complete`);
}

for (const tableName of ["execution_plans", "execution_plan_steps", "execution_plan_events", "approval_holds", "capability_resolution_envelope_ledger", "agent_delegations", "repository_automation_receipts", "release_operation_evidence", "platform_resource_operation_registry", "platform_capability_readback_contracts"]) {
  assert.match(inventory, new RegExp(`\\b${tableName}\\b`));
}

assert.match(inventory, /reuse-first/i);
assert.match(inventory, /Phase 0 introduces no SQL migration/);
assert.match(adapters, /execution_contract_projection_adapter/);
assert.match(adapters, /agent_delegation_grant_adapter/);
assert.match(adapters, /No-duplication gate/);
assert.match(draftGovernance, /design artifact/i);
assert.match(draftGovernance, /Route and handler|Route and handler\./i);

for (const code of ["EXECUTION_CONTRACT_AMBIGUOUS", "IDEMPOTENCY_SCOPE_CONFLICT", "UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED", "DELEGATION_SCOPE_DRIFT", "SELF_APPROVAL_FORBIDDEN", "ENGINE_VALIDATION_REQUIRED", "MERGE_FRESHNESS_CHANGED", "STRUCTURED_DIAGNOSIS_REQUIRED"]) {
  assert.match(errorCodes, new RegExp(`\\b${code}\\b`));
}

for (const schemaFile of ["schemas/durable-operation.schema.json", "schemas/execution-contract.schema.json", "schemas/delegation-grant.schema.json", "schemas/mutation-receipt.schema.json", "schemas/evidence-bundle.schema.json"]) {
  const schema = readJson(schemaFile);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes("secrets_included"));
  assert.equal(schema.properties.secrets_included.const, false);
}

assert.match(draftOpenApi, /^openapi: 3\.1\.0/m);
assert.match(draftOpenApi, /^x-runtime-authority: false$/m);
assert.match(draftOpenApi, /^x-contract-status: design_only$/m);
assert.match(draftOpenApi, /^x-promotion-gate: route_handler_registry_parity$/m);
assert.doesNotMatch(canonicalOpenApi, /\/admin\/platform-operations(?:\/|:)/);
assert.doesNotMatch(canonicalOpenApi, /\/admin\/delegation-grants(?:\/|:)/);

const specFiles = readdirSync(specRoot, { recursive: true }).map(String);
assert.equal(specFiles.some((file) => file.endsWith(".sql")), false);

console.log("Spec 011 Phase 0 contract baseline tests passed");
