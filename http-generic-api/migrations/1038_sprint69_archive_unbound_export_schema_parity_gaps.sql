-- Migration execution safety
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
--
-- Close registry export parity gaps that are not callable dispatch surfaces.
-- These active export rows either point at deprecated endpoint rows or have no
-- source endpoint at all, and none has an active platform_tool_dispatch_binding.
-- They are archived rather than deleted so history remains auditable.

UPDATE platform_endpoint_tool_exports export_row
LEFT JOIN endpoints endpoint_row
  ON endpoint_row.id = export_row.source_endpoint_id
SET export_row.status = 'archived',
    export_row.notes = CONCAT(
      COALESCE(export_row.notes, ''),
      CASE WHEN COALESCE(export_row.notes, '') = '' THEN '' ELSE '\n' END,
      '1038_sprint69_archive_unbound_export_schema_parity_gaps: archived active legacy export with no active dispatch binding.'
    ),
    export_row.updated_at = CURRENT_TIMESTAMP
WHERE export_row.status = 'active'
  AND export_row.export_key IN (
    'cloudflare_api__cf_create_dns_record',
    'cloudflare_api__cf_get_tunnel',
    'cloudflare_api__cf_get_tunnel_config',
    'cloudflare_api__cf_list_dns_records',
    'cloudflare_api__cf_list_tunnels',
    'cloudflare_api__cf_list_zones',
    'cloudflare_api__cf_update_tunnel_config',
    'github_actions_status__getWorkflowJobLogs',
    'github_actions_status__getWorkflowRunJobs',
    'github_actions_status__list_workflow_runs',
    'github_actions_status__listWorkflowRuns',
    'github_git_data__create_ref',
    'github_git_data__createGitCommit',
    'github_git_data__createGitRef',
    'github_git_data__createGitTree',
    'github_git_data__get_ref_head',
    'github_git_data__getGitCommit',
    'github_git_data__updateGitRefHead',
    'google_docs_api__getDocument',
    'google_docs_api__updateDocument',
    'google_drive_api__listDriveFiles',
    'hostinger_api.hostinger_ssh_restart_app.admin_export',
    'hostinger_api.remote_runtime_hostinger_deploy_release.admin_export',
    'tenant_wovacation_runtime_endpoint_call_v1'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_tool_dispatch_bindings binding_row
    WHERE binding_row.export_key = export_row.export_key
      AND binding_row.status = 'active'
  )
  AND (
    export_row.source_endpoint_id IS NULL
    OR endpoint_row.id IS NULL
    OR endpoint_row.status <> 'active'
  );
