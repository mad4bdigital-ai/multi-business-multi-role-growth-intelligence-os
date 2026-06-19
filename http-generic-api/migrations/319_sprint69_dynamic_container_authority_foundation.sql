-- Sprint 69: Dynamic Container Authority foundation.
-- Additive registry and projection surfaces only; no runtime enforcement.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

CREATE TABLE IF NOT EXISTS `container_type_registry` (
  `container_type_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `allowed_parent_types_json` LONGTEXT NOT NULL,
  `allowed_child_types_json` LONGTEXT NOT NULL,
  `default_inheritance_profile_key` VARCHAR(191) NULL,
  `classification_profile_key` VARCHAR(191) NULL,
  `max_depth` SMALLINT UNSIGNED NOT NULL DEFAULT 16,
  `supports_multi_parent` TINYINT(1) NOT NULL DEFAULT 1,
  `status` ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`container_type_key`),
  KEY `idx_ctr_status` (`status`),
  KEY `idx_ctr_inheritance_profile` (`default_inheritance_profile_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `containers` (
  `container_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `container_key` VARCHAR(191) NOT NULL,
  `container_type_key` VARCHAR(191) NOT NULL,
  `canonical_subject_type` VARCHAR(128) NULL,
  `canonical_subject_ref` VARCHAR(255) NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `status` ENUM('draft','active','disabled','archived') NOT NULL DEFAULT 'draft',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `metadata_json` LONGTEXT NULL,
  `created_by` VARCHAR(191) NULL,
  `updated_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`container_id`),
  UNIQUE KEY `uq_containers_tenant_type_key` (`tenant_id`,`container_type_key`,`container_key`),
  UNIQUE KEY `uq_containers_canonical_subject` (`tenant_id`,`canonical_subject_type`,`canonical_subject_ref`),
  KEY `idx_containers_tenant_status` (`tenant_id`,`status`),
  KEY `idx_containers_type_status` (`container_type_key`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_relationship_type_registry` (
  `relationship_type_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `relationship_class` ENUM('containment','sharing','delegation','reference','management') NOT NULL,
  `directed` TINYINT(1) NOT NULL DEFAULT 1,
  `contributes_to_ancestry` TINYINT(1) NOT NULL DEFAULT 0,
  `contributes_to_inheritance` TINYINT(1) NOT NULL DEFAULT 0,
  `default_access_mode` ENUM('none','read_only','delegated_write') NOT NULL DEFAULT 'none',
  `default_merge_profile_key` VARCHAR(191) NULL,
  `requires_approval` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`relationship_type_key`),
  KEY `idx_crtr_class_status` (`relationship_class`,`status`),
  KEY `idx_crtr_ancestry` (`contributes_to_ancestry`,`contributes_to_inheritance`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_relationships` (
  `relationship_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `from_container_id` VARCHAR(36) NOT NULL,
  `to_container_id` VARCHAR(36) NOT NULL,
  `relationship_type_key` VARCHAR(191) NOT NULL,
  `priority` INT NOT NULL DEFAULT 0,
  `conditions_json` LONGTEXT NULL,
  `valid_from` DATETIME NULL,
  `valid_until` DATETIME NULL,
  `status` ENUM('draft','active','disabled','revoked','expired') NOT NULL DEFAULT 'draft',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_by` VARCHAR(191) NULL,
  `approved_by` VARCHAR(191) NULL,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`relationship_id`),
  KEY `idx_cr_tenant_from_status` (`tenant_id`,`from_container_id`,`status`),
  KEY `idx_cr_tenant_to_status` (`tenant_id`,`to_container_id`,`status`),
  KEY `idx_cr_type_status_validity` (`relationship_type_key`,`status`,`valid_from`,`valid_until`),
  KEY `idx_cr_pair` (`from_container_id`,`to_container_id`,`relationship_type_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_closure` (
  `tenant_id` VARCHAR(36) NOT NULL,
  `ancestor_container_id` VARCHAR(36) NOT NULL,
  `descendant_container_id` VARCHAR(36) NOT NULL,
  `shortest_depth` SMALLINT UNSIGNED NOT NULL,
  `longest_depth` SMALLINT UNSIGNED NOT NULL,
  `path_count` INT UNSIGNED NOT NULL DEFAULT 1,
  `path_hash` CHAR(64) NOT NULL,
  `authority_epoch` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `computed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`,`ancestor_container_id`,`descendant_container_id`),
  KEY `idx_cc_descendant_depth` (`tenant_id`,`descendant_container_id`,`shortest_depth`),
  KEY `idx_cc_epoch` (`tenant_id`,`authority_epoch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_classification_type_registry` (
  `classification_type_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `value_schema_json` LONGTEXT NOT NULL,
  `cardinality` ENUM('single','multi') NOT NULL DEFAULT 'single',
  `inheritance_mode` ENUM('local_only','inherit_down','inherit_until_blocked') NOT NULL DEFAULT 'inherit_down',
  `merge_strategy` ENUM('deny_wins','union','intersection','minimum','nearest_replace','priority_replace') NOT NULL DEFAULT 'nearest_replace',
  `conflict_policy` ENUM('block','restrict','nearest','priority') NOT NULL DEFAULT 'block',
  `affected_dimensions_json` LONGTEXT NULL,
  `status` ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`classification_type_key`),
  KEY `idx_cctr_status_strategy` (`status`,`merge_strategy`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_classifications` (
  `classification_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `container_id` VARCHAR(36) NOT NULL,
  `classification_type_key` VARCHAR(191) NOT NULL,
  `value_key` VARCHAR(191) NULL,
  `value_json` LONGTEXT NOT NULL,
  `inheritance_mode` ENUM('registry_default','local_only','inherit_down','inherit_until_blocked') NOT NULL DEFAULT 'registry_default',
  `merge_priority` INT NOT NULL DEFAULT 0,
  `valid_from` DATETIME NULL,
  `valid_until` DATETIME NULL,
  `status` ENUM('draft','active','disabled','revoked','expired') NOT NULL DEFAULT 'draft',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_by` VARCHAR(191) NULL,
  `approved_by` VARCHAR(191) NULL,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`classification_id`),
  KEY `idx_ccf_container_type_status` (`container_id`,`classification_type_key`,`status`),
  KEY `idx_ccf_tenant_validity` (`tenant_id`,`status`,`valid_from`,`valid_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_role_template_registry` (
  `role_template_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `composition_json` LONGTEXT NULL,
  `default_scope_mode` ENUM('local_only','inherit_down') NOT NULL DEFAULT 'local_only',
  `status` ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`role_template_key`),
  KEY `idx_crt_status_scope` (`status`,`default_scope_mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_role_template_permissions` (
  `role_template_key` VARCHAR(191) NOT NULL,
  `dimension_key` VARCHAR(191) NOT NULL,
  `permission_key` VARCHAR(191) NOT NULL,
  `effect` ENUM('allow','deny','restrict') NOT NULL DEFAULT 'allow',
  `operation_patterns_json` LONGTEXT NULL,
  `conditions_json` LONGTEXT NULL,
  `merge_priority` INT NOT NULL DEFAULT 0,
  `status` ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`role_template_key`,`dimension_key`,`permission_key`,`effect`),
  KEY `idx_crtp_dimension_status` (`dimension_key`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_role_assignments` (
  `assignment_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `container_id` VARCHAR(36) NOT NULL,
  `principal_type` ENUM('user','agent','service','group') NOT NULL,
  `principal_id` VARCHAR(191) NOT NULL,
  `role_template_key` VARCHAR(191) NULL,
  `inline_permissions_json` LONGTEXT NULL,
  `inheritance_mode` ENUM('local_only','inherit_down') NOT NULL DEFAULT 'local_only',
  `valid_from` DATETIME NULL,
  `valid_until` DATETIME NULL,
  `status` ENUM('draft','active','disabled','revoked','expired') NOT NULL DEFAULT 'draft',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `issued_by` VARCHAR(191) NULL,
  `approved_by` VARCHAR(191) NULL,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`assignment_id`),
  KEY `idx_cra_principal_status` (`tenant_id`,`principal_type`,`principal_id`,`status`),
  KEY `idx_cra_container_status` (`container_id`,`status`,`valid_from`,`valid_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_resource_dimension_registry` (
  `dimension_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `resource_key_schema_json` LONGTEXT NOT NULL,
  `supports_containment_inheritance` TINYINT(1) NOT NULL DEFAULT 0,
  `supports_sharing` TINYINT(1) NOT NULL DEFAULT 0,
  `supports_delegation` TINYINT(1) NOT NULL DEFAULT 0,
  `default_merge_strategy` ENUM('deny_wins','union','intersection','minimum','nearest_replace','priority_replace') NOT NULL DEFAULT 'deny_wins',
  `default_share_access_mode` ENUM('none','read_only','delegated_write') NOT NULL DEFAULT 'none',
  `write_requires_delegation` TINYINT(1) NOT NULL DEFAULT 1,
  `credential_materialization_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`dimension_key`),
  KEY `idx_crdr_status_strategy` (`status`,`default_merge_strategy`),
  KEY `idx_crdr_sharing_delegation` (`supports_sharing`,`supports_delegation`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_resource_bindings` (
  `binding_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `container_id` VARCHAR(36) NOT NULL,
  `dimension_key` VARCHAR(191) NOT NULL,
  `resource_type` VARCHAR(128) NOT NULL,
  `resource_ref` VARCHAR(512) NOT NULL,
  `effect` ENUM('allow','deny','restrict','require','share','delegate') NOT NULL,
  `permission_key` VARCHAR(191) NULL,
  `operation_patterns_json` LONGTEXT NULL,
  `capability_keys_json` LONGTEXT NULL,
  `inheritance_mode` ENUM('local_only','inherit_down','explicit_share','block_inheritance') NOT NULL DEFAULT 'local_only',
  `merge_priority` INT NOT NULL DEFAULT 0,
  `conditions_json` LONGTEXT NULL,
  `valid_from` DATETIME NULL,
  `valid_until` DATETIME NULL,
  `status` ENUM('draft','active','disabled','revoked','expired') NOT NULL DEFAULT 'draft',
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `source_table` VARCHAR(191) NULL,
  `source_pk` VARCHAR(255) NULL,
  `created_by` VARCHAR(191) NULL,
  `approved_by` VARCHAR(191) NULL,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`binding_id`),
  KEY `idx_crb_container_dimension_status` (`container_id`,`dimension_key`,`status`),
  KEY `idx_crb_tenant_resource_status` (`tenant_id`,`resource_type`,`resource_ref`(191),`status`),
  KEY `idx_crb_effect_validity` (`effect`,`status`,`valid_from`,`valid_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `container_authority_epochs` (
  `tenant_id` VARCHAR(36) NOT NULL,
  `authority_epoch` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `last_mutation_type` VARCHAR(128) NULL,
  `last_mutation_ref` VARCHAR(255) NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `container_type_registry`
  (`container_type_key`,`display_name`,`description`,`allowed_parent_types_json`,`allowed_child_types_json`,`max_depth`,`supports_multi_parent`,`status`,`metadata_json`)
VALUES
  ('platform','Platform','Global platform root.',JSON_ARRAY(),JSON_ARRAY('tenant'),1,0,'active',JSON_OBJECT('seed','migration_319','grants_authority',false)),
  ('tenant','Tenant','Tenant authority boundary.',JSON_ARRAY('platform'),JSON_ARRAY('workspace'),4,0,'active',JSON_OBJECT('seed','migration_319','grants_authority',false)),
  ('workspace','Workspace','Operational workspace under one or more tenant paths.',JSON_ARRAY('tenant'),JSON_ARRAY('brand','activity','workflow'),8,1,'active',JSON_OBJECT('seed','migration_319','grants_authority',false)),
  ('brand','Brand','Canonical brand scope under workspace containment.',JSON_ARRAY('workspace'),JSON_ARRAY('activity','workflow'),12,1,'active',JSON_OBJECT('seed','migration_319','canonical_key','brands.target_key','grants_authority',false)),
  ('activity','Activity','Business activity scope; nested activities are allowed.',JSON_ARRAY('workspace','brand','activity'),JSON_ARRAY('activity','workflow'),16,1,'active',JSON_OBJECT('seed','migration_319','grants_authority',false)),
  ('workflow','Workflow','Workflow scope under workspace, brand, or activity.',JSON_ARRAY('workspace','brand','activity'),JSON_ARRAY(),16,1,'active',JSON_OBJECT('seed','migration_319','grants_authority',false))
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),description=VALUES(description),allowed_parent_types_json=VALUES(allowed_parent_types_json),
  allowed_child_types_json=VALUES(allowed_child_types_json),max_depth=VALUES(max_depth),supports_multi_parent=VALUES(supports_multi_parent),
  metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `container_relationship_type_registry`
  (`relationship_type_key`,`display_name`,`relationship_class`,`directed`,`contributes_to_ancestry`,`contributes_to_inheritance`,`default_access_mode`,`requires_approval`,`status`,`metadata_json`)
VALUES
  ('contains','Contains','containment',1,1,1,'none',0,'active',JSON_OBJECT('cycle_check_required',true,'seed','migration_319')),
  ('shares','Shares','sharing',1,0,0,'read_only',0,'active',JSON_OBJECT('write_authority_implied',false,'seed','migration_319')),
  ('delegates','Delegates','delegation',1,0,0,'delegated_write',1,'active',JSON_OBJECT('exact_operations_required',true,'seed','migration_319')),
  ('references','References','reference',1,0,0,'none',0,'active',JSON_OBJECT('authority_implied',false,'seed','migration_319')),
  ('manages','Manages','management',1,0,0,'read_only',1,'active',JSON_OBJECT('authority_implied',false,'seed','migration_319'))
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),relationship_class=VALUES(relationship_class),directed=VALUES(directed),
  contributes_to_ancestry=VALUES(contributes_to_ancestry),contributes_to_inheritance=VALUES(contributes_to_inheritance),
  default_access_mode=VALUES(default_access_mode),requires_approval=VALUES(requires_approval),metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO `container_resource_dimension_registry`
  (`dimension_key`,`display_name`,`resource_key_schema_json`,`supports_containment_inheritance`,`supports_sharing`,`supports_delegation`,`default_merge_strategy`,`default_share_access_mode`,`write_requires_delegation`,`credential_materialization_allowed`,`status`,`metadata_json`)
VALUES
  ('connections','Connections',JSON_OBJECT('type','string','maxLength',255),1,1,1,'nearest_replace','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('tools','Tools',JSON_OBJECT('type','string','maxLength',191),1,1,1,'union','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('skills','Skills',JSON_OBJECT('type','string','maxLength',191),1,1,1,'union','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('rules','Rules',JSON_OBJECT('type','string','maxLength',191),1,1,0,'deny_wins','read_only',1,0,'active',JSON_OBJECT('child_may_relax',false)),
  ('policies','Policies',JSON_OBJECT('type','string','maxLength',191),1,1,0,'deny_wins','read_only',1,0,'active',JSON_OBJECT('child_may_relax',false)),
  ('profiles','Profiles',JSON_OBJECT('type','string','maxLength',191),1,1,1,'nearest_replace','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('knowledge','Knowledge',JSON_OBJECT('type','string','maxLength',512),1,1,1,'union','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('logic','Logic',JSON_OBJECT('type','string','maxLength',191),1,1,1,'intersection','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('engines','Engines',JSON_OBJECT('type','string','maxLength',191),1,1,1,'intersection','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('workflows','Workflows',JSON_OBJECT('type','string','maxLength',191),1,1,1,'union','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('actions','Actions',JSON_OBJECT('type','string','maxLength',191),1,1,1,'intersection','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('endpoints','Endpoints',JSON_OBJECT('type','string','maxLength',191),1,1,1,'intersection','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('credentials','Credentials',JSON_OBJECT('type','string','maxLength',255),0,0,1,'nearest_replace','none',1,1,'active',JSON_OBJECT('binding_references_only',true,'raw_values_allowed',false)),
  ('budgets','Budgets',JSON_OBJECT('type','number','minimum',0),1,0,1,'minimum','none',1,0,'active',JSON_OBJECT('most_restrictive_wins',true)),
  ('quotas','Quotas',JSON_OBJECT('type','number','minimum',0),1,0,1,'minimum','none',1,0,'active',JSON_OBJECT('most_restrictive_wins',true)),
  ('assets','Assets',JSON_OBJECT('type','string','maxLength',512),1,1,1,'union','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('agents','Agents',JSON_OBJECT('type','string','maxLength',191),1,1,1,'intersection','read_only',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('roles','Roles',JSON_OBJECT('type','string','maxLength',191),1,0,1,'intersection','none',1,0,'active',JSON_OBJECT('secret_values_allowed',false)),
  ('brand_core','Brand Core',JSON_OBJECT('type','string','maxLength',255),1,0,1,'nearest_replace','none',1,0,'active',JSON_OBJECT('canonical_brand_key','brands.target_key','secret_values_allowed',false))
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),resource_key_schema_json=VALUES(resource_key_schema_json),
  supports_containment_inheritance=VALUES(supports_containment_inheritance),supports_sharing=VALUES(supports_sharing),
  supports_delegation=VALUES(supports_delegation),default_merge_strategy=VALUES(default_merge_strategy),
  default_share_access_mode=VALUES(default_share_access_mode),write_requires_delegation=VALUES(write_requires_delegation),
  credential_materialization_allowed=VALUES(credential_materialization_allowed),metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_container_active_hierarchy` AS
SELECT
  r.relationship_id,r.tenant_id,r.from_container_id AS parent_container_id,
  p.container_key AS parent_container_key,p.container_type_key AS parent_container_type,
  r.to_container_id AS child_container_id,c.container_key AS child_container_key,c.container_type_key AS child_container_type,
  r.relationship_type_key,r.priority,r.valid_from,r.valid_until,r.version AS relationship_version
FROM container_relationships r
JOIN container_relationship_type_registry rt ON rt.relationship_type_key=r.relationship_type_key
JOIN containers p ON p.container_id=r.from_container_id
JOIN containers c ON c.container_id=r.to_container_id
WHERE r.status='active' AND rt.status='active' AND rt.contributes_to_ancestry=1
  AND p.status='active' AND c.status='active'
  AND (r.valid_from IS NULL OR r.valid_from<=CURRENT_TIMESTAMP)
  AND (r.valid_until IS NULL OR r.valid_until>CURRENT_TIMESTAMP);

CREATE OR REPLACE VIEW `v_container_relationship_issues` AS
SELECT r.relationship_id,r.tenant_id,'self_relationship' AS issue_code,'Containment and graph edges cannot target the same container.' AS issue_detail
FROM container_relationships r WHERE r.from_container_id=r.to_container_id
UNION ALL
SELECT r.relationship_id,r.tenant_id,'from_container_missing','The source container does not exist.'
FROM container_relationships r LEFT JOIN containers c ON c.container_id=r.from_container_id WHERE c.container_id IS NULL
UNION ALL
SELECT r.relationship_id,r.tenant_id,'to_container_missing','The target container does not exist.'
FROM container_relationships r LEFT JOIN containers c ON c.container_id=r.to_container_id WHERE c.container_id IS NULL
UNION ALL
SELECT r.relationship_id,r.tenant_id,'cross_tenant_relationship','Relationship tenant and container tenants do not match.'
FROM container_relationships r
JOIN containers p ON p.container_id=r.from_container_id
JOIN containers c ON c.container_id=r.to_container_id
WHERE r.tenant_id<>p.tenant_id OR r.tenant_id<>c.tenant_id OR p.tenant_id<>c.tenant_id
UNION ALL
SELECT r.relationship_id,r.tenant_id,'relationship_type_missing_or_disabled','Relationship type is missing or disabled.'
FROM container_relationships r
LEFT JOIN container_relationship_type_registry rt ON rt.relationship_type_key=r.relationship_type_key
WHERE rt.relationship_type_key IS NULL OR rt.status<>'active';

CREATE OR REPLACE VIEW `v_container_authority_foundation_summary` AS
SELECT
  (SELECT COUNT(*) FROM container_type_registry WHERE status='active') AS active_container_type_count,
  (SELECT COUNT(*) FROM containers WHERE status='active') AS active_container_count,
  (SELECT COUNT(*) FROM container_relationship_type_registry WHERE status='active') AS active_relationship_type_count,
  (SELECT COUNT(*) FROM container_relationships WHERE status='active') AS active_relationship_count,
  (SELECT COUNT(*) FROM container_classification_type_registry WHERE status='active') AS active_classification_type_count,
  (SELECT COUNT(*) FROM container_role_template_registry WHERE status='active') AS active_role_template_count,
  (SELECT COUNT(*) FROM container_resource_dimension_registry WHERE status='active') AS active_dimension_count,
  (SELECT COUNT(*) FROM v_container_relationship_issues) AS relationship_issue_count,
  0 AS runtime_enforcement_enabled,
  0 AS provider_calls_enabled,
  0 AS credential_payload_reads_enabled,
  0 AS secrets_included;

INSERT INTO `platform_closure_threads`
  (`thread_key`,`state`,`required_evidence_json`,`observed_evidence_json`,`blocker_json`,`next_action`,`owner_engine_key`)
VALUES
  ('dynamic_container_authority_foundation','validating',
   JSON_ARRAY('migration_319_schema_readback','cycle_validation_tests','deterministic_merge_tests','shadow_resolver_plan'),
   JSON_ARRAY('spec_001_dynamic_container_authority'),JSON_ARRAY(),
   'Implement read-only shadow resolver before any runtime enforcement.','resource_authority_engine')
ON DUPLICATE KEY UPDATE
  state=VALUES(state),required_evidence_json=VALUES(required_evidence_json),observed_evidence_json=VALUES(observed_evidence_json),
  blocker_json=VALUES(blocker_json),next_action=VALUES(next_action),owner_engine_key=VALUES(owner_engine_key),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `governed_migration_authorization_registry`
  (`migration_file`,`authorization_status`,`authorization_source`,`policy_key`,`risk_tier`,`requires_preflight`,`requires_confirmation`,`allow_record_only`,`allow_apply`,`notes`,`metadata_json`)
VALUES
  ('319_sprint69_dynamic_container_authority_foundation.sql','authorized','migration_seed',
   'governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize additive Dynamic Container Authority registry, graph, classification, role, dimension, epoch, and read-model foundation. Runtime enforcement remains disabled.',
   JSON_OBJECT('scope','dynamic_container_authority_foundation','runtime_enforcement',false,'provider_calls',false,
               'credential_payload_reads',false,'external_writes',false,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),authorization_source=VALUES(authorization_source),policy_key=VALUES(policy_key),
  risk_tier=VALUES(risk_tier),requires_preflight=VALUES(requires_preflight),requires_confirmation=VALUES(requires_confirmation),
  allow_record_only=VALUES(allow_record_only),allow_apply=VALUES(allow_apply),notes=VALUES(notes),metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
