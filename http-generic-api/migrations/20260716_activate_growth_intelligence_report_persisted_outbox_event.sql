-- Promote only the validated Growth Intelligence outbox event contract from draft to active.
-- This migration does not wire a producer, create events, enable a consumer, configure delivery,
-- or change any endpoint, credential, transport, or feature flag.

UPDATE platform_outbox_event_types
   SET status = 'active',
       updated_at = CURRENT_TIMESTAMP(6)
 WHERE event_type = 'growth_intelligence.report_persisted'
   AND current_schema_version = 1
   AND producer_key = 'growth_intelligence_registry'
   AND payload_classification = 'internal'
   AND contains_pii = 0
   AND status = 'draft';
