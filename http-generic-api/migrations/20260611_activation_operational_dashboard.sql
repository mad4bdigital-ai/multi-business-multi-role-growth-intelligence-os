-- Activation Operational Dashboard Registry
-- Purpose: make activation return adaptive operational awareness tiles and callbacks.
-- Secrets policy: no credential values, tokens, passwords, or private keys are stored here.

CREATE TABLE IF NOT EXISTS activation_operational_tile_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tile_key VARCHAR(160) NOT NULL UNIQUE,
  provider_family VARCHAR(128) NOT NULL,
  connector_family VARCHAR(128) NULL,
  scope_class ENUM('platform','tenant','user','brand','device','mixed') NOT NULL DEFAULT 'mixed',
  display_name VARCHAR(200) NULL,
  description TEXT NULL,
  category VARCHAR(96) NULL,
  default_visibility ENUM('admin_only','owner_and_admin','tenant_members','user_private','public_status') NOT NULL DEFAULT 'owner_and_admin',
  source_mode ENUM('platform_native','chatgpt_app_fallback','manual_prompt','mixed') NOT NULL DEFAULT 'mixed',
  status_callback_key VARCHAR(160) NULL,
  freshness_sla_seconds INT UNSIGNED NOT NULL DEFAULT 900,
  priority_order INT NOT NULL DEFAULT 100,
  risk_level ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_tile_provider (provider_family, connector_family),
  INDEX idx_activation_tile_scope_status (scope_class, status),
  INDEX idx_activation_tile_priority (priority_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_callback_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  callback_key VARCHAR(160) NOT NULL UNIQUE,
  tile_key VARCHAR(160) NOT NULL,
  provider_family VARCHAR(128) NOT NULL,
  connector_family VARCHAR(128) NULL,
  intent_key VARCHAR(160) NULL,
  runtime_action_key VARCHAR(255) NULL,
  endpoint_selector VARCHAR(255) NULL,
  safe_mode ENUM('read_only','advisory','write_requires_confirmation','destructive_blocked') NOT NULL DEFAULT 'read_only',
  allowed_sources_json JSON NULL,
  output_contract_json JSON NULL,
  fallback_prompt_template_key VARCHAR(160) NULL,
  freshness_sla_seconds INT UNSIGNED NOT NULL DEFAULT 900,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_callback_tile (tile_key, status),
  INDEX idx_activation_callback_provider (provider_family, connector_family),
  INDEX idx_activation_callback_runtime_action (runtime_action_key),
  CONSTRAINT fk_activation_callback_tile FOREIGN KEY (tile_key) REFERENCES activation_operational_tile_registry(tile_key) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_auth_source_router (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider_family VARCHAR(128) NOT NULL,
  connector_family VARCHAR(128) NULL,
  capability_key VARCHAR(160) NOT NULL DEFAULT '*',
  source_order_json JSON NOT NULL,
  background_allowed_sources_json JSON NULL,
  conversation_allowed_sources_json JSON NULL,
  write_allowed_sources_json JSON NULL,
  fallback_policy_json JSON NULL,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_activation_auth_router (provider_family, connector_family, capability_key),
  INDEX idx_activation_auth_router_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO activation_operational_tile_registry
(tile_key, provider_family, connector_family, scope_class, display_name, description, category, default_visibility, source_mode, status_callback_key, freshness_sla_seconds, priority_order, risk_level, status)
VALUES
('wordpress_site_status','wordpress','wordpress','brand','WordPress Operational Dashboard','Read-only operational status for a connected WordPress brand/site, including health, content, plugins, SEO and pending actions.','site_operations','owner_and_admin','mixed','wordpress.health.read',900,20,'medium','active'),
('email_operational_inbox','email','email','user','Email Operational Inbox','User-scoped inbox awareness for follow-ups, customer signals, meeting requests and priority threads.','communications','user_private','mixed','email.recent_threads.summary',600,30,'medium','active'),
('gmail_operational_inbox','gmail','gmail','user','Gmail Operational Inbox','Gmail-specific inbox awareness using platform OAuth when available, ChatGPT app fallback when connected, or prompt-guided fallback.','communications','user_private','mixed','gmail.recent_threads.summary',600,31,'medium','active'),
('outlook_operational_inbox','outlook','outlook','user','Outlook Operational Inbox','Outlook/Microsoft mailbox awareness using platform OAuth when available, ChatGPT app fallback when connected, or prompt-guided fallback.','communications','user_private','mixed','outlook.recent_threads.summary',600,32,'medium','active'),
('google_drive_knowledge_sources','google_drive','google_drive','user','Google Drive Knowledge Sources','User or tenant-scoped Drive awareness for recent files, source freshness and knowledge evidence.','knowledge_sources','user_private','mixed','google_drive.recent_sources.summary',1800,40,'low','active'),
('google_calendar_operational_schedule','google_calendar','google_calendar','user','Google Calendar Operational Schedule','Calendar awareness for upcoming meetings, deadlines, blockers and schedule-derived operational signals.','schedule','user_private','mixed','google_calendar.upcoming_events.summary',600,41,'low','active')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), category=VALUES(category), default_visibility=VALUES(default_visibility), source_mode=VALUES(source_mode), status_callback_key=VALUES(status_callback_key), freshness_sla_seconds=VALUES(freshness_sla_seconds), priority_order=VALUES(priority_order), risk_level=VALUES(risk_level), status=VALUES(status);

INSERT INTO activation_callback_registry
(callback_key, tile_key, provider_family, connector_family, intent_key, runtime_action_key, endpoint_selector, safe_mode, allowed_sources_json, output_contract_json, fallback_prompt_template_key, freshness_sla_seconds, priority_order, status)
VALUES
('wordpress.health.read','wordpress_site_status','wordpress','wordpress','status_probe','wordpress_api','wp_root_health','read_only',JSON_ARRAY('platform_native_connection','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('site_url','wp_version','auth_status','rest_api_status','last_checked_at','warnings')),'wordpress_health_manual_snapshot',900,10,'active'),
('wordpress.content.inventory','wordpress_site_status','wordpress','wordpress','content_inventory','wordpress_api','wp_v2_content_summary','read_only',JSON_ARRAY('platform_native_connection','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('posts','pages','custom_post_types','drafts','recent_changes')),'wordpress_content_manual_snapshot',1800,20,'active'),
('wordpress.plugins.status','wordpress_site_status','wordpress','wordpress','plugin_theme_inventory','wordpress_api','wp_plugin_theme_inventory','read_only',JSON_ARRAY('platform_native_connection','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('plugins','themes','active_theme','update_indicators','risk_flags')),'wordpress_plugins_manual_snapshot',1800,30,'active'),
('wordpress.seo.status','wordpress_site_status','wordpress','wordpress','seo_operational_snapshot','wordpress_api','wp_seo_snapshot','read_only',JSON_ARRAY('platform_native_connection','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('seo_plugin','indexed_content_signals','metadata_coverage','sitemap_status','schema_status')),'wordpress_seo_manual_snapshot',3600,40,'active'),
('wordpress.pending_actions','wordpress_site_status','wordpress','wordpress','recommended_next_actions',NULL,NULL,'advisory',JSON_ARRAY('platform_native_connection','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('priority','recommendation','source_evidence','requires_confirmation')),'wordpress_pending_actions_manual_snapshot',900,50,'active'),
('email.recent_threads.summary','email_operational_inbox','email','email','recent_threads_summary',NULL,NULL,'read_only',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('priority_threads','unanswered_threads','customer_signals','last_checked_at')),'email_threads_manual_snapshot',600,10,'active'),
('email.followups.detect','email_operational_inbox','email','email','followup_detection',NULL,NULL,'advisory',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('followups','overdue_items','suggested_replies','requires_confirmation')),'email_followups_manual_snapshot',600,20,'active'),
('email.meeting_requests.detect','email_operational_inbox','email','email','meeting_request_detection',NULL,NULL,'read_only',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('meeting_requests','dates','participants','calendar_conflicts')),'email_meeting_requests_manual_snapshot',600,30,'active'),
('email.customer_signals.extract','email_operational_inbox','email','email','customer_signal_extraction',NULL,NULL,'advisory',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('leads','complaints','opportunities','sentiment','source_threads')),'email_customer_signals_manual_snapshot',900,40,'active'),
('gmail.recent_threads.summary','gmail_operational_inbox','gmail','gmail','recent_threads_summary',NULL,NULL,'read_only',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('priority_threads','unanswered_threads','customer_signals','last_checked_at')),'gmail_threads_manual_snapshot',600,10,'active'),
('outlook.recent_threads.summary','outlook_operational_inbox','outlook','outlook','recent_threads_summary',NULL,NULL,'read_only',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('priority_threads','unanswered_threads','customer_signals','last_checked_at')),'outlook_threads_manual_snapshot',600,10,'active'),
('google_drive.recent_sources.summary','google_drive_knowledge_sources','google_drive','google_drive','recent_knowledge_sources',NULL,NULL,'read_only',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('recent_files','source_freshness','missing_sources','knowledge_gaps')),'google_drive_sources_manual_snapshot',1800,10,'active'),
('google_calendar.upcoming_events.summary','google_calendar_operational_schedule','google_calendar','google_calendar','upcoming_events_summary',NULL,NULL,'read_only',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_OBJECT('returns',JSON_ARRAY('upcoming_events','deadlines','conflicts','followup_windows')),'google_calendar_events_manual_snapshot',600,10,'active')
ON DUPLICATE KEY UPDATE
  tile_key=VALUES(tile_key), provider_family=VALUES(provider_family), connector_family=VALUES(connector_family), intent_key=VALUES(intent_key), runtime_action_key=VALUES(runtime_action_key), endpoint_selector=VALUES(endpoint_selector), safe_mode=VALUES(safe_mode), allowed_sources_json=VALUES(allowed_sources_json), output_contract_json=VALUES(output_contract_json), fallback_prompt_template_key=VALUES(fallback_prompt_template_key), freshness_sla_seconds=VALUES(freshness_sla_seconds), priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO activation_auth_source_router
(provider_family, connector_family, capability_key, source_order_json, background_allowed_sources_json, conversation_allowed_sources_json, write_allowed_sources_json, fallback_policy_json, status)
VALUES
('wordpress','wordpress','*',JSON_ARRAY('platform_native_connection','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_connection'),JSON_ARRAY('platform_native_connection','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_connection'),JSON_OBJECT('when_unconnected','return_prompt_guided_tile','write_requires','platform_connection_and_confirmation','background_requires','platform_native_connection'),'active'),
('email','email','*',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_OBJECT('when_unconnected','return_chatgpt_app_or_manual_fallback','write_requires','explicit_user_confirmation','background_requires','platform_native_oauth'),'active'),
('gmail','gmail','*',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_OBJECT('chatgpt_app_name','Gmail','when_unconnected','suggest_connect_gmail_app_or_platform_oauth','write_requires','explicit_user_confirmation','background_requires','platform_native_oauth'),'active'),
('outlook','outlook','*',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_OBJECT('chatgpt_app_name','Outlook','when_unconnected','suggest_connect_outlook_app_or_platform_oauth','write_requires','explicit_user_confirmation','background_requires','platform_native_oauth'),'active'),
('google_drive','google_drive','*',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_OBJECT('chatgpt_app_name','Google Drive','when_unconnected','suggest_connect_drive_app_or_platform_oauth','background_requires','platform_native_oauth'),'active'),
('google_calendar','google_calendar','*',JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_ARRAY('platform_native_oauth','chatgpt_user_app','manual_prompt'),JSON_ARRAY('platform_native_oauth'),JSON_OBJECT('chatgpt_app_name','Google Calendar','when_unconnected','suggest_connect_calendar_app_or_platform_oauth','write_requires','explicit_user_confirmation','background_requires','platform_native_oauth'),'active')
ON DUPLICATE KEY UPDATE
  source_order_json=VALUES(source_order_json), background_allowed_sources_json=VALUES(background_allowed_sources_json), conversation_allowed_sources_json=VALUES(conversation_allowed_sources_json), write_allowed_sources_json=VALUES(write_allowed_sources_json), fallback_policy_json=VALUES(fallback_policy_json), status=VALUES(status);
