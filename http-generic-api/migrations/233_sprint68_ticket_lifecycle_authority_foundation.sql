-- Sprint 68: Ticket Lifecycle Authority foundation
-- Generalizes ticket creation across tenant/admin/runtime layers as governed work envelopes.
-- Idempotent, additive, no destructive changes, no secrets.

ALTER TABLE `tickets`
  ADD COLUMN IF NOT EXISTS `ticket_type` VARCHAR(128) NULL AFTER `title`,
  ADD COLUMN IF NOT EXISTS `source_layer` VARCHAR(64) NULL AFTER `service_mode`,
  ADD COLUMN IF NOT EXISTS `source_tool` VARCHAR(128) NULL AFTER `source_layer`,
  ADD COLUMN IF NOT EXISTS `source_event` VARCHAR(128) NULL AFTER `source_tool`,
  ADD COLUMN IF NOT EXISTS `severity` ENUM('sev4','sev3','sev2','sev1') NOT NULL DEFAULT 'sev3' AFTER `priority`,
  ADD COLUMN IF NOT EXISTS `lifecycle_state` VARCHAR(64) NOT NULL DEFAULT 'intake_received' AFTER `status`,
  ADD COLUMN IF NOT EXISTS `customer_status` VARCHAR(64) NOT NULL DEFAULT 'received' AFTER `lifecycle_state`,
  ADD COLUMN IF NOT EXISTS `queue_key` VARCHAR(128) NULL AFTER `customer_status`,
  ADD COLUMN IF NOT EXISTS `assignment_status` VARCHAR(64) NOT NULL DEFAULT 'unassigned' AFTER `assigned_to`,
  ADD COLUMN IF NOT EXISTS `assigned_actor_type` VARCHAR(64) NULL AFTER `assignment_status`,
  ADD COLUMN IF NOT EXISTS `user_id` VARCHAR(36) NULL AFTER `tenant_id`,
  ADD COLUMN IF NOT EXISTS `actor_id` VARCHAR(64) NULL AFTER `user_id`,
  ADD COLUMN IF NOT EXISTS `actor_type` VARCHAR(64) NULL AFTER `actor_id`,
  ADD COLUMN IF NOT EXISTS `dedupe_key` VARCHAR(255) NULL AFTER `metadata_json`,
  ADD COLUMN IF NOT EXISTS `first_response_due_at` DATETIME NULL AFTER `dedupe_key`,
  ADD COLUMN IF NOT EXISTS `triage_due_at` DATETIME NULL AFTER `first_response_due_at`,
  ADD COLUMN IF NOT EXISTS `resolution_due_at` DATETIME NULL AFTER `triage_due_at`,
  ADD COLUMN IF NOT EXISTS `sla_status` VARCHAR(32) NOT NULL DEFAULT 'on_track' AFTER `resolution_due_at`,
  ADD COLUMN IF NOT EXISTS `last_seen_at` DATETIME NULL AFTER `sla_status`,
  ADD COLUMN IF NOT EXISTS `occurrence_count` INT NOT NULL DEFAULT 1 AFTER `last_seen_at`,
  ADD COLUMN IF NOT EXISTS `customer_message` TEXT NULL AFTER `occurrence_count`,
  ADD COLUMN IF NOT EXISTS `internal_summary` TEXT NULL AFTER `customer_message`,
  ADD INDEX IF NOT EXISTS `idx_ticket_dedupe_open` (`tenant_id`, `dedupe_key`, `status`),
  ADD INDEX IF NOT EXISTS `idx_ticket_lifecycle_state` (`tenant_id`, `lifecycle_state`),
  ADD INDEX IF NOT EXISTS `idx_ticket_queue` (`tenant_id`, `queue_key`, `assignment_status`),
  ADD INDEX IF NOT EXISTS `idx_ticket_type` (`tenant_id`, `ticket_type`),
  ADD INDEX IF NOT EXISTS `idx_ticket_user` (`tenant_id`, `user_id`);

