-- Tenant Growth Dashboard product layer.
-- Adds customer-facing Dynamic Tabs, typed metric/card metadata, preference state,
-- recommendation feedback, instruction profiles, and governed growth actions.

ALTER TABLE activation_dynamic_tab_registry
  ADD COLUMN IF NOT EXISTS icon_key varchar(128) NULL AFTER description,
  ADD COLUMN IF NOT EXISTS mobile_label varchar(120) NULL AFTER icon_key,
  ADD COLUMN IF NOT EXISTS renderer_key varchar(160) NULL AFTER mobile_label,
  ADD COLUMN IF NOT EXISTS default_pinned tinyint(1) NOT NULL DEFAULT 0 AFTER renderer_key,
  ADD COLUMN IF NOT EXISTS business_type_filters_json longtext NULL AFTER default_pinned,
  ADD COLUMN IF NOT EXISTS business_activity_filters_json longtext NULL AFTER business_type_filters_json,
  ADD COLUMN IF NOT EXISTS goal_tags_json longtext NULL AFTER business_activity_filters_json,
  ADD COLUMN IF NOT EXISTS empty_state_template_key varchar(180) NULL AFTER goal_tags_json,
  ADD COLUMN IF NOT EXISTS instruction_template_key varchar(180) NULL AFTER empty_state_template_key,
  ADD COLUMN IF NOT EXISTS mobile_priority int NOT NULL DEFAULT 100 AFTER instruction_template_key;

ALTER TABLE activation_dynamic_tab_section_registry
  ADD COLUMN IF NOT EXISTS card_type varchar(80) NULL AFTER aggregation_mode,
  ADD COLUMN IF NOT EXISTS metric_definition_key varchar(180) NULL AFTER card_type,
  ADD COLUMN IF NOT EXISTS default_filters_json longtext NULL AFTER metric_definition_key,
  ADD COLUMN IF NOT EXISTS default_sort_json longtext NULL AFTER default_filters_json,
  ADD COLUMN IF NOT EXISTS interpretation_template_key varchar(180) NULL AFTER default_sort_json,
  ADD COLUMN IF NOT EXISTS empty_state_template_key varchar(180) NULL AFTER interpretation_template_key,
  ADD COLUMN IF NOT EXISTS growth_signal_key varchar(180) NULL AFTER empty_state_template_key,
  ADD COLUMN IF NOT EXISTS mobile_layout_json longtext NULL AFTER growth_signal_key;

ALTER TABLE activation_section_action_registry
  ADD COLUMN IF NOT EXISTS input_schema_json longtext NULL AFTER fallback_prompt_template_key,
  ADD COLUMN IF NOT EXISTS preview_template_key varchar(180) NULL AFTER input_schema_json,
  ADD COLUMN IF NOT EXISTS confirmation_template_key varchar(180) NULL AFTER preview_template_key,
  ADD COLUMN IF NOT EXISTS success_readback_tool_key varchar(180) NULL AFTER confirmation_template_key,
  ADD COLUMN IF NOT EXISTS failure_recovery_key varchar(180) NULL AFTER success_readback_tool_key,
  ADD COLUMN IF NOT EXISTS undo_action_key varchar(180) NULL AFTER failure_recovery_key,
  ADD COLUMN IF NOT EXISTS expected_impact_metric_key varchar(180) NULL AFTER undo_action_key,
  ADD COLUMN IF NOT EXISTS analytics_event_key varchar(180) NULL AFTER expected_impact_metric_key,
  ADD COLUMN IF NOT EXISTS mobile_action_style varchar(80) NULL AFTER analytics_event_key;

