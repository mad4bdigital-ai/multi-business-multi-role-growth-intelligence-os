import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANONICAL_IDENTIFIER_CONTRACTS,
  assessLiveIdentifierComparisonContracts,
  extractCanonicalIdentifierComparisons,
  requiresDedicatedIdentifierRepairRunner,
} from "./canonicalIdentifierContract.js";
import {
  assessReadinessRepairState,
  assertEnvelopeFresh,
  detectConnectedSystemIdCollision,
} from "./scripts/repository-authority-capability-readiness-repair-runner.mjs";

const unsafeSql = `
UPDATE repository_authority_bindings authority
JOIN connected_systems system ON authority.tenant_id = system.tenant_id
SET authority.system_id = system.system_id
WHERE authority.system_id <> system.system_id;
`;
const protectedSql = unsafeSql
  .replace(
    "authority.tenant_id = system.tenant_id",
    "BINARY authority.tenant_id = BINARY system.tenant_id",
  )
  .replace(
    "authority.system_id <> system.system_id",
    "BINARY authority.system_id <> BINARY system.system_id",
  );

const comparisons = extractCanonicalIdentifierComparisons(unsafeSql);
assert.equal(comparisons.length, 2);
assert(comparisons.some((item) => item.identifier_name === "tenant_id"));
assert(comparisons.some((item) => item.identifier_name === "system_id"));
assert(!comparisons.some((item) => item.operator === "=" && item.left.column_name === "system_id"));

const schemaRows = [
  { table_name: "repository_authority_bindings", column_name: "tenant_id", column_type: "varchar(36)", data_type: "varchar", character_set_name: "utf8mb4", collation_name: "utf8mb4_unicode_ci" },
  { table_name: "connected_systems", column_name: "tenant_id", column_type: "varchar(36)", data_type: "varchar", character_set_name: "utf8mb4", collation_name: "utf8mb4_uca1400_ai_ci" },
  { table_name: "repository_authority_bindings", column_name: "system_id", column_type: "varchar(36)", data_type: "varchar", character_set_name: "utf8mb4", collation_name: "utf8mb4_unicode_ci" },
  { table_name: "connected_systems", column_name: "system_id", column_type: "varchar(36)", data_type: "varchar", character_set_name: "utf8mb4", collation_name: "utf8mb4_uca1400_ai_ci" },
];
const query = async () => [schemaRows];

const unsafeResult = await assessLiveIdentifierComparisonContracts(unsafeSql, { query });
assert.equal(unsafeResult.status, "block");
assert.equal(unsafeResult.issue_count, 2);
assert.equal(unsafeResult.protected_mismatch_count, 0);

const protectedResult = await assessLiveIdentifierComparisonContracts(protectedSql, { query });
assert.equal(protectedResult.status, "pass");
assert.equal(protectedResult.issue_count, 0);
assert.equal(protectedResult.protected_mismatch_count, 2);

assert.equal(CANONICAL_IDENTIFIER_CONTRACTS.system_id.target_sql_type, "binary(16)");
assert.equal(CANONICAL_IDENTIFIER_CONTRACTS.tenant_id.transition_collation, "ascii_bin");

const registryMigration = readFileSync(
  new URL("./migrations/20260727_canonical_identifier_contract_registry.sql", import.meta.url),
  "utf8",
);
assert(registryMigration.includes("canonical_identifier_contract_registry"));
assert(registryMigration.includes("canonical_identifier_column_binding_registry"));
assert(registryMigration.includes("uuid.system_id.v1"));
assert(registryMigration.includes("binary(16)"));
assert(!/ALTER\s+TABLE/i.test(registryMigration));

const readinessRepairMigration = readFileSync(
  new URL("./migrations/20260725_repository_authority_capability_readiness_repair.sql", import.meta.url),
  "utf8",
);
assert.equal(requiresDedicatedIdentifierRepairRunner(readinessRepairMigration), true);
let genericRunnerQueryCalled = false;
const dedicatedRunnerResult = await assessLiveIdentifierComparisonContracts(readinessRepairMigration, {
  query: async () => {
    genericRunnerQueryCalled = true;
    return [schemaRows];
  },
});
assert.equal(genericRunnerQueryCalled, false);
assert.equal(dedicatedRunnerResult.status, "block");
assert.equal(dedicatedRunnerResult.dedicated_atomic_runner_required, true);
assert.equal(
  dedicatedRunnerResult.issues[0]?.code,
  "IDENTIFIER_REPAIR_DEDICATED_ATOMIC_RUNNER_REQUIRED",
);
assert.equal(
  dedicatedRunnerResult.required_runner,
  "repository-authority-capability-readiness-repair-runner.mjs",
);

