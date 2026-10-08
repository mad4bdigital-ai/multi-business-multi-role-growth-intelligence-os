-- Forward-only, discoverable Hostinger Recovery allowlist extension (PR #8461).
-- Registry-and-target-discovery ONLY: no executor, no live SSH, no DB creation,
-- no environment mutation, no privileged grant, no provider or credential read.
-- Command rows stay PLANNED. Production activation requires a separate certified
-- provider/host executor, exact target authority, independent approval + readback.
-- Hostinger SSH access alone is not Hostinger hPanel database-create authority.
-- Do not grant arbitrary command, SQL, filesystem or environment-value input.

INSERT INTO remote_runtime_command_allowlists
  (command_id,plugin_key,command_key,display_name,target_kind,command_template,
   input_schema_json,risk_class,requires_approval,is_consequential,output_policy,status,notes)
SELECT UUID(),'remote_ssh_runtime','hostinger_recovery_database_inventory','Hostinger Recovery DB Inventory',
       'hosting_account','remote_runtime:hostinger:catalog_only:hostinger_recovery_database_inventory',
       JSON_OBJECT('type','object',
         'required',JSON_ARRAY('target_id','environment','expected_commit_sha','plan_digest'),
         'properties',JSON_OBJECT(
           'target_id',JSON_OBJECT('type','string','minLength',3,'maxLength',64),
           'environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production')),
           'role',JSON_OBJECT('type','string','enum',JSON_ARRAY('runtime','governance','runtime_persistence')),
           'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
           'plan_digest',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),
           'credential_binding_ref',JSON_OBJECT('type','string','maxLength',191),
           'approval_id',JSON_OBJECT('type','string','maxLength',191),
           'execution_ticket_id',JSON_OBJECT('type','string','maxLength',191),
           'dry_run',JSON_OBJECT('type','boolean','const',true)),
         'additionalProperties',false),
       'high',1,0,'summary_only','planned',
       'Read-only metadata for existing production runtime/governance/persistence databases. No external execution or secret return; unimplemented executor.'
WHERE EXISTS (SELECT 1 FROM connected_systems
              WHERE system_key='hostinger_ssh_prod_platform'
                AND provider_family='hostinger' AND connector_family='hostinger_ssh')
ON DUPLICATE KEY UPDATE
  notes = notes;

INSERT INTO remote_runtime_command_allowlists
  (command_id,plugin_key,command_key,display_name,target_kind,command_template,
   input_schema_json,risk_class,requires_approval,is_consequential,output_policy,status,notes)
SELECT UUID(),'remote_ssh_runtime','hostinger_recovery_control_store_plan','Hostinger Recovery Control Store Plan',
       'hosting_account','remote_runtime:hostinger:catalog_only:hostinger_recovery_control_store_plan',
       JSON_OBJECT('type','object',
         'required',JSON_ARRAY('target_id','environment','expected_commit_sha','plan_digest'),
         'properties',JSON_OBJECT(
           'target_id',JSON_OBJECT('type','string','minLength',3,'maxLength',64),
           'environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production')),
           'role',JSON_OBJECT('type','string','enum',JSON_ARRAY('runtime','governance','runtime_persistence')),
           'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
           'plan_digest',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),
           'credential_binding_ref',JSON_OBJECT('type','string','maxLength',191),
           'approval_id',JSON_OBJECT('type','string','maxLength',191),
           'execution_ticket_id',JSON_OBJECT('type','string','maxLength',191),
           'dry_run',JSON_OBJECT('type','boolean','const',true)),
         'additionalProperties',false),
       'high',1,0,'summary_only','planned',
       'Inspect existing DB roles and produce an immutable recovery-control-store proposal. No external execution or secret return; unimplemented executor.'
WHERE EXISTS (SELECT 1 FROM connected_systems
              WHERE system_key='hostinger_ssh_prod_platform'
                AND provider_family='hostinger' AND connector_family='hostinger_ssh')
ON DUPLICATE KEY UPDATE
  notes = notes;

INSERT INTO remote_runtime_command_allowlists
  (command_id,plugin_key,command_key,display_name,target_kind,command_template,
   input_schema_json,risk_class,requires_approval,is_consequential,output_policy,status,notes)
