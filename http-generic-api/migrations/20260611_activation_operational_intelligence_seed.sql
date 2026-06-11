-- Activation Operational Intelligence Seed

INSERT INTO activation_section_action_registry
(action_ref_key, tab_key, section_key_like, provider_family, connector_family, source_table_like, runtime_action_key, endpoint_selector, label, action_mode, requires_confirmation, required_capability_key, fallback_prompt_template_key, priority_order, status)
VALUES
('wordpress_health_review','container_operational_tiles','%wordpress%','wordpress','wordpress',NULL,'wordpress_api','wp_root_health','Review WordPress health','read_only',0,NULL,'wordpress_health_manual_snapshot',10,'active'),
('wordpress_plugin_review','container_operational_tiles','%wordpress%','wordpress','wordpress',NULL,'wordpress_api','wp_plugin_theme_inventory','Review plugin/theme risks','read_only',0,NULL,'wordpress_plugins_manual_snapshot',20,'active'),
('wordpress_content_inventory','container_operational_tiles','%wordpress%','wordpress','wordpress',NULL,'wordpress_api','wp_v2_content_summary','Review content inventory','read_only',0,NULL,'wordpress_content_manual_snapshot',30,'active'),
('email_threads_summarize','container_operational_tiles','%email%','email','email',NULL,NULL,NULL,'Summarize priority threads','read_only',0,NULL,'email_threads_manual_snapshot',40,'active'),
('email_followup_draft','container_operational_tiles','%email%','email','email',NULL,NULL,NULL,'Draft follow-up replies','draft_only',0,NULL,'email_followups_manual_snapshot',50,'active'),
('email_send_confirmed','container_operational_tiles','%email%','email','email',NULL,NULL,NULL,'Send confirmed email reply','write_requires_confirmation',1,'email_send','email_followups_manual_snapshot',60,'active'),
('drive_source_refresh','container_knowledge','%drive%','google_drive','google_drive',NULL,NULL,NULL,'Refresh Drive knowledge sources','background_requires_native',0,'drive_read','google_drive_sources_manual_snapshot',70,'active'),
('calendar_conflict_review','container_operational_tiles','%calendar%','google_calendar','google_calendar',NULL,NULL,NULL,'Review schedule conflicts','read_only',0,NULL,'google_calendar_events_manual_snapshot',80,'active'),
('task_review_blockers','container_tasks','%tasks%','task','task','%task%','platform_tasks_review',NULL,'Review blockers and pending tasks','advisory',0,NULL,NULL,90,'active'),
('agent_health_review','container_agents','%agent%','agent','agent','%agent%','agent_health_review',NULL,'Review agent health','advisory',0,NULL,NULL,100,'active'),
('skill_approval_review','container_skills','%skill%','skill','skill','%skill%','skill_grant_review',NULL,'Review skill approvals','advisory',0,NULL,NULL,110,'active')
ON DUPLICATE KEY UPDATE tab_key=VALUES(tab_key), section_key_like=VALUES(section_key_like), provider_family=VALUES(provider_family), connector_family=VALUES(connector_family), source_table_like=VALUES(source_table_like), runtime_action_key=VALUES(runtime_action_key), endpoint_selector=VALUES(endpoint_selector), label=VALUES(label), action_mode=VALUES(action_mode), requires_confirmation=VALUES(requires_confirmation), required_capability_key=VALUES(required_capability_key), fallback_prompt_template_key=VALUES(fallback_prompt_template_key), priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO activation_freshness_policy_registry
(policy_key, surface_key_like, source_table_like, provider_family, connector_family, freshness_sla_seconds, refresh_mode, stale_severity, status)
VALUES
('freshness_wordpress_15m','%wordpress%',NULL,'wordpress','wordpress',900,'polling','medium','active'),
('freshness_email_10m','%email%',NULL,'email','email',600,'mixed','medium','active'),
('freshness_gmail_10m','%gmail%',NULL,'gmail','gmail',600,'mixed','medium','active'),
('freshness_outlook_10m','%outlook%',NULL,'outlook','outlook',600,'mixed','medium','active'),
('freshness_drive_30m','%drive%',NULL,'google_drive','google_drive',1800,'mixed','low','active'),
('freshness_calendar_10m','%calendar%',NULL,'google_calendar','google_calendar',600,'mixed','low','active'),
('freshness_github_5m','%github%',NULL,'github','github',300,'webhook','medium','active'),
('freshness_crm_15m','%crm%',NULL,'hubspot','hubspot',900,'webhook','medium','active'),
('freshness_ads_30m','%ads%',NULL,'ads','ads',1800,'polling','medium','active'),
('freshness_tasks_5m','%task%',NULL,'task','task',300,'platform_native','high','active'),
('freshness_default_30m','%',NULL,NULL,NULL,1800,'mixed','low','active')
ON DUPLICATE KEY UPDATE surface_key_like=VALUES(surface_key_like), source_table_like=VALUES(source_table_like), provider_family=VALUES(provider_family), connector_family=VALUES(connector_family), freshness_sla_seconds=VALUES(freshness_sla_seconds), refresh_mode=VALUES(refresh_mode), stale_severity=VALUES(stale_severity), status=VALUES(status);

