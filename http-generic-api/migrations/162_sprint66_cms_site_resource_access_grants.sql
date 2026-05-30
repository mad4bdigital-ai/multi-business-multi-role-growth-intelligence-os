-- Sprint 66: CMS site resources + access grants foundation
-- Separates CMS site identity from brand context and user credentials.
-- Additive only; safe to run repeatedly.

CREATE TABLE IF NOT EXISTS cms_sites (
  site_id varchar(36) NOT NULL PRIMARY KEY,
  app_key varchar(64) NOT NULL DEFAULT 'wordpress_rest',
  normalized_domain varchar(255) NOT NULL,
  site_url varchar(512) NOT NULL,
  wp_json_base varchar(512) NOT NULL,
  canonical_target_key varchar(128) NULL,
  platform_status enum('active','pending','archived') NOT NULL DEFAULT 'active',
  first_claimed_at datetime NOT NULL DEFAULT current_timestamp(),
  last_verified_at datetime NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  UNIQUE KEY uq_cms_sites_app_domain (app_key, normalized_domain),
  KEY idx_cms_sites_target (canonical_target_key),
  KEY idx_cms_sites_status (platform_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cms_site_access_grants (
  grant_id varchar(36) NOT NULL PRIMARY KEY,
  site_id varchar(36) NOT NULL,
  tenant_id varchar(36) NOT NULL,
  user_id varchar(36) NULL,
  workspace_id varchar(36) NULL,
  connection_id varchar(36) NULL,
  claim_id varchar(36) NULL,
  scope enum('personal','workspace','tenant_brand') NOT NULL DEFAULT 'personal',
  capabilities_json longtext NULL,
  draft_allowed tinyint(1) NOT NULL DEFAULT 1,
  publish_allowed tinyint(1) NOT NULL DEFAULT 0,
  destructive_allowed tinyint(1) NOT NULL DEFAULT 0,
  status enum('active','pending_approval','revoked','expired') NOT NULL DEFAULT 'active',
  approved_by varchar(64) NULL,
  approved_at datetime NULL,
  expires_at datetime NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  UNIQUE KEY uq_cms_site_grant_scope (site_id, tenant_id, scope, user_id, workspace_id, connection_id),
  KEY idx_cms_site_grants_site (site_id),
  KEY idx_cms_site_grants_tenant (tenant_id),
  KEY idx_cms_site_grants_connection (connection_id),
  KEY idx_cms_site_grants_claim (claim_id),
  KEY idx_cms_site_grants_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS brand_site_bindings (
  binding_id varchar(36) NOT NULL PRIMARY KEY,
  site_id varchar(36) NOT NULL,
  target_key varchar(128) NOT NULL,
  brand_name varchar(255) NULL,
  relationship_type enum('primary','secondary','shared') NOT NULL DEFAULT 'primary',
  status enum('active','pending','archived') NOT NULL DEFAULT 'active',
  created_by varchar(64) NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  UNIQUE KEY uq_brand_site_target (target_key, site_id),
  KEY idx_brand_site_site (site_id),
  KEY idx_brand_site_target (target_key),
  KEY idx_brand_site_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
