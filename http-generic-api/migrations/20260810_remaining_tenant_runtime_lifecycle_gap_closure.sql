-- Remaining tenant runtime/lifecycle gap closure — 2026-08-10
-- Safety contract:
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- no_runtime_dispatch=true
-- no_live_tenant_repair=true
-- secrets_included=false
--
-- This migration registers read-only/reconciliation authority only. Stale CMS
-- grant revocation remains behind the explicit CMS reconciliation apply command.

INSERT INTO operational_alert_rule_registry
  (rule_key, source_type, condition_key, severity, reason_code,
   recommended_action_key, requires_confirmation, lookback_hours, dedupe_scope, status)
VALUES
  ('alert_support_ticket_escalated',
   'support_ticket',
   'resolution escalation evidence present',
   'high',
   'support_ticket_escalated',
   'support_ticket.review_resolution_case',
   0,
   720,
   'record',
   'active')
ON DUPLICATE KEY UPDATE
  source_type=VALUES(source_type),
  condition_key=VALUES(condition_key),
  severity=VALUES(severity),
  reason_code=VALUES(reason_code),
  recommended_action_key=VALUES(recommended_action_key),
  requires_confirmation=VALUES(requires_confirmation),
  lookback_hours=VALUES(lookback_hours),
  dedupe_scope=VALUES(dedupe_scope),
  status=VALUES(status),
  updated_at=CURRENT_TIMESTAMP;

-- WordPress exposes two intentionally distinct namespaces:
--   app-local connector actions -> app connection execution surface
--   canonical provider action    -> wordpress_api Platform Plugin action group
-- The adapter actions below MUST NOT be inserted as additional canonical
-- app_integration_action_bindings. This view gives diagnostics/generators an
-- explicit source of truth instead of inferring "missing binding".
CREATE OR REPLACE VIEW v_wordpress_action_surface_contract AS
SELECT
  'wordpress_rest' AS app_key,
  'wordpress_rest.validate_connection' AS operation_key,
  'app_connection_action' AS operation_surface,
  'wordpress_api' AS canonical_platform_action_key,
  0 AS platform_plugin_selector_allowed,
  0 AS will_mutate,
  0 AS secrets_included
UNION ALL
SELECT 'wordpress_rest','wordpress_rest.get_current_user','app_connection_action','wordpress_api',0,0,0
UNION ALL
SELECT 'wordpress_rest','wordpress_rest.read_users','app_connection_action','wordpress_api',0,0,0;

CREATE OR REPLACE VIEW v_wordpress_action_surface_reconciliation AS
SELECT
  c.app_key,
  c.operation_key,
  c.operation_surface,
  c.canonical_platform_action_key,
  c.platform_plugin_selector_allowed,
  (SELECT COUNT(*)
     FROM app_integration_action_bindings b
    WHERE b.app_key=c.app_key
      AND b.action_key=c.canonical_platform_action_key
      AND b.status='active') AS canonical_binding_count,
  (SELECT COUNT(*)
     FROM app_integration_action_bindings b
    WHERE b.app_key=c.app_key
      AND b.action_key=c.operation_key
      AND b.status='active') AS invalid_adapter_alias_binding_count,
  CASE
    WHEN (SELECT COUNT(*) FROM app_integration_action_bindings b
           WHERE b.app_key=c.app_key
             AND b.action_key=c.canonical_platform_action_key
             AND b.status='active') <> 1
      THEN 'canonical_wordpress_binding_missing_or_ambiguous'
    WHEN (SELECT COUNT(*) FROM app_integration_action_bindings b
           WHERE b.app_key=c.app_key
             AND b.action_key=c.operation_key
             AND b.status='active') <> 0
      THEN 'adapter_action_incorrectly_promoted_to_platform_action'
    ELSE 'pass'
  END AS reconciliation_status,
  0 AS secrets_included
FROM v_wordpress_action_surface_contract c;

CREATE OR REPLACE VIEW v_remaining_tenant_runtime_lifecycle_gap_readiness AS
SELECT
  'remaining_tenant_runtime_lifecycle_gap_closure' AS readiness_key,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM v_wordpress_action_surface_reconciliation
       WHERE reconciliation_status <> 'pass'
    ) THEN 'fail'
    ELSE 'pass'
  END AS readiness_status,
  (SELECT COUNT(*) FROM v_wordpress_action_surface_reconciliation) AS wordpress_surface_rows_checked,
  (SELECT COUNT(*) FROM v_wordpress_action_surface_reconciliation WHERE reconciliation_status <> 'pass') AS wordpress_surface_issue_count,
  0 AS provider_calls_made,
  0 AS external_writes_made,
  0 AS secrets_included;
