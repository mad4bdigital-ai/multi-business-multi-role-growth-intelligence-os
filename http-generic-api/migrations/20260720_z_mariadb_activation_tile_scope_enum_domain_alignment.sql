-- Add the platform-admin scope used by the next operational tile seed.
-- Additive enum-domain alignment only; no activation or provider operation.

ALTER TABLE activation_operational_tile_registry
  MODIFY COLUMN scope_class ENUM('platform','tenant','user','brand','device','mixed','platform_admin') NOT NULL DEFAULT 'mixed';
