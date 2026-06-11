-- Activation Dynamic Tabs Registry
-- Purpose: group activation evidence by visible workspace/brand containers.
-- Secrets policy: no credential values, tokens, passwords, private keys, or system prompts are exposed.

CREATE TABLE IF NOT EXISTS activation_dynamic_tab_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tab_key VARCHAR(160) NOT NULL UNIQUE,
  display_name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  tab_group ENUM('overview','access','operations','automation','knowledge','tasks','integrations','custom') NOT NULL DEFAULT 'custom',
  container_scope ENUM('platform','tenant','workspace','brand','user','connector','agent','mixed') NOT NULL DEFAULT 'workspace',
  default_visibility ENUM('admin_only','owner_and_admin','tenant_members','user_private','subject_scoped') NOT NULL DEFAULT 'subject_scoped',
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_dynamic_tab_group (tab_group, status),
  INDEX idx_activation_dynamic_tab_scope (container_scope, status),
  INDEX idx_activation_dynamic_tab_priority (priority_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_dynamic_tab_section_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  section_key VARCHAR(180) NOT NULL UNIQUE,
  tab_key VARCHAR(160) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  source_table VARCHAR(160) NOT NULL,
  result_columns_json JSON NOT NULL,
  tenant_column VARCHAR(128) NULL,
  user_column VARCHAR(128) NULL,
  workspace_column VARCHAR(128) NULL,
  brand_key_column VARCHAR(128) NULL,
  system_id_column VARCHAR(128) NULL,
  status_column VARCHAR(128) NULL,
  active_status_values_json JSON NULL,
  row_limit INT UNSIGNED NOT NULL DEFAULT 25,
  aggregation_mode ENUM('rows','count','summary') NOT NULL DEFAULT 'rows',
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_tab_section_tab (tab_key, status),
  INDEX idx_activation_tab_section_source (source_table, status),
  INDEX idx_activation_tab_section_priority (priority_order),
  CONSTRAINT fk_activation_tab_section_tab FOREIGN KEY (tab_key) REFERENCES activation_dynamic_tab_registry(tab_key) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO activation_dynamic_tab_registry
(tab_key, display_name, description, tab_group, container_scope, default_visibility, priority_order, status)
VALUES
('container_overview','Overview','Container identity, brand/workspace linkage, readiness and high-level operational status.','overview','workspace','subject_scoped',10,'active'),
('container_roles_access','Roles & Access','User roles, memberships, permission grants and access scope for this container.','access','workspace','subject_scoped',20,'active'),
('container_connectors','Connectors','Connected systems, installations and provider families visible for this workspace or brand.','integrations','workspace','subject_scoped',30,'active'),
('container_agents','Agents','Agents available to the workspace/brand scope and their health/readiness.','automation','workspace','subject_scoped',40,'active'),
('container_skills','Skills','Skills and skill grants available to the workspace/brand scope.','automation','workspace','subject_scoped',50,'active'),
('container_tasks','Tasks','Pending, blocked, deferred and in-progress tasks relevant to the container.','tasks','workspace','subject_scoped',60,'active'),
('container_operational_tiles','Operational Tiles','Provider-level operational dashboard tiles and callbacks available in this container.','operations','workspace','subject_scoped',70,'active')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), tab_group=VALUES(tab_group), container_scope=VALUES(container_scope), default_visibility=VALUES(default_visibility), priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO activation_dynamic_tab_section_registry
(section_key, tab_key, display_name, description, source_table, result_columns_json, tenant_column, user_column, workspace_column, brand_key_column, system_id_column, status_column, active_status_values_json, row_limit, aggregation_mode, priority_order, status)
VALUES
('overview_workspace','container_overview','Workspace','Workspace identity and linked brand/system references.','workspace_registry',JSON_ARRAY('workspace_id','tenant_id','workspace_key','display_name','workspace_type','bootstrap_status','linked_brand_key','linked_system_ids','updated_at'),'tenant_id',NULL,'workspace_id','linked_brand_key',NULL,'bootstrap_status',JSON_ARRAY('ready','in_progress','degraded'),10,'rows',10,'active'),
('overview_brand','container_overview','Brand','Linked brand control state and maturity.','brands',JSON_ARRAY('brand_name','target_key','brand_domain','status','brand_core_ready','maturity','evolution_status','governance_readiness_status','runtime_scope_class','control_state_last_validated_at','updated_at'),NULL,NULL,NULL,'target_key',NULL,'status',JSON_ARRAY('active','validating'),10,'rows',20,'active'),
('access_memberships','container_roles_access','Memberships','Active memberships for the current subject within the tenant.','memberships',JSON_ARRAY('user_id','tenant_id','role','status','granted_at','updated_at'),'tenant_id','user_id',NULL,NULL,NULL,'status',JSON_ARRAY('active'),25,'rows',10,'active'),
('access_role_assignments','container_roles_access','Role Assignments','Active non-expired role assignments for the current subject.','role_assignments',JSON_ARRAY('assignment_id','user_id','tenant_id','role','granted_at','expires_at','status'),'tenant_id','user_id',NULL,NULL,NULL,'status',JSON_ARRAY('active'),25,'rows',20,'active'),
('connectors_connected_systems','container_connectors','Connected Systems','Visible connected systems and provider families for the tenant/workspace.','connected_systems',JSON_ARRAY('system_id','tenant_id','system_key','display_name','provider_family','provider_domain','connector_family','auth_type','service_mode','status','updated_at'),'tenant_id',NULL,NULL,NULL,'system_id','status',JSON_ARRAY('active','pending','error'),50,'rows',10,'active'),
('connectors_installations','container_connectors','Installations','Active app/connector installations for the tenant/workspace.','installations',JSON_ARRAY('installation_id','system_id','tenant_id','scope','status','installed_at','expires_at'),'tenant_id',NULL,NULL,NULL,'system_id','status',JSON_ARRAY('active'),50,'rows',20,'active'),
('agents_catalog','container_agents','Agents','Active agent catalog visible to the tenant/admin subject.','v_activation_agent_catalog',JSON_ARRAY('tenant_id','agent_id','agent_name','agent_display_name','execution_class','execution_layer','health_status','agent_status','updated_at'),'tenant_id',NULL,NULL,NULL,NULL,'agent_status',JSON_ARRAY('active'),50,'rows',10,'active'),
('skills_catalog','container_skills','Skill Catalog','Active skills available to the tenant or globally.','v_activation_agent_skill_catalog',JSON_ARRAY('tenant_id','skill_id','skill_key','skill_display_name','skill_type','skill_scope','requires_approval','skill_status','created_at'),'tenant_id',NULL,NULL,NULL,NULL,'skill_status',JSON_ARRAY('active'),50,'rows',10,'active'),
('skills_grants','container_skills','Skill Grants','Active skill grants by agent and brand scope.','v_activation_agent_skill_grants',JSON_ARRAY('grant_id','tenant_id','brand_key','agent_id','agent_name','agent_display_name','skill_id','skill_key','skill_display_name','skill_type','skill_scope','requires_approval','grant_status','expires_at','granted_at'),'tenant_id',NULL,NULL,'brand_key',NULL,'grant_status',JSON_ARRAY('active'),50,'rows',20,'active'),
('tasks_pending','container_tasks','Pending Tasks','Activation-visible tasks scoped to tenant/user/platform.','v_activation_pending_tasks',JSON_ARRAY('task_id','task_key','title','task_type','priority','task_status','owner_scope','tenant_id','user_id','source_surface','blocker_level','due_at','updated_at'),'tenant_id','user_id',NULL,NULL,NULL,'task_status',JSON_ARRAY('pending','in_progress','blocked','deferred'),50,'rows',10,'active'),
('operational_tiles','container_operational_tiles','Operational Tiles','Activation operational tiles and dashboard callbacks from provider registries.','activation_operational_tile_registry',JSON_ARRAY('tile_key','provider_family','connector_family','scope_class','display_name','category','default_visibility','source_mode','status_callback_key','freshness_sla_seconds','risk_level','status'),NULL,NULL,NULL,NULL,NULL,'status',JSON_ARRAY('active'),50,'rows',10,'active'),
('operational_callbacks','container_operational_tiles','Operational Callbacks','Callbacks available for activation operational tiles.','activation_callback_registry',JSON_ARRAY('callback_key','tile_key','provider_family','connector_family','intent_key','runtime_action_key','endpoint_selector','safe_mode','freshness_sla_seconds','status'),NULL,NULL,NULL,NULL,NULL,'status',JSON_ARRAY('active'),75,'rows',20,'active')
ON DUPLICATE KEY UPDATE
 tab_key=VALUES(tab_key), display_name=VALUES(display_name), description=VALUES(description), source_table=VALUES(source_table), result_columns_json=VALUES(result_columns_json), tenant_column=VALUES(tenant_column), user_column=VALUES(user_column), workspace_column=VALUES(workspace_column), brand_key_column=VALUES(brand_key_column), system_id_column=VALUES(system_id_column), status_column=VALUES(status_column), active_status_values_json=VALUES(active_status_values_json), row_limit=VALUES(row_limit), aggregation_mode=VALUES(aggregation_mode), priority_order=VALUES(priority_order), status=VALUES(status);
