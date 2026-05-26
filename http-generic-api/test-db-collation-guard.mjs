import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sessionSummaryMigration = readFileSync(
  join(__dirname, "migrations/113_sprint62x_session_summary_graph_collation_guard.sql"),
  "utf8"
);

assert(
  sessionSummaryMigration.includes("v_session_summary_graph_attachments"),
  "session summary graph attachment view must exist"
);

assert(
  /ja\.source_asset_ref\s*=\s*ss\.summary_id\s+COLLATE\s+utf8mb4_unicode_ci/i.test(sessionSummaryMigration),
  "cross-family summary_id join must use explicit utf8mb4_unicode_ci collation"
);

assert(
  !/ALTER\s+TABLE\s+`?session_summaries`?/i.test(sessionSummaryMigration),
  "collation guard must not broad-alter session_summaries in the view migration"
);

const pluginCollationMigration = readFileSync(
  join(__dirname, "migrations/142_sprint65_platform_plugin_collation_normalization.sql"),
  "utf8"
);
const pluginCollationHardeningMigration = readFileSync(
  join(__dirname, "migrations/143_sprint65_platform_plugin_collation_hardening.sql"),
  "utf8"
);
const pluginCollationHardeningWithoutComments = pluginCollationHardeningMigration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

for (const backupTable of [
  "collation_backup_app_integrations_20260526",
  "collation_backup_user_app_connections_20260526",
  "collation_backup_app_action_grants_20260526",
  "collation_backup_app_action_requests_20260526",
]) {
  assert(pluginCollationMigration.includes(backupTable), `migration must create safety snapshot ${backupTable}`);
}

for (const table of [
  "app_integrations",
  "user_app_connections",
  "app_action_grants",
  "app_action_requests",
]) {
  assert(new RegExp(`ALTER\\s+TABLE\\s+${table}`, "i").test(pluginCollationMigration), `migration must normalize ${table}`);
}

for (const column of [
  "app_key",
  "action_key",
  "tenant_id",
  "user_id",
  "status",
]) {
  assert(pluginCollationMigration.includes(column), `migration must mention join key ${column}`);
}

assert(
  pluginCollationMigration.includes("DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"),
  "migration must set table defaults to utf8mb4_unicode_ci"
);
assert(
  pluginCollationMigration.includes("v_platform_plugin_collation_issues"),
  "migration must create a diagnostic collation view"
);
assert(
  pluginCollationMigration.includes("platform_plugin_join_key_collation"),
  "migration must install a blocking execution policy for plugin join-key collation"
);
assert(
  pluginCollationMigration.includes("collation_name <> 'utf8mb4_unicode_ci'"),
  "diagnostic view must detect non-canonical collations"
);

assert(
  /ALTER\s+DATABASE\s+CHARACTER\s+SET\s+utf8mb4\s+COLLATE\s+utf8mb4_unicode_ci/i.test(pluginCollationHardeningMigration),
  "hardening migration must set the database default for future plugin DDL"
);
assert(
  pluginCollationHardeningMigration.includes("collation_backup_workspace_app_links_20260526"),
  "hardening migration must snapshot workspace_app_links before mutation"
);
assert(
  /ALTER\s+TABLE\s+workspace_app_links/i.test(pluginCollationHardeningMigration),
  "hardening migration must normalize workspace_app_links"
);
for (const column of ["workspace_id", "workspace_key", "connection_id", "app_key", "tenant_id", "status"]) {
  assert(pluginCollationHardeningMigration.includes(column), `hardening migration must mention workspace join key ${column}`);
}
assert(
  pluginCollationHardeningMigration.includes("'workspace_app_links'") &&
    pluginCollationHardeningMigration.includes("'connection_id'") &&
    pluginCollationHardeningMigration.includes("'workspace_id'"),
  "hardening diagnostic view must cover workspace app links and connection/workspace keys"
);
assert(
  !/ALTER\s+TABLE[\s\S]*CONVERT\s+TO\s+CHARACTER\s+SET/i.test(pluginCollationHardeningWithoutComments),
  "hardening migration must avoid broad ALTER TABLE CONVERT TO so JSON utf8mb4_bin columns stay intact"
);

for (const forbidden of [
  "encrypted_credentials",
  "api_key_value",
  "access_token",
  "refresh_token",
  "client_secret",
]) {
  assert(!pluginCollationMigration.toLowerCase().includes(forbidden.toLowerCase()), `migration must not alter secret payload fields: ${forbidden}`);
  assert(!pluginCollationHardeningMigration.toLowerCase().includes(forbidden.toLowerCase()), `hardening migration must not alter secret payload fields: ${forbidden}`);
}

console.log("db collation guard tests passed");
