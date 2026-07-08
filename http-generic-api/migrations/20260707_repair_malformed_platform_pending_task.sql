-- Repair one malformed legacy platform_pending_tasks row that surfaced as
-- activation pending-task source-data-quality noise.
--
-- Evidence:
-- - task_key: open_pr_platform_governance_codification_v3
-- - source_ref: commit f5bc4d9dd509ae1467ff7a80657ae0acc9674f98
-- - commit message: Merge PR #677: Add OpenClaude provider bridge dry-run routes
-- - the legacy row had an empty task_id and empty title, which made the
--   operational alert collector emit a malformed-row source_data_quality alert.
--
-- This migration is data repair only. It does not call providers, expose
-- secrets, or change runtime execution authority.

UPDATE platform_pending_tasks
   SET task_id = UUID(),
       title = 'OpenClaude provider bridge dry-run routes merged by PR #677',
       description = COALESCE(
         NULLIF(description, ''),
         CONCAT(
           'Source-data-quality repair: this legacy pending task referenced merge commit ',
           'f5bc4d9dd509ae1467ff7a80657ae0acc9674f98, which merged PR #677 and completed the open-PR work item. ',
           'The malformed empty task_id/title caused v_activation_pending_tasks source_data_quality noise.'
         )
       ),
       brief = COALESCE(
         NULLIF(brief, ''),
         'Completed legacy open-PR work item for OpenClaude provider bridge dry-run routes.'
       ),
       status = 'done',
       blocker_level = 'none',
       completed_at = COALESCE(completed_at, NOW()),
       updated_by = 'platform_admin_source_data_quality_repair_20260707',
       updated_at = CURRENT_TIMESTAMP
 WHERE task_key = 'open_pr_platform_governance_codification_v3'
   AND (
        task_id IS NULL OR task_id = ''
     OR title IS NULL OR title = ''
     OR status <> 'done'
   );
