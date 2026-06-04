-- Sprint 67: Workspace resource authority foundation
-- Workspace membership gives access to a workspace; these tables prepare scoped access to brands/sites/apps/assets.

CREATE TABLE IF NOT EXISTS workspace_resource_grants (
  grant_id varchar(36) NOT NULL PRIMARY KEY,
  tenant_id varchar(36) NOT NULL,
  grantee_user_id varchar(36) NOT NULL,
  resource_type enum('workspace','brand','site','app','asset','workflow','agent','vault') NOT NULL,
  resource_ref varchar(255) NOT NULL,
  permission enum('owner','admin','manage','operate','edit','comment','view') NOT NULL DEFAULT 'view',
  status enum('active','pending','revoked','expired') NOT NULL DEFAULT 'active',
  source enum('membership_default','invitation_accept','access_request_approval','owner_assignment','admin_repair','system_sync') NOT NULL DEFAULT 'owner_assignment',
  granted_by varchar(36) NULL,
  granted_at datetime NOT NULL DEFAULT current_timestamp(),
  revoked_by varchar(36) NULL,
  revoked_at datetime NULL,
  expires_at datetime NULL,
  metadata_json longtext NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  UNIQUE KEY uq_workspace_resource_grant_active (tenant_id, grantee_user_id, resource_type, resource_ref, permission, status),
  KEY idx_workspace_resource_grants_tenant_user (tenant_id, grantee_user_id, status),
  KEY idx_workspace_resource_grants_resource (tenant_id, resource_type, resource_ref, status),
  KEY idx_workspace_resource_grants_granted_by (granted_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS workspace_vaults (
  vault_id varchar(36) NOT NULL PRIMARY KEY,
  tenant_id varchar(36) NOT NULL,
  provider enum('google_drive') NOT NULL DEFAULT 'google_drive',
  provider_mode enum('managed_service_account','shared_drive','external_folder') NOT NULL DEFAULT 'managed_service_account',
  vault_name varchar(255) NOT NULL,
  drive_id varchar(255) NULL,
  root_folder_id varchar(255) NULL,
  status enum('active','pending','disabled','error') NOT NULL DEFAULT 'pending',
  metadata_json longtext NULL,
  created_by varchar(36) NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  UNIQUE KEY uq_workspace_vault_provider_root (tenant_id, provider, root_folder_id),
  KEY idx_workspace_vaults_tenant_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS workspace_assets (
  asset_id varchar(36) NOT NULL PRIMARY KEY,
  tenant_id varchar(36) NOT NULL,
  vault_id varchar(36) NULL,
  asset_type enum('drive_file','drive_folder','drive_shortcut','doc','sheet','image','report','session','knowledge','approval','external_ref') NOT NULL,
  asset_ref varchar(512) NOT NULL,
  display_name varchar(255) NULL,
  brand_ref varchar(255) NULL,
  site_ref varchar(255) NULL,
  workflow_ref varchar(255) NULL,
  session_ref varchar(255) NULL,
  visibility enum('workspace','restricted','private','public') NOT NULL DEFAULT 'workspace',
  lifecycle_status enum('active','draft','review','approved','published','archived','deleted') NOT NULL DEFAULT 'active',
  metadata_json longtext NULL,
  created_by varchar(36) NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  UNIQUE KEY uq_workspace_asset_ref (tenant_id, asset_type, asset_ref),
  KEY idx_workspace_assets_tenant_type (tenant_id, asset_type, lifecycle_status),
  KEY idx_workspace_assets_brand (tenant_id, brand_ref),
  KEY idx_workspace_assets_site (tenant_id, site_ref),
  KEY idx_workspace_assets_session (tenant_id, session_ref),
  KEY idx_workspace_assets_vault (vault_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE OR REPLACE VIEW v_workspace_resource_grant_effective AS
SELECT
  g.grant_id,
  g.tenant_id,
  g.grantee_user_id,
  u.email AS grantee_email,
  m.role AS membership_role,
  m.status AS membership_status,
  g.resource_type,
  g.resource_ref,
  g.permission,
  g.status AS grant_status,
  g.source,
  g.granted_by,
  g.granted_at,
  g.expires_at
FROM workspace_resource_grants g
JOIN memberships m
  ON m.tenant_id = g.tenant_id AND m.user_id = g.grantee_user_id AND m.status = 'active'
LEFT JOIN users u
  ON u.user_id = g.grantee_user_id
WHERE g.status = 'active'
  AND (g.expires_at IS NULL OR g.expires_at > NOW());

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
('workspace_resource_grants_list','Workspace Resource Grants List','List effective resource grants for a workspace member.','GET','/me/workspaces/{tenant_id}/resource-grants',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'resource_type',JSON_OBJECT('type','string'),'resource_ref',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id'),'additionalProperties',false),NULL,'tenant,workspace,resource_grants,read_only,no_secrets',1,320),
('workspace_assets_list','Workspace Assets List','List workspace asset graph records visible to a workspace member.','GET','/me/workspaces/{tenant_id}/assets',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'asset_type',JSON_OBJECT('type','string'),'brand_ref',JSON_OBJECT('type','string'),'site_ref',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id'),'additionalProperties',false),NULL,'tenant,workspace,assets,read_only,no_secrets',1,321),
('workspace_vaults_list','Workspace Vaults List','List workspace vault mappings for a workspace member.','GET','/me/workspaces/{tenant_id}/vaults',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id'),'additionalProperties',false),NULL,'tenant,workspace,vaults,read_only,no_secrets',1,322)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
