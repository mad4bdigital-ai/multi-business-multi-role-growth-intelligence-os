import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateOrderedSqlChain,
  evaluateSqlFiles,
  resolveSqlFiles,
} from "./scripts/mariadb-collation-ci-guard.mjs";
import { inspectOrderedMigrationChainEnumSeeds } from "./databaseEnumSeedPolicyGuard.js";
import { inspectOrderedMigrationChainTextWidths } from "./databaseTextWidthPolicyGuard.js";

const policy = {
  policy_key: "test-policy",
  engines: {
    mariadb: {
      required_default_charset: "utf8mb4",
      required_default_collation: "utf8mb4_unicode_ci",
      allowed_default_collations: ["utf8mb4_unicode_ci", "utf8mb4_bin"],
      join_key_collation_mode: "uniform",
      allow_explicit_collation_boundary: true,
    },
  },
};

const validFiles = resolveSqlFiles({
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  gitFn: (args) => {
    assert.deepEqual(args, ["diff", "--name-only", "a".repeat(40), "b".repeat(40), "--"]);
    return "docs/readme.md\nhttp-generic-api/migrations/valid.sql\nhttp-generic-api/test-only.mjs\n";
  },
});
assert.deepEqual(validFiles, ["http-generic-api/migrations/valid.sql"]);

const zeroBaseFiles = resolveSqlFiles({
  baseSha: "0".repeat(40),
  headSha: "b".repeat(40),
  gitFn: (args) => {
    assert.deepEqual(args, ["diff", "--name-only", `${"b".repeat(40)}^`, "b".repeat(40), "--"]);
    return "http-generic-api/migrations/valid.sql\n";
  },
});
assert.deepEqual(zeroBaseFiles, ["http-generic-api/migrations/valid.sql"]);

let unavailableBaseCalls = 0;
const unavailableBaseFiles = resolveSqlFiles({
  baseSha: "c".repeat(40),
  headSha: "b".repeat(40),
  gitFn: (args) => {
    unavailableBaseCalls += 1;
    if (unavailableBaseCalls === 1) {
      assert.deepEqual(args, ["diff", "--name-only", "c".repeat(40), "b".repeat(40), "--"]);
      throw new Error("base commit is unavailable in this CI checkout");
    }
    assert.deepEqual(args, ["diff", "--name-only", `${"b".repeat(40)}^`, "b".repeat(40), "--"]);
    return "http-generic-api/migrations/valid.sql\n";
  },
});
assert.deepEqual(unavailableBaseFiles, ["http-generic-api/migrations/valid.sql"]);
assert.equal(unavailableBaseCalls, 2);

const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
assert.match(
  ciWorkflow,
  /COLLATION_BASE_SHA.*\^0\{40\}\$/,
  "CI must not pass an all-zero event.before SHA to the collation diff guard",
);
assert.match(ciWorkflow, /ordered_enum_seed_chain\.ok == true/);
assert.match(ciWorkflow, /enum_seed_chain\.ok == true/);
assert.match(ciWorkflow, /enum_seed_chain\.database_connection_performed == false/);
assert.match(ciWorkflow, /ordered_text_width_chain\.ok == true/);
assert.match(ciWorkflow, /text_width_chain\.ok == true/);
assert.match(ciWorkflow, /text_width_chain\.database_connection_performed == false/);

const valid = evaluateSqlFiles(validFiles, {
  policy,
  readFile: () => "CREATE TABLE governed_example (id BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;",
});
assert.equal(valid.ok, true, JSON.stringify(valid));
assert.equal(valid.files_checked, 1);
assert.equal(valid.sql_mutation_performed, false);
assert.equal(valid.database_connection_performed, false);
assert.equal(valid.secrets_included, false);

const invalid = evaluateSqlFiles(["http-generic-api/migrations/invalid.sql"], {
  policy,
  readFile: () => "CREATE TABLE governed_example (id BIGINT NOT NULL) DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;",
});
assert.equal(invalid.ok, false);
assert.deepEqual(invalid.blocked_files, ["http-generic-api/migrations/invalid.sql"]);
assert(invalid.files[0].issues.some((issue) => issue.code === "migration_default_charset_not_allowed"));
assert(invalid.files[0].issues.some((issue) => issue.code === "migration_default_collation_not_allowed"));

const implicit = evaluateSqlFiles(["http-generic-api/schema.sql"], {
  policy,
  readFile: () => "CREATE TABLE governed_example (id BIGINT NOT NULL);",
});
assert.equal(implicit.ok, false);
assert(implicit.files[0].issues.some((issue) => issue.code === "migration_table_collation_not_explicit"));

