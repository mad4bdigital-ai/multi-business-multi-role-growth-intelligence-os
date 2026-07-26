-- Activation Dynamic Tabs Auto-Discovery
-- Purpose: allow dynamic tabs to grow as activation authorized surfaces, views, connectors, agents, skills, and workflows grow.

CREATE TABLE IF NOT EXISTS activation_dynamic_tab_discovery_rule_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_key VARCHAR(180) NOT NULL UNIQUE,
  target_tab_key VARCHAR(160) NOT NULL,
  surface_key_like VARCHAR(180) NULL,
  source_table_like VARCHAR(180) NULL,
  provider_family_like VARCHAR(180) NULL,
  display_name VARCHAR(200) NULL,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_tab_discovery_tab (target_tab_key, status),
  INDEX idx_activation_tab_discovery_priority (priority_order),
  CONSTRAINT fk_activation_tab_discovery_tab FOREIGN KEY (target_tab_key) REFERENCES activation_dynamic_tab_registry(tab_key) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO activation_dynamic_tab_registry
(tab_key, display_name, description, tab_group, container_scope, default_visibility, priority_order, status)
VALUES
('container_workflows','Workflows','Workflow catalog, runtime bindings, task routes and automation execution surfaces.','automation','workspace','subject_scoped',80,'active'),
('container_knowledge','Knowledge','Knowledge sources, skill manifests, packages, memories and context sources available to the container.','knowledge','workspace','subject_scoped',90,'active'),
('container_governance_security','Governance & Security','Policies, permissions, audit, security, readiness gates and risk surfaces.','access','workspace','subject_scoped',100,'active'),
('container_evidence_activity','Evidence & Activity','Execution evidence, audit payloads, runtime logs and recent platform activity.','operations','workspace','subject_scoped',110,'active'),
('container_readiness_quality','Readiness & Quality','Coverage, quality, drift, lifecycle and integrity readiness views.','operations','workspace','subject_scoped',120,'active'),
('container_growth_signals','Growth Signals','Growth, analytics, CRM, ads, content and external platform signals.','operations','workspace','subject_scoped',130,'active'),
('container_auto_discovered_surfaces','Discovered Surfaces','Automatically discovered activation surfaces that do not yet map to a specialized tab.','custom','workspace','subject_scoped',900,'active')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), tab_group=VALUES(tab_group), container_scope=VALUES(container_scope), default_visibility=VALUES(default_visibility), priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO activation_dynamic_tab_discovery_rule_registry
(rule_key, target_tab_key, surface_key_like, source_table_like, provider_family_like, display_name, priority_order, status)
VALUES
('discover_workflows_by_surface','container_workflows','%workflow%',NULL,NULL,'Workflow surfaces',10,'active'),
('discover_task_routes_by_surface','container_workflows','%task_route%',NULL,NULL,'Task route surfaces',20,'active'),
('discover_agents_by_surface','container_agents','%agent%',NULL,NULL,'Agent surfaces',30,'active'),
('discover_skills_by_surface','container_skills','%skill%',NULL,NULL,'Skill surfaces',40,'active'),
('discover_connectors_by_surface','container_connectors','%connector%',NULL,NULL,'Connector surfaces',50,'active'),
('discover_integrations_by_surface','container_connectors','%integration%',NULL,NULL,'Integration surfaces',60,'active'),
('discover_apps_by_surface','container_connectors','%app_%',NULL,NULL,'App surfaces',70,'active'),
('discover_permissions_by_surface','container_roles_access','%permission%',NULL,NULL,'Permission surfaces',80,'active'),
('discover_grants_by_surface','container_roles_access','%grant%',NULL,NULL,'Grant surfaces',90,'active'),
('discover_tasks_by_surface','container_tasks','%pending_task%',NULL,NULL,'Task surfaces',100,'active'),
('discover_evidence_by_surface','container_evidence_activity','%evidence%',NULL,NULL,'Evidence surfaces',110,'active'),
('discover_execution_by_surface','container_evidence_activity','%execution%',NULL,NULL,'Execution surfaces',120,'active'),
('discover_audit_by_surface','container_governance_security','%audit%',NULL,NULL,'Audit surfaces',130,'active'),
('discover_policy_by_surface','container_governance_security','%policy%',NULL,NULL,'Policy surfaces',140,'active'),
('discover_readiness_by_source','container_readiness_quality',NULL,'%readiness%',NULL,'Readiness surfaces',150,'active'),
('discover_quality_by_source','container_readiness_quality',NULL,'%quality%',NULL,'Quality surfaces',160,'active'),
('discover_coverage_by_source','container_readiness_quality',NULL,'%coverage%',NULL,'Coverage surfaces',170,'active'),
('discover_lifecycle_by_source','container_readiness_quality',NULL,'%lifecycle%',NULL,'Lifecycle surfaces',180,'active'),
('discover_memory_by_surface','container_knowledge','%memory%',NULL,NULL,'Memory surfaces',190,'active'),
('discover_knowledge_by_surface','container_knowledge','%knowledge%',NULL,NULL,'Knowledge surfaces',200,'active'),
('discover_manifest_by_surface','container_knowledge','%manifest%',NULL,NULL,'Manifest surfaces',210,'active'),
('discover_ads_growth_by_source','container_growth_signals',NULL,'%ads%',NULL,'Ads/growth surfaces',220,'active'),
('discover_crm_growth_by_source','container_growth_signals',NULL,'%crm%',NULL,'CRM/growth surfaces',230,'active'),
('discover_content_growth_by_source','container_growth_signals',NULL,'%content%',NULL,'Content/growth surfaces',240,'active'),
('discover_default','container_auto_discovered_surfaces','%',NULL,NULL,'Default discovered surfaces',999,'active')
ON DUPLICATE KEY UPDATE
 target_tab_key=VALUES(target_tab_key), surface_key_like=VALUES(surface_key_like), source_table_like=VALUES(source_table_like), provider_family_like=VALUES(provider_family_like), display_name=VALUES(display_name), priority_order=VALUES(priority_order), status=VALUES(status);
