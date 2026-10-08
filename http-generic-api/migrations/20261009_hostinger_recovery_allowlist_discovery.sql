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
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    '$', 'hostinger_recovery_database_inventory')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND NOT JSON_CONTAINS(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    JSON_QUOTE('hostinger_recovery_database_inventory'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    '$', 'hostinger_recovery_control_store_plan')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND NOT JSON_CONTAINS(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    JSON_QUOTE('hostinger_recovery_control_store_plan'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    '$', 'hostinger_recovery_database_create')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND NOT JSON_CONTAINS(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    JSON_QUOTE('hostinger_recovery_database_create'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    '$', 'hostinger_recovery_environment_binding_plan')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND NOT JSON_CONTAINS(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    JSON_QUOTE('hostinger_recovery_environment_binding_plan'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    '$', 'hostinger_recovery_environment_binding_apply')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND NOT JSON_CONTAINS(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    JSON_QUOTE('hostinger_recovery_environment_binding_apply'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    '$', 'hostinger_recovery_grants_plan')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND NOT JSON_CONTAINS(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    JSON_QUOTE('hostinger_recovery_grants_plan'), '$');

UPDATE remote_runtime_targets t
  JOIN connected_systems cs ON cs.system_id=t.system_id
SET t.command_allowlist_json =
  JSON_ARRAY_APPEND(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    '$', 'hostinger_recovery_grants_apply')
WHERE cs.system_key='hostinger_ssh_prod_platform'
  AND t.plugin_key='remote_ssh_runtime'
  AND t.target_kind='hosting_account'
  AND t.provider_family='hostinger' AND t.connector_family='hostinger_ssh'
  AND NOT JSON_CONTAINS(
    IF(JSON_VALID(t.command_allowlist_json), t.command_allowlist_json, JSON_ARRAY()),
    JSON_QUOTE('hostinger_recovery_grants_apply'), '$');

-- Explicitly do not insert Admin write tools, dispatch certifications or executor gates.
-- The discovery endpoint lists these as planned and reports execution_allowed=false.