const orderedFiles = {
  "http-generic-api/schema.sql": "CREATE TABLE users (user_id VARCHAR(36) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;",
  "http-generic-api/migrations/001_sprint02_tenancy.sql": "CREATE TABLE user_app_connections (user_id VARCHAR(36) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;",
  "http-generic-api/migrations/196_sprint67_mariadb_join_key_collation_alignment.sql": "ALTER TABLE user_app_connections DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci, MODIFY user_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL;",
  "http-generic-api/migrations/197_sprint67_view.sql": "-- view boundary\nCREATE OR REPLACE VIEW v_join AS SELECT u.user_id FROM users u JOIN user_app_connections c ON u.user_id = c.user_id;",
  "http-generic-api/migrations/198_sprint67_explicit_view.sql": "CREATE OR REPLACE VIEW v_explicit_join AS SELECT u.user_id FROM users u JOIN user_app_connections c ON u.user_id = c.user_id COLLATE utf8mb4_unicode_ci;",
};
const readOrderedFixture = (file) => orderedFiles[file];
const orderedBad = evaluateOrderedSqlChain([
  "http-generic-api/migrations/001_sprint02_tenancy.sql",
  "http-generic-api/migrations/197_sprint67_view.sql",
], { policy, baselineFile: "http-generic-api/schema.sql", readFile: readOrderedFixture });
assert.equal(orderedBad.ok, false, JSON.stringify(orderedBad));
assert(orderedBad.findings.some((finding) => finding.code === "ordered_join_collation_incompatible"));

const orderedGood = evaluateOrderedSqlChain([
  "http-generic-api/migrations/001_sprint02_tenancy.sql",
  "http-generic-api/migrations/196_sprint67_mariadb_join_key_collation_alignment.sql",
  "http-generic-api/migrations/197_sprint67_view.sql",
  "http-generic-api/migrations/198_sprint67_explicit_view.sql",
], { policy, baselineFile: "http-generic-api/schema.sql", readFile: readOrderedFixture });
assert.equal(orderedGood.ok, true, JSON.stringify(orderedGood));
assert(orderedGood.warnings.some((warning) => warning.code === "explicit_collation_join_boundary"));
assert.equal(orderedGood.database_connection_performed, false);
assert.equal(orderedGood.sql_mutation_performed, false);
  assert.equal(orderedGood.secrets_included, false);

const enumPolicy = {
  enum_seed_chain_contract: {
    enabled: true,
    static_only: true,
    database_connection_allowed: false,
    sql_mutation_allowed: false,
    provider_access_allowed: false,
    credential_access_allowed: false,
    data_export_allowed: false,
    runtime_mutation_allowed: false,
    secrets_included: false,
    policy_key: "test-enum-seed-chain",
  },
};
const enumFiles = {
  "http-generic-api/schema.sql": "CREATE TABLE platform_engine_registry (engine_key VARCHAR(64) PRIMARY KEY, engine_type ENUM('generic') NOT NULL DEFAULT 'generic');",
  "http-generic-api/migrations/002_seed.sql": "-- INSERT INTO platform_engine_registry (engine_key,engine_type) VALUES ('comment','comment_only');\nINSERT INTO platform_engine_registry (engine_key,engine_type) VALUES ('developer','developer_platform');",
  "http-generic-api/migrations/001_alignment.sql": "ALTER TABLE platform_engine_registry MODIFY COLUMN engine_type ENUM('generic','developer_platform') NOT NULL DEFAULT 'generic';",
  "http-generic-api/migrations/003_update.sql": "UPDATE platform_engine_registry SET engine_type='developer_platform' WHERE engine_key='developer';",
  "http-generic-api/migrations/004_replace.sql": "REPLACE INTO platform_engine_registry (engine_key,engine_type) VALUES ('developer','generic');",
};
const readEnumFixture = (file) => enumFiles[file];
const enumBad = inspectOrderedMigrationChainEnumSeeds({
  files: ["http-generic-api/migrations/002_seed.sql"],
  baselineFile: "http-generic-api/schema.sql",
  policy: enumPolicy,
  readFile: readEnumFixture,
});
assert.equal(enumBad.ok, false, JSON.stringify(enumBad));
assert.equal(enumBad.findings.length, 1);
assert.equal(enumBad.findings[0].table, "platform_engine_registry");
assert.equal(enumBad.findings[0].column, "engine_type");
assert.equal(enumBad.findings[0].value, "developer_platform");
const enumGood = inspectOrderedMigrationChainEnumSeeds({
  files: Object.keys(enumFiles).filter((file) => file !== "http-generic-api/schema.sql"),
  baselineFile: "http-generic-api/schema.sql",
  policy: enumPolicy,
  readFile: readEnumFixture,
});
assert.equal(enumGood.ok, true, JSON.stringify(enumGood));
assert.equal(enumGood.findings.length, 0);
assert.equal(enumGood.database_connection_performed, false);
assert.equal(enumGood.sql_mutation_performed, false);
assert.equal(enumGood.provider_mutation_performed, false);
assert.equal(enumGood.credential_access_performed, false);
assert.equal(enumGood.data_export_performed, false);
assert.equal(enumGood.runtime_mutation_performed, false);
assert.equal(enumGood.secrets_included, false);

