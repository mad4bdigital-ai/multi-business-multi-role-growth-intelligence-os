import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/196_sprint67_cms_authority_collation_alignment.sql", "utf8");

assert(migration.includes("cms_sites"), "migration must align cms_sites");
assert(migration.includes("cms_site_access_grants"), "migration must align cms_site_access_grants");
assert(migration.includes("utf8mb4_uca1400_ai_ci"), "migration must align CMS authority keys to production user/membership collation");
assert(migration.includes("MODIFY site_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL"), "site_id must be explicitly aligned");
assert(migration.includes("MODIFY tenant_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NOT NULL"), "tenant_id must be explicitly aligned");
assert(migration.includes("MODIFY user_id varchar(36) COLLATE utf8mb4_uca1400_ai_ci NULL"), "user_id must be explicitly aligned");
assert(!migration.includes("utf8mb4_unicode_ci"), "migration must not keep old unicode collation on join keys");

console.log("CMS authority collation alignment tests passed");
