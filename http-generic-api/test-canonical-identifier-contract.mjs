import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANONICAL_IDENTIFIER_CONTRACTS,
  assessLiveIdentifierComparisonContracts,
  extractCanonicalIdentifierComparisons,
} from "./canonicalIdentifierContract.js";

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

const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
assert(runner.includes("assessLiveIdentifierComparisonContracts"));
assert(runner.includes("identifier_comparison_contract_mismatch"));

console.log("canonical identifier contract tests passed");
