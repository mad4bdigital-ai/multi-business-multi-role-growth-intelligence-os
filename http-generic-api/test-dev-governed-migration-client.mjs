import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDevDbStatus,
  parseArgs,
  resolveApplyAuthoritySource,
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

assert.deepEqual(
  validateShellAliasInvocation("platform_outbox_worker", ["--action=status"]),
  { mutation_requested: false, extra_args: ["--action=status"] }
);
assert.deepEqual(
  validateShellAliasInvocation("platform_outbox_worker", [
    "--action=dry-run",
    "--consumer=prod_shadow_v1",
    "--limit=100",
  ]),
  {
    mutation_requested: false,
    extra_args: ["--action=dry-run", "--consumer=prod_shadow_v1", "--limit=100"],
  }
);
assert.deepEqual(
  validateShellAliasInvocation("capability_resolution_envelope_create", []),
  { mutation_requested: true, extra_args: [] }
);
for (const blockedArgs of [
  ["--action=run-once"],
  ["--action=loop"],
  ["--action=status", "--apply"],
  ["--action=status", "--limit=0"],
  ["--action=status", "--limit=501"],
  ["--action=status", "--consumer=bad consumer"],
  ["--action=status", "--unknown=value"],
]) {
  assert.throws(() => validateShellAliasInvocation("platform_outbox_worker", blockedArgs));
}

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
assert.equal(
  packageJson.scripts["dev:outbox:status"],
  "node scripts/dev-governed-migration-client.mjs --action=shell-alias --alias=platform_outbox_worker --extra-args-base64=WyItLWFjdGlvbj1zdGF0dXMiXQ=="
);
assert.equal(
  packageJson.scripts["dev:outbox:dry-run"],
  "node scripts/dev-governed-migration-client.mjs --action=shell-alias --alias=platform_outbox_worker --extra-args-base64=WyItLWFjdGlvbj1kcnktcnVuIl0="
);

console.log("dev governed migration and outbox read-only client contract tests passed");
