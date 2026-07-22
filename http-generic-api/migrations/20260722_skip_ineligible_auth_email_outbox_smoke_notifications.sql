-- Mark ineligible queued support-ticket admin notifications as skipped before enabling any delivery worker.
-- This migration is intentionally guarded: it only targets queued support_ticket_admin_notification rows
-- that are linked to missing, closed, resolved, cancelled, or smoke-test support tickets.
UPDATE auth_email_outbox e
LEFT JOIN tickets t
  ON t.ticket_id = JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.ticket_id'))
SET e.status = 'skipped',
    e.last_error = CASE
      WHEN JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.smoke_test')) = 'true'
        OR JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.internal_smoke')) = 'true'
        THEN 'smoke_test_notification'
      WHEN JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.ticket_id')) IS NOT NULL
        AND t.ticket_id IS NULL
        THEN 'ticket_not_found'
      ELSE 'ticket_not_open'
    END,
    e.metadata_json = JSON_SET(
      COALESCE(e.metadata_json, JSON_OBJECT()),
      '$.skip_reason',
      CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.smoke_test')) = 'true'
          OR JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.internal_smoke')) = 'true'
          THEN 'smoke_test_notification'
        WHEN JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.ticket_id')) IS NOT NULL
          AND t.ticket_id IS NULL
          THEN 'ticket_not_found'
        ELSE 'ticket_not_open'
      END,
      '$.skipped_by', '20260722_skip_ineligible_auth_email_outbox_smoke_notifications',
      '$.external_send_performed', CAST('false' AS JSON),
      '$.secrets_included', CAST('false' AS JSON)
    )
WHERE e.purpose = 'support_ticket_admin_notification'
  AND e.status = 'queued'
  AND (
    JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.smoke_test')) = 'true'
    OR JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.internal_smoke')) = 'true'
    OR (
      JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.ticket_id')) IS NOT NULL
      AND t.ticket_id IS NULL
    )
    OR LOWER(COALESCE(t.status, '')) IN ('closed', 'resolved', 'cancelled', 'canceled')
    OR LOWER(COALESCE(t.lifecycle_state, '')) IN ('closed', 'resolved', 'cancelled', 'canceled')
    OR LOWER(COALESCE(t.customer_status, '')) IN ('closed', 'resolved', 'cancelled', 'canceled')
  );
