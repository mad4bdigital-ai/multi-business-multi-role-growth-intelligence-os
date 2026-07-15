-- Register the first controlled Growth Intelligence outbox contract in draft state.
-- This migration does not wire a producer, create events, enable a consumer, or permit delivery.

INSERT INTO platform_outbox_event_types (
  event_type,
  current_schema_version,
  producer_key,
  payload_classification,
  contains_pii,
  status,
  description
) VALUES (
  'growth_intelligence.report_persisted',
  1,
  'growth_intelligence_registry',
  'internal',
  0,
  'draft',
  'Emitted only after a Growth Intelligence report and its internal workflow records are committed in one transaction. Payload contains identifiers, status, and aggregate counts only; no report body, insight text, action text, user identity, credentials, tokens, or secrets.'
)
ON DUPLICATE KEY UPDATE
  current_schema_version = GREATEST(current_schema_version, VALUES(current_schema_version)),
  producer_key = VALUES(producer_key),
  payload_classification = VALUES(payload_classification),
  contains_pii = VALUES(contains_pii),
  description = VALUES(description),
  status = CASE
    WHEN status IN ('active','paused','retired') THEN status
    ELSE 'draft'
  END,
  updated_at = CURRENT_TIMESTAMP(6);
