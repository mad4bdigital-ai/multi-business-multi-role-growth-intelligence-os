-- Sprint 62s: DB-governed graph memory ranking rules
-- Lets platform admins tune graph-memory retrieval ranking without changing runtime code.

CREATE TABLE IF NOT EXISTS `platform_graph_memory_rank_rules` (
  `rule_key` VARCHAR(96) NOT NULL,
  `description` TEXT NULL,
  `weight` INT NOT NULL DEFAULT 0,
  `condition_type` VARCHAR(64) NOT NULL DEFAULT 'score_bonus',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`rule_key`),
  KEY `idx_graph_memory_rank_rules_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `platform_graph_memory_rank_rules`
  (`rule_key`, `description`, `weight`, `condition_type`, `status`)
VALUES
  ('direct_asset_match', 'Boost assets explicitly requested by asset_id or directly discovered as graph json_asset nodes.', 100, 'score_bonus', 'active'),
  ('asset_graph_node_match', 'Boost assets whose own graph node is inside the resolved graph context.', 60, 'score_bonus', 'active'),
  ('attached_scope_match', 'Boost assets attached_to one of the resolved graph context nodes.', 40, 'score_bonus', 'active'),
  ('validated_asset', 'Small boost for validated json_assets.', 10, 'score_bonus', 'active'),
  ('knowledge_asset_type', 'Small boost for doctrine, memory, and knowledge asset types.', 5, 'score_bonus', 'active')
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`),
  `condition_type` = VALUES(`condition_type`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;
