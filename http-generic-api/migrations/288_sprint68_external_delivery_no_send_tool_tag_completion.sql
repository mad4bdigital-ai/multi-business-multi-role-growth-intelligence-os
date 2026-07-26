-- Sprint 68: External Delivery no-send tool tag completion
-- Purpose:
--   Persist the no-send tag alignment required by the External Delivery orchestration graph.
--   support_ticket_external_credential_candidates is read-only/no_raw_secrets and participates
--   in the no-send graph, so it must carry no_external_send consistently with every other
--   support_ticket_external* tool.
-- Safety:
--   Idempotent metadata UPDATE only. No provider calls. No external send. No secrets.

UPDATE admin_platform_endpoint_tools
   SET tags = CASE
       WHEN tags IS NULL OR tags = '' THEN 'no_external_send'
       WHEN tags NOT LIKE '%no_external_send%' THEN CONCAT(tags, ',no_external_send')
       ELSE tags
     END,
     updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'support_ticket_external_credential_candidates'
   AND (tags IS NULL OR tags NOT LIKE '%no_external_send%');
