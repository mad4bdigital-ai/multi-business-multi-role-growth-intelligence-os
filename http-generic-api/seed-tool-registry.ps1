$headers = @{
    Authorization = "Bearer gpt_http_bridge_9Kf3x2Pq7Lm8Vn4T"
    "Content-Type" = "application/json"
}
$uri = "https://auth.mad4b.com/admin/control"

function Send-SQL($label, $sql) {
    $body = [ordered]@{ tool = "db"; sql = $sql } | ConvertTo-Json -Depth 3 -Compress
    try {
        $r = Invoke-RestMethod -Method POST -Uri $uri -Headers $headers -Body $body
        Write-Host "[$label] ok=$($r.ok) affectedRows=$($r.result.affectedRows)"
    } catch {
        Write-Host "[$label] ERROR: $($_.Exception.Message)"
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    }
}

# ── Admin Batch 1: system/activation tools ─────────────────────────────────
Send-SQL "admin-b1" @'
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('health_check','Health Check','Service health and DB connectivity.','GET','/health',NULL,NULL,NULL,'system',10),
('release_readiness','Release Readiness','Full platform release readiness check across all tables and migrations.','GET','/release/readiness',NULL,NULL,NULL,'system',20),
('activation_platform_access','Platform Access','Platform-wide counts: brands, actions, plugins, logics, engines. Optional user_id/tenant_id filters.','GET','/activation/platform-access',NULL,'{"type":"object","properties":{"user_id":{"type":"string"},"tenant_id":{"type":"string"}}}',NULL,'activation',30),
('activation_bootstrap_config','Bootstrap Config','Authoritative runtime bootstrap: GitHub binding, tenant/membership counts, device counts.','GET','/activation/bootstrap-config',NULL,NULL,NULL,'activation',40),
('activation_provider_bootstrap_validate','Validate Activation Bootstrap','Validate Drive, GitHub, Sheets, and provider bootstrap. Confirms all activation evidence is reachable.','POST','/admin/system/tools/call',NULL,'{"type":"object","properties":{"arguments":{"type":"object"}}}','{"name":"activation_provider_bootstrap_validate"}','activation',42)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Admin Batch 2: more activation + admin_control ────────────────────────
Send-SQL "admin-b2" @'
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('activation_drive_probe','Probe Google Drive','Check Google Drive connectivity and verify the configured upload folder is accessible.','POST','/admin/system/tools/call',NULL,NULL,'{"name":"activation_drive_probe"}','activation',43),
('activation_github_validate','Validate GitHub','Validate GitHub token and verify repo access for the configured activation binding.','POST','/admin/system/tools/call',NULL,NULL,'{"name":"activation_github_validate"}','activation',45),
('activation_bootstrap_config_upsert','Upsert Bootstrap Config','Upsert the GitHub activation binding. Pass arguments with github_owner, github_repo, github_branch.','POST','/admin/system/tools/call',NULL,'{"type":"object","properties":{"arguments":{"type":"object","properties":{"github_owner":{"type":"string"},"github_repo":{"type":"string"},"github_branch":{"type":"string"}}}}}','{"name":"activation_bootstrap_config_upsert"}','activation',46),
('admin_control','Admin Control','Run GitHub CLI, gcloud CLI, DB SQL, env inspect/mutate, or allowlisted shell commands.','POST','/admin/control',NULL,'{"type":"object","required":["tool"],"properties":{"tool":{"type":"string","enum":["github","gcloud","db","env","shell","hostinger","windows_app"]},"args":{"type":"array","items":{"type":"string"}},"sql":{"type":"string"},"params":{"type":"array"},"action":{"type":"string","enum":["run","list","get","set","unset","status","authorize","launch"]},"alias":{"type":"string"},"name":{"type":"string"},"value":{"type":"string"},"include_values":{"type":"boolean"},"reveal_values":{"type":"boolean"},"timeout_ms":{"type":"integer"}}}',NULL,'admin',50),
('admin_hostinger','Hostinger API','Forward any call to the Hostinger REST API (VPS, DNS, domains, billing).','POST','/admin/cli/hostinger',NULL,'{"type":"object","required":["path"],"properties":{"path":{"type":"string"},"method":{"type":"string","enum":["GET","POST","PUT","DELETE","PATCH"]},"request_body":{"type":"object"},"params":{"type":"object"},"api_key_ref":{"type":"string","enum":["cloud_plan","shared_manager"]}}}',NULL,'admin',60)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Admin Batch 3: auth + session + schema ────────────────────────────────
Send-SQL "admin-b3" @'
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('platform_jwt_issue','Issue Platform JWT','Mint a short-lived user JWT for an existing active user.','POST','/auth/platform-jwt/issue',NULL,'{"type":"object","properties":{"user_id":{"type":"string"},"email":{"type":"string"},"tenant_id":{"type":"string"},"ttl_seconds":{"type":"integer"},"reason":{"type":"string"}}}',NULL,'auth',70),
('session_continuity_link','Link Session Continuity','Assign user_id to unlinked request_envelopes rows and backfill tenant_id.','POST','/admin/session-continuity/link-user',NULL,'{"type":"object","required":["user_id","tenant_id"],"properties":{"user_id":{"type":"string"},"tenant_id":{"type":"string"},"scope":{"type":"string","enum":["current_unlinked_sessions","tenant_unlinked_sessions"]}}}',NULL,'admin',80),
('schema_import_upload','Import Schema (Upload)','Upload a full OpenAPI YAML/JSON schema string and split it into the registry.','POST','/admin/schema-import/upload',NULL,'{"type":"object","required":["schema_yaml"],"properties":{"schema_yaml":{"type":"string"},"action_key":{"type":"string"},"filename":{"type":"string"},"imported_by":{"type":"string"}}}',NULL,'schema',90),
('schema_import_repo','Import Schema (Repo)','Fetch and import an OpenAPI schema directly from a GitHub repo URL.','POST','/admin/schema-import/repo',NULL,'{"type":"object","required":["repo_url"],"properties":{"repo_url":{"type":"string"},"path_in_repo":{"type":"string"},"ref":{"type":"string"},"action_key":{"type":"string"},"imported_by":{"type":"string"}}}',NULL,'schema',100),
('schema_import_rollback','Rollback Schema Import','Restore endpoint schemas to a previous import job snapshot.','POST','/admin/schema-import/rollback',NULL,'{"type":"object","required":["action_key","job_id"],"properties":{"action_key":{"type":"string"},"job_id":{"type":"string"},"requested_by":{"type":"string"}}}',NULL,'schema',110)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Admin Batch 4: schema jobs + system connectors ────────────────────────
Send-SQL "admin-b4" @'
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('schema_import_jobs_list','List Schema Import Jobs','List schema import jobs. Optional action_key filter.','GET','/admin/schema-import/jobs',NULL,'{"type":"object","properties":{"action_key":{"type":"string"},"limit":{"type":"integer"},"offset":{"type":"integer"}}}',NULL,'schema',120),
('schema_import_job_get','Get Schema Import Job','Get one schema import job with endpoint snapshots.','GET','/admin/schema-import/jobs/{job_id}','["job_id"]','{"type":"object","required":["job_id"],"properties":{"job_id":{"type":"string"}}}',NULL,'schema',130),
('admin_system_connectors_list','List System Connectors','List connected systems from the admin connector registry.','GET','/admin/system/connectors',NULL,'{"type":"object","properties":{"tenant_id":{"type":"string"},"status":{"type":"string"},"connector_family":{"type":"string"},"limit":{"type":"integer"}}}',NULL,'system',140),
('admin_system_connector_get','Get System Connector','Get one connected system record with installation summary.','GET','/admin/system/connectors/{system_id}','["system_id"]','{"type":"object","required":["system_id"],"properties":{"system_id":{"type":"string"}}}',NULL,'system',150),
('admin_system_tools_list','List Admin System Tools','List MCP-style admin system layer tools (connector registry, bootstrap probes).','GET','/admin/system/tools',NULL,NULL,NULL,'system',160)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Admin Batch 5: system tools call + credential/connector wrappers ───────
Send-SQL "admin-b5" @'
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('admin_system_tools_call','Call Admin System Tool','Call a governed admin system tool by name (connector_registry_list, activation_drive_probe, etc.).','POST','/admin/system/tools/call',NULL,'{"type":"object","required":["name"],"properties":{"name":{"type":"string"},"arguments":{"type":"object"}}}',NULL,'system',170),
('tenant_gpt_oauth_client_upsert','Upsert Tenant GPT OAuth Client','Upsert the OAuth client configuration for the Tenant GPT.','POST','/admin/system/tools/call',NULL,'{"type":"object","properties":{"arguments":{"type":"object"}}}','{"name":"tenant_gpt_oauth_client_upsert"}','system',178),
('credential_client_config_upsert','Upsert Credential Client Config','Upsert a credential client config record.','POST','/admin/system/tools/call',NULL,'{"type":"object","properties":{"arguments":{"type":"object"}}}','{"name":"credential_client_config_upsert"}','system',179),
('credential_client_config_list','List Credential Client Configs','List all credential client config records.','POST','/admin/system/tools/call',NULL,NULL,'{"name":"credential_client_config_list"}','system',180),
('connector_registry_list_tool','List Connector Registry (tool)','List all connected systems via the system tool registry.','POST','/admin/system/tools/call',NULL,NULL,'{"name":"connector_registry_list"}','system',181)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Admin Batch 6: more wrappers + governance ────────────────────────────
Send-SQL "admin-b6" @'
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('connector_registry_get_tool','Get Connector Registry Entry (tool)','Get one connected system. Pass arguments.system_id.','POST','/admin/system/tools/call',NULL,'{"type":"object","properties":{"arguments":{"type":"object","properties":{"system_id":{"type":"string"}},"required":["system_id"]}}}','{"name":"connector_registry_get"}','system',182),
('governance_resolve_context','Resolve Governance Context','Diagnostic: resolve business type, brand path, Brand Core, validation, and execution readiness.','POST','/governance/resolve-context-diagnostic',NULL,'{"type":"object","properties":{"business_type_key":{"type":"string"},"brand_key":{"type":"string"},"target_key":{"type":"string"}}}',NULL,'governance',183),
('governance_execution_log','Governance Execution Log','Latest execution log entries with route keys and workflow selections.','GET','/governance/execution-log-latest',NULL,NULL,NULL,'governance',190),
('google_auth_tabs_get','Google Auth Platform Tabs','Read all simulated Google Auth Platform tab state for a project.','GET','/admin/apis-services/google-auth-platform',NULL,'{"type":"object","properties":{"project_key":{"type":"string"},"owner_type":{"type":"string"},"tenant_id":{"type":"string"}}}',NULL,'admin',200),
('google_auth_tab_get','Get Google Auth Tab','Read one Google Auth Platform tab (branding, audience, clients, data_access, settings, api_credentials).','GET','/admin/apis-services/google-auth-platform/{tab}','["tab"]','{"type":"object","required":["tab"],"properties":{"tab":{"type":"string","enum":["overview","branding","audience","clients","data_access","verification_center","settings","api_credentials"]},"project_key":{"type":"string"}}}',NULL,'admin',210)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Admin Batch 7: google auth upsert + device tools ─────────────────────
Send-SQL "admin-b7" @'
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('google_auth_tab_upsert','Upsert Google Auth Tab','Write governed Google Auth Platform tab state.','POST','/admin/apis-services/google-auth-platform/{tab}','["tab"]','{"type":"object","required":["tab"],"properties":{"tab":{"type":"string"},"project_key":{"type":"string"},"state":{"type":"object"},"note":{"type":"string"}}}',NULL,'admin',220),
('google_auth_platform_config_upsert','Upsert Google Auth Platform Config','Upsert the Google Auth Platform configuration record.','POST','/admin/system/tools/call',NULL,'{"type":"object","properties":{"arguments":{"type":"object"}}}','{"name":"google_auth_platform_config_upsert"}','admin',225),
('google_auth_platform_config_get','Get Google Auth Platform Config','Read the current Google Auth Platform configuration record.','POST','/admin/system/tools/call',NULL,NULL,'{"name":"google_auth_platform_config_get"}','admin',226),
('connector_policy','Device Policy','Fetch device governance policy: shell enabled, permitted aliases/paths, restricted ops.','GET','/connector/{device_id}/policy','["device_id"]','{"type":"object","required":["device_id"],"properties":{"device_id":{"type":"string"},"user_id":{"type":"string"}}}',NULL,'device',230),
('connector_health','Device Health','Check if the device connector agent is running.','GET','/connector/{device_id}/health','["device_id"]','{"type":"object","required":["device_id"],"properties":{"device_id":{"type":"string"},"user_id":{"type":"string"}}}',NULL,'device',240)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Admin Batch 8: remaining device tools ────────────────────────────────
Send-SQL "admin-b8" @'
INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('connector_shell','Device Shell','Run an allowlisted shell command on the device. action=list shows aliases; action=run executes.','POST','/connector/{device_id}/shell','["device_id"]','{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["status","list","run"]},"alias":{"type":"string"},"extra_args":{"type":"array","items":{"type":"string"}},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}',NULL,'device',250),
('connector_files','Device Files','Read or write allowlisted files on the device. action=list/read/write.','POST','/connector/{device_id}/files','["device_id"]','{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["list","read","write"]},"path":{"type":"string"},"content":{"type":"string"},"user_id":{"type":"string"}}}',NULL,'device',260),
('connector_fetch_upload','Device Fetch-Upload','Device fetches a URL and pushes content to platform uploads. Returns upload_id.','POST','/connector/{device_id}/fetch-upload','["device_id"]','{"type":"object","required":["device_id","url","upload_type"],"properties":{"device_id":{"type":"string"},"url":{"type":"string"},"upload_type":{"type":"string","enum":["schema","skill","knowledge","repo_link","asset"]},"filename":{"type":"string"},"user_id":{"type":"string"}}}',NULL,'device',270),
('connector_github','Device GitHub CLI','Run a gh CLI command on the device. Pass args as array.','POST','/connector/{device_id}/github','["device_id"]','{"type":"object","required":["device_id","args"],"properties":{"device_id":{"type":"string"},"args":{"oneOf":[{"type":"array","items":{"type":"string"}},{"type":"string"}]},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}',NULL,'device',280),
('connector_gcloud','Device gcloud CLI','Run a gcloud command on the device (restart Cloud Run, read logs, etc.).','POST','/connector/{device_id}/gcloud','["device_id"]','{"type":"object","required":["device_id","args"],"properties":{"device_id":{"type":"string"},"args":{"oneOf":[{"type":"array","items":{"type":"string"}},{"type":"string"}]},"timeout_ms":{"type":"integer"},"user_id":{"type":"string"}}}',NULL,'device',290),
('connector_shell_fetch_upload','Device curl Fetch-Upload','Download a URL via curl on the device and push to platform uploads.','POST','/connector/{device_id}/shell-fetch-upload','["device_id"]','{"type":"object","required":["device_id","url","upload_type"],"properties":{"device_id":{"type":"string"},"url":{"type":"string"},"upload_type":{"type":"string","enum":["schema","skill","knowledge","repo_link","asset"]},"filename":{"type":"string"},"uploaded_by":{"type":"string"},"user_id":{"type":"string"}}}',NULL,'device',300)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Tenant Batch 1: governance + system + connect ─────────────────────────
Send-SQL "tenant-b1" @'
INSERT INTO tenant_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('governance_policy','Governance Policy','Read the governance boundary and execution policy for this tenant scope.','GET','/policy',NULL,NULL,NULL,'governance',10),
('platform_status','Platform Status','Current platform operational status.','GET','/status',NULL,NULL,NULL,'system',20),
('connect_status','Connection Status','Read current tenant backend connection status and active device list.','GET','/connect/status',NULL,NULL,NULL,'connect',30),
('connect_activate','Activate Connection','Activate managed or dedicated tenant backend connection mode.','POST','/connect/activate',NULL,'{"type":"object","properties":{"mode":{"type":"string","enum":["managed","dedicated"]},"device_id":{"type":"string"},"workspace_name":{"type":"string"}}}',NULL,'connect',40),
('connect_device_install','Install Device Connector','Provision a device install bundle for the Cloudflare tunnel connector.','POST','/connect/device-install',NULL,'{"type":"object","properties":{"device_id":{"type":"string"},"workspace_name":{"type":"string"}}}',NULL,'connect',50)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Tenant Batch 2: system connectors + local connector ──────────────────
Send-SQL "tenant-b2" @'
INSERT INTO tenant_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('system_connectors_list','List System Connectors','List connector systems scoped to this tenant.','GET','/system/connectors',NULL,'{"type":"object","properties":{"status":{"type":"string"},"connector_family":{"type":"string"},"limit":{"type":"integer"}}}',NULL,'system',60),
('system_connector_get','Get System Connector','Get one connector system record for this tenant.','GET','/system/connectors/{system_id}','["system_id"]','{"type":"object","required":["system_id"],"properties":{"system_id":{"type":"string"}}}',NULL,'system',70),
('system_tools_list','List System Tools','List MCP-style system layer tools available to this tenant.','GET','/system/tools',NULL,NULL,NULL,'system',80),
('system_tools_call','Call System Tool','Call a governed tenant-scoped system tool by name.','POST','/system/tools/call',NULL,'{"type":"object","required":["name"],"properties":{"name":{"type":"string"},"arguments":{"type":"object"}}}',NULL,'system',90),
('local_connector_health','Local Connector Health','Check if the local connector agent is reachable for a specific device.','GET','/local-connector/health',NULL,'{"type":"object","required":["device_id"],"properties":{"device_id":{"type":"string"},"user_id":{"type":"string"},"tenant_id":{"type":"string"}}}',NULL,'connector',100),
('local_connector_devices','List Connector Devices','List registered local connector devices for a user/tenant.','GET','/local-connector/devices',NULL,'{"type":"object","required":["user_id","tenant_id"],"properties":{"user_id":{"type":"string"},"tenant_id":{"type":"string"}}}',NULL,'connector',110)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

