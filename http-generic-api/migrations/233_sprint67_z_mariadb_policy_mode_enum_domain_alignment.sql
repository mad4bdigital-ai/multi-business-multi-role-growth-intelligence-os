-- Add the policy modes used by ordered governance seeds before their first write.
-- Additive enum-domain alignment only; it does not authorize execution.

ALTER TABLE platform_engine_policy_registry
  MODIFY COLUMN mode ENUM('diagnose_only','dry_run','apply_allowed','blocking','blocking_guard') NOT NULL DEFAULT 'diagnose_only';
