-- Sprint 65: JSON Asset Registry required execution surface.
-- Promotes the SQL-backed JSON Asset Registry surface from authoritative-only
-- to required-for-execution so memory/artifact writes can enforce surface
-- authority as a blocking runtime gate.

UPDATE `registry_surfaces_catalog`
   SET `required_for_execution` = 'TRUE',
       `active_status` = 'active',
       `authority_status` = 'authoritative',
       `backend_type` = COALESCE(NULLIF(`backend_type`, ''), 'sql'),
       `backend_adapter` = COALESCE(NULLIF(`backend_adapter`, ''), 'json_assets_readback_artifact_layer'),
       `authority_model` = COALESCE(NULLIF(`authority_model`, ''), 'sql_runtime_authority'),
       `updated_at` = NOW()
 WHERE `surface_id` = 'surface.json_asset_registry_sheet'
    OR `logical_surface_key` = 'surface.json_asset_registry_sheet'
    OR `surface_name` = 'JSON Asset Registry';

UPDATE `registry_surfaces_catalog`
   SET `retired_replacement_surface_id` = 'surface.json_asset_registry_sheet',
       `active_status` = 'active',
       `authority_status` = 'legacy_alias',
       `required_for_execution` = 'FALSE',
       `updated_at` = NOW()
 WHERE `surface_id` = 'surface.json_asset_registry'
   AND (`retired_replacement_surface_id` IS NULL OR `retired_replacement_surface_id` = '');
