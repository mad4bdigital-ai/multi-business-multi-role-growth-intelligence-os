-- Staging-local compatibility alignment for the repository authority readiness view.
-- The baseline brands table predates the status column; the later view uses it
-- to exclude archived/disabled/inactive brands. Keep the historical view immutable.

ALTER TABLE `brands`
  ADD COLUMN IF NOT EXISTS `status` VARCHAR(32) NOT NULL DEFAULT 'active' AFTER `transport_enabled`;