# ── Tenant Batch 3: device tools ─────────────────────────────────────────
Send-SQL "tenant-b3" @'
INSERT INTO tenant_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, sort_order)
VALUES
('connector_policy','Device Policy','Fetch device governance policy.','GET','/connector/{device_id}/policy','["device_id"]','{"type":"object","required":["device_id"],"properties":{"device_id":{"type":"string"}}}',NULL,'device',120),
('connector_health','Device Health','Check if the device connector agent is running.','GET','/connector/{device_id}/health','["device_id"]','{"type":"object","required":["device_id"],"properties":{"device_id":{"type":"string"}}}',NULL,'device',130),
('connector_shell','Device Shell','Run an allowlisted shell command on the device. action=list shows aliases; action=run executes.','POST','/connector/{device_id}/shell','["device_id"]','{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["status","list","run"]},"alias":{"type":"string"},"extra_args":{"type":"array"},"timeout_ms":{"type":"integer"}}}',NULL,'device',140),
('connector_files','Device Files','Read or write allowlisted files on the device.','POST','/connector/{device_id}/files','["device_id"]','{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["list","read","write"]},"path":{"type":"string"},"content":{"type":"string"}}}',NULL,'device',150),
('connector_github','Device GitHub CLI','Run a gh CLI command on the device.','POST','/connector/{device_id}/github','["device_id"]','{"type":"object","required":["device_id","args"],"properties":{"device_id":{"type":"string"},"args":{"oneOf":[{"type":"array","items":{"type":"string"}},{"type":"string"}]},"timeout_ms":{"type":"integer"}}}',NULL,'device',160),
('connector_gcloud','Device gcloud CLI','Run a gcloud command on the device.','POST','/connector/{device_id}/gcloud','["device_id"]','{"type":"object","required":["device_id","args"],"properties":{"device_id":{"type":"string"},"args":{"oneOf":[{"type":"array","items":{"type":"string"}},{"type":"string"}]},"timeout_ms":{"type":"integer"}}}',NULL,'device',170)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), sort_order=VALUES(sort_order)
'@

Write-Host "`nAll batches complete. Verifying counts..."

$body = @{ tool = "db"; sql = "SELECT (SELECT COUNT(*) FROM admin_platform_endpoint_tools WHERE is_enabled=1) AS admin_count, (SELECT COUNT(*) FROM tenant_platform_endpoint_tools WHERE is_enabled=1) AS tenant_count" } | ConvertTo-Json -Compress
$r = Invoke-RestMethod -Method POST -Uri $uri -Headers $headers -Body $body
Write-Host "admin_count=$($r.rows[0].admin_count)  tenant_count=$($r.rows[0].tenant_count)"
