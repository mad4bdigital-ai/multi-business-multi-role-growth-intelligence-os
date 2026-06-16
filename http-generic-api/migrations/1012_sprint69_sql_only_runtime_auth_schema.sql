-- 1012_sprint69_sql_only_runtime_auth_schema.sql
-- Runtime authority: endpoint schemas and authentication configuration are SQL-backed.
-- Secret values remain server-side; this migration stores references and bindings only.
-- Safety: no provider call, no credential payload read, no raw secrets, no external send,
-- no external write, and secrets_included=false.

INSERT INTO `secret_references`
  (`ref_id`,`tenant_id`,`owner_type`,`owner_id`,`action_key`,`provider_family`,`connector_family`,`credential_type`,`scope_json`,`consent_status`,`rotation_status`,`validation_status`,`status`,`secret_key`,`store_type`,`env_var_name`,`description`)
VALUES
  ('5d674c0f-0d26-44ae-86c3-c13738cc67b1','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform',NULL,'google','google_oauth2','oauth_client_id',JSON_OBJECT('usage','google_oauth_client'),'not_required','managed','configured','active','GOOGLE_CLIENT_ID','env','GOOGLE_CLIENT_ID','Existing platform Google OAuth client id; value remains in the server secret environment.'),
  ('7b98e941-b7cc-40cb-8de7-a21005a90f7b','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform',NULL,'google','google_oauth2','oauth_client_secret',JSON_OBJECT('usage','google_oauth_client'),'not_required','managed','configured','active','GOOGLE_CLIENT_SECRET','env','GOOGLE_CLIENT_SECRET','Existing platform Google OAuth client secret; value remains in the server secret environment.')
ON DUPLICATE KEY UPDATE
  `owner_type`=VALUES(`owner_type`),
  `owner_id`=VALUES(`owner_id`),
  `provider_family`=VALUES(`provider_family`),
  `connector_family`=VALUES(`connector_family`),
  `credential_type`=VALUES(`credential_type`),
  `scope_json`=VALUES(`scope_json`),
  `validation_status`=VALUES(`validation_status`),
  `status`=VALUES(`status`),
  `store_type`=VALUES(`store_type`),
  `env_var_name`=VALUES(`env_var_name`),
  `description`=VALUES(`description`);

UPDATE `actions` SET
  `runtime_binding_profile`=JSON_SET(IF(JSON_VALID(`runtime_binding_profile`),`runtime_binding_profile`,JSON_OBJECT()),'$.auth_strategy.required_scopes',JSON_ARRAY('https://www.googleapis.com/auth/analytics.edit'),'$.auth_strategy.allowed_auth_types',JSON_ARRAY('oauth2'),'$.auth_strategy.scope_source','sql_runtime_registry','$.auth_strategy.scope_contract_version',2),
  `oauth_config_ref`='ref:config:sql_runtime_google_oauth_v2',
  `oauth_client_id_ref`='ref:secret:GOOGLE_CLIENT_ID',
  `oauth_client_secret_ref`='ref:secret:GOOGLE_CLIENT_SECRET',
  `oauth_binding_status`='bound'
WHERE `action_key`='analytics_admin_api';

UPDATE `actions` SET
  `runtime_binding_profile`=JSON_SET(IF(JSON_VALID(`runtime_binding_profile`),`runtime_binding_profile`,JSON_OBJECT()),'$.auth_strategy.required_scopes',JSON_ARRAY('https://www.googleapis.com/auth/analytics.readonly'),'$.auth_strategy.allowed_auth_types',JSON_ARRAY('oauth2'),'$.auth_strategy.scope_source','sql_runtime_registry','$.auth_strategy.scope_contract_version',2),
  `oauth_config_ref`='ref:config:sql_runtime_google_oauth_v2',
  `oauth_client_id_ref`='ref:secret:GOOGLE_CLIENT_ID',
  `oauth_client_secret_ref`='ref:secret:GOOGLE_CLIENT_SECRET',
  `oauth_binding_status`='bound'
WHERE `action_key`='analytics_data_api';

