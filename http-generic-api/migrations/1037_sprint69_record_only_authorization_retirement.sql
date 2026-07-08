-- Sprint 69: Retire legacy record-only migration authorizations and catch newly expired referenced envelopes.
-- Internal-only governed cleanup: no provider calls, no credential reads, no raw secrets,
-- no external sends, no external writes, and no deletion.

UPDATE governed_migration_authorization_registry a
   SET a.authorization_status = 'disabled',
       a.authorization_source = '1037_sprint69_record_only_authorization_retirement',
       a.allow_apply = 0,
       a.notes = 'Disabled legacy record-only migration authorization after governed ledger readback confirmed a record_only entry and no apply ledger entry. This prevents stale authorizations from appearing as unapplied migration debt.',
       a.metadata_json = JSON_OBJECT(
         'disabled_by_migration','1037_sprint69_record_only_authorization_retirement.sql',
         'legacy_record_only_authorization_retired',true,
         'apply_ledger_absent',true,
         'secrets_included',false
       ),
       a.updated_at = CURRENT_TIMESTAMP
 WHERE a.migration_file IN (
       '051_sprint48_cloudflare_and_self_repair_tools.sql',
       '052_sprint49_local_connector_install_bundle.sql',
       '054_sprint50_admin_device_seed_and_self_repair_tool.sql',
       '055_sprint51_sql_primary_data_source.sql',
       '057_sprint53_admin_session_turn_tools.sql',
       '162_sprint66_cms_site_resource_access_grants.sql',
       '163_sprint65_session_archive_smoke_tool.sql',
       '166_sprint65_ai_intelligence_runtime_governance.sql',
       '168_sprint65_database_table_lifecycle_governance.sql',
       '187_sprint66_platform_secret_intake_promotion_tool.sql',
       '201_sprint68_lifecycle_owner_engine_registry_alignment.sql',
       '20260618_governed_tool_response_chunks.sql',
       '305_sprint69_runtime_verification_control_plane_hardening.sql',
       '1025_sprint69_activation_archive_dynamic_control_authority.sql'
   )
   AND a.authorization_status = 'authorized'
   AND a.allow_apply = 1
   AND EXISTS (
       SELECT 1
         FROM governed_migration_ledger l
        WHERE l.migration_file = a.migration_file
          AND l.mode = 'record_only'
   )
   AND NOT EXISTS (
       SELECT 1
         FROM governed_migration_ledger applied
        WHERE applied.migration_file = a.migration_file
          AND applied.mode = 'apply'
   );

UPDATE capability_resolution_envelope_ledger
   SET envelope_status = 'expired',
       dispatch_allowed = 0,
       apply_allowed = 0,
       updated_at = CURRENT_TIMESTAMP
 WHERE expires_at IS NOT NULL
   AND expires_at < UTC_TIMESTAMP()
   AND envelope_status IN ('ready_for_dispatch','ready_requires_approval','dry_run')
   AND execution_status <> 'executed';
