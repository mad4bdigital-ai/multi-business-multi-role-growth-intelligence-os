-- Sprint 68: Local connector tunnel provisioning continuation policy
-- Converts missing tunnel token self-repair failures into resumable no-secret provisioning handoffs.
-- Pattern: connector HTTP 530/1033 -> self-repair -> if cf_token is missing, checkpoint provisioning handoff -> provision token -> retry self-repair.

INSERT INTO execution_policies (
  policy_group,
  policy_key,
  policy_value,
  active,
  execution_scope,
  affects_layer,
  blocking,
  notes
) VALUES (
  'Connector Continuation Governance',
  'Local Connector Tunnel Provisioning Continuation Contract',
  JSON_OBJECT(
    'rule','local_connector_tunnel_provisioning_continuation_contract',
    'trigger_conditions',JSON_ARRAY('connector_http_530','cloudflare_error_1033','local_connector_self_repair_no_tunnel_token','missing local_connector_user_configs.cf_token','missing CLOUDFLARE_TUNNEL_TOKEN'),
    'interruption_signal','connector_tunnel_provisioning_required',
    'required_sequence',JSON_ARRAY(
      'detect_connector_unavailable',
      'run_local_connector_self_repair',
      'detect_missing_tunnel_token',
      'create_no_secret_continuation_checkpoint',
      'provision_tunnel_token',
      'retry_local_connector_self_repair',
      'verify_connector_health',
      'audit',
      'resume_original_operation'
    ),
    'checkpoint_contract',JSON_OBJECT(
      'engine','shared-reconciliation-continuation-v1',
      'resource_type','local_connector_tunnel_provisioning',
      'resource_scope','device',
      'must_include',JSON_ARRAY('operation_key','actor_scope','resource_scope','resource_fingerprint','interruption_signal','required_next_action','resume_metadata'),
      'must_exclude',JSON_ARRAY('cf_token','connector_secret','CLOUDFLARE_TUNNEL_TOKEN','BACKEND_API_KEY','raw_secret','access_token','refresh_token','client_secret','password','private_key'),
      'secrets_included',false
    ),
    'provisioning_handoff',JSON_OBJECT(
      'required_next_action','provision_tunnel_token',
      'accepted_sources',JSON_ARRAY('local_connector_user_configs.cf_token','CLOUDFLARE_TUNNEL_TOKEN'),
      'retry_route','POST /admin/cli/local-connector/self-repair',
      'status_code','409 connector_tunnel_provisioning_required'
    ),
    'forbidden_behaviors',JSON_ARRAY(
      'return_dead_end_404_for_no_tunnel_token',
      'claim_connector_recovered_without_same_cycle_validation',
      'include_tunnel_token_or_backend_secret_in_response_or_audit'
    ),
    'secrets_included',false
  ),
  'TRUE',
  'admin_tool_dispatch,local_connector_self_repair,device_tool_dispatch,connector_dispatch,cloudflare_tunnel_repair',
  'adminCliRoutes,local_connector_self_repair,sharedReconciliationEngine,connector_health,cloudflare_tunnel_provisioning',
  'TRUE',
  'Missing local connector tunnel tokens must return a no-secret continuation/provisioning handoff instead of a terminal self-repair failure.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