SELECT UUID(),'remote_ssh_runtime','hostinger_recovery_database_create','Hostinger Recovery Database Create',
       'hosting_account','remote_runtime:hostinger:catalog_only:hostinger_recovery_database_create',
       JSON_OBJECT('type','object',
         'required',JSON_ARRAY('target_id','environment','expected_commit_sha','plan_digest'),
         'properties',JSON_OBJECT(
           'target_id',JSON_OBJECT('type','string','minLength',3,'maxLength',64),
           'environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production')),
           'role',JSON_OBJECT('type','string','enum',JSON_ARRAY('runtime','governance','runtime_persistence')),
           'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
           'plan_digest',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),
           'credential_binding_ref',JSON_OBJECT('type','string','maxLength',191),
           'approval_id',JSON_OBJECT('type','string','maxLength',191),
           'execution_ticket_id',JSON_OBJECT('type','string','maxLength',191),
           'dry_run',JSON_OBJECT('type','boolean','const',true)),
         'additionalProperties',false),
       'admin_recovery',1,1,'summary_only','planned',
       'Provider-certified creation of an exact new empty recovery control database only. No external execution or secret return; unimplemented executor.'
WHERE EXISTS (SELECT 1 FROM connected_systems
              WHERE system_key='hostinger_ssh_prod_platform'
                AND provider_family='hostinger' AND connector_family='hostinger_ssh')
ON DUPLICATE KEY UPDATE
  notes = notes;

INSERT INTO remote_runtime_command_allowlists
  (command_id,plugin_key,command_key,display_name,target_kind,command_template,
   input_schema_json,risk_class,requires_approval,is_consequential,output_policy,status,notes)
SELECT UUID(),'remote_ssh_runtime','hostinger_recovery_environment_binding_plan','Hostinger Recovery Environment Binding Plan',
       'hosting_account','remote_runtime:hostinger:catalog_only:hostinger_recovery_environment_binding_plan',
       JSON_OBJECT('type','object',
         'required',JSON_ARRAY('target_id','environment','expected_commit_sha','plan_digest'),
         'properties',JSON_OBJECT(
           'target_id',JSON_OBJECT('type','string','minLength',3,'maxLength',64),
           'environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production')),
           'role',JSON_OBJECT('type','string','enum',JSON_ARRAY('runtime','governance','runtime_persistence')),
           'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
           'plan_digest',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),
           'credential_binding_ref',JSON_OBJECT('type','string','maxLength',191),
           'approval_id',JSON_OBJECT('type','string','maxLength',191),
           'execution_ticket_id',JSON_OBJECT('type','string','maxLength',191),
           'dry_run',JSON_OBJECT('type','boolean','const',true)),
         'additionalProperties',false),
       'high',1,0,'summary_only','planned',
       'Preview named secret-reference bindings without reading or returning secret values. No external execution or secret return; unimplemented executor.'
WHERE EXISTS (SELECT 1 FROM connected_systems
              WHERE system_key='hostinger_ssh_prod_platform'
                AND provider_family='hostinger' AND connector_family='hostinger_ssh')
ON DUPLICATE KEY UPDATE
  notes = notes;

INSERT INTO remote_runtime_command_allowlists
  (command_id,plugin_key,command_key,display_name,target_kind,command_template,
   input_schema_json,risk_class,requires_approval,is_consequential,output_policy,status,notes)
SELECT UUID(),'remote_ssh_runtime','hostinger_recovery_environment_binding_apply','Hostinger Recovery Environment Binding Apply',
       'hosting_account','remote_runtime:hostinger:catalog_only:hostinger_recovery_environment_binding_apply',
       JSON_OBJECT('type','object',
         'required',JSON_ARRAY('target_id','environment','expected_commit_sha','plan_digest'),
         'properties',JSON_OBJECT(
           'target_id',JSON_OBJECT('type','string','minLength',3,'maxLength',64),
           'environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production')),
           'role',JSON_OBJECT('type','string','enum',JSON_ARRAY('runtime','governance','runtime_persistence')),
           'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
           'plan_digest',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),
           'credential_binding_ref',JSON_OBJECT('type','string','maxLength',191),
           'approval_id',JSON_OBJECT('type','string','maxLength',191),
           'execution_ticket_id',JSON_OBJECT('type','string','maxLength',191),
           'dry_run',JSON_OBJECT('type','boolean','const',true)),
         'additionalProperties',false),
       'admin_recovery',1,1,'summary_only','planned',
       'Separate approved, atomic server-side environment binding operation using stored credential references. No external execution or secret return; unimplemented executor.'
