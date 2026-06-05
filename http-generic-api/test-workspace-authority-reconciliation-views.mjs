import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/197_sprint67_workspace_authority_reconciliation_views.sql", "utf8");

assert(migration.includes("v_cms_grants_without_workspace_membership"), "must detect CMS grants without workspace membership");
assert(migration.includes("v_connections_without_workspace_membership"), "must detect app connections without workspace membership");
assert(migration.includes("v_active_memberships_missing_workspace_grants"), "must detect active members missing workspace grants");
assert(migration.includes("v_cms_publish_grants_missing_resource_grants"), "must detect publish grants missing resource authority");
assert(migration.includes("v_workspace_authority_reconciliation_summary"), "must expose a summary view");
assert(migration.includes("LEFT JOIN memberships m"), "must compare grants/connections against memberships");
assert(migration.includes("LEFT JOIN v_workspace_resource_grant_effective"), "must compare CMS publish grants against effective resource grants");
assert(migration.includes("cms_grants_without_workspace_membership"), "summary must include CMS membership mismatch check");
assert(migration.includes("cms_publish_grants_missing_resource_grants"), "summary must include WordPress enforcement mismatch check");
assert(migration.includes("rg.permission IN ('owner','admin','manage')"), "high permissions must satisfy resource authority checks");
assert(migration.includes("g.publish_allowed = 1 AND rg.permission = 'operate'"), "publish grants must require operate or higher");
assert(!migration.includes("encrypted_credentials"), "reconciliation views must not expose secrets");

console.log("workspace authority reconciliation view tests passed");
