#!/usr/bin/env node

import { getPool } from "../db.js";
import { ACTIVE_WORKFLOW_SQL, resolveRuntimeWorkflow } from "../runtimeWorkflowResolver.js";

const MIGRATIONS = [
  "206_sprint67_deterministic_workflow_execution_identity.sql",
  "209_sprint67_execution_plan_workflow_identity_backfill.sql",
];

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
  const [[columnRows], [indexRows], [ledgerRows], [uniqueRows], [duplicateRows], [planCoverageRows], [planResolutionCoverageRows], [ambiguousPlanRows], [identityMissingPlanRows], [unresolvedPlanRows]] = await Promise.all([
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
        WHERE migration_file IN (?, ?)
        ORDER BY applied_at DESC
        LIMIT 6`,
      MIGRATIONS
    ).catch(() => [[]]),
    pool.query(
      `SELECT workflow_id, workflow_key
         FROM workflows
        WHERE workflow_id IS NOT NULL
          AND workflow_id <> ''
          AND workflow_key IS NOT NULL
          AND workflow_key <> ''
          AND ${ACTIVE_WORKFLOW_SQL}
          AND workflow_key IN (
            SELECT workflow_key
              FROM workflows
             WHERE workflow_key IS NOT NULL
               AND workflow_key <> ''
               AND ${ACTIVE_WORKFLOW_SQL}
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
          AND ${ACTIVE_WORKFLOW_SQL}
        GROUP BY workflow_key
       HAVING COUNT(*) > 1
        ORDER BY candidate_count DESC, workflow_key
        LIMIT 1`
    ),
    pool.query(
      `SELECT
          COUNT(*) AS total_plans,
          SUM(workflow_id IS NOT NULL AND workflow_id <> '') AS plans_with_workflow_id,
          SUM((workflow_id IS NULL OR workflow_id = '') AND workflow_key IS NOT NULL AND workflow_key <> '') AS plans_using_key_fallback,
          SUM((workflow_id IS NULL OR workflow_id = '') AND (workflow_key IS NULL OR workflow_key = '')) AS identityless_plans,
          SUM(plan_status IN ('validated', 'approved', 'executing') AND (workflow_id IS NULL OR workflow_id = '') AND (workflow_key IS NULL OR workflow_key = '')) AS executable_identityless_plans,
          SUM(plan_status IN ('validated', 'approved', 'executing') AND (workflow_id IS NULL OR workflow_id = '')) AS executable_plans_without_workflow_id
         FROM execution_plans`
    ),
    pool.query(
      `SELECT
          SUM((ep.workflow_id IS NULL OR ep.workflow_id = '') AND wk.candidate_count = 1 AND wk.valid_identity_count = 1) AS uniquely_resolvable_fallback_plans,
          SUM((ep.workflow_id IS NULL OR ep.workflow_id = '') AND ep.plan_status IN ('validated', 'approved', 'executing') AND wk.candidate_count = 1 AND wk.valid_identity_count = 1) AS executable_uniquely_resolvable_fallback_plans,
          SUM((ep.workflow_id IS NULL OR ep.workflow_id = '') AND wk.candidate_count > 1) AS ambiguous_fallback_plans,
          SUM((ep.workflow_id IS NULL OR ep.workflow_id = '') AND wk.candidate_count = 1 AND wk.valid_identity_count = 0) AS identity_missing_fallback_plans,
          SUM((ep.workflow_id IS NULL OR ep.workflow_id = '') AND ep.workflow_key IS NOT NULL AND ep.workflow_key <> '' AND wk.workflow_key IS NULL) AS unresolved_fallback_plans
         FROM execution_plans ep
         LEFT JOIN (
           SELECT
             workflow_key,
             COUNT(*) AS candidate_count,
             SUM(workflow_id IS NOT NULL AND workflow_id <> '') AS valid_identity_count
             FROM workflows
            WHERE workflow_key IS NOT NULL
              AND workflow_key <> ''
              AND ${ACTIVE_WORKFLOW_SQL}
            GROUP BY workflow_key
         ) wk ON wk.workflow_key COLLATE utf8mb4_unicode_ci = ep.workflow_key COLLATE utf8mb4_unicode_ci`
    ),
    pool.query(
      `SELECT ep.plan_status, ep.workflow_key, COUNT(*) AS plan_count, wk.candidate_count
         FROM execution_plans ep
         JOIN (
           SELECT workflow_key, COUNT(*) AS candidate_count
             FROM workflows
            WHERE workflow_key IS NOT NULL
              AND workflow_key <> ''
              AND ${ACTIVE_WORKFLOW_SQL}
            GROUP BY workflow_key
           HAVING COUNT(*) > 1
         ) wk ON wk.workflow_key COLLATE utf8mb4_unicode_ci = ep.workflow_key COLLATE utf8mb4_unicode_ci
        WHERE ep.workflow_id IS NULL OR ep.workflow_id = ''
        GROUP BY ep.plan_status, ep.workflow_key, wk.candidate_count
        ORDER BY FIELD(ep.plan_status, 'executing', 'approved', 'validated', 'draft', 'failed', 'completed', 'cancelled'), plan_count DESC
        LIMIT 20`
    ),
    pool.query(
      `SELECT ep.plan_status, ep.workflow_key, COUNT(*) AS plan_count
         FROM execution_plans ep
         JOIN (
           SELECT workflow_key
             FROM workflows
            WHERE workflow_key IS NOT NULL
              AND workflow_key <> ''
              AND ${ACTIVE_WORKFLOW_SQL}
            GROUP BY workflow_key
           HAVING COUNT(*) = 1
              AND SUM(workflow_id IS NOT NULL AND workflow_id <> '') = 0
         ) wk ON wk.workflow_key COLLATE utf8mb4_unicode_ci = ep.workflow_key COLLATE utf8mb4_unicode_ci
        WHERE ep.workflow_id IS NULL OR ep.workflow_id = ''
        GROUP BY ep.plan_status, ep.workflow_key
        ORDER BY FIELD(ep.plan_status, 'executing', 'approved', 'validated', 'draft', 'failed', 'completed', 'cancelled'), plan_count DESC
        LIMIT 20`
    ),
    pool.query(
      `SELECT ep.plan_status, ep.workflow_key, COUNT(*) AS plan_count
         FROM execution_plans ep
         LEFT JOIN (
           SELECT workflow_key
             FROM workflows
            WHERE workflow_key IS NOT NULL
              AND workflow_key <> ''
              AND ${ACTIVE_WORKFLOW_SQL}
            GROUP BY workflow_key
         ) wk ON wk.workflow_key COLLATE utf8mb4_unicode_ci = ep.workflow_key COLLATE utf8mb4_unicode_ci
        WHERE (ep.workflow_id IS NULL OR ep.workflow_id = '')
          AND ep.workflow_key IS NOT NULL
          AND ep.workflow_key <> ''
          AND wk.workflow_key IS NULL
        GROUP BY ep.plan_status, ep.workflow_key
        ORDER BY FIELD(ep.plan_status, 'executing', 'approved', 'validated', 'draft', 'failed', 'completed', 'cancelled'), plan_count DESC
        LIMIT 20`
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
  const planCoverage = planCoverageRows[0] || {};
  const planResolutionCoverage = planResolutionCoverageRows[0] || {};

  console.log(JSON.stringify({
    ok: columnRows.length === 1 && indexRows.length > 0,
    migrations: MIGRATIONS,
    schema: {
      workflow_id_column_present: columnRows.length === 1,
      workflow_id_index_present: indexRows.length > 0,
      workflow_id_column: columnRows[0] || null,
      workflow_id_index: indexRows,
    },
    ledger: ledgerRows,
    execution_plan_coverage: planCoverage,
    execution_plan_resolution_coverage: planResolutionCoverage,
    backfill_readiness: {
      uniquely_resolvable_plans_remaining: Number(planResolutionCoverage.uniquely_resolvable_fallback_plans || 0),
      ambiguous_plans_requiring_manual_review: Number(planResolutionCoverage.ambiguous_fallback_plans || 0),
      identity_missing_plans_requiring_manual_review: Number(planResolutionCoverage.identity_missing_fallback_plans || 0),
      unresolved_plans_requiring_manual_review: Number(planResolutionCoverage.unresolved_fallback_plans || 0),
      identityless_plans_requiring_manual_review: Number(planCoverage.identityless_plans || 0),
    },
    ambiguous_legacy_plan_groups: ambiguousPlanRows,
    identity_missing_legacy_plan_groups: identityMissingPlanRows,
    unresolved_legacy_plan_groups: unresolvedPlanRows,
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
