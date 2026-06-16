#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  assertDatabaseTableLifecycleRegistryUpsertAllowed,
  planDatabaseTableLifecycleRegistryUpsert,
} from "../databaseTableLifecycle.js";

function parseArgs(argv) {
  const args = { apply: false, confirm: null, includeExisting: false, limit: 1000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    if (arg === "--dry-run") args.apply = false;
    if (arg === "--include-existing") args.includeExisting = true;
    if (arg === "--confirm") {
      args.confirm = argv[index + 1] || null;
      index += 1;
    }
    if (arg === "--limit") {
      args.limit = argv[index + 1] || args.limit;
      index += 1;
    }
  }
  return args;
}

async function applyLifecycleRegistryUpsert(pool, upsertRows) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let applied = 0;
    for (const row of upsertRows) {
      await conn.query(
        `INSERT INTO database_table_lifecycle_registry (
           table_name, table_family, owner_engine_key, authority_model, usage_status,
           write_strategy, retention_class, retention_days, archive_strategy,
           cleanup_strategy, growth_policy, approx_rows, size_mb,
           last_observed_write_at, linked_by_code, linked_by_policy,
           linked_by_foreign_key, risk_level, status, notes, last_checked_at,
           created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           table_family = VALUES(table_family),
           owner_engine_key = VALUES(owner_engine_key),
           authority_model = VALUES(authority_model),
           usage_status = VALUES(usage_status),
           write_strategy = VALUES(write_strategy),
           retention_class = VALUES(retention_class),
           retention_days = VALUES(retention_days),
           archive_strategy = VALUES(archive_strategy),
           cleanup_strategy = VALUES(cleanup_strategy),
           growth_policy = VALUES(growth_policy),
           approx_rows = VALUES(approx_rows),
           size_mb = VALUES(size_mb),
           last_observed_write_at = VALUES(last_observed_write_at),
           linked_by_code = VALUES(linked_by_code),
           linked_by_policy = VALUES(linked_by_policy),
           linked_by_foreign_key = VALUES(linked_by_foreign_key),
           risk_level = VALUES(risk_level),
           status = VALUES(status),
           notes = VALUES(notes),
           last_checked_at = NOW(),
           updated_at = NOW()`,
        [
          row.table_name,
          row.table_family,
          row.owner_engine_key,
          row.authority_model,
          row.usage_status,
          row.write_strategy,
          row.retention_class,
          row.retention_days,
          row.archive_strategy,
          row.cleanup_strategy,
          row.growth_policy,
          row.approx_rows,
          row.size_mb,
          row.last_observed_write_at,
          row.linked_by_code ? 1 : 0,
          row.linked_by_policy ? 1 : 0,
          row.linked_by_foreign_key ? 1 : 0,
          row.risk_level,
          row.status,
          row.notes,
        ]
      );
      applied += 1;
    }
    await conn.commit();
    return { applied_rows: applied };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gate = assertDatabaseTableLifecycleRegistryUpsertAllowed(args);
  const pool = getPool();
  const plan = await planDatabaseTableLifecycleRegistryUpsert({
    limit: args.limit,
    include_existing: args.includeExisting,
  }, { pool });
  const response = {
    ok: true,
    mode: gate.mode,
    selection_mode: plan.selection_mode,
    required_confirmation: gate.allowed ? undefined : gate.required_confirmation,
    live_table_count: plan.live_table_count,
    existing_registry_count: plan.existing_registry_count,
    selected_table_count: plan.selected_table_count,
    summary: plan.summary,
    buckets: plan.buckets,
    upsert_count: plan.upsert_count,
    no_drop: true,
    no_archive_execution: true,
    secrets_included: false,
  };

  if (gate.allowed) {
    response.apply = await applyLifecycleRegistryUpsert(pool, plan.upsert_rows);
    const readback = await planDatabaseTableLifecycleRegistryUpsert({
      limit: args.limit,
      include_existing: false,
    }, { pool });
    response.readback = {
      live_table_count: readback.live_table_count,
      existing_registry_count: readback.existing_registry_count,
      remaining_missing_count: readback.selected_table_count,
      verified: readback.selected_table_count === 0,
    };
    if (!response.readback.verified) {
      const error = new Error(`Lifecycle registry readback found ${readback.selected_table_count} remaining missing table(s).`);
      error.code = "DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT_READBACK_FAILED";
      throw error;
    }
  }

  await pool.end();
  console.log(JSON.stringify(response, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || "DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT_FAILED",
    message: err.message,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
