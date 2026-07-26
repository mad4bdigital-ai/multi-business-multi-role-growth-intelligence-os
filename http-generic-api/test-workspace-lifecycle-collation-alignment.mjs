import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration191 = readFileSync("migrations/191_sprint66_workspace_lifecycle_collation_alignment.sql", "utf8");
const migration192 = readFileSync("migrations/192_sprint66_workspace_lifecycle_uca1400_collation_alignment.sql", "utf8");

assert(migration191.includes("workspace_access_requests"), "migration 191 must target workspace_access_requests");
assert(migration191.includes("utf8mb4_unicode_ci"), "migration 191 documents the first unicode alignment attempt");
assert(migration192.includes("utf8mb4_uca1400_ai_ci"), "migration 192 must supersede 191 for production memberships collation");
assert(migration192.includes("requester_user_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci"), "migration 192 must align requester_user_id with memberships.user_id");
assert(migration192.includes("tenant_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci"), "migration 192 must align tenant_id with memberships.tenant_id");

console.log("workspace lifecycle collation alignment supersession test passed");