CREATE TABLE IF NOT EXISTS tenant_dynamic_dashboard_preferences (
  preference_id varchar(36) NOT NULL,
  tenant_id varchar(36) NOT NULL,
  user_id varchar(64) NOT NULL,
  active_container_key varchar(220) NULL,
  active_tab_key varchar(160) NULL,
  pinned_tabs_json longtext NULL,
  hidden_tabs_json longtext NULL,
  preferred_date_range varchar(80) NOT NULL DEFAULT 'last_30_days',
  saved_filters_json longtext NULL,
  dismissed_alerts_json longtext NULL,
  favorite_metrics_json longtext NULL,
  dashboard_density enum('compact','comfortable','detailed') NOT NULL DEFAULT 'comfortable',
  language varchar(32) NULL,
  currency varchar(16) NULL,
  timezone varchar(80) NULL,
  notification_preferences_json longtext NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (preference_id),
  UNIQUE KEY uq_tenant_dashboard_preference (tenant_id, user_id),
  KEY idx_tenant_dashboard_active (tenant_id, active_container_key, active_tab_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_growth_recommendation_events (
  event_id varchar(36) NOT NULL,
  tenant_id varchar(36) NOT NULL,
  user_id varchar(64) NOT NULL,
  workspace_id varchar(36) NULL,
  recommendation_id varchar(180) NOT NULL,
  recommendation_key varchar(180) NULL,
  tab_key varchar(160) NULL,
  card_id varchar(180) NULL,
  event_type enum('shown','opened','accepted','dismissed','executed','failed','result_observed') NOT NULL,
  reason_code varchar(120) NULL,
  result_metric_key varchar(180) NULL,
  result_value_json longtext NULL,
  context_json longtext NULL,
  occurred_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (event_id),
  KEY idx_growth_recommendation_subject (tenant_id, user_id, occurred_at),
  KEY idx_growth_recommendation_item (recommendation_id, event_type, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS growth_dashboard_metric_registry (
  metric_key varchar(180) NOT NULL,
  display_name varchar(220) NOT NULL,
  description text NULL,
  unit varchar(60) NOT NULL DEFAULT 'count',
  aggregation_mode varchar(60) NOT NULL DEFAULT 'sum',
  comparison_mode varchar(80) NULL,
  source_surface varchar(180) NULL,
  freshness_sla_seconds int unsigned NULL,
  interpretation_template_key varchar(180) NULL,
  status enum('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (metric_key),
  KEY idx_growth_metric_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS growth_dashboard_tab_profile_registry (
  profile_key varchar(180) NOT NULL,
  business_type_key varchar(255) NULL,
  business_activity_type_key varchar(255) NULL,
  tab_key varchar(160) NOT NULL,
  priority_order int NOT NULL DEFAULT 100,
  default_pinned tinyint(1) NOT NULL DEFAULT 0,
  goal_tags_json longtext NULL,
  status enum('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (profile_key, tab_key),
  KEY idx_growth_tab_profile_match (business_type_key, business_activity_type_key, status, priority_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS growth_dashboard_instruction_registry (
  instruction_key varchar(180) NOT NULL,
  business_type_key varchar(255) NULL,
  business_activity_type_key varchar(255) NULL,
  goal_key varchar(180) NULL,
  headline varchar(500) NOT NULL,
  guidance_template text NOT NULL,
  quick_commands_json longtext NULL,
  empty_state_actions_json longtext NULL,
  priority_order int NOT NULL DEFAULT 100,
  status enum('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (instruction_key),
  KEY idx_growth_instruction_match (business_type_key, business_activity_type_key, goal_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO growth_dashboard_metric_registry
(metric_key, display_name, description, unit, aggregation_mode, comparison_mode, source_surface, freshness_sla_seconds, interpretation_template_key, status)
VALUES
('dashboard_health_score','Business Growth Readiness','Composite readiness across brand, data, integrations, tasks, and freshness.','score','weighted_score','previous_period','tenant_growth_dashboard',3600,'growth_readiness_interpretation','active'),
('connected_systems_active','Active Integrations','Connected systems currently ready for use.','count','count','previous_period','connected_systems',900,'integration_readiness_interpretation','active'),
('open_tasks','Open Tasks','Open platform and growth tasks requiring attention.','count','count','previous_period','v_activation_pending_tasks',300,'task_load_interpretation','active'),
('blocked_tasks','Blocked Tasks','Tasks blocked by permissions, missing data, or dependencies.','count','count','previous_period','v_activation_pending_tasks',300,'blocked_task_interpretation','active'),
('active_agents','Active Agents','Agents available to support the tenant.','count','count','previous_period','v_activation_agent_catalog',900,'agent_readiness_interpretation','active'),
('active_skill_grants','Active Skills','Authorized agent skills available to the tenant.','count','count','previous_period','v_activation_agent_skill_grants',900,'skill_readiness_interpretation','active'),
('data_freshness_score','Data Freshness','Freshness of connected operational and growth data.','score','weighted_score','previous_period','activation_freshness_ledger',300,'freshness_interpretation','active'),
('growth_opportunities','Growth Opportunities','Prioritized opportunities detected from signals, gaps, and business context.','count','count','previous_period','activation_signal_inbox',300,'growth_opportunity_interpretation','active')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), unit=VALUES(unit), aggregation_mode=VALUES(aggregation_mode),
 comparison_mode=VALUES(comparison_mode), source_surface=VALUES(source_surface), freshness_sla_seconds=VALUES(freshness_sla_seconds),
 interpretation_template_key=VALUES(interpretation_template_key), status='active';

INSERT INTO activation_dynamic_tab_registry
(tab_key, display_name, description, icon_key, mobile_label, renderer_key, default_pinned,
 business_type_filters_json, business_activity_filters_json, goal_tags_json,
 empty_state_template_key, instruction_template_key, mobile_priority,
 tab_group, container_scope, default_visibility, priority_order, status)
VALUES
('tenant_today','Today','Daily growth cockpit with changes, opportunities, risks, and next actions.','sparkles','Today','growth_dashboard_today',1,NULL,NULL,'["grow_revenue","increase_leads","increase_bookings"]','today_empty_state','tenant_growth_copilot',1,'overview','tenant','tenant_members',1,'active'),
('tenant_growth_plan','Growth Plan','Prioritized growth goals, experiments, and progress.','target','Plan','growth_dashboard_plan',1,NULL,NULL,'["grow_revenue","expand_market"]','growth_plan_empty_state','tenant_growth_copilot',10,'custom','tenant','tenant_members',10,'active'),
('tenant_customers_leads','Customers & Leads','Lead acquisition, qualification, follow-up, and customer signals.','users','Leads','growth_dashboard_leads',0,NULL,NULL,'["increase_leads","improve_conversion"]','leads_empty_state','tenant_growth_copilot',20,'custom','tenant','tenant_members',20,'active'),
('tenant_sales_bookings','Sales & Bookings','Pipeline, proposals, bookings, conversion, and revenue activity.','chart-line','Sales','growth_dashboard_sales',1,NULL,NULL,'["grow_revenue","increase_bookings"]','sales_empty_state','tenant_growth_copilot',30,'custom','tenant','tenant_members',30,'active'),
('tenant_content_seo','Content & SEO','Organic visibility, content opportunities, and website growth.','search','SEO','growth_dashboard_content',0,NULL,NULL,'["increase_visibility","organic_growth"]','content_empty_state','tenant_growth_copilot',40,'knowledge','tenant','tenant_members',40,'active'),
('tenant_campaigns','Campaigns','Campaign performance, audience, creative, and budget recommendations.','megaphone','Campaigns','growth_dashboard_campaigns',0,NULL,NULL,'["increase_leads","grow_revenue"]','campaigns_empty_state','tenant_growth_copilot',50,'custom','tenant','tenant_members',50,'active'),
('tenant_reputation','Reputation','Reviews, customer feedback, sentiment, and response opportunities.','star','Reviews','growth_dashboard_reputation',0,NULL,NULL,'["improve_reputation","retention"]','reputation_empty_state','tenant_growth_copilot',60,'custom','tenant','tenant_members',60,'active'),
('tenant_tasks','Tasks','Growth tasks, approvals, blockers, and ownership.','check-square','Tasks','growth_dashboard_tasks',0,NULL,NULL,'["execution"]','tasks_empty_state','tenant_growth_copilot',70,'tasks','tenant','tenant_members',70,'active'),
('tenant_operations','Operations','Operational health, readiness, automations, and service quality.','activity','Operations','growth_dashboard_operations',0,NULL,NULL,'["efficiency","quality"]','operations_empty_state','tenant_growth_copilot',80,'operations','tenant','tenant_members',80,'active'),
('tenant_integrations','Integrations','Connected systems, data readiness, permissions, and setup guidance.','plug','Integrations','growth_dashboard_integrations',0,NULL,NULL,'["data_readiness"]','integrations_empty_state','tenant_growth_copilot',90,'integrations','tenant','tenant_members',90,'active'),
('tenant_knowledge_brand','Knowledge & Brand','Brand Core, business knowledge, assets, and source readiness.','book-open','Brand','growth_dashboard_knowledge',0,NULL,NULL,'["brand_readiness"]','knowledge_empty_state','tenant_growth_copilot',100,'knowledge','tenant','tenant_members',100,'active'),
('tenant_reports','Reports','Saved views, performance summaries, and decision-ready reports.','file-chart','Reports','growth_dashboard_reports',0,NULL,NULL,'["reporting"]','reports_empty_state','tenant_growth_copilot',110,'operations','tenant','tenant_members',110,'active')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), icon_key=VALUES(icon_key), mobile_label=VALUES(mobile_label),
 renderer_key=VALUES(renderer_key), default_pinned=VALUES(default_pinned), goal_tags_json=VALUES(goal_tags_json),
 empty_state_template_key=VALUES(empty_state_template_key), instruction_template_key=VALUES(instruction_template_key),
 mobile_priority=VALUES(mobile_priority), tab_group=VALUES(tab_group), container_scope=VALUES(container_scope),
 default_visibility=VALUES(default_visibility), priority_order=VALUES(priority_order), status='active';

INSERT INTO growth_dashboard_tab_profile_registry
(profile_key, business_type_key, business_activity_type_key, tab_key, priority_order, default_pinned, goal_tags_json, status)
VALUES
('default','general_business',NULL,'tenant_today',1,1,'["all"]','active'),
('default','general_business',NULL,'tenant_growth_plan',10,1,'["all"]','active'),
('default','general_business',NULL,'tenant_customers_leads',20,0,'["increase_leads"]','active'),
('default','general_business',NULL,'tenant_sales_bookings',30,1,'["grow_revenue"]','active'),
('default','general_business',NULL,'tenant_content_seo',40,0,'["organic_growth"]','active'),
('default','general_business',NULL,'tenant_campaigns',50,0,'["increase_leads"]','active'),
('default','general_business',NULL,'tenant_tasks',70,0,'["execution"]','active'),
('default','general_business',NULL,'tenant_operations',80,0,'["efficiency"]','active'),
('default','general_business',NULL,'tenant_integrations',90,0,'["data_readiness"]','active'),
('default','general_business',NULL,'tenant_knowledge_brand',100,0,'["brand_readiness"]','active'),
('travel','destination_or_travel_business',NULL,'tenant_today',1,1,'["all"]','active'),
('travel','destination_or_travel_business',NULL,'tenant_sales_bookings',10,1,'["increase_bookings"]','active'),
('travel','destination_or_travel_business',NULL,'tenant_customers_leads',20,0,'["increase_leads"]','active'),
('travel','destination_or_travel_business',NULL,'tenant_content_seo',30,0,'["destinations","organic_growth"]','active'),
('travel','destination_or_travel_business',NULL,'tenant_campaigns',40,0,'["increase_bookings"]','active'),
('travel','destination_or_travel_business',NULL,'tenant_reputation',50,0,'["improve_reputation"]','active'),
('travel','destination_or_travel_business',NULL,'tenant_tasks',70,0,'["execution"]','active'),
('travel','destination_or_travel_business',NULL,'tenant_operations',80,0,'["quality"]','active'),
('travel','destination_or_travel_business',NULL,'tenant_integrations',90,0,'["data_readiness"]','active'),
('b2b_services','expert_service_firm',NULL,'tenant_today',1,1,'["all"]','active'),
('b2b_services','expert_service_firm',NULL,'tenant_customers_leads',10,1,'["increase_leads"]','active'),
('b2b_services','expert_service_firm',NULL,'tenant_sales_bookings',20,1,'["pipeline","proposals"]','active'),
('b2b_services','expert_service_firm',NULL,'tenant_content_seo',30,0,'["authority","organic_growth"]','active'),
('b2b_services','expert_service_firm',NULL,'tenant_campaigns',40,0,'["demand_generation"]','active'),
('b2b_services','expert_service_firm',NULL,'tenant_tasks',70,0,'["execution"]','active'),
('b2b_services','expert_service_firm',NULL,'tenant_operations',80,0,'["efficiency"]','active'),
('b2b_services','expert_service_firm',NULL,'tenant_integrations',90,0,'["data_readiness"]','active'),
('b2b_products','b2b_product_supplier',NULL,'tenant_today',1,1,'["all"]','active'),
('b2b_products','b2b_product_supplier',NULL,'tenant_customers_leads',10,1,'["increase_leads"]','active'),
('b2b_products','b2b_product_supplier',NULL,'tenant_sales_bookings',20,1,'["grow_revenue"]','active'),
('b2b_products','b2b_product_supplier',NULL,'tenant_content_seo',30,0,'["product_visibility"]','active'),
('b2b_products','b2b_product_supplier',NULL,'tenant_campaigns',40,0,'["demand_generation"]','active'),
('b2b_products','b2b_product_supplier',NULL,'tenant_tasks',70,0,'["execution"]','active'),
('b2b_products','b2b_product_supplier',NULL,'tenant_operations',80,0,'["quality"]','active'),
('b2b_products','b2b_product_supplier',NULL,'tenant_integrations',90,0,'["data_readiness"]','active')
ON DUPLICATE KEY UPDATE
 business_type_key=VALUES(business_type_key), business_activity_type_key=VALUES(business_activity_type_key),
 priority_order=VALUES(priority_order), default_pinned=VALUES(default_pinned), goal_tags_json=VALUES(goal_tags_json), status='active';

INSERT INTO growth_dashboard_instruction_registry
(instruction_key, business_type_key, business_activity_type_key, goal_key, headline, guidance_template, quick_commands_json, empty_state_actions_json, priority_order, status)
VALUES
('tenant_growth_generic',NULL,NULL,NULL,'Your growth cockpit is ready.','Translate platform data into business outcomes, prioritize the highest-impact next action, explain which platform capability can help, and keep technical registry names out of customer-facing guidance.','["Show today''s growth opportunities","Create this week''s growth plan","Review tasks and blockers","Show what the platform can do for my business"]','["Complete business profile","Connect a data source","Choose a growth goal"]',100,'active'),
('tenant_growth_travel','destination_or_travel_business',NULL,NULL,'Turn demand into more direct bookings.','Prioritize destination demand, package conversion, lead follow-up, reviews, seasonality, and direct-booking opportunities. Explain recommendations in booking and revenue language.','["Show booking opportunities","Review destinations losing visibility","Find leads needing follow-up","Create a package growth plan"]','["Add destinations and packages","Connect website analytics","Connect booking or lead source"]',10,'active'),
('tenant_growth_b2b_services','expert_service_firm',NULL,NULL,'Build a stronger and more predictable pipeline.','Prioritize qualified lead generation, follow-up, proposals, authority content, account opportunities, and pipeline movement.','["Review qualified leads","Find stalled opportunities","Create a follow-up plan","Build an authority content plan"]','["Define ideal customer profile","Connect CRM or lead source","Add services and proof points"]',20,'active'),
('tenant_growth_b2b_products','b2b_product_supplier',NULL,NULL,'Create more product demand and sales opportunities.','Prioritize product visibility, account targeting, inquiries, distributor or buyer follow-up, commercial content, and conversion friction.','["Find product demand opportunities","Review inquiries needing follow-up","Create a product content plan","Review sales blockers"]','["Add product categories","Connect inquiry sources","Define target buyer segments"]',30,'active')
ON DUPLICATE KEY UPDATE
 business_type_key=VALUES(business_type_key), business_activity_type_key=VALUES(business_activity_type_key), goal_key=VALUES(goal_key),
 headline=VALUES(headline), guidance_template=VALUES(guidance_template), quick_commands_json=VALUES(quick_commands_json),
 empty_state_actions_json=VALUES(empty_state_actions_json), priority_order=VALUES(priority_order), status='active';

INSERT INTO activation_section_action_registry
(action_ref_key, tab_key, section_key_like, provider_family, connector_family, source_table_like,
 runtime_action_key, endpoint_selector, label, action_mode, requires_confirmation, required_capability_key,
 fallback_prompt_template_key, input_schema_json, preview_template_key, confirmation_template_key,
 success_readback_tool_key, failure_recovery_key, undo_action_key, expected_impact_metric_key,
 analytics_event_key, mobile_action_style, priority_order, status)
VALUES
('growth_today_review','tenant_today','%','growth','growth',NULL,NULL,NULL,'Review today''s opportunities','advisory',0,NULL,'growth_today_review','{}','growth_action_preview',NULL,NULL,'growth_guidance_recovery',NULL,'growth_opportunities','growth_today_reviewed','primary',1,'active'),
('growth_plan_create','tenant_growth_plan','%','growth','growth',NULL,NULL,NULL,'Create a growth plan','draft_only',0,NULL,'growth_plan_create','{"type":"object","properties":{"time_horizon":{"type":"string"},"primary_goal":{"type":"string"}}}','growth_plan_preview',NULL,NULL,'growth_plan_recovery',NULL,'dashboard_health_score','growth_plan_created','primary',10,'active'),
('seo_opportunity_review','tenant_content_seo','%','seo','seo',NULL,NULL,NULL,'Review organic growth opportunities','read_only',0,NULL,'seo_opportunity_review','{}','seo_opportunity_preview',NULL,NULL,'seo_manual_snapshot',NULL,'growth_opportunities','seo_opportunities_reviewed','secondary',20,'active'),
('content_brief_create','tenant_content_seo','%','content','content',NULL,NULL,NULL,'Create a content brief','draft_only',0,NULL,'content_brief_create','{"type":"object","properties":{"topic":{"type":"string"},"target_audience":{"type":"string"}}}','content_brief_preview',NULL,NULL,'content_brief_recovery',NULL,'growth_opportunities','content_brief_created','primary',30,'active'),
('lead_followup_review','tenant_customers_leads','%','crm','crm',NULL,NULL,NULL,'Review leads needing follow-up','advisory',0,NULL,'lead_followup_review','{}','lead_followup_preview',NULL,NULL,'lead_followup_recovery',NULL,'growth_opportunities','lead_followups_reviewed','primary',40,'active'),
('lead_followup_draft','tenant_customers_leads','%','crm','crm',NULL,NULL,NULL,'Draft lead follow-ups','draft_only',0,NULL,'lead_followup_draft','{"type":"object","properties":{"tone":{"type":"string"},"offer":{"type":"string"}}}','lead_followup_draft_preview',NULL,NULL,'lead_followup_recovery',NULL,'growth_opportunities','lead_followups_drafted','primary',50,'active'),
('sales_pipeline_review','tenant_sales_bookings','%','sales','sales',NULL,NULL,NULL,'Review sales or booking pipeline','advisory',0,NULL,'sales_pipeline_review','{}','sales_pipeline_preview',NULL,NULL,'sales_pipeline_recovery',NULL,'growth_opportunities','sales_pipeline_reviewed','primary',60,'active'),
('campaign_performance_review','tenant_campaigns','%','ads','ads',NULL,NULL,NULL,'Review campaign performance','read_only',0,NULL,'campaign_performance_review','{}','campaign_review_preview',NULL,NULL,'campaign_manual_snapshot',NULL,'growth_opportunities','campaign_performance_reviewed','secondary',70,'active'),
('campaign_brief_create','tenant_campaigns','%','ads','ads',NULL,NULL,NULL,'Create a campaign brief','draft_only',0,NULL,'campaign_brief_create','{"type":"object","properties":{"objective":{"type":"string"},"audience":{"type":"string"},"budget_range":{"type":"string"}}}','campaign_brief_preview',NULL,NULL,'campaign_brief_recovery',NULL,'growth_opportunities','campaign_brief_created','primary',80,'active'),
('reputation_review','tenant_reputation','%','reviews','reviews',NULL,NULL,NULL,'Review customer feedback','read_only',0,NULL,'reputation_review','{}','reputation_review_preview',NULL,NULL,'reputation_manual_snapshot',NULL,'dashboard_health_score','reputation_reviewed','secondary',90,'active'),
('review_reply_draft','tenant_reputation','%','reviews','reviews',NULL,NULL,NULL,'Draft review replies','draft_only',0,NULL,'review_reply_draft','{"type":"object","properties":{"tone":{"type":"string"}}}','review_reply_preview',NULL,NULL,'review_reply_recovery',NULL,'dashboard_health_score','review_replies_drafted','primary',100,'active'),
('travel_destination_opportunity_review','tenant_content_seo','%destination%','travel','travel',NULL,NULL,NULL,'Review destination opportunities','advisory',0,NULL,'travel_destination_opportunity_review','{}','destination_opportunity_preview',NULL,NULL,'travel_destination_recovery',NULL,'growth_opportunities','destination_opportunities_reviewed','primary',110,'active'),
('travel_package_optimization','tenant_sales_bookings','%package%','travel','travel',NULL,NULL,NULL,'Create package optimization plan','draft_only',0,NULL,'travel_package_optimization','{"type":"object","properties":{"package_key":{"type":"string"},"target_market":{"type":"string"}}}','travel_package_preview',NULL,NULL,'travel_package_recovery',NULL,'growth_opportunities','travel_package_plan_created','primary',120,'active')
ON DUPLICATE KEY UPDATE
 tab_key=VALUES(tab_key), section_key_like=VALUES(section_key_like), provider_family=VALUES(provider_family), connector_family=VALUES(connector_family),
 label=VALUES(label), action_mode=VALUES(action_mode), requires_confirmation=VALUES(requires_confirmation), required_capability_key=VALUES(required_capability_key),
 fallback_prompt_template_key=VALUES(fallback_prompt_template_key), input_schema_json=VALUES(input_schema_json), preview_template_key=VALUES(preview_template_key),
 confirmation_template_key=VALUES(confirmation_template_key), success_readback_tool_key=VALUES(success_readback_tool_key),
 failure_recovery_key=VALUES(failure_recovery_key), undo_action_key=VALUES(undo_action_key), expected_impact_metric_key=VALUES(expected_impact_metric_key),
 analytics_event_key=VALUES(analytics_event_key), mobile_action_style=VALUES(mobile_action_style), priority_order=VALUES(priority_order), status='active';
