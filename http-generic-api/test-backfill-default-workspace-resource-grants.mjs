import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/195_sprint67_backfill_default_workspace_resource_grants.sql", "utf8");

assert(migration.includes("workspace_resource_grants"), "backfill must insert into workspace_resource_grants");
assert(migration.includes("FROM memberships m"), "backfill must source active memberships");
assert(migration.includes("JOIN tenants t"), "backfill must only use active tenants");
assert(migration.includes("LEFT JOIN workspace_resource_grants g"), "backfill must detect existing grants");
assert(migration.includes("g.grant_id IS NULL"), "backfill must avoid duplicate active workspace grants");
assert(migration.includes("'workspace' AS resource_type"), "backfill must create workspace resource grants");
assert(migration.includes("'membership_default' AS source"), "backfill source must be membership_default");
assert(migration.includes("LOWER(m.role) = 'admin' THEN 'admin'"), "admin membership should map to admin permission");
assert(migration.includes("LOWER(m.role) IN ('editor', 'operator') THEN 'operate'"), "editor/operator membership should map to operate permission");
assert(migration.includes("ELSE 'view'"), "all other roles should map to view");
assert(migration.includes("default_workspace_membership_grant"), "metadata must mark default workspace membership grants");
assert(!migration.includes("THEN 'owner'"), "backfill must not create owner resource grants");

console.log("default workspace resource grant backfill migration tests passed");
