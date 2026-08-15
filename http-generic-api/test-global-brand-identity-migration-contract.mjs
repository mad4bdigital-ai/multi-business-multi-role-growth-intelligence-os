import assert from "node:assert/strict";
import fs from "node:fs/promises";

const sql = await fs.readFile(new URL("./migrations/20260815_platform_resource_global_brand_identity.sql", import.meta.url), "utf8");

for (const token of [
  "ADD COLUMN IF NOT EXISTS `brand_id`",
  "ADD COLUMN IF NOT EXISTS `resource_revision`",
  "CREATE TABLE IF NOT EXISTS `brand_identifiers`",
  "CREATE TABLE IF NOT EXISTS `brand_identity_aliases`",
  "CREATE TABLE IF NOT EXISTS `brand_claims`",
  "CREATE TABLE IF NOT EXISTS `brand_verification_evidence`",
  "CREATE TABLE IF NOT EXISTS `tenant_relationships`",
  "ADD COLUMN IF NOT EXISTS `relationship_type`",
  "ADD COLUMN IF NOT EXISTS `relationship_status`",
  "ADD COLUMN IF NOT EXISTS `verification_status`",
  "'legacy_target_key'",
  "authority_grants_created",
  "provider_mutations_executed",
  "production_promotions_executed",
]) assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing migration contract token: ${token}`);

assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i, "identity foundation must not drop schema");
assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i, "identity foundation must not delete rows");
assert.doesNotMatch(sql, /INSERT\s+INTO\s+`?workspace_resource_grants`?/i, "identity migration must not mint authority grants");
assert.doesNotMatch(sql, /UPDATE\s+`?workspace_resource_grants`?/i, "identity migration must not alter authority grants");

console.log("global brand identity migration contract: ok");
