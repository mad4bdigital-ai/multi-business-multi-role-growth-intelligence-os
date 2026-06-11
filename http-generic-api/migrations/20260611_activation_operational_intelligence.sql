-- Activation Operational Intelligence
-- Purpose: convert activation from passive tabs into attention, actions, freshness, signals, graph, packs, preferences and fallback negotiation.
-- Secrets policy: no credentials, tokens, passwords, private keys, system prompts, or sensitive payloads are stored or returned by these registries.

CREATE TABLE IF NOT EXISTS activation_section_action_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  action_ref_key VARCHAR(180) NOT NULL UNIQUE,
  tab_key VARCHAR(160) NULL,
  section_key_like VARCHAR(180) NULL,
  provider_family VARCHAR(128) NULL,
  connector_family VARCHAR(128) NULL,
  source_table_like VARCHAR(180) NULL,
  runtime_action_key VARCHAR(255) NULL,
  endpoint_selector VARCHAR(255) NULL,
  label VARCHAR(220) NOT NULL,
  action_mode ENUM('read_only','advisory','draft_only','write_requires_confirmation','background_requires_native','blocked') NOT NULL DEFAULT 'read_only',
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  required_capability_key VARCHAR(180) NULL,
  fallback_prompt_template_key VARCHAR(180) NULL,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_section_action_tab (tab_key, status),
  INDEX idx_activation_section_action_provider (provider_family, connector_family, status),
  INDEX idx_activation_section_action_priority (priority_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_attention_rule_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_key VARCHAR(180) NOT NULL UNIQUE,
  display_name VARCHAR(220) NOT NULL,
  source_tab_key VARCHAR(160) NULL,
  source_section_key_like VARCHAR(180) NULL,
  source_table_like VARCHAR(180) NULL,
  provider_family VARCHAR(128) NULL,
  signal_field VARCHAR(128) NULL,
  signal_value_like VARCHAR(180) NULL,
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  reason_code VARCHAR(180) NOT NULL,
  recommended_action_key VARCHAR(255) NULL,
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_attention_source (source_tab_key, status),
  INDEX idx_activation_attention_provider (provider_family, status),
  INDEX idx_activation_attention_priority (priority_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_freshness_policy_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  policy_key VARCHAR(180) NOT NULL UNIQUE,
  surface_key_like VARCHAR(180) NULL,
  source_table_like VARCHAR(180) NULL,
  provider_family VARCHAR(128) NULL,
  connector_family VARCHAR(128) NULL,
  freshness_sla_seconds INT UNSIGNED NOT NULL DEFAULT 900,
  refresh_mode ENUM('platform_native','chatgpt_app_conversation','manual_prompt','webhook','polling','mixed') NOT NULL DEFAULT 'mixed',
  stale_severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_freshness_policy_provider (provider_family, connector_family, status),
  INDEX idx_activation_freshness_policy_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_freshness_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ledger_id VARCHAR(36) NOT NULL UNIQUE,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  container_key VARCHAR(220) NULL,
  surface_key VARCHAR(180) NULL,
  provider_family VARCHAR(128) NULL,
  connector_family VARCHAR(128) NULL,
  source_ref VARCHAR(255) NULL,
  freshness_status ENUM('fresh','stale','unknown','failed') NOT NULL DEFAULT 'unknown',
  last_checked_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_failure_at DATETIME NULL,
  evidence_summary_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_freshness_scope (tenant_id, user_id, container_key),
  INDEX idx_activation_freshness_surface (surface_key, provider_family, connector_family),
  INDEX idx_activation_freshness_status (freshness_status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_signal_subscription_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subscription_key VARCHAR(180) NOT NULL UNIQUE,
  provider_family VARCHAR(128) NOT NULL,
  connector_family VARCHAR(128) NULL,
  signal_type VARCHAR(180) NOT NULL,
  source_mode ENUM('webhook','polling','platform_event','chatgpt_conversation','manual_prompt','mixed') NOT NULL DEFAULT 'mixed',
  webhook_supported TINYINT(1) NOT NULL DEFAULT 0,
  polling_supported TINYINT(1) NOT NULL DEFAULT 1,
  min_poll_interval_seconds INT UNSIGNED NOT NULL DEFAULT 900,
  required_scope_json JSON NULL,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_signal_provider (provider_family, connector_family, status),
  INDEX idx_activation_signal_type (signal_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_signal_inbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  signal_id VARCHAR(36) NOT NULL UNIQUE,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  container_key VARCHAR(220) NULL,
  provider_family VARCHAR(128) NULL,
  connector_family VARCHAR(128) NULL,
  signal_type VARCHAR(180) NOT NULL,
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'info',
  signal_status ENUM('new','processing','processed','ignored','failed') NOT NULL DEFAULT 'new',
  payload_summary_json JSON NULL,
  source_ref VARCHAR(255) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_signal_inbox_scope (tenant_id, user_id, container_key),
  INDEX idx_activation_signal_inbox_provider (provider_family, connector_family, signal_type),
  INDEX idx_activation_signal_inbox_status (signal_status, severity, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_signal_processing_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  log_id VARCHAR(36) NOT NULL UNIQUE,
  signal_id VARCHAR(36) NOT NULL,
  processor_key VARCHAR(180) NOT NULL,
  processing_status ENUM('started','completed','failed','skipped') NOT NULL DEFAULT 'started',
  result_summary_json JSON NULL,
  error_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_signal_processing_signal (signal_id, processing_status),
  INDEX idx_activation_signal_processing_processor (processor_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_container_relationship_type_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  relationship_type VARCHAR(120) NOT NULL UNIQUE,
  display_name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  default_direction ENUM('directed','undirected') NOT NULL DEFAULT 'directed',
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_container_relationships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  relationship_id VARCHAR(36) NOT NULL UNIQUE,
  tenant_id VARCHAR(64) NULL,
  from_container_key VARCHAR(220) NOT NULL,
  to_container_key VARCHAR(220) NOT NULL,
  relationship_type VARCHAR(120) NOT NULL,
  source_surface VARCHAR(180) NULL,
  evidence_ref VARCHAR(255) NULL,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_relationship_scope (tenant_id, status),
  INDEX idx_activation_relationship_from (from_container_key, relationship_type),
  INDEX idx_activation_relationship_to (to_container_key, relationship_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_user_dashboard_preferences (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  preference_id VARCHAR(36) NOT NULL UNIQUE,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NOT NULL,
  preference_key VARCHAR(180) NOT NULL DEFAULT 'default_activation_dashboard',
  preferred_home_tab VARCHAR(160) NULL,
  pinned_containers_json JSON NULL,
  collapsed_tabs_json JSON NULL,
  hidden_sections_json JSON NULL,
  layout_json JSON NULL,
  status ENUM('active','pending','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_activation_user_pref (user_id, preference_key),
  INDEX idx_activation_user_pref_scope (tenant_id, user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_connector_pack_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pack_key VARCHAR(180) NOT NULL UNIQUE,
  provider_family VARCHAR(128) NOT NULL,
  connector_family VARCHAR(128) NULL,
  display_name VARCHAR(220) NOT NULL,
  description TEXT NULL,
  pack_category ENUM('cms','email','calendar','files','crm','ads','commerce','payments','devops','team_ops','analytics','custom') NOT NULL DEFAULT 'custom',
  default_scope_class ENUM('platform','tenant','user','brand','workspace','mixed') NOT NULL DEFAULT 'mixed',
  webhook_supported TINYINT(1) NOT NULL DEFAULT 0,
  polling_supported TINYINT(1) NOT NULL DEFAULT 1,
  chatgpt_app_fallback_supported TINYINT(1) NOT NULL DEFAULT 0,
  manual_fallback_supported TINYINT(1) NOT NULL DEFAULT 1,
  required_scopes_json JSON NULL,
  pack_status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_pack_provider (provider_family, connector_family, pack_status),
  INDEX idx_activation_pack_category (pack_category, pack_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_connector_pack_component_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  component_key VARCHAR(220) NOT NULL UNIQUE,
  pack_key VARCHAR(180) NOT NULL,
  component_type ENUM('tile','tab','callback','action','signal','freshness','fallback','risk_rule') NOT NULL,
  component_ref VARCHAR(220) NOT NULL,
  required TINYINT(1) NOT NULL DEFAULT 0,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_pack_component_pack (pack_key, component_type, status),
  CONSTRAINT fk_activation_pack_component_pack FOREIGN KEY (pack_key) REFERENCES activation_connector_pack_registry(pack_key) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO activation_connector_pack_registry
(pack_key, provider_family, connector_family, display_name, description, pack_category, default_scope_class, webhook_supported, polling_supported, chatgpt_app_fallback_supported, manual_fallback_supported, required_scopes_json, pack_status)
VALUES
('wordpress_operational_pack','wordpress','wordpress','WordPress Operational Pack','CMS/site operations pack for health, content, plugins, SEO, tasks and safe actions.','cms','brand',0,1,0,1,JSON_ARRAY('wp_rest_read','optional_app_password'),'active'),
('email_operational_pack','email','email','Email Operational Pack','Generic email operations for inbox awareness, followups, meeting requests and customer signals.','email','user',1,1,1,1,JSON_ARRAY('mail.read','mail.send_draft_optional'),'active'),
('gmail_operational_pack','gmail','gmail','Gmail Operational Pack','Gmail-specific operational awareness with platform OAuth or ChatGPT app fallback.','email','user',1,1,1,1,JSON_ARRAY('gmail.readonly','gmail.modify_optional'),'active'),
('outlook_operational_pack','outlook','outlook','Outlook Operational Pack','Microsoft Outlook mailbox awareness with platform OAuth or ChatGPT app fallback.','email','user',1,1,1,1,JSON_ARRAY('Mail.Read','Mail.Send_optional'),'active'),
('google_drive_knowledge_pack','google_drive','google_drive','Google Drive Knowledge Pack','Drive files, knowledge sources, freshness and evidence grounding.','files','user',1,1,1,1,JSON_ARRAY('drive.metadata.readonly','drive.readonly_optional'),'active'),
('google_calendar_schedule_pack','google_calendar','google_calendar','Google Calendar Schedule Pack','Calendar events, deadlines, schedule conflicts and operational follow-up windows.','calendar','user',1,1,1,1,JSON_ARRAY('calendar.readonly','calendar.events_optional'),'active'),
('github_devops_pack','github','github','GitHub DevOps Pack','Repository, PR, workflow, audit and engineering activity signals.','devops','workspace',1,1,1,1,JSON_ARRAY('repo_read','workflow_read','audit_log_optional'),'active'),
('hubspot_crm_pack','hubspot','hubspot','HubSpot CRM Pack','CRM contacts, deals, webhooks, followups and revenue/growth signals.','crm','tenant',1,1,0,1,JSON_ARRAY('crm.objects.contacts.read','crm.objects.deals.read','oauth'),'active'),
('ads_growth_pack','ads','ads','Ads Growth Pack','Ad account, campaign, spend and performance signals for growth operations.','ads','brand',1,1,0,1,JSON_ARRAY('ads_read','campaign_read'),'active'),
('shopify_commerce_pack','shopify','shopify','Shopify Commerce Pack','Store, order, product, inventory and commerce operations signals.','commerce','brand',1,1,0,1,JSON_ARRAY('read_products','read_orders','read_inventory'),'active'),
('stripe_revenue_pack','stripe','stripe','Stripe Revenue Pack','Revenue, payments, invoices, disputes and billing health signals.','payments','tenant',1,1,0,1,JSON_ARRAY('read_only_api_key_or_oauth'),'active'),
('slack_team_ops_pack','slack','slack','Slack Team Ops Pack','Team communication, alerts, mentions and workflow activity signals.','team_ops','workspace',1,1,1,1,JSON_ARRAY('channels:history','users:read','chat:write_optional'),'active')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), description=VALUES(description), pack_category=VALUES(pack_category), default_scope_class=VALUES(default_scope_class), webhook_supported=VALUES(webhook_supported), polling_supported=VALUES(polling_supported), chatgpt_app_fallback_supported=VALUES(chatgpt_app_fallback_supported), manual_fallback_supported=VALUES(manual_fallback_supported), required_scopes_json=VALUES(required_scopes_json), pack_status=VALUES(pack_status);

INSERT INTO activation_attention_rule_registry
(rule_key, display_name, source_tab_key, source_section_key_like, source_table_like, provider_family, signal_field, signal_value_like, severity, reason_code, recommended_action_key, requires_confirmation, priority_order, status)
VALUES
('attention_connector_error','Connector errors','container_connectors','%connector%','%connected_systems%',NULL,'status','error','high','connector_error','connector.reconnect_or_review',1,10,'active'),
('attention_connector_pending','Pending connectors','container_connectors','%connector%','%connected_systems%',NULL,'status','pending','medium','connector_pending','connector.complete_setup',0,20,'active'),
('attention_task_blocked','Blocked tasks','container_tasks','%tasks%','%task%','task','task_status','blocked','critical','task_blocked','task.review_blocker',0,30,'active'),
('attention_task_high_priority','High priority tasks','container_tasks','%tasks%','%task%','task','priority','high','high','high_priority_task','task.review_priority',0,40,'active'),
('attention_agent_degraded','Degraded agents','container_agents','%agent%','%agent%','agent','health_status','degraded','high','agent_degraded','agent.health_review',0,50,'active'),
('attention_agent_offline','Offline agents','container_agents','%agent%','%agent%','agent','health_status','offline','critical','agent_offline','agent.recover',1,60,'active'),
('attention_skill_requires_approval','Skills requiring approval','container_skills','%skill%','%skill%','skill','requires_approval','1','medium','skill_requires_approval','skill.review_approval',1,70,'active'),
('attention_freshness_stale','Stale operational evidence',NULL,NULL,NULL,NULL,'freshness_status','stale','medium','freshness_stale','surface.refresh',0,80,'active'),
('attention_signal_critical','Critical signals',NULL,NULL,NULL,NULL,'severity','critical','critical','critical_signal','signal.review',0,90,'active'),
('attention_manual_fallback','Manual fallback required',NULL,NULL,NULL,NULL,'status','manual_prompt_available','low','manual_fallback_available','fallback.collect_manual_snapshot',0,100,'active')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), source_tab_key=VALUES(source_tab_key), source_section_key_like=VALUES(source_section_key_like), source_table_like=VALUES(source_table_like), provider_family=VALUES(provider_family), signal_field=VALUES(signal_field), signal_value_like=VALUES(signal_value_like), severity=VALUES(severity), reason_code=VALUES(reason_code), recommended_action_key=VALUES(recommended_action_key), requires_confirmation=VALUES(requires_confirmation), priority_order=VALUES(priority_order), status=VALUES(status);
