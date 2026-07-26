-- Sprint 68: External Delivery policy scope/readiness alignment
-- Purpose:
--   Persist the policy metadata alignment required by release readiness after promoting
--   External Delivery to first-class orchestration readback.
-- Safety:
--   Idempotent execution_policies metadata UPDATE only. No provider calls. No external send. No secrets.

UPDATE execution_policies
   SET execution_scope = CASE
         WHEN execution_scope LIKE '%no_external_send%' THEN execution_scope
         ELSE CONCAT(execution_scope, '|no_external_send')
       END,
       affects_layer = CASE
         WHEN affects_layer LIKE '%v_platform_orchestration_external_delivery_readiness%' THEN affects_layer
         ELSE CONCAT(affects_layer, '|v_platform_orchestration_external_delivery_readiness')
       END
 WHERE policy_key = 'support_ticket_external_delivery_orchestration_readback_policy_v1';