INSERT INTO activation_signal_subscription_registry
(subscription_key, provider_family, connector_family, signal_type, source_mode, webhook_supported, polling_supported, min_poll_interval_seconds, required_scope_json, status)
VALUES
('wordpress_health_poll','wordpress','wordpress','site_health','polling',0,1,900,JSON_ARRAY('wp_rest_read'),'active'),
('wordpress_content_poll','wordpress','wordpress','content_changed','polling',0,1,1800,JSON_ARRAY('wp_rest_read'),'active'),
('gmail_message_event','gmail','gmail','message_activity','mixed',1,1,600,JSON_ARRAY('gmail.readonly'),'active'),
('outlook_message_event','outlook','outlook','message_activity','mixed',1,1,600,JSON_ARRAY('Mail.Read'),'active'),
('drive_file_change','google_drive','google_drive','file_changed','mixed',1,1,1800,JSON_ARRAY('drive.metadata.readonly'),'active'),
('calendar_event_change','google_calendar','google_calendar','event_changed','mixed',1,1,600,JSON_ARRAY('calendar.readonly'),'active'),
('github_repo_event','github','github','repo_activity','webhook',1,1,300,JSON_ARRAY('repo_read'),'active'),
('hubspot_crm_event','hubspot','hubspot','crm_activity','webhook',1,1,900,JSON_ARRAY('crm.objects.contacts.read'),'active'),
('ads_performance_poll','ads','ads','campaign_performance','polling',0,1,1800,JSON_ARRAY('ads_read'),'active'),
('shopify_order_event','shopify','shopify','order_activity','webhook',1,1,900,JSON_ARRAY('read_orders'),'active'),
('stripe_revenue_event','stripe','stripe','revenue_activity','webhook',1,1,900,JSON_ARRAY('read_only_api_key_or_oauth'),'active'),
('slack_team_event','slack','slack','team_activity','mixed',1,1,600,JSON_ARRAY('channels:history'),'active')
ON DUPLICATE KEY UPDATE source_mode=VALUES(source_mode), webhook_supported=VALUES(webhook_supported), polling_supported=VALUES(polling_supported), min_poll_interval_seconds=VALUES(min_poll_interval_seconds), required_scope_json=VALUES(required_scope_json), status=VALUES(status);

INSERT INTO activation_container_relationship_type_registry
(relationship_type, display_name, description, default_direction, status)
VALUES
('workspace_owns_brand','Workspace owns/links brand','Workspace or platform owner container links to a brand control state.','directed','active'),
('brand_uses_connector','Brand uses connector','Brand or workspace uses an external connected system/provider.','directed','active'),
('agent_has_skill','Agent has skill','Agent is granted or associated with a skill.','directed','active'),
('task_blocks_container','Task blocks container','A pending or blocked task affects a workspace, tenant, user or brand container.','directed','active'),
('evidence_supports_action','Evidence supports action','Evidence or signal supports a recommended action.','directed','active'),
('connector_emits_signal','Connector emits signal','Connected provider emits operational signals into activation.','directed','active')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), description=VALUES(description), default_direction=VALUES(default_direction), status=VALUES(status);

INSERT INTO activation_connector_pack_component_registry
(component_key, pack_key, component_type, component_ref, required, priority_order, status)
VALUES
('wordpress_pack_tile','wordpress_operational_pack','tile','wordpress_site_status',1,10,'active'),
('wordpress_pack_health','wordpress_operational_pack','callback','wordpress.health.read',1,20,'active'),
('wordpress_pack_plugins','wordpress_operational_pack','callback','wordpress.plugins.status',0,30,'active'),
('wordpress_pack_actions','wordpress_operational_pack','action','wordpress_health_review',0,40,'active'),
('email_pack_tile','email_operational_pack','tile','email_operational_inbox',1,10,'active'),
('email_pack_followups','email_operational_pack','action','email_followup_draft',0,20,'active'),
('gmail_pack_tile','gmail_operational_pack','tile','gmail_operational_inbox',1,10,'active'),
('outlook_pack_tile','outlook_operational_pack','tile','outlook_operational_inbox',1,10,'active'),
('drive_pack_tile','google_drive_knowledge_pack','tile','google_drive_knowledge_sources',1,10,'active'),
('calendar_pack_tile','google_calendar_schedule_pack','tile','google_calendar_operational_schedule',1,10,'active'),
('github_pack_signal','github_devops_pack','signal','github_repo_event',0,10,'active'),
('hubspot_pack_signal','hubspot_crm_pack','signal','hubspot_crm_event',0,10,'active'),
('ads_pack_signal','ads_growth_pack','signal','ads_performance_poll',0,10,'active'),
('shopify_pack_signal','shopify_commerce_pack','signal','shopify_order_event',0,10,'active'),
('stripe_pack_signal','stripe_revenue_pack','signal','stripe_revenue_event',0,10,'active'),
('slack_pack_signal','slack_team_ops_pack','signal','slack_team_event',0,10,'active')
ON DUPLICATE KEY UPDATE pack_key=VALUES(pack_key), component_type=VALUES(component_type), component_ref=VALUES(component_ref), required=VALUES(required), priority_order=VALUES(priority_order), status=VALUES(status);