CREATE TABLE IF NOT EXISTS `ticket_lifecycle_events` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` VARCHAR(36) NOT NULL,
  `ticket_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `from_state` VARCHAR(64) NULL,
  `to_state` VARCHAR(64) NULL,
  `actor_id` VARCHAR(64) NULL,
  `actor_type` VARCHAR(64) NULL,
  `visibility` ENUM('customer','tenant_admin','internal_support','platform_engineering','security','system_only') NOT NULL DEFAULT 'internal_support',
  `summary` VARCHAR(512) NULL,
  `payload_json` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_lifecycle_event_id` (`event_id`),
  KEY `idx_ticket_lifecycle_ticket` (`ticket_id`),
  KEY `idx_ticket_lifecycle_tenant` (`tenant_id`),
  KEY `idx_ticket_lifecycle_type` (`event_type`),
  KEY `idx_ticket_lifecycle_visibility` (`ticket_id`, `visibility`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `ticket_resource_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `link_id` VARCHAR(36) NOT NULL,
  `ticket_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_ref` VARCHAR(191) NULL,
  `relationship` VARCHAR(64) NOT NULL DEFAULT 'subject',
  `visibility` ENUM('customer','tenant_admin','internal_support','platform_engineering','security','system_only') NOT NULL DEFAULT 'internal_support',
  `evidence_json` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_resource_link_id` (`link_id`),
  KEY `idx_ticket_resource_ticket` (`ticket_id`),
  KEY `idx_ticket_resource_lookup` (`tenant_id`, `resource_type`, `resource_ref`),
  KEY `idx_ticket_resource_visibility` (`ticket_id`, `visibility`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `ticket_permission_snapshots` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id` VARCHAR(36) NOT NULL,
  `ticket_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NULL,
  `actor_type` VARCHAR(64) NULL,
  `role_at_creation` VARCHAR(64) NULL,
  `requested_action` VARCHAR(128) NULL,
  `resource_type` VARCHAR(64) NULL,
  `resource_ref` VARCHAR(191) NULL,
  `access_decision` VARCHAR(64) NULL,
  `authority_source` VARCHAR(128) NULL,
  `snapshot_json` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_permission_snapshot_id` (`snapshot_id`),
  KEY `idx_ticket_permission_ticket` (`ticket_id`),
  KEY `idx_ticket_permission_tenant_user` (`tenant_id`, `user_id`),
  KEY `idx_ticket_permission_resource` (`tenant_id`, `resource_type`, `resource_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `ticket_workflow_links` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `link_id` VARCHAR(36) NOT NULL,
  `ticket_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `plan_id` VARCHAR(36) NULL,
  `run_id` VARCHAR(36) NULL,
  `approval_hold_id` VARCHAR(36) NULL,
  `relationship` VARCHAR(64) NOT NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'linked',
  `evidence_json` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ticket_workflow_link_id` (`link_id`),
  KEY `idx_ticket_workflow_ticket` (`ticket_id`),
  KEY `idx_ticket_workflow_run` (`run_id`),
  KEY `idx_ticket_workflow_plan` (`plan_id`),
  KEY `idx_ticket_workflow_approval` (`approval_hold_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

INSERT INTO `tenant_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_create',
  'Support Ticket Create',
  'Create or append a customer-safe governed support work envelope for the signed-in tenant user. Dedupe is enforced server-side.',
  'POST',
  '/me/support/tickets',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'title',JSON_OBJECT('type','string'),
      'ticket_type',JSON_OBJECT('type','string'),
      'source_event',JSON_OBJECT('type','string'),
      'priority',JSON_OBJECT('type','string','enum',JSON_ARRAY('low','normal','high','urgent')),
      'severity',JSON_OBJECT('type','string','enum',JSON_ARRAY('sev4','sev3','sev2','sev1')),
      'customer_message',JSON_OBJECT('type','string'),
      'resource_type',JSON_OBJECT('type','string'),
      'resource_ref',JSON_OBJECT('type','string'),
      'metadata_json',JSON_OBJECT('type','object')
    ),
    'required',JSON_ARRAY('title'),
    'additionalProperties',true
  ),
  NULL,
  'tenant,support,tickets,lifecycle,customer_safe,dedupe,no_secrets',
  1,
  330
),
(
  'support_ticket_list',
  'Support Ticket List',
  'List customer-safe support tickets visible to the signed-in tenant user.',
  'GET',
  '/me/support/tickets',
  JSON_ARRAY(),
  JSON_OBJECT('type','object','properties',JSON_OBJECT('status',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer')),'additionalProperties',false),
  NULL,
  'tenant,support,tickets,read_only,customer_safe,no_secrets',
  1,
  331
),
(
  'support_ticket_get',
  'Support Ticket Get',
  'Read one customer-safe support ticket and customer-visible lifecycle events.',
  'GET',
  '/me/support/tickets/{ticket_id}',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT('type','object','properties',JSON_OBJECT('ticket_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('ticket_id'),'additionalProperties',false),
  NULL,
  'tenant,support,tickets,read_only,customer_safe,no_secrets',
  1,
  332
),
(
  'support_ticket_event_append',
  'Support Ticket Event Append',
  'Append a customer-visible reply or safe note to an existing tenant support ticket.',
  'POST',
  '/me/support/tickets/{ticket_id}/events',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT('type','object','properties',JSON_OBJECT('ticket_id',JSON_OBJECT('type','string'),'summary',JSON_OBJECT('type','string'),'event_type',JSON_OBJECT('type','string'),'payload_json',JSON_OBJECT('type','object')),'required',JSON_ARRAY('ticket_id','summary'),'additionalProperties',false),
  NULL,
  'tenant,support,tickets,lifecycle,customer_safe,no_secrets',
  1,
  333
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method), http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'support_ticket_admin_list',
  'Support Ticket Admin List',
  'Admin list of governed support work envelopes across tenants with queue/status filters.',
  'GET',
  '/admin/support/tickets',
  JSON_ARRAY(),
  JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'status',JSON_OBJECT('type','string'),'queue_key',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer')),'additionalProperties',false),
  NULL,
  'admin,support,tickets,lifecycle,read_only,no_secrets',
  1,
  430
),
(
  'support_ticket_admin_get',
  'Support Ticket Admin Get',
  'Admin read of a governed support work envelope including internal lifecycle events.',
  'GET',
  '/admin/support/tickets/{ticket_id}',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT('type','object','properties',JSON_OBJECT('ticket_id',JSON_OBJECT('type','string'),'tenant_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('ticket_id'),'additionalProperties',false),
  NULL,
  'admin,support,tickets,lifecycle,read_only,no_secrets',
  1,
  431
),
(
  'support_ticket_transition',
  'Support Ticket Transition',
  'Transition a support ticket lifecycle/status with internal evidence.',
  'POST',
  '/admin/support/tickets/{ticket_id}/transition',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT('type','object','properties',JSON_OBJECT('ticket_id',JSON_OBJECT('type','string'),'tenant_id',JSON_OBJECT('type','string'),'to_state',JSON_OBJECT('type','string'),'status',JSON_OBJECT('type','string'),'customer_status',JSON_OBJECT('type','string'),'reason',JSON_OBJECT('type','string'),'evidence_json',JSON_OBJECT('type','object')),'required',JSON_ARRAY('ticket_id','to_state'),'additionalProperties',false),
  NULL,
  'admin,support,tickets,lifecycle,mutation,no_secrets',
  1,
  432
),
(
  'support_ticket_assign',
  'Support Ticket Assign',
  'Assign or queue a support ticket work envelope.',
  'POST',
  '/admin/support/tickets/{ticket_id}/assign',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT('type','object','properties',JSON_OBJECT('ticket_id',JSON_OBJECT('type','string'),'tenant_id',JSON_OBJECT('type','string'),'queue_key',JSON_OBJECT('type','string'),'assigned_to',JSON_OBJECT('type','string'),'assigned_actor_type',JSON_OBJECT('type','string'),'reason',JSON_OBJECT('type','string')),'required',JSON_ARRAY('ticket_id'),'additionalProperties',false),
  NULL,
  'admin,support,tickets,assignment,mutation,no_secrets',
  1,
  433
),
(
  'support_ticket_admin_event_append',
  'Support Ticket Admin Event Append',
  'Append an internal or customer-visible lifecycle event to a support ticket.',
  'POST',
  '/admin/support/tickets/{ticket_id}/events',
  JSON_ARRAY('ticket_id'),
  JSON_OBJECT('type','object','properties',JSON_OBJECT('ticket_id',JSON_OBJECT('type','string'),'tenant_id',JSON_OBJECT('type','string'),'event_type',JSON_OBJECT('type','string'),'visibility',JSON_OBJECT('type','string'),'summary',JSON_OBJECT('type','string'),'payload_json',JSON_OBJECT('type','object')),'required',JSON_ARRAY('ticket_id','summary'),'additionalProperties',false),
  NULL,
  'admin,support,tickets,lifecycle,mutation,no_secrets',
  1,
  434
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method), http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
