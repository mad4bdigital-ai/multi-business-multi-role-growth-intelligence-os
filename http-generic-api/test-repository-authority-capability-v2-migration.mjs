import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationName = "20260721_repository_authority_capability_bindings_v2.sql";
const sql = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");

assert(sql.includes("repository_authority_bindings"));
assert(sql.includes("repository_authority_aliases"));
assert(sql.includes("repository_capability_bindings"));
assert(sql.includes("repository_capability_policy_layers"));
assert(sql.includes("v_repository_authority_binding_readiness"));
assert(sql.includes("v_repository_capability_binding_readiness"));
assert(sql.includes("shared_platform_adapter"));
assert(sql.includes("repository_node_id"));
assert(sql.includes("R_kgDOSFDYfg"));
assert(sql.includes("1213257854"));
assert(sql.includes("resource_type ENUM('workspace','brand','site','app','asset','workflow','agent','vault','repository')"));
assert(sql.includes("repository_authority_db_v2"));
assert(sql.includes("github_repository_webhook_v2"));
assert(sql.includes("github_repository_main_moved_webhook_readback_v2"));
assert(sql.includes("github_repository_main_moved_webhook_dynamic_binding_apply_v2"));
assert(sql.includes("require_binding_sha256"));
assert(sql.includes("require_capability_sha256"));
assert(sql.includes("repository-capability-v2"));
assert(sql.includes("deterministic_inheritance"));
assert.match(sql, /SELECT\s+'platform'\s+AS\s+scope_type,\s*'\*'\s+AS\s+scope_ref,\s*100\s+AS\s+precedence/i);
assert.match(sql, /UNION\s+ALL\s+SELECT\s+'environment',\s*'production',\s*700/i);
assert(!sql.includes("value_ciphertext"));
assert(!sql.includes("includeSecret"));

console.log("repository authority capability v2 migration tests passed");
