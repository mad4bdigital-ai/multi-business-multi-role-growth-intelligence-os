import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertDisposableAuthorizationTarget,
  buildDisposableMigrationAuthorizationMetadata,
} from "./scripts/spec011-disposable-migration-authorization-binding.mjs";

const migrationSql = await readFile(
  new URL("./migrations/20260725_agent_delegation_grant_persistence_contract.sql", import.meta.url),
  "utf8",
);
const metadata = buildDisposableMigrationAuthorizationMetadata({ migrationSql });

assert.match(metadata.migration_checksum_sha256, /^[0-9a-f]{64}$/);
assert.equal(metadata.expected_statement_count, 2);
assert.equal(metadata.authorization_scope, "disposable_ci_only");
assert.equal(metadata.disposable, true);
assert.equal(metadata.production_authorized, false);
assert.equal(metadata.secrets_included, false);

assert.doesNotThrow(() => assertDisposableAuthorizationTarget({
  DELEGATION_MARIADB_CERTIFICATION_MODE: "disposable",
  DB_NAME: "spec011_delegation_cert_ci",
  DB_HOST: "127.0.0.1",
}));
assert.throws(
  () => assertDisposableAuthorizationTarget({
    DELEGATION_MARIADB_CERTIFICATION_MODE: "disposable",
    DB_NAME: "production",
    DB_HOST: "127.0.0.1",
  }),
  /disposable prefix/,
);
assert.throws(
  () => assertDisposableAuthorizationTarget({
    DELEGATION_MARIADB_CERTIFICATION_MODE: "disposable",
    DB_NAME: "spec011_delegation_cert_ci",
    DB_HOST: "db.production.internal",
  }),
  /loopback DB_HOST/,
);

const bindingSource = await readFile(
  new URL("./scripts/spec011-disposable-migration-authorization-binding.mjs", import.meta.url),
  "utf8",
);
assert.match(bindingSource, /splitSqlStatements/);
assert.match(bindingSource, /migration_checksum_sha256/);
assert.match(bindingSource, /expected_statement_count/);
assert.match(bindingSource, /metadata_json=VALUES\(metadata_json\)/);
assert.match(bindingSource, /authorization_scope:\s*"disposable_ci_only"/);
assert.doesNotMatch(bindingSource, /production_authorized:\s*true/);

console.log("Spec 011 disposable migration authorization binding tests passed");
