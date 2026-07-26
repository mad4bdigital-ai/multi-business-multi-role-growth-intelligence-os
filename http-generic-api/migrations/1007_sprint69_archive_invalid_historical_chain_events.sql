-- Sprint 69: close historical pending chain events whose composite workflow identity never resolved.
-- Guarded/idempotent. No provider calls, external writes, or secret reads.

UPDATE `agent_chain_events` e
LEFT JOIN `workflows` w
  ON BINARY w.workflow_key = BINARY e.target_workflow_key
SET e.status = 'skipped',
    e.failure_reason = 'workflow_identity_missing_historical'
WHERE e.status = 'pending'
  AND e.created_at < '2026-06-15 00:00:00'
  AND e.target_workflow_key LIKE '%;%'
  AND w.workflow_id IS NULL;
