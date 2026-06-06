#!/usr/bin/env node

import { getPool } from "../db.js";
import { resolveRuntimeWorkflow } from "../runtimeWorkflowResolver.js";

const MIGRATION = "206_sprint67_deterministic_workflow_execution_identity.sql";

function resolutionSummary(result = {}) {
  return {
    ok: result.ok === true,
    code: result.resolution?.code || null,
    matched_by: result.resolution?.matched_by || null,
    candidate_count: Number(result.resolution?.candidate_count || 0),
    workflow_id: result.workflow?.workflow_id || null,
    workflow_key: result.workflow?.workflow_key || null,
  };
}

async function main() {
  const pool = getPool();
  const [[columnRows], [indexRows], [ledgerRows], [uniqueRows], [duplicateRows]] = await Promise.all([
    pool.query(
      `SELECT column_name, column_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'execution_plans'
          AND column_name = 'workflow_id'`
    ),
    pool.query(
      `SELECT index_name, non_unique, seq_in_index, column_name
         FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'execution_plans'
          AND index_name = 'idx_execution_plans_workflow_id'
        ORDER BY seq_in_index`
    ),
    pool.query(
      `SELECT migration_file, mode, applied_at
         FROM governed_migration_ledger
        WHERE migration_file = ?
        ORDER BY applied_at DESC
        LIMIT 3`,
      [MIGRATION]
    ).catch(() => [[]]),
    pool.query(
      `SELECT workflow_id, workflow_key
         FROM workflows
        WHERE workflow_id IS NOT NULL
          AND workflow_id <> ''
          AND workflow_key IS NOT NULL
          AND workflow_key <> ''
          AND (active = 1 OR active = '1' OR active = 'TRUE' OR status IN ('active', 'ready', 'enabled', 'beta'))
          AND workflow_key IN (
            SELECT workflow_key
              FROM workflows
             WHERE workflow_key IS NOT NULL
               AND workflow_key <> ''
               AND (active = 1 OR active = '1' OR active = 'TRUE' OR status IN ('active', 'ready', 'enabled', 'beta'))
             GROUP BY workflow_key
            HAVING COUNT(*) = 1
          )
        ORDER BY workflow_key
        LIMIT 1`
    ),
    pool.query(
      `SELECT workflow_key, COUNT(*) AS candidate_count
         FROM workflows
        WHERE workflow_key IS NOT NULL
          AND workflow_key <> ''
          AND (active = 1 OR active = '1' OR active = 'TRUE' OR status IN ('active', 'ready', 'enabled', 'beta'))
        GROUP BY workflow_key
       HAVING COUNT(*) > 1
        ORDER BY candidate_count DESC, workflow_key
        LIMIT 1`
    ),
  ]);

  const unique = uniqueRows[0] || null;
  const duplicate = duplicateRows[0] || null;
  const explicitResolution = unique
    ? await resolveRuntimeWorkflow({ pool, workflow_id: unique.workflow_id })
    : null;
  const uniqueKeyResolution = unique
    ? await resolveRuntimeWorkflow({ pool, workflow_key: unique.workflow_key })
    : null;
  const ambiguousResolution = duplicate
    ? await resolveRuntimeWorkflow({ pool, workflow_key: duplicate.workflow_key })
    : null;

  console.log(JSON.stringify({
    ok: columnRows.length === 1 && indexRows.length > 0,
    migration: MIGRATION,
    schema: {
      workflow_id_column_present: columnRows.length === 1,
      workflow_id_index_present: indexRows.length > 0,
      workflow_id_column: columnRows[0] || null,
      workflow_id_index: indexRows,
    },
    ledger: ledgerRows,
    resolution_evidence: {
      explicit_workflow_id: explicitResolution ? resolutionSummary(explicitResolution) : { skipped: true, reason: "no_unique_active_workflow" },
      unique_workflow_key: uniqueKeyResolution ? resolutionSummary(uniqueKeyResolution) : { skipped: true, reason: "no_unique_active_workflow" },
      ambiguous_workflow_key: ambiguousResolution ? resolutionSummary(ambiguousResolution) : { skipped: true, reason: "no_duplicated_active_workflow_key" },
    },
    secrets_included: false,
  }, null, 2));
}

async function closePoolQuietly() {
  try {
    await getPool().end();
  } catch {}
}

main()
  .then(closePoolQuietly)
  .catch(async (error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error?.message || String(error),
      secrets_included: false,
    }, null, 2));
    await closePoolQuietly();
    process.exit(1);
  });
