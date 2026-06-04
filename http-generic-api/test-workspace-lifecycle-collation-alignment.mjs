import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/191_sprint66_workspace_lifecycle_collation_alignment.sql", "utf8");

assert(migration.includes("workspace_access_requests"), "migration must target workspace_access_requests");
assert(migration.includes("CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"), "migration must align table collation");
assert(migration.includes("tenant_id varchar(36) COLLATE utf8mb4_unicode_ci"), "tenant_id collation must align with memberships");
assert(migration.includes("requester_user_id varchar(36) COLLATE utf8mb4_unicode_ci"), "requester_user_id collation must align with memberships");
assert(migration.includes("requester_email varchar(255) COLLATE utf8mb4_unicode_ci"), "requester email collation must be explicit");

console.log("workspace lifecycle collation alignment test passed");
