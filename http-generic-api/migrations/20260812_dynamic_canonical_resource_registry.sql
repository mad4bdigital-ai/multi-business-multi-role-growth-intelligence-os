-- Spec 018 / Dynamic Canonical Resource Registry
-- Additive source-of-truth registry. This migration does not remove the legacy activation fallback.

CREATE TABLE IF NOT EXISTS `canonical_resource_registry` (
  `resource_key` VARCHAR(191) NOT NULL,
  `path` VARCHAR(512) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL DEFAULT 'document',
  `resource_class` ENUM('runtime_critical','routing_index','on_demand_searchable') NOT NULL DEFAULT 'on_demand_searchable',
  `load_strategy` ENUM('integrity_only','load_at_activation','on_demand_search') NOT NULL DEFAULT 'on_demand_search',
  `validation_strategy` ENUM('exists_nonempty','json_valid','generated_canonical','sha256_attested') NOT NULL DEFAULT 'exists_nonempty',
  `required_at_activation` TINYINT(1) NOT NULL DEFAULT 0,
  `searchable` TINYINT(1) NOT NULL DEFAULT 1,
  `environment_scope` ENUM('all','staging','production') NOT NULL DEFAULT 'all',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `registry_revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `metadata_json` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`resource_key`),
  UNIQUE KEY `uq_canonical_resource_registry_path` (`path`),
  KEY `idx_canonical_resource_activation` (`enabled`,`required_at_activation`,`environment_scope`,`resource_class`),
  KEY `idx_canonical_resource_searchable` (`enabled`,`searchable`,`resource_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `canonical_resource_registry`
  (`resource_key`,`path`,`resource_type`,`resource_class`,`load_strategy`,`validation_strategy`,`required_at_activation`,`searchable`,`environment_scope`,`enabled`,`registry_revision`,`metadata_json`)
VALUES
  ('ai_agent_knowledge_guide','AI_Agent_Knowledge_Guide.md','document','runtime_critical','integrity_only','exists_nonempty',1,1,'all',1,1,JSON_OBJECT('legacy_required_reference',TRUE)),
  ('system_bootstrap','system_bootstrap.md','document','runtime_critical','load_at_activation','exists_nonempty',1,0,'all',1,1,JSON_OBJECT('legacy_required_reference',TRUE)),
  ('memory_schema','memory_schema.json','schema','runtime_critical','load_at_activation','json_valid',1,0,'all',1,1,JSON_OBJECT('legacy_required_reference',TRUE)),
  ('direct_instructions_registry','direct_instructions_registry_patch.md','generated_canonical','runtime_critical','integrity_only','generated_canonical',1,1,'all',1,1,JSON_OBJECT('legacy_required_reference',TRUE)),
  ('module_loader','module_loader.md','routing_index','runtime_critical','load_at_activation','exists_nonempty',1,0,'all',1,1,JSON_OBJECT('legacy_required_reference',TRUE)),
  ('prompt_router','prompt_router.md','routing_index','runtime_critical','load_at_activation','exists_nonempty',1,0,'all',1,1,JSON_OBJECT('legacy_required_reference',TRUE))
ON DUPLICATE KEY UPDATE
  `path`=VALUES(`path`),
  `resource_type`=VALUES(`resource_type`),
  `resource_class`=VALUES(`resource_class`),
  `load_strategy`=VALUES(`load_strategy`),
  `validation_strategy`=VALUES(`validation_strategy`),
  `required_at_activation`=VALUES(`required_at_activation`),
  `searchable`=VALUES(`searchable`),
  `environment_scope`=VALUES(`environment_scope`),
  `enabled`=VALUES(`enabled`),
  `metadata_json`=VALUES(`metadata_json`),
  `updated_at`=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_canonical_resource_activation_registry` AS
SELECT
  `resource_key`,`path`,`resource_type`,`resource_class`,`load_strategy`,`validation_strategy`,
  `required_at_activation`,`searchable`,`environment_scope`,`registry_revision`,`updated_at`
FROM `canonical_resource_registry`
WHERE `enabled` = 1 AND `required_at_activation` = 1;