UPDATE `actions` SET
  `runtime_binding_profile`=JSON_SET(IF(JSON_VALID(`runtime_binding_profile`),`runtime_binding_profile`,JSON_OBJECT()),'$.auth_strategy.required_scopes',JSON_ARRAY('https://www.googleapis.com/auth/documents'),'$.auth_strategy.allowed_auth_types',JSON_ARRAY('oauth2'),'$.auth_strategy.scope_source','sql_runtime_registry','$.auth_strategy.scope_contract_version',2),
  `oauth_config_ref`='ref:config:sql_runtime_google_oauth_v2',
  `oauth_client_id_ref`='ref:secret:GOOGLE_CLIENT_ID',
  `oauth_client_secret_ref`='ref:secret:GOOGLE_CLIENT_SECRET',
  `oauth_binding_status`='bound'
WHERE `action_key`='google_docs_api';

UPDATE `actions` SET
  `runtime_binding_profile`=JSON_SET(IF(JSON_VALID(`runtime_binding_profile`),`runtime_binding_profile`,JSON_OBJECT()),'$.auth_strategy.required_scopes',JSON_ARRAY('https://www.googleapis.com/auth/drive'),'$.auth_strategy.allowed_auth_types',JSON_ARRAY('oauth2'),'$.auth_strategy.scope_source','sql_runtime_registry','$.auth_strategy.scope_contract_version',2),
  `oauth_config_ref`='ref:config:sql_runtime_google_oauth_v2',
  `oauth_client_id_ref`='ref:secret:GOOGLE_CLIENT_ID',
  `oauth_client_secret_ref`='ref:secret:GOOGLE_CLIENT_SECRET',
  `oauth_binding_status`='bound'
WHERE `action_key`='google_drive_api';

UPDATE `actions` SET
  `runtime_binding_profile`=JSON_SET(IF(JSON_VALID(`runtime_binding_profile`),`runtime_binding_profile`,JSON_OBJECT()),'$.auth_strategy.required_scopes',JSON_ARRAY('https://www.googleapis.com/auth/spreadsheets'),'$.auth_strategy.allowed_auth_types',JSON_ARRAY('oauth2'),'$.auth_strategy.scope_source','sql_runtime_registry','$.auth_strategy.scope_contract_version',2),
  `oauth_config_ref`='ref:config:sql_runtime_google_oauth_v2',
  `oauth_client_id_ref`='ref:secret:GOOGLE_CLIENT_ID',
  `oauth_client_secret_ref`='ref:secret:GOOGLE_CLIENT_SECRET',
  `oauth_binding_status`='bound'
WHERE `action_key`='google_sheets_api';

UPDATE `actions` SET
  `runtime_binding_profile`=JSON_SET(IF(JSON_VALID(`runtime_binding_profile`),`runtime_binding_profile`,JSON_OBJECT()),'$.auth_strategy.required_scopes',JSON_ARRAY('https://www.googleapis.com/auth/adwords'),'$.auth_strategy.allowed_auth_types',JSON_ARRAY('oauth2'),'$.auth_strategy.scope_source','sql_runtime_registry','$.auth_strategy.scope_contract_version',2),
  `oauth_config_ref`='ref:config:sql_runtime_google_oauth_v2',
  `oauth_client_id_ref`='ref:secret:GOOGLE_CLIENT_ID',
  `oauth_client_secret_ref`='ref:secret:GOOGLE_CLIENT_SECRET',
  `oauth_binding_status`='bound'
WHERE `action_key`='googleads_api';

UPDATE `actions` SET
  `runtime_binding_profile`=JSON_SET(IF(JSON_VALID(`runtime_binding_profile`),`runtime_binding_profile`,JSON_OBJECT()),'$.auth_strategy.required_scopes',JSON_ARRAY('https://www.googleapis.com/auth/doubleclicksearch'),'$.auth_strategy.allowed_auth_types',JSON_ARRAY('oauth2'),'$.auth_strategy.scope_source','sql_runtime_registry','$.auth_strategy.scope_contract_version',2),
  `oauth_config_ref`='ref:config:sql_runtime_google_oauth_v2',
  `oauth_client_id_ref`='ref:secret:GOOGLE_CLIENT_ID',
  `oauth_client_secret_ref`='ref:secret:GOOGLE_CLIENT_SECRET',
  `oauth_binding_status`='bound'
WHERE `action_key`='searchads360_api';

