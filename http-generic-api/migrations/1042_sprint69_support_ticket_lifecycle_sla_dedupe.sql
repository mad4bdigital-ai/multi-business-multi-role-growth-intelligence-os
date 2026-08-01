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

CREATE TABLE IF NOT EXISTS support_ticket_dedupe_claims (
  tenant_id VARCHAR(64) NOT NULL,
  dedupe_key VARCHAR(128) NOT NULL,
  claim_token CHAR(36) NOT NULL,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, dedupe_key),
  INDEX idx_support_ticket_dedupe_claims_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE tickets
  ADD INDEX IF NOT EXISTS idx_tickets_tenant_test_status_activity
    (tenant_id, is_test, status, updated_at),
  ADD INDEX IF NOT EXISTS idx_tickets_tenant_parent_status
    (tenant_id, parent_ticket_id, status),
  ADD INDEX IF NOT EXISTS idx_tickets_tenant_capability_status
    (tenant_id, target_capability, status),
  ADD INDEX IF NOT EXISTS idx_tickets_tenant_visibility_status
    (tenant_id, visibility_class, status);

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

UPDATE tickets
   SET parent_ticket_id = COALESCE(parent_ticket_id, 'b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4'),
       related_ticket_id = COALESCE(related_ticket_id, 'b48a7b04-fa30-4e7d-ac5b-7a97515e7dd4'),
       target_capability = COALESCE(target_capability, 'wordpress_tenant_safe_self_repair'),
       updated_at = NOW()
 WHERE ticket_id = '310f39c8-d2f7-4523-95db-9a783c59f9cf';

UPDATE tickets
   SET status = 'resolved',
       updated_at = NOW()
 WHERE ticket_id = '685dc4d9-c137-4941-81f4-de13306a8508'
   AND status IN ('open', 'in_review', 'awaiting_approval')
   AND lifecycle_state = 'resolved_runtime_validated'
   AND customer_status = 'resolved_runtime_validated';

UPDATE tickets
   SET last_seen_at = COALESCE(last_seen_at, updated_at, created_at, NOW())
 WHERE last_seen_at IS NULL;

UPDATE tickets t
JOIN (
  SELECT
    e.tenant_id,
    e.ticket_id,
    MIN(CASE
      WHEN e.visibility = 'customer'
       AND e.event_type NOT IN ('ticket_created', 'dedupe_matched', 'queue_assigned')
       AND LOWER(COALESCE(e.actor_type, 'system')) NOT IN ('tenant_user', 'customer', 'user')
      THEN e.created_at
      ELSE NULL
    END) AS derived_first_response_at,
    MIN(CASE
      WHEN LOWER(COALESCE(e.actor_type, 'system')) NOT IN ('tenant_user', 'customer', 'user')
       AND (
         e.event_type IN ('triaged', 'ticket_triaged', 'assignee_changed', 'diagnostic_started')
         OR (
           e.event_type = 'state_transition'
           AND LOWER(COALESCE(e.to_state, '')) NOT IN ('', 'triage_pending', 'received')
         )
       )
      THEN e.created_at
      ELSE NULL
    END) AS derived_triaged_at
  FROM ticket_lifecycle_events e
  GROUP BY e.tenant_id, e.ticket_id
) evidence
  ON evidence.tenant_id = t.tenant_id
 AND evidence.ticket_id = t.ticket_id
SET t.first_response_at = COALESCE(t.first_response_at, evidence.derived_first_response_at),
    t.triaged_at = COALESCE(t.triaged_at, evidence.derived_triaged_at)
WHERE (t.first_response_at IS NULL AND evidence.derived_first_response_at IS NOT NULL)
   OR (t.triaged_at IS NULL AND evidence.derived_triaged_at IS NOT NULL);

CREATE OR REPLACE TRIGGER trg_ticket_lifecycle_sla_milestones
AFTER INSERT ON ticket_lifecycle_events
FOR EACH ROW
UPDATE tickets
   SET first_response_at = CASE
         WHEN NEW.visibility = 'customer'
          AND NEW.event_type NOT IN ('ticket_created', 'dedupe_matched', 'queue_assigned')
          AND LOWER(COALESCE(NEW.actor_type, 'system')) NOT IN ('tenant_user', 'customer', 'user')
         THEN COALESCE(first_response_at, NEW.created_at)
         ELSE first_response_at
       END,
       triaged_at = CASE
         WHEN LOWER(COALESCE(NEW.actor_type, 'system')) NOT IN ('tenant_user', 'customer', 'user')
          AND (
            NEW.event_type IN ('triaged', 'ticket_triaged', 'assignee_changed', 'diagnostic_started')
            OR (
              NEW.event_type = 'state_transition'
              AND LOWER(COALESCE(NEW.to_state, '')) NOT IN ('', 'triage_pending', 'received')
            )
          )
         THEN COALESCE(triaged_at, NEW.created_at)
         ELSE triaged_at
       END
 WHERE tenant_id = NEW.tenant_id
   AND ticket_id = NEW.ticket_id;

UPDATE tickets t
JOIN (
  SELECT
    tenant_id,
    ticket_id,
    CASE
      WHEN first_response_at IS NULL AND first_response_due_at IS NOT NULL AND first_response_due_at < NOW() THEN 'breached'
      WHEN triaged_at IS NULL AND triage_due_at IS NOT NULL AND triage_due_at < NOW() THEN 'breached'
      WHEN resolution_due_at IS NOT NULL AND resolution_due_at < NOW() THEN 'breached'
      WHEN first_response_at IS NULL AND first_response_due_at IS NOT NULL AND first_response_due_at <= DATE_ADD(NOW(), INTERVAL 60 MINUTE) THEN 'warning'
      WHEN triaged_at IS NULL AND triage_due_at IS NOT NULL AND triage_due_at <= DATE_ADD(NOW(), INTERVAL 60 MINUTE) THEN 'warning'
      WHEN resolution_due_at IS NOT NULL AND resolution_due_at <= DATE_ADD(NOW(), INTERVAL 60 MINUTE) THEN 'warning'
      ELSE 'on_track'
    END AS computed_sla_status
  FROM tickets
  WHERE status IN ('open', 'in_review', 'awaiting_approval')
) computed
  ON computed.tenant_id = t.tenant_id
 AND computed.ticket_id = t.ticket_id
SET t.sla_status = computed.computed_sla_status
WHERE COALESCE(t.sla_status, '') <> computed.computed_sla_status;

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
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'support_ticket_dedupe_claims') AS dedupe_claim_table_count,
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
     AND (SELECT COUNT(*)
            FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'support_ticket_dedupe_claims') = 1
    THEN 'ready'
    ELSE 'blocked'
  END AS readiness_status,
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()
      AND TRIGGER_NAME = 'trg_ticket_lifecycle_sla_milestones') AS milestone_trigger_count,
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
