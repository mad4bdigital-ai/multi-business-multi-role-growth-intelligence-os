-- Spec 011 T500: preserve historical virtual leases while allowing real ephemeral checkout workspaces.
-- This migration is additive at the enum-contract level. It does not create workspaces or migrate rows.

ALTER TABLE operation_managed_git_worker_leases
  MODIFY COLUMN checkout_strategy
    ENUM('virtual_git_tree', 'ephemeral_checkout')
    NOT NULL;
