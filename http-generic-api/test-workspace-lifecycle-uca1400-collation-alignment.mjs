import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/192_sprint66_workspace_lifecycle_uca1400_collation_alignment.sql", "utf8");

assert(migration.includes("workspace_access_requests"), "migration must target workspace_access_requests");
assert(migration.includes("utf8mb4_uca1400_ai_ci"), "migration must align to production memberships collation");
assert(migration.includes("tenant_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci"), "tenant_id collation must match memberships");
assert(migration.includes("requester_user_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci"), "requester_user_id collation must match memberships.user_id");

console.log("workspace lifecycle uca1400 collation alignment test passed");
