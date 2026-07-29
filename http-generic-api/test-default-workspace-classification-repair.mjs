import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/20260723_default_workspace_classification_repair.sql", "utf8");
const projectionService = readFileSync("dynamicContainerProjectionService.js", "utf8");

for (const workspaceId of [
  "0ff5982f-77d5-11f1-9a4d-d342cf4a053c",
  "0ff59ac4-77d5-11f1-9a4d-d342cf4a053c",
  "0ff59b5f-77d5-11f1-9a4d-d342cf4a053c",
]) {
  assert(migration.includes(workspaceId), `migration must pin workspace ${workspaceId}`);
}

for (const tenantId of [
  "00000000-0000-4000-a000-000000000001",
  "1e673d38-89a2-4872-a6b9-8bc937bd9503",
  "d7696384-ef5c-4d38-a90c-b17edaaf8c72",
]) {
  assert(migration.includes(tenantId), `migration must pin tenant ${tenantId}`);
}

assert.match(migration, /workspace_type`\s*=\s*'project'/, "repair must classify the rows as project workspaces");
assert(migration.includes("capability_gate_default_workspace_registry_20260704"), "repair must require the original repair key");
assert(migration.includes("default_workspace_non_brand_classification_20260723"), "repair must persist its own evidence key");
assert.match(migration, /linked_brand_key` IS NULL/, "repair must require no direct linked brand");
assert.match(migration, /NOT EXISTS\s*\([\s\S]*tenant_brand_links[\s\S]*status` = 'active'/, "repair must skip tenants with active tenant brand evidence");
assert.match(migration, /tenant_type` IN \('platform_owner', 'managed_client_account'\)/, "repair must remain tenant-type bounded");
assert(!/INSERT\s+INTO\s+`?tenant_brand_links`?/i.test(migration), "repair must not invent tenant brand links");
assert(!/UPDATE\s+`?brands`?/i.test(migration), "repair must not modify the global brands registry");
assert(!/SET[\s\S]*linked_brand_key`\s*=/i.test(migration), "repair must not manufacture linked_brand_key values");
assert.match(projectionService, /workspaceType\s*&&\s*workspaceType\s*!==\s*"brand"/, "projection must skip brand-link requirements for non-brand workspaces");

console.log("default workspace classification repair safeguards: pass");
