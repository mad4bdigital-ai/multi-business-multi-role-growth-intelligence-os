import assert from "node:assert/strict";
import {
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

console.log("MariaDB collation CI guard tests passed");
