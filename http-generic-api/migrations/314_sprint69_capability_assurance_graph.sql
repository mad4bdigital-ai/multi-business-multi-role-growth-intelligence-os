-- Sprint 69: canonical capability assurance graph, evidence, certification, debt, and provenance.
-- Additive and idempotent. Registry/readback surfaces only; no provider execution.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

CREATE TABLE IF NOT EXISTS `platform_plugins` (
  `plugin_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `plugin_family` VARCHAR(128) NOT NULL,
  `source_kind` VARCHAR(64) NOT NULL DEFAULT 'legacy_registry',
  `owner_scope` VARCHAR(64) NOT NULL DEFAULT 'internal',
  `trust_level` VARCHAR(64) NOT NULL DEFAULT 'governed',
  `status` VARCHAR(64) NOT NULL DEFAULT 'active',
  `version` VARCHAR(64) NULL,
  `manifest_json` LONGTEXT NULL,
  `governance_policy_key` VARCHAR(191) NULL,
  `credential_policy_key` VARCHAR(191) NULL,
  `runtime_policy_key` VARCHAR(191) NULL,
  `source_table` VARCHAR(191) NULL,
  `source_key` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`plugin_key`),
  KEY `idx_platform_plugins_family_status` (`plugin_family`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_plugin_capabilities` (
  `capability_key` VARCHAR(191) NOT NULL,
  `plugin_key` VARCHAR(191) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `capability_family` VARCHAR(128) NOT NULL,
  `source_table` VARCHAR(191) NOT NULL,
  `source_key` VARCHAR(255) NOT NULL,
  `operation_class` VARCHAR(128) NOT NULL,
  `risk_class` VARCHAR(64) NOT NULL,
  `runtime_status` VARCHAR(64) NOT NULL,
  `exposure_scope` VARCHAR(64) NOT NULL,
  `authority_requirement_type` ENUM('none','invocation','resource','approval','quota','combined') NOT NULL DEFAULT 'none',
  `resource_authority_required` TINYINT(1) NOT NULL DEFAULT 0,
  `dispatch_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `apply_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_audit_evidence` TINYINT(1) NOT NULL DEFAULT 0,
  `requires_readback` TINYINT(1) NOT NULL DEFAULT 0,
  `legacy_evidence_ref` VARCHAR(255) NULL,
  `metadata_json` LONGTEXT NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`capability_key`),
  KEY `idx_ppc_plugin_status` (`plugin_key`, `status`),
  KEY `idx_ppc_authority` (`authority_requirement_type`, `resource_authority_required`),
  KEY `idx_ppc_dispatch_apply` (`dispatch_allowed`, `apply_allowed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_plugin_bindings` (
  `binding_key` VARCHAR(191) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `binding_family` VARCHAR(128) NOT NULL,
  `source_table` VARCHAR(191) NOT NULL,
  `source_key` VARCHAR(255) NOT NULL,
  `binding_status` VARCHAR(64) NOT NULL,
  `exposure_scope` VARCHAR(64) NOT NULL,
  `credential_source` VARCHAR(128) NULL,
  `dispatch_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `apply_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `metadata_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`binding_key`),
  KEY `idx_ppb_capability_status` (`capability_key`, `binding_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_plugin_capability_exports` (
  `export_key` VARCHAR(191) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `export_surface` VARCHAR(128) NOT NULL,
  `source_table` VARCHAR(191) NOT NULL,
  `source_key` VARCHAR(255) NOT NULL,
  `export_status` VARCHAR(64) NOT NULL,
  `exposure_scope` VARCHAR(64) NOT NULL,
  `http_method` VARCHAR(16) NULL,
  `http_path` VARCHAR(512) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`export_key`),
  KEY `idx_ppce_capability_status` (`capability_key`, `export_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_source_links` (
  `link_id` CHAR(64) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `source_kind` VARCHAR(64) NOT NULL,
  `source_ref` VARCHAR(512) NOT NULL,
  `source_sha` CHAR(64) NULL,
  `resolution_status` VARCHAR(64) NOT NULL DEFAULT 'resolved',
  `confidence` DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
  `evidence_id` VARCHAR(191) NULL,
  `metadata_json` LONGTEXT NULL,
  `observed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`link_id`),
  KEY `idx_pcsl_capability_status` (`capability_key`, `resolution_status`),
  KEY `idx_pcsl_source_kind` (`source_kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_evidence_events` (
  `evidence_id` VARCHAR(191) NOT NULL,
  `evidence_type` VARCHAR(128) NOT NULL,
  `subject_type` VARCHAR(96) NOT NULL,
  `subject_key` VARCHAR(255) NOT NULL,
  `capability_key` VARCHAR(191) NULL,
  `envelope_id` VARCHAR(36) NULL,
  `binding_id` VARCHAR(36) NULL,
  `certification_id` VARCHAR(191) NULL,
  `source_system` VARCHAR(128) NOT NULL DEFAULT 'mysql_primary',
  `source_ref` VARCHAR(512) NULL,
  `source_sha` CHAR(64) NULL,
  `evidence_status` ENUM('observed','passed','blocked','failed','expired','revoked','superseded') NOT NULL DEFAULT 'observed',
  `reason_code` VARCHAR(191) NULL,
  `payload_hash` CHAR(64) NULL,
  `evidence_json` LONGTEXT NULL,
  `observed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `supersedes_evidence_id` VARCHAR(191) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`evidence_id`),
  KEY `idx_pee_capability_type` (`capability_key`, `evidence_type`),
  KEY `idx_pee_envelope` (`envelope_id`),
  KEY `idx_pee_binding` (`binding_id`),
  KEY `idx_pee_status_freshness` (`evidence_status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_envelope_evidence_links` (
  `envelope_id` VARCHAR(36) NOT NULL,
  `evidence_id` VARCHAR(191) NOT NULL,
  `link_role` VARCHAR(64) NOT NULL DEFAULT 'decision_evidence',
  `status` VARCHAR(64) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`envelope_id`, `evidence_id`, `link_role`),
  KEY `idx_pceel_evidence` (`evidence_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_envelope_binding_links` (
  `envelope_id` VARCHAR(36) NOT NULL,
  `binding_id` VARCHAR(36) NOT NULL,
  `link_role` VARCHAR(64) NOT NULL DEFAULT 'resource_authority',
  `status` VARCHAR(64) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`envelope_id`, `binding_id`, `link_role`),
  KEY `idx_pcebl_binding` (`binding_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_certifications` (
  `certification_id` VARCHAR(191) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `certification_type` VARCHAR(128) NOT NULL,
  `environment` VARCHAR(64) NOT NULL DEFAULT 'production',
  `subject_type` VARCHAR(96) NULL,
  `subject_key` VARCHAR(255) NULL,
  `certification_status` VARCHAR(96) NOT NULL,
  `evidence_id` VARCHAR(191) NULL,
  `source_registry` VARCHAR(191) NULL,
  `source_key` VARCHAR(255) NULL,
  `certified_at` DATETIME NULL,
  `expires_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `metadata_json` LONGTEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`certification_id`),
  KEY `idx_pcc_capability_status` (`capability_key`, `certification_status`),
  KEY `idx_pcc_expiry` (`expires_at`, `revoked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_capability_debt` (
  `debt_id` CHAR(64) NOT NULL,
  `capability_key` VARCHAR(191) NOT NULL,
  `gap_key` VARCHAR(128) NOT NULL,
  `severity` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `source_view` VARCHAR(191) NOT NULL DEFAULT 'v_platform_capability_assurance_gaps',
  `status` ENUM('open','accepted','in_progress','resolved','superseded') NOT NULL DEFAULT 'open',
  `blocks_dispatch` TINYINT(1) NOT NULL DEFAULT 0,
  `blocks_apply` TINYINT(1) NOT NULL DEFAULT 0,
  `recommended_fix` TEXT NULL,
  `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` DATETIME NULL,
  `evidence_id` VARCHAR(191) NULL,
  `metadata_json` LONGTEXT NULL,
  PRIMARY KEY (`debt_id`),
  KEY `idx_pcd_capability_status` (`capability_key`, `status`),
  KEY `idx_pcd_severity_status` (`severity`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_closure_threads` (
  `thread_key` VARCHAR(191) NOT NULL,
  `capability_key` VARCHAR(191) NULL,
  `state` ENUM('open','planned','validating','blocked','certified','superseded','archived') NOT NULL DEFAULT 'open',
  `required_evidence_json` LONGTEXT NULL,
  `observed_evidence_json` LONGTEXT NULL,
  `blocker_json` LONGTEXT NULL,
  `next_action` VARCHAR(255) NULL,
  `owner_engine_key` VARCHAR(191) NULL,
  `opened_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `closed_at` DATETIME NULL,
  PRIMARY KEY (`thread_key`),
  KEY `idx_pct_state_owner` (`state`, `owner_engine_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_secret_movement_ledger` (
  `movement_id` VARCHAR(36) NOT NULL,
  `source_type` VARCHAR(128) NOT NULL,
  `source_id` VARCHAR(191) NULL,
  `target_type` VARCHAR(128) NOT NULL,
  `target_id` VARCHAR(191) NOT NULL,
  `target_field` VARCHAR(128) NOT NULL,
  `value_sha256` CHAR(64) NOT NULL,
  `actor_id` VARCHAR(191) NULL,
  `policy_key` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `readback_sha256` CHAR(64) NULL,
  `movement_status` ENUM('observed','verified','failed','revoked') NOT NULL DEFAULT 'observed',
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`movement_id`),
  KEY `idx_psml_target_hash` (`target_id`(100), `value_sha256`),
  KEY `idx_psml_source` (`source_type`, `source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`,`display_name`,`description`,`http_method`,`http_path`,`path_param_keys`,`input_schema`,`fixed_body`,`tags`,`is_enabled`,`sort_order`,`created_at`,`updated_at`)
VALUES
  ('platform_capability_assurance_reconcile',
   'Reconcile Platform Capability Assurance Graph',
   'Build a dry-run reconciliation plan by default, or apply canonical capability, provenance, evidence, certification, and debt upserts only with a ready capability envelope. Performs no provider calls and returns no secrets.',
   'POST','/admin/control',JSON_ARRAY(),
   JSON_OBJECT('type','object','required',JSON_ARRAY('tool','action','alias'),'additionalProperties',false,'properties',JSON_OBJECT(
     'tool',JSON_OBJECT('type','string','const','shell'),
     'action',JSON_OBJECT('type','string','const','run'),
     'alias',JSON_OBJECT('type','string','const','platform_capability_assurance_reconcile'),
     'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8)
   )),
   NULL,
   'admin,capability,assurance,reconcile,dry_run_default,capability_envelope,no_provider_call,no_external_write,no_secrets',
   1,735,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order), updated_at=CURRENT_TIMESTAMP;

INSERT INTO `runtime_dispatch_certification_registry`
  (`certification_key`,`surface_key`,`surface_family`,`tool_or_action_key`,`risk_class`,`certification_status`,`smoke_strategy`,
   `dispatch_allowed`,`apply_allowed`,`requires_resource_authority`,`requires_dry_run`,`requires_audit_evidence`,`requires_readback`,
   `last_evidence_ref`,`last_certified_at`,`expires_at`,`notes`)
VALUES
  ('platform_capability_assurance_reconcile','platform_capability_assurance_reconcile','capability_assurance',
   'platform_capability_assurance_reconcile','C','migration_registered_apply_envelope_required','registry_reconciliation_dry_run',
   1,0,1,1,1,1,'migration:314_sprint69_capability_assurance_graph.sql',CURRENT_TIMESTAMP,NULL,
   'Dry-run by default. Apply requires a ready capability envelope and writes only canonical registry/evidence/debt rows.')
ON DUPLICATE KEY UPDATE
  certification_status=VALUES(certification_status), dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=VALUES(apply_allowed),
  requires_resource_authority=VALUES(requires_resource_authority), requires_dry_run=VALUES(requires_dry_run),
  requires_audit_evidence=VALUES(requires_audit_evidence), requires_readback=VALUES(requires_readback),
  last_evidence_ref=VALUES(last_evidence_ref), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugins`
  (`plugin_key`,`display_name`,`plugin_family`,`source_kind`,`owner_scope`,`trust_level`,`status`,`source_table`,`source_key`)
SELECT DISTINCT
  c.source_table,REPLACE(c.source_table,'_',' '),c.capability_family,'legacy_registry',c.exposure_scope,'governed',
  CASE WHEN c.runtime_status='disabled' THEN 'disabled' ELSE 'active' END,c.source_table,c.source_table
FROM `v_platform_capabilities_current` c
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),plugin_family=VALUES(plugin_family),owner_scope=VALUES(owner_scope),
  status=VALUES(status),source_table=VALUES(source_table),source_key=VALUES(source_key),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_capabilities`
  (`capability_key`,`plugin_key`,`display_name`,`capability_family`,`source_table`,`source_key`,`operation_class`,`risk_class`,
   `runtime_status`,`exposure_scope`,`authority_requirement_type`,`resource_authority_required`,`dispatch_allowed`,`apply_allowed`,
   `requires_audit_evidence`,`requires_readback`,`legacy_evidence_ref`,`metadata_json`,`status`)
SELECT
  c.capability_key,c.source_table,c.display_name,c.capability_family,c.source_table,c.source_key,c.operation_class,c.risk_class,
  c.runtime_status,c.exposure_scope,
  CASE
    WHEN c.resource_authority_required=0 THEN 'none'
    WHEN c.source_table IN ('admin_platform_endpoint_tools','tenant_platform_endpoint_tools') THEN 'invocation'
    WHEN c.apply_allowed=1 OR c.risk_class IN ('D','critical') THEN 'combined'
    ELSE 'resource'
  END,
  c.resource_authority_required,c.dispatch_allowed,c.apply_allowed,c.requires_audit_evidence,c.requires_readback,c.evidence_ref,
  JSON_OBJECT('legacy_notes',c.notes,'backfill_source','v_platform_capabilities_current'),
  CASE WHEN c.runtime_status='disabled' THEN 'disabled' ELSE 'active' END
FROM `v_platform_capabilities_current` c
ON DUPLICATE KEY UPDATE
  plugin_key=VALUES(plugin_key),display_name=VALUES(display_name),capability_family=VALUES(capability_family),
  source_table=VALUES(source_table),source_key=VALUES(source_key),operation_class=VALUES(operation_class),risk_class=VALUES(risk_class),
  runtime_status=VALUES(runtime_status),exposure_scope=VALUES(exposure_scope),authority_requirement_type=VALUES(authority_requirement_type),
  resource_authority_required=VALUES(resource_authority_required),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  requires_audit_evidence=VALUES(requires_audit_evidence),requires_readback=VALUES(requires_readback),
  legacy_evidence_ref=VALUES(legacy_evidence_ref),metadata_json=VALUES(metadata_json),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_bindings`
  (`binding_key`,`capability_key`,`binding_family`,`source_table`,`source_key`,`binding_status`,`exposure_scope`,
   `credential_source`,`dispatch_allowed`,`apply_allowed`,`metadata_json`)
SELECT b.binding_key,b.capability_key,b.binding_family,b.source_table,b.source_key,b.binding_status,b.exposure_scope,
       b.credential_source,b.dispatch_allowed,b.apply_allowed,JSON_OBJECT('legacy_notes',b.notes)
FROM `v_platform_bindings_current` b
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),binding_family=VALUES(binding_family),source_table=VALUES(source_table),
  source_key=VALUES(source_key),binding_status=VALUES(binding_status),exposure_scope=VALUES(exposure_scope),
  credential_source=VALUES(credential_source),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_capability_exports`
  (`export_key`,`capability_key`,`export_surface`,`source_table`,`source_key`,`export_status`,`exposure_scope`,`http_method`,`http_path`,`notes`)
SELECT x.export_key,x.capability_key,x.export_surface,x.source_table,x.source_key,x.export_status,x.exposure_scope,x.http_method,x.http_path,x.notes
FROM `v_platform_exports_current` x
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),export_surface=VALUES(export_surface),source_table=VALUES(source_table),
  source_key=VALUES(source_key),export_status=VALUES(export_status),exposure_scope=VALUES(exposure_scope),
  http_method=VALUES(http_method),http_path=VALUES(http_path),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_capability_source_links`
  (`link_id`,`capability_key`,`source_kind`,`source_ref`,`resolution_status`,`confidence`,`metadata_json`)
SELECT SHA2(CONCAT(c.capability_key,'|registry|',c.source_table,'|',c.source_key),256),
       c.capability_key,'mysql_registry',CONCAT(c.source_table,':',c.source_key),'resolved',1.0000,
       JSON_OBJECT('source_table',c.source_table,'source_key',c.source_key,'backfill','migration_314')
FROM `v_platform_capabilities_current` c
ON DUPLICATE KEY UPDATE
  resolution_status='resolved',confidence=1.0000,metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_evidence_events`
  (`evidence_id`,`evidence_type`,`subject_type`,`subject_key`,`capability_key`,`envelope_id`,`source_system`,`source_ref`,
   `evidence_status`,`reason_code`,`payload_hash`,`evidence_json`,`observed_at`,`expires_at`,`secrets_included`)
SELECT CONCAT('envelope:',e.envelope_id,':decision'),'capability_envelope_decision','capability_invocation',e.envelope_id,
       e.capability_key,e.envelope_id,'capability_resolution_envelope_ledger',CONCAT('envelope:',e.envelope_id),
       CASE WHEN e.envelope_status IN ('ready_for_dispatch','ready_requires_approval') THEN 'passed'
            WHEN e.envelope_status='blocked' THEN 'blocked'
            WHEN e.envelope_status='expired' THEN 'expired' ELSE 'observed' END,
       e.decision,e.envelope_sha256,
       JSON_OBJECT('authority_status',e.authority_status,'decision',e.decision,'dispatch_allowed',e.dispatch_allowed,
                   'apply_allowed',e.apply_allowed,'blocking_gap_count',e.blocking_gap_count,'secrets_included',false),
       e.created_at,e.expires_at,0
FROM `capability_resolution_envelope_ledger` e
ON DUPLICATE KEY UPDATE
  evidence_status=VALUES(evidence_status),reason_code=VALUES(reason_code),payload_hash=VALUES(payload_hash),
  evidence_json=VALUES(evidence_json),expires_at=VALUES(expires_at),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_capability_envelope_evidence_links`
  (`envelope_id`,`evidence_id`,`link_role`,`status`)
SELECT e.envelope_id,CONCAT('envelope:',e.envelope_id,':decision'),'decision_evidence','active'
FROM `capability_resolution_envelope_ledger` e
ON DUPLICATE KEY UPDATE status='active';

INSERT INTO `platform_evidence_events`
  (`evidence_id`,`evidence_type`,`subject_type`,`subject_key`,`binding_id`,`source_system`,`source_ref`,`evidence_status`,
   `reason_code`,`payload_hash`,`evidence_json`,`observed_at`,`expires_at`,`revoked_at`,`secrets_included`)
SELECT CONCAT('authority-binding:',b.binding_id,':state'),'resource_binding_state','resource_binding',b.binding_id,b.binding_id,
       'platform_resource_authority_bindings',b.resource_uri,
       CASE WHEN b.status='active' AND (b.expires_at IS NULL OR b.expires_at>CURRENT_TIMESTAMP) THEN 'passed'
            WHEN b.status='revoked' THEN 'revoked' WHEN b.status='expired' THEN 'expired' ELSE 'blocked' END,
       CONCAT('binding_',b.status),
       SHA2(CONCAT(b.binding_id,'|',b.status,'|',b.permission_level,'|',COALESCE(b.expires_at,'')),256),
       JSON_OBJECT('resource_type',b.resource_type,'permission_level',b.permission_level,'status',b.status,'secrets_included',false),
       b.created_at,b.expires_at,CASE WHEN b.status='revoked' THEN b.updated_at ELSE NULL END,0
FROM `platform_resource_authority_bindings` b
ON DUPLICATE KEY UPDATE
  evidence_status=VALUES(evidence_status),reason_code=VALUES(reason_code),payload_hash=VALUES(payload_hash),
  evidence_json=VALUES(evidence_json),expires_at=VALUES(expires_at),revoked_at=VALUES(revoked_at),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_capability_certifications`
  (`certification_id`,`capability_key`,`certification_type`,`environment`,`subject_type`,`subject_key`,`certification_status`,
   `evidence_id`,`source_registry`,`source_key`,`certified_at`,`expires_at`,`metadata_json`,`secrets_included`)
SELECT CONCAT('runtime:',c.certification_key),CONCAT('runtime_dispatch_certification.',c.certification_key),'runtime_dispatch','production',
       'runtime_surface',c.surface_key,c.certification_status,CONCAT('certification:',c.certification_key,':state'),
       'runtime_dispatch_certification_registry',c.certification_key,c.last_certified_at,c.expires_at,
       JSON_OBJECT('dispatch_allowed',c.dispatch_allowed,'apply_allowed',c.apply_allowed,'requires_readback',c.requires_readback,
                   'last_evidence_ref',c.last_evidence_ref,'secrets_included',false),0
FROM `runtime_dispatch_certification_registry` c
ON DUPLICATE KEY UPDATE
  certification_status=VALUES(certification_status),evidence_id=VALUES(evidence_id),certified_at=VALUES(certified_at),
  expires_at=VALUES(expires_at),metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_evidence_events`
  (`evidence_id`,`evidence_type`,`subject_type`,`subject_key`,`capability_key`,`certification_id`,`source_system`,`source_ref`,
   `evidence_status`,`reason_code`,`payload_hash`,`evidence_json`,`observed_at`,`expires_at`,`secrets_included`)
SELECT CONCAT('certification:',c.certification_key,':state'),'capability_certification','runtime_surface',c.surface_key,
       CONCAT('runtime_dispatch_certification.',c.certification_key),CONCAT('runtime:',c.certification_key),
       'runtime_dispatch_certification_registry',c.last_evidence_ref,
       CASE WHEN c.dispatch_allowed=1 AND (c.expires_at IS NULL OR c.expires_at>CURRENT_TIMESTAMP) THEN 'passed'
            WHEN c.expires_at IS NOT NULL AND c.expires_at<=CURRENT_TIMESTAMP THEN 'expired' ELSE 'blocked' END,
       c.certification_status,
       SHA2(CONCAT(c.certification_key,'|',c.certification_status,'|',c.dispatch_allowed,'|',c.apply_allowed),256),
       JSON_OBJECT('smoke_strategy',c.smoke_strategy,'requires_readback',c.requires_readback,'secrets_included',false),
       COALESCE(c.last_certified_at,c.created_at),c.expires_at,0
FROM `runtime_dispatch_certification_registry` c
ON DUPLICATE KEY UPDATE
  evidence_status=VALUES(evidence_status),reason_code=VALUES(reason_code),payload_hash=VALUES(payload_hash),
  evidence_json=VALUES(evidence_json),expires_at=VALUES(expires_at),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_secret_movement_ledger`
  (`movement_id`,`source_type`,`source_id`,`target_type`,`target_id`,`target_field`,`value_sha256`,`actor_id`,`policy_key`,
   `reason`,`readback_sha256`,`movement_status`,`secrets_included`,`occurred_at`)
SELECT UUID(),'user_app_connection',m.connection_id,'platform_secret',p.secret_key,'encrypted_value_slot',p.value_sha256,p.created_by,
       'platform_secret_promotion_policy_v1',m.metadata_source,
       SHA2(CONCAT(p.secret_key,'|',p.value_sha256,'|',p.status),256),
       CASE WHEN m.issue_code IS NULL AND p.status='active' THEN 'verified' ELSE 'observed' END,0,p.created_at
FROM `platform_secrets` p
JOIN `v_platform_secret_promotion_monitoring` m ON m.secret_key=p.secret_key
WHERE p.value_sha256 IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `platform_secret_movement_ledger` l
     WHERE l.target_id=p.secret_key AND l.value_sha256=p.value_sha256
  );

CREATE OR REPLACE VIEW `v_effective_platform_resource_authority_bindings` AS
SELECT b.*,
       CASE WHEN b.status='active' AND (b.expires_at IS NULL OR b.expires_at>CURRENT_TIMESTAMP) THEN 1 ELSE 0 END AS is_effective
FROM `platform_resource_authority_bindings` b
WHERE b.status='active' AND (b.expires_at IS NULL OR b.expires_at>CURRENT_TIMESTAMP);

CREATE OR REPLACE VIEW `v_platform_capability_readiness_vector` AS
SELECT
  c.capability_key,c.display_name,c.capability_family,c.source_table,c.source_key,c.operation_class,c.risk_class,
  c.runtime_status,c.exposure_scope,c.authority_requirement_type,c.resource_authority_required,
  1 AS discoverable,
  1 AS registered,
  CASE WHEN c.exposure_scope NOT IN ('admin','tenant') OR EXISTS (
    SELECT 1 FROM platform_plugin_capability_exports x WHERE x.capability_key=c.capability_key AND x.export_status='active'
  ) THEN 1 ELSE 0 END AS exported,
  CASE WHEN c.dispatch_allowed=1 THEN 1 ELSE 0 END AS routable,
  1 AS authority_model_ready,
  CASE
    WHEN c.authority_requirement_type IN ('none','invocation','approval','quota') THEN 1
    WHEN c.legacy_evidence_ref IS NOT NULL THEN 1
    WHEN EXISTS (
      SELECT 1
      FROM platform_capability_envelope_binding_links bl
      JOIN capability_resolution_envelope_ledger e ON e.envelope_id=bl.envelope_id
      JOIN v_effective_platform_resource_authority_bindings eb ON eb.binding_id=bl.binding_id
      WHERE bl.status='active'
        AND e.envelope_status='ready_for_dispatch'
        AND e.dispatch_allowed=1
        AND (e.expires_at IS NULL OR e.expires_at>CURRENT_TIMESTAMP)
        AND e.capability_key IN (c.capability_key,c.source_key)
    ) THEN 1
    ELSE 0
  END AS resource_binding_ready,
  CASE WHEN c.dispatch_allowed=1 THEN 1 ELSE 0 END AS dispatchable,
  CASE WHEN c.apply_allowed=1 THEN 1 ELSE 0 END AS applyable,
  CASE WHEN c.requires_readback=0 THEN 1
       WHEN c.source_table='runtime_dispatch_certification_registry' THEN 1
       WHEN EXISTS (SELECT 1 FROM platform_capability_certifications pc
                     WHERE pc.capability_key=c.capability_key AND pc.revoked_at IS NULL
                       AND (pc.expires_at IS NULL OR pc.expires_at>CURRENT_TIMESTAMP)) THEN 1
       ELSE 0 END AS readback_contract_ready,
  CASE WHEN EXISTS (SELECT 1 FROM platform_capability_certifications pc
                     WHERE pc.capability_key=c.capability_key AND pc.revoked_at IS NULL
                       AND pc.certification_status NOT IN ('failed','blocked','revoked','expired')
                       AND (pc.expires_at IS NULL OR pc.expires_at>CURRENT_TIMESTAMP))
       OR c.runtime_status IN ('read_only_certified','diagnostic_certified','certified') THEN 1 ELSE 0 END AS certified,
  CASE WHEN EXISTS (SELECT 1 FROM platform_capability_source_links sl
                     WHERE sl.capability_key=c.capability_key AND sl.resolution_status='resolved') THEN 1 ELSE 0 END AS provenance_ready,
  CASE WHEN EXISTS (SELECT 1 FROM platform_evidence_events ev
                     WHERE ev.capability_key=c.capability_key
                       AND ev.evidence_status='passed'
                       AND ev.revoked_at IS NULL
                       AND (ev.expires_at IS NULL OR ev.expires_at>CURRENT_TIMESTAMP)) THEN 1 ELSE 0 END AS evidence_linked,
  c.dispatch_allowed,c.apply_allowed,c.requires_audit_evidence,c.requires_readback,c.legacy_evidence_ref,
  (
    CASE WHEN c.dispatch_allowed=0 THEN 1 ELSE 0 END +
    CASE WHEN c.authority_requirement_type IN ('resource','combined')
              AND c.legacy_evidence_ref IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM platform_capability_envelope_binding_links bl
                JOIN capability_resolution_envelope_ledger e ON e.envelope_id=bl.envelope_id
                JOIN v_effective_platform_resource_authority_bindings eb ON eb.binding_id=bl.binding_id
                WHERE bl.status='active'
                  AND e.envelope_status='ready_for_dispatch'
                  AND e.dispatch_allowed=1
                  AND (e.expires_at IS NULL OR e.expires_at>CURRENT_TIMESTAMP)
                  AND e.capability_key IN (c.capability_key,c.source_key)
              ) THEN 1 ELSE 0 END
  ) AS hard_block_count
FROM `platform_plugin_capabilities` c
WHERE c.status='active';

CREATE OR REPLACE VIEW `v_platform_capability_assurance_gaps` AS
SELECT capability_key,'dispatch_not_allowed' AS gap_key,
       CASE WHEN risk_class IN ('D','critical') THEN 'high' ELSE 'medium' END AS gap_severity,
       'Capability is registered but dispatch is not currently allowed.' AS gap_description
FROM v_platform_capability_readiness_vector WHERE dispatchable=0
UNION ALL
SELECT capability_key,'resource_binding_missing',
       CASE WHEN risk_class IN ('D','critical') THEN 'high' ELSE 'medium' END,
       'A resource-scoped capability has no capability-specific effective resource binding or legacy authority evidence.'
FROM v_platform_capability_readiness_vector
WHERE authority_requirement_type IN ('resource','combined') AND resource_binding_ready=0
UNION ALL
SELECT capability_key,'active_export_missing','low',
       'An admin or tenant capability has no active public export.'
FROM v_platform_capability_readiness_vector
WHERE exposure_scope IN ('admin','tenant') AND exported=0
UNION ALL
SELECT capability_key,'readback_evidence_missing',
       CASE WHEN risk_class IN ('D','critical') THEN 'high' ELSE 'medium' END,
       'A resource-scoped capability requires readback but has no certified readback contract.'
FROM v_platform_capability_readiness_vector
WHERE authority_requirement_type IN ('resource','combined') AND requires_readback=1 AND readback_contract_ready=0
UNION ALL
SELECT capability_key,'certification_missing',
       CASE WHEN risk_class IN ('D','critical') THEN 'high' WHEN risk_class IN ('C','high') THEN 'medium' ELSE 'low' END,
       'A high-impact runtime/resource capability is dispatchable but lacks a current generic certification.'
FROM v_platform_capability_readiness_vector
WHERE dispatchable=1 AND certified=0
  AND source_table IN ('runtime_dispatch_certification_registry','resource_authority_route_family_registry','platform_plugin_contributions')
UNION ALL
SELECT capability_key,'provenance_missing','low',
       'Capability has no resolved canonical source link.'
FROM v_platform_capability_readiness_vector WHERE provenance_ready=0;

CREATE OR REPLACE VIEW `v_platform_capability_assurance_summary` AS
SELECT
  COUNT(*) AS capability_count,
  SUM(dispatchable=1) AS dispatchable_count,
  SUM(applyable=1) AS applyable_count,
  SUM(certified=1) AS certified_count,
  SUM(provenance_ready=1) AS provenance_ready_count,
  SUM(resource_binding_ready=1) AS resource_binding_ready_count,
  SUM(hard_block_count>0) AS hard_blocked_count
FROM v_platform_capability_readiness_vector;

INSERT INTO `platform_capability_debt`
  (`debt_id`,`capability_key`,`gap_key`,`severity`,`source_view`,`status`,`blocks_dispatch`,`blocks_apply`,`recommended_fix`,`metadata_json`)
SELECT SHA2(CONCAT(g.capability_key,'|',g.gap_key),256),g.capability_key,g.gap_key,g.gap_severity,
       'v_platform_capability_assurance_gaps','open',
       CASE WHEN g.gap_key IN ('dispatch_not_allowed','resource_binding_missing') THEN 1 ELSE 0 END,
       CASE WHEN g.gap_key IN ('resource_binding_missing','readback_evidence_missing','certification_missing') THEN 1 ELSE 0 END,
       g.gap_description,
       JSON_OBJECT('first_backfill','migration_314','secrets_included',false)
FROM `v_platform_capability_assurance_gaps` g
ON DUPLICATE KEY UPDATE
  severity=VALUES(severity),
  status=CASE WHEN platform_capability_debt.status='resolved' THEN 'open' ELSE platform_capability_debt.status END,
  resolved_at=NULL,
  blocks_dispatch=VALUES(blocks_dispatch),blocks_apply=VALUES(blocks_apply),recommended_fix=VALUES(recommended_fix),
  last_seen_at=CURRENT_TIMESTAMP,metadata_json=VALUES(metadata_json);

INSERT INTO `platform_closure_threads`
  (`thread_key`,`state`,`required_evidence_json`,`observed_evidence_json`,`blocker_json`,`next_action`,`owner_engine_key`)
VALUES
  ('capability_assurance_evidence_normalization','validating',
   JSON_ARRAY('platform_evidence_events','envelope_evidence_links','typed_gap_taxonomy'),
   JSON_ARRAY('migration_314_backfill'),JSON_ARRAY(),'run platform_capability_assurance_reconcile after registry changes','resource_authority_engine'),
  ('capability_source_resolution_population','certified',
   JSON_ARRAY('platform_capability_source_links'),JSON_ARRAY('migration_314_backfill'),JSON_ARRAY(),
   'monitor provenance_missing debt','governed_repository_intelligence_engine'),
  ('canonical_capability_graph_backfill','certified',
   JSON_ARRAY('platform_plugins','platform_plugin_capabilities','platform_plugin_bindings','platform_plugin_capability_exports'),
   JSON_ARRAY('migration_314_backfill'),JSON_ARRAY(),'keep compatibility views until canonical cutover is certified','platform_orchestration_engine')
ON DUPLICATE KEY UPDATE
  state=VALUES(state),required_evidence_json=VALUES(required_evidence_json),observed_evidence_json=VALUES(observed_evidence_json),
  blocker_json=VALUES(blocker_json),next_action=VALUES(next_action),owner_engine_key=VALUES(owner_engine_key),updated_at=CURRENT_TIMESTAMP;