function readinessState(overrides = {}) {
  return {
    system: {
      system_id: "2f4ce77b-0ef8-4d83-aec4-1fca5e332108",
      tenant_id: "f2795a7f-8d06-4053-8bee-35ca9af8b460",
      system_key: "github_rest_prod_platform_managed",
      display_name: "GitHub REST - Production Platform Managed",
      provider_family: "github_com_connector",
      provider_domain: "https://api.github.com",
      connector_family: "github_com_connector",
      service_mode: "managed",
      self_serve_capable: 0,
      assisted_capable: 1,
      managed_capable: 1,
      status: "active",
      config_json: {
        source: "migration:20260725_repository_authority_capability_readiness_repair",
        execution_readiness: "ready",
        authority_role: "repository_shared_platform_adapter",
        provider_transport: "http_generic_api",
        provider_call_executed: false,
        external_write_executed: false,
        credential_payload_read: false,
        secrets_included: false,
      },
    },
    authority: {
      system_id: "old-system",
      installation_id: "installation-1",
      system_binding_mode: "shared_platform_adapter",
      lifecycle_status: "active",
      metadata_json: {},
    },
    capability: {
      capability_key: "repository_main_moved_webhook_provision",
      operation_intent: "apply",
      policy_key: "old-policy",
      lifecycle_status: "active",
      metadata_json: {},
    },
    policy: {
      policy_key: "github_repository_main_moved_webhook_provision_apply_v1",
      app_key: "github",
      capability_key: "repository_main_moved_webhook_provision",
      operation_intent: "apply",
      runtime_surface: "system_layer",
      status: "active",
    },
    authorization: {
      authorization_status: "authorized",
      allow_apply: 1,
      requires_preflight: 1,
      requires_confirmation: 1,
    },
    collations: [
      { collation_name: "utf8mb4_unicode_ci" },
      { collation_name: "utf8mb4_uca1400_ai_ci" },
    ],
    system_id_collision: false,
    ledger: null,
    ...overrides,
  };
}

const ledgerDrift = assessReadinessRepairState(readinessState({
  ledger: { run_id: "existing-run", mode: "apply" },
}));
assert.equal(ledgerDrift.status, "blocked");
assert.equal(ledgerDrift.recommended_action, "diagnose");
assert(ledgerDrift.blocking_reasons.includes("matching_migration_ledger_state_drift"));

assert.equal(
  detectConnectedSystemIdCollision({
    system: {
      system_id: "11111111-1111-4111-8111-111111111111",
      tenant_id: "f2795a7f-8d06-4053-8bee-35ca9af8b460",
      system_key: "github_rest_prod_platform_managed",
    },
    systemById: null,
  }),
  true,
);

const malformedMetadata = assessReadinessRepairState(readinessState({
  authority: {
    system_id: "old-system",
    installation_id: "installation-1",
    system_binding_mode: "shared_platform_adapter",
    lifecycle_status: "active",
    metadata_json: "{not-json",
  },
}));
assert.equal(malformedMetadata.status, "blocked");
assert(malformedMetadata.blocking_reasons.includes("authority_metadata_json_invalid"));

assert.throws(
  () => assertEnvelopeFresh({
    envelope_id: "11111111-2222-4333-8444-555555555555",
    envelope_status: "ready_for_dispatch",
    execution_status: "not_executed",
    dispatch_allowed: 1,
    apply_allowed: 1,
    expires_at: "2026-07-30T08:00:00.000Z",
  }, new Date("2026-07-30T08:00:01.000Z").getTime()),
  (error) => error.code === "readiness_repair_capability_envelope_expired",
);
assert.equal(
  assertEnvelopeFresh({
    envelope_id: "11111111-2222-4333-8444-555555555555",
    envelope_status: "ready_for_dispatch",
    execution_status: "referenced",
    dispatch_allowed: 1,
    apply_allowed: 1,
    expires_at: "2026-07-30T08:01:00.000Z",
  }, new Date("2026-07-30T08:00:01.000Z").getTime()),
  true,
);

const genericRunner = readFileSync(
  new URL("./scripts/governed-migration-runner.mjs", import.meta.url),
  "utf8",
);
assert(genericRunner.includes("assessLiveIdentifierComparisonContracts"));
assert(genericRunner.includes("identifier_comparison_contract_mismatch"));

console.log("canonical identifier contract tests passed");
