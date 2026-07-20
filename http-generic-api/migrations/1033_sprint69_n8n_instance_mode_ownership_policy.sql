-- Sprint 69: n8n instance-mode, ownership, and action-class policy contract.
-- Metadata and readiness view only. No n8n provider call, workflow mutation,
-- credential access, external write, or secret material is executed.

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
VALUES
  (
    'n8n Mutation Governance',
    'n8n_instance_mode_ownership_policy_v1',
    JSON_OBJECT(
      'rule', 'n8n_run_and_activation_actions_require_instance_mode_ownership_envelope_and_existing_approval',
      'enforcement_mode', 'blocking',
      'read_actions', JSON_ARRAY('list_workflows', 'get_workflow', 'list_executions', 'status', 'diagnose', 'health', 'open'),
      'run_actions', JSON_ARRAY('trigger_webhook', 'run_workflow', 'execute_workflow'),
      'activation_actions', JSON_ARRAY('activate_workflow', 'deactivate_workflow'),
      'mutation_actions', JSON_ARRAY('trigger_webhook', 'run_workflow', 'execute_workflow', 'activate_workflow', 'deactivate_workflow'),
      'instance_mode_required', TRUE,
      'accepted_instance_modes', JSON_ARRAY('tenant_bound', 'managed_dedicated', 'managed_shared_with_tenant_binding'),
      'ownership_binding_required', TRUE,
      'workflow_owner_tenant_match_required', TRUE,
      'capability_envelope_required', TRUE,
      'approval_hold_required', TRUE,
      'reuse_existing_approval_path', TRUE,
      'same_cycle_readback_required', TRUE,
      'rollback_metadata_required_for_activation', TRUE,
      'credential_payload_read_allowed', FALSE,
      'direct_provider_execution_enabled_by_policy', FALSE,
      'secrets_included', FALSE
    ),
    'TRUE',
    'n8n|connector_n8n|app_action|external_app_action|workflow_run|workflow_activation|gpt_tools_call|tool_dispatch',
    'execution_policies|platform_runtime_config|connectorProxyRoutes|appAdapters|appAdapters/index.js|capability_resolution_envelope_ledger|approval_holds',
    'TRUE',
    'n8n run and activation actions must prove instance mode, workflow ownership binding, capability envelope readiness, and existing approval gates before dispatch. Read actions remain separated from run and activation actions.'
  )
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_runtime_config`
  (`config_key`, `config_json`, `status`, `note`)
VALUES
  (
    'n8n_instance_mode_ownership_policy_v1',
    JSON_OBJECT(
      'policy_key', 'n8n_instance_mode_ownership_policy_v1',
      'status', 'active',
      'app_key', 'n8n',
      'tool_key', 'connector_n8n',
      'read_actions', JSON_ARRAY('list_workflows', 'get_workflow', 'list_executions', 'status', 'diagnose', 'health', 'open'),
      'run_actions', JSON_ARRAY('trigger_webhook', 'run_workflow', 'execute_workflow'),
      'activation_actions', JSON_ARRAY('activate_workflow', 'deactivate_workflow'),
      'instance_mode_required', TRUE,
      'ownership_binding_required', TRUE,
      'reuse_existing_approval_path', TRUE,
      'no_new_approval_path', TRUE,
      'secrets_included', FALSE
    ),
    'active',
    'n8n actions are split into read, run, and activation classes. Run and activation classes require instance mode and ownership binding before existing envelope and approval gates.'
  )
ON DUPLICATE KEY UPDATE
  `config_json` = VALUES(`config_json`),
  `status` = VALUES(`status`),
  `note` = VALUES(`note`),
  `updated_at` = CURRENT_TIMESTAMP;

UPDATE `admin_platform_endpoint_tools`
   SET `input_schema` = JSON_SET(
         `input_schema`,
         '$.properties.instance_mode',
         JSON_OBJECT('type','string','enum',JSON_ARRAY('tenant_bound','managed_dedicated','managed_shared_with_tenant_binding'),'description','Required for n8n run and activation actions.'),
         '$.properties.workflow_owner_tenant_id',
         JSON_OBJECT('type','string','description','Tenant ownership binding for n8n workflow run and activation actions.'),
         '$.properties.approval_hold_id',
         JSON_OBJECT('type','string','description','Existing approval hold for state-changing n8n actions.'),
         '$.properties.readback_plan',
         JSON_OBJECT('type','object','description','Same-cycle readback plan for state-changing n8n actions.')
       ),
       `description` = CONCAT(`description`, ' n8n read, run, and activation actions are separated; run and activation require instance mode, ownership binding, capability envelope, and existing approval gates.'),
       `tags` = CONCAT(`tags`, ',n8n_action_class_separation,instance_mode_required,ownership_binding_required,approval_required,readback,no_secret_response'),
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `tool_key` = 'connector_n8n'
   AND `tags` NOT LIKE '%n8n_action_class_separation%';

UPDATE `tenant_platform_endpoint_tools`
   SET `input_schema` = JSON_SET(
         `input_schema`,
         '$.properties.instance_mode',
         JSON_OBJECT('type','string','enum',JSON_ARRAY('tenant_bound','managed_dedicated','managed_shared_with_tenant_binding'),'description','Required for n8n run and activation actions.'),
         '$.properties.workflow_owner_tenant_id',
         JSON_OBJECT('type','string','description','Tenant ownership binding for n8n workflow run and activation actions.')
       ),
       `description` = CONCAT(`description`, ' n8n read, run, and activation actions are separated; run and activation require instance mode and ownership binding.'),
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `tool_key` = 'connector_n8n'
   AND `description` NOT LIKE '%n8n read, run, and activation actions are separated%';

CREATE OR REPLACE VIEW `v_n8n_instance_mode_ownership_policy_readiness` AS
SELECT
  p.`policy_key`,
  p.`active`,
  p.`blocking`,
  c.`status` AS `runtime_config_status`,
  CASE
    WHEN p.`policy_key` = 'n8n_instance_mode_ownership_policy_v1'
      AND p.`active` = 'TRUE'
      AND p.`blocking` = 'TRUE'
      AND c.`status` = 'active'
      THEN 'ready'
    ELSE 'missing_n8n_instance_mode_ownership_policy_contract'
  END AS `coverage_status`,
  p.`updated_at`
FROM `execution_policies` p
LEFT JOIN `platform_runtime_config` c
  ON c.`config_key` = 'n8n_instance_mode_ownership_policy_v1'
WHERE p.`policy_group` = 'n8n Mutation Governance'
  AND p.`policy_key` = 'n8n_instance_mode_ownership_policy_v1';
