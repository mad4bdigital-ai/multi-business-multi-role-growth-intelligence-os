-- Add the planned adapter kind used by the next GitHub file-content registry seed.
-- Additive enum-domain alignment only; provider/runtime dispatch remains governed elsewhere.

ALTER TABLE platform_resource_adapters
  MODIFY COLUMN adapter_kind ENUM('installed_tool','endpoint_recipe','db_adapter','graph_adapter','composite','planned_runtime_adapter') NOT NULL;
