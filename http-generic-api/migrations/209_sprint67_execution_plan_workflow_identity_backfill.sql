-- Backfill exact workflow identity only where one active workflow row with a valid workflow_id can be resolved.
-- Ambiguous and unresolved workflow keys intentionally remain unchanged for manual review.
UPDATE execution_plans ep
JOIN (
  SELECT workflow_key, MIN(workflow_id) AS workflow_id
  FROM workflows
  WHERE workflow_key IS NOT NULL
    AND workflow_key <> ''
    AND (
      active = 1
      OR active = '1'
      OR active = 'TRUE'
      OR status IN ('active', 'ready', 'enabled', 'beta')
    )
  GROUP BY workflow_key
  HAVING COUNT(*) = 1
     AND SUM(workflow_id IS NOT NULL AND workflow_id <> '') = 1
) wf
  ON wf.workflow_key COLLATE utf8mb4_unicode_ci
   = ep.workflow_key COLLATE utf8mb4_unicode_ci
SET ep.workflow_id = wf.workflow_id
WHERE ep.workflow_id IS NULL OR ep.workflow_id = '';
