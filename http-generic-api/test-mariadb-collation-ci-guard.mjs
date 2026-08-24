import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateOrderedSqlChain,
  evaluateSqlFiles,
  resolveSqlFiles,
} from "./scripts/mariadb-collation-ci-guard.mjs";

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

console.log("MariaDB collation CI guard tests passed");