WHERE EXISTS (SELECT 1 FROM connected_systems
              WHERE system_key='hostinger_ssh_prod_platform'
                AND provider_family='hostinger' AND connector_family='hostinger_ssh')
ON DUPLICATE KEY UPDATE
  notes = notes;

INSERT INTO remote_runtime_command_allowlists
  (command_id,plugin_key,command_key,display_name,target_kind,command_template,
   input_schema_json,risk_class,requires_approval,is_consequential,output_policy,status,notes)
SELECT UUID(),'remote_ssh_runtime','hostinger_recovery_grants_plan','Hostinger Recovery DB Grants Plan',
       'hosting_account','remote_runtime:hostinger:catalog_only:hostinger_recovery_grants_plan',
       JSON_OBJECT('type','object',
         'required',JSON_ARRAY('target_id','environment','expected_commit_sha','plan_digest'),
         'properties',JSON_OBJECT(
           'target_id',JSON_OBJECT('type','string','minLength',3,'maxLength',64),
           'environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production')),
           'role',JSON_OBJECT('type','string','enum',JSON_ARRAY('runtime','governance','runtime_persistence')),
           'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
           'plan_digest',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),
           'credential_binding_ref',JSON_OBJECT('type','string','maxLength',191),
           'approval_id',JSON_OBJECT('type','string','maxLength',191),
           'execution_ticket_id',JSON_OBJECT('type','string','maxLength',191),
           'dry_run',JSON_OBJECT('type','boolean','const',true)),
         'additionalProperties',false),
       'high',1,0,'summary_only','planned',
       'Read-only least-privilege grant reconciliation preview. No external execution or secret return; unimplemented executor.'
WHERE EXISTS (SELECT 1 FROM connected_systems
              WHERE system_key='hostinger_ssh_prod_platform'
                AND provider_family='hostinger' AND connector_family='hostinger_ssh')
ON DUPLICATE KEY UPDATE
  notes = notes;

INSERT INTO remote_runtime_command_allowlists
  (command_id,plugin_key,command_key,display_name,target_kind,command_template,
   input_schema_json,risk_class,requires_approval,is_consequential,output_policy,status,notes)
SELECT UUID(),'remote_ssh_runtime','hostinger_recovery_grants_apply','Hostinger Recovery DB Grants Apply',
       'hosting_account','remote_runtime:hostinger:catalog_only:hostinger_recovery_grants_apply',
       JSON_OBJECT('type','object',
         'required',JSON_ARRAY('target_id','environment','expected_commit_sha','plan_digest'),
         'properties',JSON_OBJECT(
           'target_id',JSON_OBJECT('type','string','minLength',3,'maxLength',64),
           'environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production')),
           'role',JSON_OBJECT('type','string','enum',JSON_ARRAY('runtime','governance','runtime_persistence')),
           'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
           'plan_digest',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),
           'credential_binding_ref',JSON_OBJECT('type','string','maxLength',191),
           'approval_id',JSON_OBJECT('type','string','maxLength',191),
           'execution_ticket_id',JSON_OBJECT('type','string','maxLength',191),
           'dry_run',JSON_OBJECT('type','boolean','const',true)),
         'additionalProperties',false),
       'admin_recovery',1,1,'summary_only','planned',
       'Apply separately approved exact scoped privileges, without GRANT OPTION. No external execution or secret return; unimplemented executor.'
WHERE EXISTS (SELECT 1 FROM connected_systems
              WHERE system_key='hostinger_ssh_prod_platform'
                AND provider_family='hostinger' AND connector_family='hostinger_ssh')