UPDATE `actions` SET
  `runtime_binding_profile`=JSON_SET(IF(JSON_VALID(`runtime_binding_profile`),`runtime_binding_profile`,JSON_OBJECT()),'$.auth_strategy.required_scopes',JSON_ARRAY('https://www.googleapis.com/auth/webmasters'),'$.auth_strategy.allowed_auth_types',JSON_ARRAY('oauth2'),'$.auth_strategy.scope_source','sql_runtime_registry','$.auth_strategy.scope_contract_version',2),
  `oauth_config_ref`='ref:config:sql_runtime_google_oauth_v2',
  `oauth_client_id_ref`='ref:secret:GOOGLE_CLIENT_ID',
  `oauth_client_secret_ref`='ref:secret:GOOGLE_CLIENT_SECRET',
  `oauth_binding_status`='bound'
WHERE `action_key`='searchconsole_api';

UPDATE `actions` SET
  `runtime_binding_profile`=JSON_SET(IF(JSON_VALID(`runtime_binding_profile`),`runtime_binding_profile`,JSON_OBJECT()),'$.auth_strategy.required_scopes',JSON_ARRAY('https://www.googleapis.com/auth/tagmanager.edit.containers'),'$.auth_strategy.allowed_auth_types',JSON_ARRAY('oauth2'),'$.auth_strategy.scope_source','sql_runtime_registry','$.auth_strategy.scope_contract_version',2),
  `oauth_config_ref`='ref:config:sql_runtime_google_oauth_v2',
  `oauth_client_id_ref`='ref:secret:GOOGLE_CLIENT_ID',
  `oauth_client_secret_ref`='ref:secret:GOOGLE_CLIENT_SECRET',
  `oauth_binding_status`='bound'
WHERE `action_key`='tagmanager_api';

INSERT INTO `credential_bindings`
  (`binding_id`,`tenant_id`,`owner_type`,`owner_id`,`action_key`,`target_key`,`credential_role`,`credential_ref`,`provider_family`,`connector_family`,`resolution_priority`,`status`,`created_by`)
VALUES
  ('0786a17f-f06c-47a9-9245-906608af5bf6','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform','analytics_admin_api','google_analytics_admin','platform_oauth2_runtime','platform_managed:analytics_admin_api_oauth2','google','analytics_admin_api',250,'active','migration_1012_sql_only_runtime_contracts'),
  ('27ddfd4f-2af9-46a1-aa91-59d4dd69288f','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform','analytics_data_api','google_analytics','platform_oauth2_runtime','platform_managed:analytics_data_api_oauth2','google','analytics_data_api',250,'active','migration_1012_sql_only_runtime_contracts'),
  ('90189339-f99a-4a75-992f-4e3f633235b9','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform','google_docs_api','google_docs','platform_oauth2_runtime','platform_managed:google_docs_api_oauth2','google','google_docs_api',250,'active','migration_1012_sql_only_runtime_contracts'),
  ('8a6cb94e-6db5-4c3a-9b5f-90168f000001','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform','google_drive_api','google_drive','platform_oauth2_runtime','platform_managed:google_drive_api_oauth2','google','google_drive_api',250,'active','migration_1012_sql_only_runtime_contracts'),
  ('d7d49689-2dbc-4881-a2f1-1d36b689d243','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform','google_sheets_api','google_sheets','platform_oauth2_runtime','platform_managed:google_sheets_api_oauth2','google','google_sheets_api',250,'active','migration_1012_sql_only_runtime_contracts'),
  ('4654d081-ae77-4a0e-a766-964b23f39e95','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform','googleads_api','google_ads','platform_oauth2_runtime','platform_managed:googleads_api_oauth2','google','googleads_api',250,'active','migration_1012_sql_only_runtime_contracts'),
  ('833af828-e733-45cf-a25d-ecc19f77db26','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform','searchads360_api','search_ads_360','platform_oauth2_runtime','platform_managed:searchads360_api_oauth2','google','searchads360_api',250,'active','migration_1012_sql_only_runtime_contracts'),
  ('1f99678a-513f-4923-84b8-27a0ca7509db','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform','searchconsole_api','google_search_console','platform_oauth2_runtime','platform_managed:searchconsole_api_oauth2','google','searchconsole_api',250,'active','migration_1012_sql_only_runtime_contracts'),
  ('b33ee3ea-1f24-402a-8949-f74bd1cfe0bf','00000000-0000-0000-0000-000000000000','platform','growth_intelligence_platform','tagmanager_api','google_tag_manager','platform_oauth2_runtime','platform_managed:tagmanager_api_oauth2','google','tagmanager_api',250,'active','migration_1012_sql_only_runtime_contracts')