const textWidthPolicy = {
  text_width_chain_contract: {
    enabled: true,
    static_only: true,
    database_connection_allowed: false,
    sql_mutation_allowed: false,
    provider_access_allowed: false,
    credential_access_allowed: false,
    data_export_allowed: false,
    runtime_mutation_allowed: false,
    secrets_included: false,
    policy_key: "test-text-width-chain",
  },
};
const textWidthFiles = {
  "http-generic-api/schema.sql": "CREATE TABLE runtime_dispatch_certification_registry (certification_key VARCHAR(64) PRIMARY KEY, certification_status VARCHAR(8) NOT NULL, smoke_strategy VARCHAR(16) NOT NULL); CREATE TABLE platform_runtime_config (config_key VARCHAR(64) PRIMARY KEY, note VARCHAR(12) NULL);",
  "http-generic-api/migrations/001_overflow.sql": "INSERT INTO runtime_dispatch_certification_registry (certification_key, certification_status, smoke_strategy) VALUES ('bad','too_long_status','this smoke strategy is longer than sixteen'); UPDATE platform_runtime_config SET note = CONCAT(note, ' appended note text exceeds twelve') WHERE config_key='policy';",
  "http-generic-api/migrations/000_alignment.sql": "ALTER TABLE runtime_dispatch_certification_registry MODIFY COLUMN smoke_strategy TEXT NOT NULL, MODIFY COLUMN certification_status VARCHAR(128) NOT NULL DEFAULT 'baseline'; ALTER TABLE platform_runtime_config MODIFY COLUMN note TEXT NULL;",
  "http-generic-api/migrations/002_update.sql": "UPDATE runtime_dispatch_certification_registry SET certification_status='this status is now safely widened', smoke_strategy='this update is safely widened' WHERE certification_key='bad';",
  "http-generic-api/migrations/003_replace.sql": "REPLACE INTO runtime_dispatch_certification_registry (certification_key, certification_status, smoke_strategy) VALUES ('good','ok','read_only_smoke');",
};
const readTextWidthFixture = (file) => textWidthFiles[file];
const textWidthBad = inspectOrderedMigrationChainTextWidths({
  files: ["http-generic-api/migrations/001_overflow.sql"],
  baselineFile: "http-generic-api/schema.sql",
  policy: textWidthPolicy,
  readFile: readTextWidthFixture,
});
assert.equal(textWidthBad.ok, false, JSON.stringify(textWidthBad));
assert.equal(textWidthBad.findings.length, 3);
assert(textWidthBad.findings.some((finding) => finding.column === "certification_status"));
assert(textWidthBad.findings.some((finding) => finding.column === "smoke_strategy"));
assert(textWidthBad.findings.some((finding) => finding.column === "note" && finding.code === "text_width_concat_overflow"));
const textWidthGood = inspectOrderedMigrationChainTextWidths({
  files: Object.keys(textWidthFiles).filter((file) => file !== "http-generic-api/schema.sql"),
  baselineFile: "http-generic-api/schema.sql",
  policy: textWidthPolicy,
  readFile: readTextWidthFixture,
});
assert.equal(textWidthGood.ok, true, JSON.stringify(textWidthGood));
assert.equal(textWidthGood.findings.length, 0);
assert.equal(textWidthGood.database_connection_performed, false);
assert.equal(textWidthGood.sql_mutation_performed, false);
assert.equal(textWidthGood.provider_mutation_performed, false);
assert.equal(textWidthGood.credential_access_performed, false);
assert.equal(textWidthGood.data_export_performed, false);
assert.equal(textWidthGood.runtime_mutation_performed, false);
assert.equal(textWidthGood.secrets_included, false);

console.log("MariaDB collation, enum, and text-width CI guard tests passed");
