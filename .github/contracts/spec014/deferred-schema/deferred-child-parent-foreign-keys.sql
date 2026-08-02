-- Spec 014 deferred child-parent foreign-key candidate.
-- Repository-only candidate: not promoted to http-generic-api/migrations.
-- Requires separate checksum-bound authorization, dry-run, typed confirmation,
-- same-cycle live parent-child parity readback, apply, and post-apply readback.
-- No CASCADE action, destructive DDL, provider dispatch, or Production promotion.

ALTER TABLE storage_cleanup_run_items
  ADD CONSTRAINT fk_storage_cleanup_run_items_run
  FOREIGN KEY (run_id) REFERENCES storage_cleanup_runs(id);

ALTER TABLE storage_cleanup_run_items
  ADD CONSTRAINT fk_storage_cleanup_run_items_plan_item
  FOREIGN KEY (plan_item_id) REFERENCES storage_cleanup_plan_items(id);

ALTER TABLE storage_reconciliation_results
  ADD CONSTRAINT fk_storage_reconciliation_results_run
  FOREIGN KEY (run_id) REFERENCES storage_cleanup_runs(id);
