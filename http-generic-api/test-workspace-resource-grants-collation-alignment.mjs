import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/198_sprint67_workspace_resource_grants_collation_alignment.sql", "utf8");

assert(migration.includes("workspace_resource_grants"), "migration must target workspace_resource_grants");
assert(migration.includes("utf8mb4_uca1400_ai_ci"), "migration must align resource grants to production memberships collation");
assert(migration.includes("MODIFY tenant_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL"), "tenant_id must be explicitly aligned");
assert(migration.includes("MODIFY grantee_user_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL"), "grantee_user_id must be explicitly aligned");
assert(migration.includes("MODIFY resource_ref varchar(255) COLLATE utf8mb4_uca1400_ai_ci NOT NULL"), "resource_ref must be explicitly aligned");
assert(migration.includes("MODIFY granted_by varchar(36) COLLATE utf8mb4_uca1400_ai_ci NULL"), "granted_by must be aligned for user joins");
assert(migration.includes("MODIFY revoked_by varchar(36) COLLATE utf8mb4_uca1400_ai_ci NULL"), "revoked_by must be aligned for user joins");
assert(!migration.includes("utf8mb4_unicode_ci"), "migration must not keep old unicode collation on join keys");

console.log("workspace resource grants collation alignment tests passed");