ON DUPLICATE KEY UPDATE
  `owner_type`=VALUES(`owner_type`),
  `owner_id`=VALUES(`owner_id`),
  `action_key`=VALUES(`action_key`),
  `target_key`=VALUES(`target_key`),
  `credential_role`=VALUES(`credential_role`),
  `credential_ref`=VALUES(`credential_ref`),
  `provider_family`=VALUES(`provider_family`),
  `connector_family`=VALUES(`connector_family`),
  `resolution_priority`=VALUES(`resolution_priority`),
  `status`=VALUES(`status`),
  `created_by`=VALUES(`created_by`);

INSERT INTO `platform_runtime_config` (`config_key`,`config_json`,`status`,`note`)
VALUES (
  'sql_only_runtime_contracts_v1',
  JSON_OBJECT(
    'runtime_schema_authority','endpoints.schema_json',
    'runtime_auth_authority','actions.runtime_binding_profile + credential_bindings + secret_references',
    'external_file_reads_allowed',false,
    'external_file_usage','import_recovery_only',
    'secret_values_returned',false
  ),
  'active',
  'Runtime endpoint schema and authentication configuration resolve from SQL. External files are import/recovery surfaces only.'
)
ON DUPLICATE KEY UPDATE
  `config_json`=VALUES(`config_json`),
  `status`=VALUES(`status`),
  `note`=VALUES(`note`);

CREATE OR REPLACE VIEW `v_sql_only_runtime_contract_readiness` AS
SELECT
  a.action_key,
  a.status AS action_status,
  a.runtime_callable,
  a.oauth_binding_status,
  JSON_LENGTH(JSON_EXTRACT(a.runtime_binding_profile,'$.auth_strategy.required_scopes')) AS required_scope_count,
  SUM(CASE WHEN e.status='active' AND e.execution_readiness='ready' THEN 1 ELSE 0 END) AS ready_endpoint_count,
  SUM(CASE WHEN e.status='active' AND e.execution_readiness='ready' AND e.schema_json IS NOT NULL AND JSON_VALID(e.schema_json)=1 THEN 1 ELSE 0 END) AS sql_schema_ready_count,
  SUM(CASE WHEN e.status='active' AND e.execution_readiness='ready' AND (e.schema_json IS NULL OR JSON_VALID(e.schema_json)=0) THEN 1 ELSE 0 END) AS sql_schema_missing_count,
  COUNT(DISTINCT CASE WHEN cb.status='active' THEN cb.binding_id END) AS active_credential_binding_count,
  CASE WHEN sr_client.ref_id IS NOT NULL AND sr_secret.ref_id IS NOT NULL THEN 1 ELSE 0 END AS oauth_secret_refs_ready,
  0 AS external_file_runtime_required
FROM actions a
LEFT JOIN endpoints e ON BINARY e.parent_action_key=BINARY a.action_key
LEFT JOIN credential_bindings cb ON BINARY cb.action_key=BINARY a.action_key AND cb.tenant_id='00000000-0000-0000-0000-000000000000'
LEFT JOIN secret_references sr_client ON sr_client.tenant_id='00000000-0000-0000-0000-000000000000' AND sr_client.secret_key='GOOGLE_CLIENT_ID' AND sr_client.status='active'
LEFT JOIN secret_references sr_secret ON sr_secret.tenant_id='00000000-0000-0000-0000-000000000000' AND sr_secret.secret_key='GOOGLE_CLIENT_SECRET' AND sr_secret.status='active'
WHERE a.action_key IN ('analytics_admin_api','analytics_data_api','google_docs_api','google_drive_api','google_sheets_api','googleads_api','searchads360_api','searchconsole_api','tagmanager_api')
GROUP BY a.action_key,a.status,a.runtime_callable,a.oauth_binding_status,a.runtime_binding_profile,sr_client.ref_id,sr_secret.ref_id;
