import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDevDbStatus,
  parseArgs,
  sanitizeResult,
  validateDevBaseUrl,
  validateShellAliasInvocation,
} from "./scripts/dev-governed-migration-client.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

assert.equal(validateDevBaseUrl("https://dev.mad4b.com"), "https://dev.mad4b.com");
assert.equal(validateDevBaseUrl("https://dev.mad4b.com/"), "https://dev.mad4b.com");
for (const blocked of [
  "http://dev.mad4b.com",
  "https://auth.mad4b.com",
  "https://evil.dev.mad4b.com",
  "https://user:pass@dev.mad4b.com",
  "https://dev.mad4b.com/path",
  "https://dev.mad4b.com?token=blocked",
]) {
  assert.throws(() => validateDevBaseUrl(blocked));
}

assert.deepEqual(assertDevDbStatus({
  status: 200,
  body: { ok: true, db_name: "u338416126_growthOS_dev", table_count: 497, row_count: 100 },
}), {
  db_name: "u338416126_growthOS_dev",
  table_count: 497,
  row_count: 100,
});
assert.throws(
  () => assertDevDbStatus({ status: 200, body: { ok: true, db_name: "u338416126_growthOS" } }),
  /not dev-scoped/
);

assert.deepEqual(parseArgs([
  "--action=tool-call",
  "--tool=governed_migration_execute",
  "--apply",
]), {
  action: "tool-call",
  base_url: "https://dev.mad4b.com",
  tool: "governed_migration_execute",
  apply: true,
});

assert.deepEqual(sanitizeResult({
  ok: true,
  nested: {
    access_token: "must-not-leak",
    password: "must-not-leak",
    migration: "safe.sql",
  },
}), {
  ok: true,
  nested: {
    access_token: "[redacted]",
    password: "[redacted]",
    migration: "safe.sql",
  },
});

const source = await fs.readFile(path.join(root, "scripts", "dev-governed-migration-client.mjs"), "utf8");
assert.match(source, /dev\.mad4b\.com/);
assert.match(source, /endsWith\("_dev"\)/);
assert.match(source, /DEV_MIGRATION_APPLY_ENABLED/);
assert.match(source, /redirect: "error"/);
assert.match(source, /governed_migration_execute/);
assert.match(source, /governed_migration_schema_readback/);
assert.match(source, /capability_resolution_envelope_create/);
assert.match(source, /capability_resolution_envelope_approve/);
assert.doesNotMatch(source, /restore-from-backup/);
assert.doesNotMatch(source, /tool:\s*["']db["']/);
assert.doesNotMatch(source, /\bsql\s*:/i);

const adminCli = await fs.readFile(path.join(root, "routes", "adminCliRoutes.js"), "utf8");
assert.match(adminCli, /dev_governed_migration_client/);
assert.match(adminCli, /dev-governed-migration-client\.mjs/);

const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["dev:migration:probe"], "node scripts/dev-governed-migration-client.mjs --action=probe");
assert.equal(packageJson.scripts["dev:migration:client"], "node scripts/dev-governed-migration-client.mjs");
assert.equal(packageJson.scripts["dev:migration:status"], "node scripts/dev-governed-migration-client.mjs --action=status");

console.log("dev governed migration client contract tests passed");
