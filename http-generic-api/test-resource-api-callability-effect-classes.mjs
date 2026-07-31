import assert from "node:assert/strict";
import { validateDirectRouteCallabilityContracts } from "./scripts/resource-api-callability-contracts.mjs";

const sharedFiles = {
  "routes/example.js": "route marker requireUserJwt readback marker",
  "routes/index.js": "mount marker",
  "test-example.mjs": "test marker",
  "openapi-example.yaml": "/example:\noperationId: exampleOperation",
};

function contract(overrides = {}) {
  return {
    contract_key: "example_contract",
    tool_key: "example_tool",
    route_signature: "GET /example",
    migration_file: "migrations/example.sql",
    migration_markers: ["example_tool"],
    route_file: "routes/example.js",
    route_markers: ["route marker", "requireUserJwt", "readback marker"],
    mount_file: "routes/index.js",
    mount_markers: ["mount marker"],
    test_file: "test-example.mjs",
    test_markers: ["test marker"],
    openapi_file: "openapi-example.yaml",
    openapi_markers: ["/example:", "operationId: exampleOperation"],
    auth_model: "user_jwt",
    runtime_execution_allowed: true,
    secrets_included: false,
    read_only: true,
    provider_calls_allowed: false,
    external_writes_allowed: false,
    credential_payload_reads_allowed: false,
    ...overrides,
  };
}

function validate(exampleContract, extraFiles = {}) {
  return validateDirectRouteCallabilityContracts({
    root: process.cwd(),
    manifest: { callability_gate: { direct_route_contracts: [exampleContract] } },
    fileOverrides: {
      ...sharedFiles,
      "migrations/example.sql": "example_tool",
      ...extraFiles,
    },
  });
}

const legacyRead = validate(contract());
assert.equal(legacyRead.ok, true, JSON.stringify(legacyRead.findings));
assert.equal(legacyRead.covered_contracts[0].effect_class, "read_only");

const databaseMutation = validate(contract({
  effect_class: "database_mutation",
  route_signature: "POST /example",
  read_only: false,
  database_writes_allowed: true,
  transaction_required: true,
  same_cycle_readback_required: true,
}));
assert.equal(databaseMutation.ok, true, JSON.stringify(databaseMutation.findings));
assert.equal(databaseMutation.covered_contracts[0].effect_class, "database_mutation");

const providerRead = validate(contract({
  effect_class: "provider_read",
  route_signature: "POST /example",
  provider_calls_allowed: true,
  credential_payload_reads_allowed: true,
  database_writes_allowed: false,
  transaction_required: false,
  same_cycle_readback_required: true,
}));
assert.equal(providerRead.ok, true, JSON.stringify(providerRead.findings));
assert.equal(providerRead.covered_contracts[0].effect_class, "provider_read");

const externalExecute = validate(contract({
  effect_class: "external_execute",
  route_signature: "POST /example",
  read_only: false,
  provider_calls_allowed: true,
  external_writes_allowed: true,
  credential_payload_reads_allowed: true,
  database_writes_allowed: true,
  transaction_required: true,
  same_cycle_readback_required: true,
}));
assert.equal(externalExecute.ok, true, JSON.stringify(externalExecute.findings));
assert.equal(externalExecute.covered_contracts[0].effect_class, "external_execute");

const policyMismatch = validate(contract({
  effect_class: "provider_read",
  route_signature: "POST /example",
  provider_calls_allowed: false,
  credential_payload_reads_allowed: true,
  database_writes_allowed: false,
  transaction_required: false,
  same_cycle_readback_required: true,
}));
assert.equal(policyMismatch.ok, false);
assert(policyMismatch.findings.some((row) => row.type === "direct_route_contract_policy_mismatch" && row.field === "provider_calls_allowed"));

const crossMigration = validateDirectRouteCallabilityContracts({
  root: process.cwd(),
  manifest: {
    callability_gate: {
      direct_route_contracts: [contract({
        contract_key: "cross_migration_dispatch",
        tool_key: undefined,
        tool_bindings: [
          { tool_key: "tool_alpha", migration_file: "migrations/alpha.sql", migration_markers: ["tool_alpha"] },
          { tool_key: "tool_beta", migration_file: "migrations/beta.sql", migration_markers: ["tool_beta"] },
        ],
      })],
    },
  },
  fileOverrides: {
    ...sharedFiles,
    "migrations/alpha.sql": "tool_alpha",
    "migrations/beta.sql": "tool_beta",
  },
});
assert.equal(crossMigration.ok, true, JSON.stringify(crossMigration.findings));
assert(crossMigration.covered_contracts.some((row) => row.tool_key === "tool_alpha" && row.migration_file === "migrations/alpha.sql"));
assert(crossMigration.covered_contracts.some((row) => row.tool_key === "tool_beta" && row.migration_file === "migrations/beta.sql"));

const delegatedEvidence = validate(contract({
  evidence_files: [
    {
      role: "application_service",
      file: "services/example-service.js",
      markers: ["MUTATION_TRANSACTION: example_tool", "MUTATION_READBACK: example_tool"],
    },
  ],
}), {
  "services/example-service.js": "MUTATION_TRANSACTION: example_tool\nMUTATION_READBACK: example_tool",
});
assert.equal(delegatedEvidence.ok, true, JSON.stringify(delegatedEvidence.findings));

const tamperedDelegatedEvidence = validate(contract({
  evidence_files: [
    {
      role: "application_service",
      file: "services/example-service.js",
      markers: ["MUTATION_TRANSACTION: example_tool", "MUTATION_READBACK: example_tool"],
    },
  ],
}), {
  "services/example-service.js": "MUTATION_TRANSACTION: example_tool",
});
assert.equal(tamperedDelegatedEvidence.ok, false);
assert(tamperedDelegatedEvidence.findings.some((row) => row.type === "direct_route_contract_marker_missing" && row.role === "application_service" && row.marker === "MUTATION_READBACK: example_tool"));

console.log("resource API callability effect-class tests passed");
