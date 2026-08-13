import assert from "node:assert/strict";
import {
  validateCanonicalIdentityPreflight,
  validateMigrationReadbackContract,
  validateProviderMutationGate,
  validateRuntimeGateBundle,
} from "./spec015RuntimeGateContracts.js";

const shaA = "a".repeat(64);
const shaB = "b".repeat(64);

const identityReady = validateCanonicalIdentityPreflight({
  candidates: [{ identity_key: "retail-commerce.catalog", manifest_hash: shaA }],
  selected_key: "retail-commerce.catalog",
});
assert.equal(identityReady.valid, true);
assert.equal(validateCanonicalIdentityPreflight({
  candidates: [
    { identity_key: "retail-commerce.catalog", manifest_hash: shaA },
    { identity_key: "retail-commerce.catalog", manifest_hash: shaB },
  ],
}).valid, false);
assert.equal(validateCanonicalIdentityPreflight({
  candidates: [
    { identity_key: "retail-commerce.catalog", manifest_hash: shaA },
    { identity_key: "retail-commerce.catalog.v2", manifest_hash: shaB },
  ],
  selected_key: "retail-commerce.catalog.v2",
}).valid, false);
assert.equal(validateCanonicalIdentityPreflight({
  candidates: [{ identity_key: "retail-commerce.catalog", manifest_hash: shaA }],
  selected_key: "unknown",
}).valid, false);

const migrationReady = validateMigrationReadbackContract({
  migration_id: "1051",
  trigger: "AUTHORIZE_GOVERNED_MIGRATION_1051",
  expected_schema_hash: shaA,
  observed_schema_hash: shaA,
  expected_revision: 4,
  observed_revision: 4,
  rollback_contract_key: "migration.1051.rollback.v1",
  readback_contract_key: "migration.1051.readback.v1",
});
assert.equal(migrationReady.valid, true);
assert.equal(migrationReady.apply_allowed, false);
assert.equal(validateMigrationReadbackContract({
  migration_id: "1051",
  trigger: "AUTHORIZE_GOVERNED_MIGRATION_1051",
  expected_schema_hash: shaA,
  observed_schema_hash: shaB,
  expected_revision: 4,
  observed_revision: 4,
  rollback_contract_key: "migration.1051.rollback.v1",
  readback_contract_key: "migration.1051.readback.v1",
}).valid, false);
assert.equal(validateMigrationReadbackContract({
  migration_id: "1051",
  trigger: "AUTHORIZE_GOVERNED_MIGRATION_1051",
  expected_schema_hash: shaA,
  observed_schema_hash: shaA,
  expected_revision: 4,
  observed_revision: 5,
  rollback_contract_key: "migration.1051.rollback.v1",
  readback_contract_key: "migration.1051.readback.v1",
}).valid, false);

assert.equal(validateProviderMutationGate({
  provider: "github",
  target: "repository/main",
  operation: "apply-ruleset",
  preflight: true,
  readback: true,
  rollback: true,
  typed_confirmation: true,
}).valid, true);
assert.equal(validateProviderMutationGate({ provider: "cloudflare", target: "tunnel", operation: "restart", preflight: true, readback: true, rollback: true }).valid, false);
assert.equal(validateProviderMutationGate({ provider: "production", target: "schema", operation: "migrate", preflight: true, readback: false, rollback: true, typed_confirmation: true }).valid, false);
assert.equal(validateProviderMutationGate({ provider: "github", target: "repository/main", operation: "apply", preflight: true, readback: true, rollback: true, credential_ref: "token" , typed_confirmation: true }).valid, false);

const bundle = validateRuntimeGateBundle({ identity: identityReady, migration: migrationReady, provider: validateProviderMutationGate({
  provider: "github", target: "repository/main", operation: "apply-ruleset", preflight: true, readback: true, rollback: true, typed_confirmation: true,
}) });
assert.equal(bundle.valid, true);
assert.equal(bundle.apply_allowed, true);
assert.equal(bundle.mutation_executed, false);
assert.equal(bundle.provider_call_executed, false);
assert.equal(bundle.database_mutation, false);
assert.equal(bundle.secrets_included, false);

console.log(JSON.stringify({
  ok: true,
  test: "spec015_runtime_gate_contracts",
  identity_ready: identityReady.valid,
  migration_readback_ready: migrationReady.valid,
  provider_gate_ready: bundle.provider_valid,
  apply_allowed: bundle.apply_allowed,
  mutation_executed: bundle.mutation_executed,
  provider_call_executed: bundle.provider_call_executed,
  database_mutation: bundle.database_mutation,
  secrets_included: bundle.secrets_included,
}));
