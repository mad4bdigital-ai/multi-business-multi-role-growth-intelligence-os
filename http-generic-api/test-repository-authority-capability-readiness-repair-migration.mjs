import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationName = "20260725_repository_authority_capability_readiness_repair.sql";
const sql = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");

assert(sql.includes("INSERT INTO connected_systems"));
assert(sql.includes("github_api_mcp_platform_managed"));
assert(sql.includes("'github_api_mcp'"));
assert(sql.includes("'platform_managed'"));
assert(sql.includes("'managed'"));
assert.match(sql, /managed_capable[\s\S]*?1/);
assert(!sql.includes("9f94af7b-21da-4f36-a407-b08aeafbef97"));
assert(!sql.includes("UPDATE connected_systems"));

assert(sql.includes("growth_intelligence_platform.github.primary.production"));
assert(sql.includes("rab.system_id = cs.system_id"));
assert(sql.includes("rab.system_binding_mode = 'shared_platform_adapter'"));
assert(sql.includes("rab.system_id <> cs.system_id"));
assert(sql.includes("rab.system_binding_mode <> 'shared_platform_adapter'"));

assert(sql.includes("SET policy_key = 'github_repository_main_moved_webhook_dynamic_binding_apply_v2'"));
assert(sql.includes("WHERE policy_key = 'github_repository_main_moved_webhook_provision_apply_v1'"));
assert(!sql.includes("INSERT INTO capability_apply_authorization_policy_registry"));
assert(sql.includes("capability_key = 'github_repository_main_moved_webhook_provision'"));
assert(sql.includes("runtime_surface = 'repo_patch_apply'"));

console.log("repository authority capability readiness repair migration tests passed");
