import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationName = "20260721_dynamic_repository_context_bindings.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
const resolver = readFileSync(new URL("./repositoryContextBindingResolver.js", import.meta.url), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS repository_context_bindings"));
assert(migration.includes("CREATE OR REPLACE VIEW v_repository_context_binding_readiness"));
assert(migration.includes("growth_intelligence_platform.github.primary.production"));
assert(migration.includes("workspace_app_links"));
assert(migration.includes("github_repository_main_moved_webhook_dynamic_binding_apply_v1"));
assert(migration.includes("require_binding_sha256"));
assert(migration.includes("require_resource_uri_match"));
assert(migration.includes("allow_external_write"));
assert(resolver.includes("repository-binding://"));
assert(resolver.includes("binding_sha256"));
assert(resolver.includes("repository_context_binding_ambiguous"));
assert(resolver.includes("repository_context_binding_not_ready"));
assert(resolver.includes("secret_reference_rows"));
assert(!resolver.includes("includeSecret: true"), "repository context resolver must never resolve secret plaintext");

console.log("dynamic repository context binding migration tests passed");
