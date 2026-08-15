-- Purpose: persist write-route policy configuration without hardcoding route decisions.
-- Safety: registry-only; every row is deny-by-default and shadow-only until an
-- independently approved promotion changes the policy. This migration does not
-- apply itself, execute provider calls, read credentials, or activate Production.

CREATE TABLE IF NOT EXISTS `write_route_policy_registry` (
  `policy_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `route_id` varchar(255) NOT NULL,
  `bundle` varchar(64) NOT NULL,
  `risk_class` enum('critical','high','medium','low','unknown') NOT NULL DEFAULT 'unknown',
  `environment` enum('staging','production') NOT NULL DEFAULT 'staging',
  `mode` enum('shadow','staging','production-canary','production-live') NOT NULL DEFAULT 'shadow',
  `status` enum('draft','shadow','canary','active','revoked') NOT NULL DEFAULT 'draft',
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `allowlisted` tinyint(1) NOT NULL DEFAULT 0,
  `approval_required` tinyint(1) NOT NULL DEFAULT 1,
  `approved_by` varchar(191) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `ttl_seconds` int unsigned DEFAULT NULL,
  `quota_limit` int unsigned DEFAULT NULL,
  `lease_seconds` int unsigned DEFAULT NULL,
  `rollback_policy_json` json NOT NULL,
  `readback_policy_json` json NOT NULL,
  `kill_switch_key` varchar(191) NOT NULL,
  `policy_version` int unsigned NOT NULL DEFAULT 1,
  `policy_hash` char(64) NOT NULL,
  `metadata_json` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`policy_id`),
  UNIQUE KEY `uq_write_route_policy_route_env` (`route_id`,`environment`),
  KEY `idx_write_route_policy_lookup` (`environment`,`mode`,`status`,`enabled`),
  KEY `idx_write_route_policy_approval` (`approval_required`,`allowlisted`,`approved_at`),
  CONSTRAINT `chk_write_route_policy_safe_defaults` CHECK (
    (`enabled` = 0)
    OR (`allowlisted` = 1 AND `approval_required` = 1 AND `ttl_seconds` IS NOT NULL AND `quota_limit` IS NOT NULL AND `lease_seconds` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `write_route_policy_audit` (
  `audit_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `policy_id` bigint unsigned NOT NULL,
  `policy_version` int unsigned NOT NULL,
  `actor` varchar(191) NOT NULL,
  `action` enum('create','update','approve','revoke','promote','rollback','kill_switch') NOT NULL,
  `reason` varchar(500) NOT NULL,
  `previous_value_hash` char(64) DEFAULT NULL,
  `new_value_hash` char(64) NOT NULL,
  `receipt_json` json NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`audit_id`),
  KEY `idx_write_route_policy_audit_policy` (`policy_id`,`created_at`),
  CONSTRAINT `fk_write_route_policy_audit_policy` FOREIGN KEY (`policy_id`) REFERENCES `write_route_policy_registry` (`policy_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
