-- Sprint 65: Auto Browser managed runtime start
-- Separates the working Essam local status probe from the planned managed
-- browser.mad4b.com runtime and fixes the Auto Browser health probe to /healthz.

UPDATE browser_runtime_registry
   SET status = 'local_active_status_only',
       metadata_json = JSON_SET(
         COALESCE(metadata_json, JSON_OBJECT()),
         '$.activation_phase', 'local_runtime_reachable_status_only',
         '$.local_connector.env.AUTO_BROWSER_HEALTH_PATH', '/healthz',
         '$.last_smoke', JSON_OBJECT(
           'checked_at', NOW(),
           'device_id', 'essam-pc',
           'base_url', 'http://127.0.0.1:8000',
           'health_path', '/healthz',
           'health_status', 200,
           'adapter_status', 'service_reachable_status_only',
           'validated_actions', JSON_ARRAY('status'),
           'blocked_actions', JSON_ARRAY('visual_takeover','click','type','auth_profile_reuse','destructive_actions'),
           'secrets_included', false
         ),
         '$.next_activation_required', JSON_ARRAY('managed_host_decision','public_gateway','auth_proxy','visual_takeover_adapter','same_cycle_smoke')
       ),
       updated_at = NOW()
 WHERE runtime_key = 'auto_browser_essam_v1';

INSERT INTO browser_runtime_registry
  (runtime_key, provider, display_name, device_id, capability_class, capabilities_json, degraded_capabilities_json, status, endpoint_url, public_url, metadata_json)
VALUES
  (
    'auto_browser_managed_v1',
    'auto_browser',
    'Auto Browser Managed Visual Takeover Runtime',
    NULL,
    'visual_takeover',
    JSON_ARRAY('visual_takeover','novnc','open_url','screenshot','human_supervision','mcp_candidate'),
    JSON_ARRAY('adapter_not_implemented','public_gateway_not_configured','auth_proxy_required','tenant_isolation_required'),
    'planned_managed_runtime',
    NULL,
    'https://browser.mad4b.com',
    JSON_OBJECT(
      'target_host','browser.mad4b.com',
      'model','managed_platform_runtime_like_n8n',
      'source_runtime_key','auto_browser_essam_v1',
      'reference_pattern','n8n.mad4b.com managed webhook runtime with bearer_env',
      'required_components',JSON_ARRAY('managed_docker_host','cloudflare_dns_tls','auth_host_gateway','bearer_env_token','session_store','visual_takeover_adapter','audit_events','approval_policy'),
      'governance',JSON_OBJECT('domain_allowlist_required',true,'audit_required',true,'no_credential_logging',true,'no_cookie_token_echo',true,'no_payment_or_checkout_submit',true,'explicit_approval_required',true,'artifact_redaction_required',true,'session_expiry_required',true),
      'activation_status','planning_started'
    )
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  capability_class = VALUES(capability_class),
  capabilities_json = VALUES(capabilities_json),
  degraded_capabilities_json = VALUES(degraded_capabilities_json),
  status = VALUES(status),
  public_url = VALUES(public_url),
  metadata_json = VALUES(metadata_json),
  updated_at = NOW();

INSERT INTO browser_runtime_bindings
  (binding_key, runtime_key, use_case, tenant_id, user_id, allowed_actions_json, domain_allowlist_json, policy_json, status)
VALUES
  (
    'auto_browser_managed_visual_takeover_v1',
    'auto_browser_managed_v1',
    'visual_takeover',
    NULL,
    NULL,
    JSON_ARRAY('session_create','session_status','open_url','screenshot','session_close'),
    JSON_ARRAY('mad4b.com','n8n.mad4b.com'),
    JSON_OBJECT(
      'status','planned_until_adapter_and_gateway_ready',
      'requires_approval',true,
      'requires_domain_allowlist',true,
      'requires_bearer_env',true,
      'raw_novnc_public_exposure_forbidden',true,
      'max_session_minutes',30,
      'artifact_redaction_required',true,
      'secrets_included',false
    ),
    'planned'
  )
ON DUPLICATE KEY UPDATE
  runtime_key = VALUES(runtime_key),
  use_case = VALUES(use_case),
  allowed_actions_json = VALUES(allowed_actions_json),
  domain_allowlist_json = VALUES(domain_allowlist_json),
  policy_json = VALUES(policy_json),
  status = VALUES(status),
  updated_at = NOW();
