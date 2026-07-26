-- Sprint 68: External delivery admin control surface
-- Purpose: operational views and admin tools for live external delivery overview, DB allowlist management,
-- adapter dispatch controls, and Gmail OAuth revocation. Additive/no secrets/no sends.

CREATE OR REPLACE VIEW `v_external_delivery_admin_overview` AS
SELECT
  a.adapter_key,
  a.family_key,
  a.channel,
  a.implementation_status,
  a.dispatch_enabled,
  a.provider_dispatch_enabled,
  a.required_credential_type,
  a.status,
  JSON_UNQUOTE(JSON_EXTRACT(a.safety_json, '$.runtime')) AS runtime,
  JSON_UNQUOTE(JSON_EXTRACT(a.safety_json, '$.live_send_enabled_by_default')) AS live_send_enabled_by_default,
  JSON_UNQUOTE(JSON_EXTRACT(a.safety_json, '$.canary_enabled')) AS canary_enabled,
  COALESCE(SUM(CASE WHEN e.event_type = 'external_send_provider_dispatch_succeeded' THEN 1 ELSE 0 END), 0) AS successful_send_events,
  MAX(CASE WHEN e.event_type = 'external_send_provider_dispatch_succeeded' THEN e.created_at ELSE NULL END) AS last_successful_send_at,
  0 AS secret_value_included,
  0 AS secrets_included,
  a.updated_at
FROM external_delivery_provider_adapter_contract_registry a
LEFT JOIN ticket_lifecycle_events e
  ON JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.provider_result.adapter_key')) = a.adapter_key
WHERE a.channel IN ('email','webhook')
GROUP BY a.adapter_key, a.family_key, a.channel, a.implementation_status, a.dispatch_enabled,
         a.provider_dispatch_enabled, a.required_credential_type, a.status, runtime,
         live_send_enabled_by_default, canary_enabled, a.updated_at;

CREATE OR REPLACE VIEW `v_external_delivery_recent_send_events` AS
SELECT
  e.event_id,
  e.ticket_id,
  e.tenant_id,
  e.summary,
  JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.provider_result.adapter_key')) AS adapter_key,
  JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.provider_result.runtime')) AS runtime,
  JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.provider_result.provider_status')) AS provider_status,
  JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.provider_result.provider_message_id')) AS provider_message_id,
  JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.idempotency_key')) AS idempotency_key,
  JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.external_send_performed')) AS external_send_performed,
  JSON_UNQUOTE(JSON_EXTRACT(e.payload_json, '$.secrets_included')) AS secrets_included,
  e.created_at
FROM ticket_lifecycle_events e
WHERE e.event_type = 'external_send_provider_dispatch_succeeded';

CREATE OR REPLACE VIEW `v_external_delivery_gmail_connections` AS
SELECT
  connection_id,
  user_id,
  tenant_id,
  app_key,
  account_label,
  status,
  validation_status,
  scopes_granted,
  is_primary,
  connected_at,
  last_used_at,
  0 AS secret_value_included,
  0 AS secrets_included
