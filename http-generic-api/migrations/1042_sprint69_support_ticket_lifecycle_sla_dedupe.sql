-- Sprint 69: support ticket lifecycle, SLA, test visibility, and dedupe integrity.
-- Additive/idempotent. Applying this migration requires separate governed authorization.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0 AFTER occurrence_count,
  ADD COLUMN IF NOT EXISTS environment VARCHAR(32) NOT NULL DEFAULT 'production' AFTER is_test,
  ADD COLUMN IF NOT EXISTS visibility_class VARCHAR(64) NOT NULL DEFAULT 'customer_visible' AFTER environment,
  ADD COLUMN IF NOT EXISTS target_capability VARCHAR(191) NULL AFTER visibility_class,
  ADD COLUMN IF NOT EXISTS related_ticket_id VARCHAR(64) NULL AFTER target_capability,
  ADD COLUMN IF NOT EXISTS parent_ticket_id VARCHAR(64) NULL AFTER related_ticket_id,
  ADD COLUMN IF NOT EXISTS supersedes_ticket_id VARCHAR(64) NULL AFTER parent_ticket_id,
  ADD COLUMN IF NOT EXISTS first_response_at DATETIME NULL AFTER first_response_due_at,
  ADD COLUMN IF NOT EXISTS triaged_at DATETIME NULL AFTER triage_due_at;

ALTER TABLE tickets
  ADD INDEX IF NOT EXISTS idx_tickets_tenant_test_status_activity
    (tenant_id, is_test, status, updated_at),
  ADD INDEX IF NOT EXISTS idx_tickets_tenant_parent_status
    (tenant_id, parent_ticket_id, status),
  ADD INDEX IF NOT EXISTS idx_tickets_tenant_capability_status
    (tenant_id, target_capability, status),
  ADD INDEX IF NOT EXISTS idx_tickets_tenant_visibility_status
    (tenant_id, visibility_class, status);

-- Known smoke/simulation records found by the 2026-08-01 production audit.
UPDATE tickets
   SET is_test = 1,
       environment = COALESCE(NULLIF(environment, ''), 'production'),
       visibility_class = 'internal_test',
       updated_at = NOW()
 WHERE ticket_id IN (
   'd3f6d691-48b8-489d-950e-a7230a996b0b',
   '1d53f041-21c4-4a9f-ad2e-7e6dff5887c0',
   '3c8d16a0-2923-4065-934b-3e9e75382a4e',
   '05beb452-7edd-4b65-9549-d154d5405884',
   '14a161bf-6664-11f1-8ecd-456940024c79'
 );

-- Preserve the explicit relationship that was previously lost by broad dedupe.
UPDATE tickets
   SET parent_ticket_id = COALESCE(parent_ticket_id, 'b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4'),
       related_ticket_id = COALESCE(related_ticket_id, 'b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4'),
       target_capability = COALESCE(target_capability, 'wordpress_tenant_safe_self_repair'),
       updated_at = NOW()
 WHERE ticket_id = '310f39c8-d2f7-4523-95db-9a783c59f9cf';

-- Resolve the exact contradictory record only when both internal states already
-- certify runtime resolution. The guard prevents broad lifecycle mutation.
UPDATE tickets
   SET status = 'resolved',
       updated_at = NOW()
 WHERE ticket_id = '685dc4d9-c137-4941-81f4-de13306a8508'
   AND status IN ('open', 'in_review', 'awaiting_approval')
   AND lifecycle_state = 'resolved_runtime_validated'
   AND customer_status = 'resolved_runtime_validated';

-- Backfill legacy rows without changing newer activity timestamps.
UPDATE tickets
   SET last_seen_at = COALESCE(last_seen_at, updated_at, created_at, NOW())
 WHERE last_seen_at IS NULL;

-- Milestone-aware SLA reconciliation. A completed milestone is not treated as
-- breached merely because its due timestamp is in the past.
UPDATE tickets
   SET sla_status = CASE
     WHEN status NOT IN ('open', 'in_review', 'awaiting_approval') THEN COALESCE(sla_status, 'on_track')
     WHEN first_response_at IS NULL AND first_response_due_at IS NOT NULL AND first_response_due_at < NOW() THEN 'breached'
     WHEN triaged_at IS NULL AND triage_due_at IS NOT NULL AND triage_due_at < NOW() THEN 'breached'
     WHEN resolution_due_at IS NOT NULL AND resolution_due_at < NOW() THEN 'breached'
     WHEN first_response_at IS NULL AND first_response_due_at IS NOT NULL AND first_response_due_at <= DATE_ADD(NOW(), INTERVAL 60 MINUTE) THEN 'warning'
     WHEN triaged_at IS NULL AND triage_due_at IS NOT NULL AND triage_due_at <= DATE_ADD(NOW(), INTERVAL 60 MINUTE) THEN 'warning'
     WHEN resolution_due_at IS NOT NULL AND resolution_due_at <= DATE_ADD(NOW(), INTERVAL 60 MINUTE) THEN 'warning'
     ELSE 'on_track'
   END,
   updated_at = NOW()
 WHERE status IN ('open', 'in_review', 'awaiting_approval');

CREATE OR REPLACE VIEW v_support_ticket_integrity_readiness AS
SELECT
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tickets'
      AND COLUMN_NAME IN (
        'is_test', 'environment', 'visibility_class', 'target_capability',
        'related_ticket_id', 'parent_ticket_id', 'supersedes_ticket_id',
        'first_response_at', 'triaged_at'
      )) AS present_column_count,
  9 AS required_column_count,
  CASE
    WHEN (SELECT COUNT(*)
            FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'tickets'
             AND COLUMN_NAME IN (
               'is_test', 'environment', 'visibility_class', 'target_capability',
               'related_ticket_id', 'parent_ticket_id', 'supersedes_ticket_id',
               'first_response_at', 'triaged_at'
             )) = 9
    THEN 'ready'
    ELSE 'blocked'
  END AS readiness_status,
  NOW() AS checked_at;

CREATE OR REPLACE VIEW v_support_ticket_latest_activity AS
SELECT
  t.*,
  GREATEST(
    COALESCE(t.last_seen_at, '1970-01-01 00:00:00'),
    COALESCE(t.updated_at, '1970-01-01 00:00:00'),
    COALESCE(t.created_at, '1970-01-01 00:00:00')
  ) AS latest_activity_at
FROM tickets t;
