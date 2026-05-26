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
const pluginRegistryMigration = readFileSync(
  join(__dirname, "migrations/141_sprint65_plugin_registry_collation_repair.sql"),
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

for (const tableName of [
  "app_integrations",
  "user_app_connections",
  "workspace_app_links",
  "app_action_grants",
  "app_action_requests",
]) {
  assert(
    pluginRegistryMigration.includes(`zz_collation_backup_20260526_${tableName}`),
    `plugin collation repair must snapshot ${tableName} before mutation`
  );
}

assert(
  /ALTER\s+DATABASE\s+CHARACTER\s+SET\s+utf8mb4\s+COLLATE\s+utf8mb4_unicode_ci/i.test(pluginRegistryMigration),
  "plugin collation repair must set the database default collation for future DDL"
);

assert(
  !/CONVERT\s+TO\s+CHARACTER\s+SET/i.test(pluginRegistryMigration),
  "plugin collation repair must avoid broad CONVERT TO so JSON utf8mb4_bin columns stay intact"
);

for (const tableName of [
  "app_integrations",
  "user_app_connections",
  "workspace_app_links",
  "app_action_grants",
  "app_action_requests",
]) {
  const tableAlter = new RegExp(`ALTER\\s+TABLE\\s+\\`${tableName}\\`[\\s\\S]*?DEFAULT\\s+CHARACTER\\s+SET\\s+utf8mb4\\s+COLLATE\\s+utf8mb4_unicode_ci`, "i");
  assert(tableAlter.test(pluginRegistryMigration), `${tableName} must be reset to utf8mb4_unicode_ci by default`);
}

for (const keyColumn of ["app_key", "action_key", "connection_id", "tenant_id", "user_id", "workspace_id"]) {
  assert(
    pluginRegistryMigration.includes(`\`${keyColumn}\``) &&
      pluginRegistryMigration.includes("COLLATE utf8mb4_unicode_ci"),
    `plugin collation repair must explicitly normalize ${keyColumn} where present`
  );
}

console.log("db collation guard tests passed");