ON DUPLICATE KEY UPDATE
  notes = notes;

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    t.command_allowlist_json,
    '$', 'hostinger_recovery_database_inventory')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND JSON_VALID(t.command_allowlist_json) = 1
  AND JSON_TYPE(t.command_allowlist_json) = 'ARRAY'
  AND NOT JSON_CONTAINS(
    t.command_allowlist_json,
    JSON_QUOTE('hostinger_recovery_database_inventory'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    t.command_allowlist_json,
    '$', 'hostinger_recovery_control_store_plan')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND JSON_VALID(t.command_allowlist_json) = 1
  AND JSON_TYPE(t.command_allowlist_json) = 'ARRAY'
  AND NOT JSON_CONTAINS(
    t.command_allowlist_json,
    JSON_QUOTE('hostinger_recovery_control_store_plan'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    t.command_allowlist_json,
    '$', 'hostinger_recovery_database_create')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND JSON_VALID(t.command_allowlist_json) = 1
  AND JSON_TYPE(t.command_allowlist_json) = 'ARRAY'
  AND NOT JSON_CONTAINS(
    t.command_allowlist_json,
    JSON_QUOTE('hostinger_recovery_database_create'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    t.command_allowlist_json,
    '$', 'hostinger_recovery_environment_binding_plan')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND JSON_VALID(t.command_allowlist_json) = 1
  AND JSON_TYPE(t.command_allowlist_json) = 'ARRAY'
  AND NOT JSON_CONTAINS(
    t.command_allowlist_json,
    JSON_QUOTE('hostinger_recovery_environment_binding_plan'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    t.command_allowlist_json,
    '$', 'hostinger_recovery_environment_binding_apply')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND JSON_VALID(t.command_allowlist_json) = 1
  AND JSON_TYPE(t.command_allowlist_json) = 'ARRAY'
  AND NOT JSON_CONTAINS(
    t.command_allowlist_json,
    JSON_QUOTE('hostinger_recovery_environment_binding_apply'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    t.command_allowlist_json,
    '$', 'hostinger_recovery_grants_plan')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND JSON_VALID(t.command_allowlist_json) = 1
  AND JSON_TYPE(t.command_allowlist_json) = 'ARRAY'
  AND NOT JSON_CONTAINS(
    t.command_allowlist_json,
    JSON_QUOTE('hostinger_recovery_grants_plan'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    t.command_allowlist_json,
    '$', 'hostinger_recovery_grants_apply')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND JSON_VALID(t.command_allowlist_json) = 1
  AND JSON_TYPE(t.command_allowlist_json) = 'ARRAY'
  AND NOT JSON_CONTAINS(
    t.command_allowlist_json,
    JSON_QUOTE('hostinger_recovery_grants_apply'), '$');

-- Explicitly do not insert Admin write tools, dispatch certifications or executor gates.
-- The discovery endpoint lists these as planned and reports execution_allowed=false.

-- Read-only admin discovery endpoint registered DISABLED until Staging route acceptance.
INSERT INTO admin_platform_endpoint_tools
  (tool_key,display_name,description,http_method,http_path,path_param_keys,
   input_schema,fixed_body,tags,is_enabled,sort_order)
VALUES
  ('remote_runtime_hostinger_recovery_allowlist_discover',
   'Hostinger Recovery Allowlist Discovery',
   'Inspect exact registered Hostinger recovery capabilities and blockers. No SSH, database creation, environment changes or grants are performed.',
   'POST','/platform/remote-runtime/hosting/recovery-allowlist/discover',NULL,
   JSON_OBJECT('type','object','required',JSON_ARRAY('target_id'),
     'properties',JSON_OBJECT(
       'target_id',JSON_OBJECT('type','string','minLength',2,'maxLength',128),
       'environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production','development'),'default','production')),
     'additionalProperties',false),
   NULL,'admin,hostinger,recovery,read_only,discovery_only,disabled_until_acceptance,no_secrets',
   0,246)
ON DUPLICATE KEY UPDATE
   description=VALUES(description),input_schema=VALUES(input_schema),
   http_method=VALUES(http_method),http_path=VALUES(http_path),
   tags=VALUES(tags),is_enabled=0,updated_at=CURRENT_TIMESTAMP;
