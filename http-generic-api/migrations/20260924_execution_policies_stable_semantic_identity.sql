ALTER TABLE `execution_policies`
  DROP INDEX IF EXISTS `idx_policy_group_key`,
  ADD UNIQUE KEY IF NOT EXISTS `uq_execution_policies_policy_identity`
    (`policy_group`, `policy_key`);
