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

for (const forbidden of [
  "encrypted_credentials",
  "api_key_value",
  "access_token",
  "refresh_token",
  "client_secret",
]) {
  assert(!pluginCollationMigration.toLowerCase().includes(forbidden.toLowerCase()), `migration must not alter secret payload fields: ${forbidden}`);
}

console.log("db collation guard tests passed");