FROM user_app_connections
WHERE app_key IN ('gmail_user_oauth','google_cloud','gmail','gmail_api')
   OR scopes_granted LIKE '%gmail.send%';

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order, created_at, updated_at)
VALUES
  ('external_delivery_control_overview',
   'External Delivery Control Overview',
   'Read-only overview of external delivery adapters, dynamic allowlist rows, Gmail OAuth connections, recent send events, and pending blockers. No secrets and no external send.',
   'GET', '/admin/support/tickets/external-delivery/control/overview', JSON_ARRAY(),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100))),
   NULL, 'admin,support,tickets,external_delivery,control,overview,read_only,no_secrets,no_external_send', 1, 10200, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('external_delivery_allowlist_upsert',
   'External Delivery Allowlist Upsert',
   'Create or reactivate a DB-backed dynamic recipient allowlist row. Does not send externally and stores no secrets.',
   'POST', '/admin/support/tickets/external-delivery/control/allowlist/upsert', JSON_ARRAY(),
   JSON_OBJECT('type','object','required',JSON_ARRAY('recipient_pattern'),'properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'adapter_key',JSON_OBJECT('type','string'),'channel',JSON_OBJECT('type','string'),'match_type',JSON_OBJECT('type','string'),'recipient_pattern',JSON_OBJECT('type','string'),'approval_hold_id',JSON_OBJECT('type','string'),'reason',JSON_OBJECT('type','string'),'expires_at',JSON_OBJECT('type','string'))),
   NULL, 'admin,support,tickets,external_delivery,allowlist,upsert,no_secrets,no_external_send', 1, 10201, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('external_delivery_allowlist_disable',
   'External Delivery Allowlist Disable',
   'Disable a DB-backed dynamic recipient allowlist row by id or scoped recipient pattern. Does not delete audit history.',
   'POST', '/admin/support/tickets/external-delivery/control/allowlist/disable', JSON_ARRAY(),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('allowlist_id',JSON_OBJECT('type','string'),'tenant_id',JSON_OBJECT('type','string'),'adapter_key',JSON_OBJECT('type','string'),'recipient_pattern',JSON_OBJECT('type','string'),'reason',JSON_OBJECT('type','string'))),
   NULL, 'admin,support,tickets,external_delivery,allowlist,disable,revoke,no_secrets,no_external_send', 1, 10202, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('external_delivery_adapter_dispatch_set',
   'External Delivery Adapter Dispatch Set',
   'Set adapter dispatch flags. Intended for controlled enable/disable with live gates still enforced by provider policy.',
   'POST', '/admin/support/tickets/external-delivery/control/adapter/dispatch', JSON_ARRAY(),
   JSON_OBJECT('type','object','required',JSON_ARRAY('adapter_key'),'properties',JSON_OBJECT('adapter_key',JSON_OBJECT('type','string'),'dispatch_enabled',JSON_OBJECT('type','boolean'),'provider_dispatch_enabled',JSON_OBJECT('type','boolean'),'reason',JSON_OBJECT('type','string'))),
   NULL, 'admin,support,tickets,external_delivery,adapter,dispatch,set,disable,enable,no_secrets,no_external_send_by_itself', 1, 10203, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('external_delivery_gmail_connection_revoke',
   'External Delivery Gmail Connection Revoke',
   'Revoke a Gmail OAuth user_app_connection used for Support Ticket live delivery. Does not expose tokens.',
   'POST', '/admin/support/tickets/external-delivery/control/gmail/revoke', JSON_ARRAY(),
   JSON_OBJECT('type','object','required',JSON_ARRAY('connection_id'),'properties',JSON_OBJECT('connection_id',JSON_OBJECT('type','string'),'reason',JSON_OBJECT('type','string'))),
   NULL, 'admin,support,tickets,external_delivery,gmail,oauth,revoke,no_secrets,no_external_send', 1, 10204, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method), http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order), updated_at=CURRENT_TIMESTAMP;

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  ('Support Ticket External Delivery Governance', 'support_ticket_external_delivery_admin_control_surface_policy_v1',
   JSON_OBJECT(
     'control_surface', true,
     'readback_views', JSON_ARRAY('v_external_delivery_admin_overview','v_external_delivery_recent_send_events','v_external_delivery_gmail_connections'),
     'mutations', JSON_ARRAY('allowlist_upsert','allowlist_disable','adapter_dispatch_set','gmail_connection_revoke'),
     'no_raw_secret_response', true,
     'external_send_performed_by_controls', false,
     'live_send_requires_provider_gate_attempt', true,
     'secret_value_included', false,
     'secrets_included', false
   ),
   'TRUE', 'support_ticket_external_delivery_admin_control_surface',
   'supportTicketExternalDeliveryAdminControlService|supportTicketRoutes|external_delivery_*|user_app_connections',
   'TRUE', 'External delivery admin controls expose readback and gated enable/disable operations without raw secrets or direct send side effects.')
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
