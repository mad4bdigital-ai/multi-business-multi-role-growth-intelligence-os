-- Sprint 66: Credential intake webhook outbox
-- Adds a governed outbound webhook delivery queue for credential_intake.completed.
-- Payloads are metadata-only and explicitly exclude submitted credentials/secrets.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  delivery_id VARCHAR(36) NOT NULL,
  webhook_id VARCHAR(36) NULL,
  tenant_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  payload_json JSON NOT NULL,
  status ENUM('queued','delivered','failed','skipped') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  response_status INT NULL,
  last_error VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  delivered_at DATETIME NULL,
  UNIQUE KEY uq_webhook_deliveries_delivery_id (delivery_id),
  KEY idx_webhook_deliveries_status_created (status, created_at),
  KEY idx_webhook_deliveries_tenant_event (tenant_id, event_type),
  KEY idx_webhook_deliveries_webhook (webhook_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_tool_registry (
  tool_key, display_name, description, http_method, http_path,
  input_schema, tags, is_enabled, sort_order
) VALUES (
  'webhook_delivery_dispatch',
  'Webhook Delivery Dispatch',
  'Dispatch queued outbound webhook deliveries from the governed webhook outbox. Payloads are metadata-only and exclude secrets.',
  'POST',
  '/admin/control',
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','webhook_delivery_dispatch'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',2)
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  'admin,webhook,delivery,outbox,dispatcher,no_secrets,ssrf_guard,rate_limited,built_in_shell_alias',
  1,
  226
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
