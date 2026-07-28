import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const migrationName = "20260725_repository_authority_capability_readiness_repair.sql";
const sql = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
const statements = splitMigrationSqlStatements(sql);

assert.equal(statements.length, 3);
assert.match(sql, /INSERT\s+INTO\s+connected_systems/i);
assert(sql.includes("github_rest_prod_platform_managed"));
assert(sql.includes("f2795a7f-8d06-4053-8bee-35ca9af8b460"));
assert(sql.includes("'managed'"));
assert(sql.includes("managed_capable=1"));
assert(sql.includes("ON DUPLICATE KEY UPDATE"));
assert(!sql.includes("9f94af7b-21da-4f36-a407-b08aeafbef97"));
assert(!sql.includes("UPDATE connected_systems"));

assert.match(sql, /UPDATE\s+repository_authority_bindings\s+authority\s+JOIN\s+connected_systems\s+system/i);
assert(sql.includes("authority.system_id=system.system_id"));
assert(sql.includes("authority.installation_id=NULL"));
assert(sql.includes("authority.authority_version=authority.authority_version+1"));
assert(sql.includes("authority.lock_version=authority.lock_version+1"));
assert(!sql.includes("binding_version"));
assert(sql.includes("BINARY authority.system_id<>BINARY system.system_id"));
assert(!sql.includes("authority.system_id<>system.system_id"));
assert.match(sql, /WHERE\s+authority\.binding_key='growth_intelligence_platform\.github\.primary\.production'/i);

assert.match(sql, /UPDATE\s+repository_capability_bindings\s+capability\s+JOIN\s+capability_apply_authorization_policy_registry\s+policy/i);
assert(sql.includes("github_repository_main_moved_webhook_provision_apply_v1"));
assert(sql.includes("policy.runtime_surface='system_layer'"));
assert(sql.includes("capability.policy_key=policy.policy_key"));
assert(sql.includes("capability.capability_version=capability.capability_version+1"));
assert(sql.includes("capability.lock_version=capability.lock_version+1"));
assert(!sql.includes("SET policy_key = 'github_repository_main_moved_webhook_dynamic_binding_apply_v2'"));
assert(!sql.includes("runtime_surface = 'repo_patch_apply'"));
assert(!sql.includes("UPDATE capability_apply_authorization_policy_registry"));

assert(sql.includes("provider_call_executed',FALSE"));
assert(sql.includes("external_write_executed',FALSE"));
assert(sql.includes("credential_payload_read',FALSE"));
assert(sql.includes("secrets_included',FALSE"));
assert(!sql.includes("value_ciphertext"));
assert(!sql.includes("includeSecret"));

console.log("repository authority capability readiness repair migration tests passed");
