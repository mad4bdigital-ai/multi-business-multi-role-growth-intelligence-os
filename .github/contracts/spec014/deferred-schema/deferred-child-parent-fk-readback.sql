-- Spec 014 read-only pre-authorization parity evidence for deferred child FKs.
-- This query performs no writes and exposes counts only.

SELECT
  (SELECT COUNT(*) FROM storage_cleanup_plan_items) AS plan_items_total,
  (SELECT COUNT(*) FROM storage_cleanup_runs) AS runs_total,
  (SELECT COUNT(*) FROM storage_cleanup_run_items) AS journal_rows_total,
  (SELECT COUNT(*) FROM storage_reconciliation_results) AS reconciliation_rows_total,

  (SELECT COUNT(*)
     FROM storage_cleanup_run_items j
    WHERE j.plan_item_id IS NULL) AS journal_null_plan_item_id_count,

  (SELECT COUNT(*)
     FROM storage_cleanup_run_items j
     LEFT JOIN storage_cleanup_runs r ON r.id = j.run_id
    WHERE r.id IS NULL) AS journal_orphan_run_count,

  (SELECT COUNT(*)
     FROM storage_cleanup_run_items j
     LEFT JOIN storage_cleanup_plan_items pi ON pi.id = j.plan_item_id
    WHERE j.plan_item_id IS NOT NULL AND pi.id IS NULL) AS journal_orphan_plan_item_count,

  (SELECT COUNT(*)
     FROM storage_cleanup_run_items j
     JOIN storage_cleanup_runs r ON r.id = j.run_id
    WHERE j.operation_id <> r.operation_id) AS journal_operation_mismatch_count,

  (SELECT COUNT(*)
     FROM storage_cleanup_run_items j
     JOIN storage_cleanup_runs r ON r.id = j.run_id
    WHERE j.plan_id <> r.plan_id) AS journal_plan_mismatch_count,

  (SELECT COUNT(*) FROM (
      SELECT j.run_id, j.item_id, j.sequence
        FROM storage_cleanup_run_items j
       GROUP BY j.run_id, j.item_id, j.sequence
      HAVING COUNT(*) > 1
  ) duplicate_runtime_sequence) AS journal_duplicate_runtime_sequence_count,

  (SELECT COUNT(*) FROM (
      SELECT j.run_id, j.plan_item_id, j.sequence
        FROM storage_cleanup_run_items j
       WHERE j.plan_item_id IS NOT NULL
       GROUP BY j.run_id, j.plan_item_id, j.sequence
      HAVING COUNT(*) > 1
  ) duplicate_parent_sequence) AS journal_duplicate_parent_sequence_count,

  (SELECT COUNT(*)
     FROM storage_cleanup_run_items j
    WHERE j.row_version <> 1) AS journal_row_version_violation_count,

  (SELECT COUNT(*)
     FROM storage_reconciliation_results rr
     LEFT JOIN storage_cleanup_runs r ON r.id = rr.run_id
    WHERE r.id IS NULL) AS reconciliation_orphan_run_count,

  (SELECT COUNT(*)
     FROM storage_reconciliation_results rr
     JOIN storage_cleanup_runs r ON r.id = rr.run_id
    WHERE rr.operation_id <> r.operation_id) AS reconciliation_operation_mismatch_count,

  (SELECT COUNT(*)
     FROM storage_reconciliation_results rr
    WHERE rr.row_version <> 1) AS reconciliation_row_version_violation_count;
