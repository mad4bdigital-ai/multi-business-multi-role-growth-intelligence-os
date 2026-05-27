-- Sprint 65: Browser runtime activation matrix
-- Durable activation state after Browser4 smoke and before enabling remaining
-- browser providers. Do not mark a runtime active without same-cycle runtime
-- validation/smoke evidence.

UPDATE `browser_runtime_registry`
   SET `status` = 'active',
       `metadata_json` = '{"use_case":"extraction_inspect","install_required":false,"last_smoke":{"status":"completed","inspection_key":"browser4_policy_smoke_after_identity_repair_20260527_0131","target_host":"n8n.mad4b.com","open_exit":0,"goto_exit":0,"snapshot_exit":0,"screenshot_exit":0,"secrets_included":false},"adapter":{"route":"/browser-runtime/inspect-site/run","connector_path":"/browser4","session_lifecycle":["open","goto","snapshot_or_screenshot"],"requires_connector_upgrade":false,"status":"active"}}'
 WHERE `runtime_key` = 'browser4_essam_v1';

UPDATE `browser_runtime_bindings`
   SET `status` = 'active'
 WHERE `binding_key` IN ('browser4_extraction_essam','browser4_inspect_essam');

UPDATE `browser_runtime_registry`
   SET `status` = 'activation_pending_adapter_poc',
       `metadata_json` = '{"use_case":"visual_takeover","install_required":true,"activation_phase":"adapter_poc_required","activation_gates":["local_tool_manifest_release","adapter_route","policy_gate","same_cycle_smoke"],"blocked_until":["adapter_available","explicit_approval_flow","artifact_redaction"]}'
 WHERE `runtime_key` = 'auto_browser_essam_v1';

UPDATE `browser_runtime_registry`
   SET `status` = 'activation_pending_adapter_poc',
       `metadata_json` = '{"use_case":"persistent_authenticated_session","install_required":true,"activation_phase":"adapter_poc_required","activation_gates":["local_tool_manifest_release","profile_storage_policy","session_reuse_approval","same_cycle_smoke"],"blocked_until":["adapter_available","session_expiry_controls","credential_echo_guard"]}'
 WHERE `runtime_key` = 'vessel_browser_essam_v1';

UPDATE `browser_runtime_registry`
   SET `status` = 'credential_required_pending_poc',
       `metadata_json` = '{"use_case":"cloud_public_extraction","credential_intake_required":true,"activation_phase":"credential_and_adapter_poc_required","activation_gates":["credential_client_config","cost_controls","domain_allowlist","same_cycle_smoke"],"blocked_until":["api_credentials_available","adapter_route_available","public_data_only_policy"]}'
 WHERE `runtime_key` = 'oxylabs_browser_agent_v1';

UPDATE `browser_runtime_registry`
   SET `status` = 'candidate_under_review_pending_poc'
 WHERE `runtime_key` = 'cloak_browser_candidate_v1'
   AND `status` IN ('candidate_under_review','planned');

UPDATE `browser_runtime_bindings`
   SET `policy_json` = '{"requires_approval":true,"domain_allowlist_required":true,"audit_required":true,"human_takeover_approval":true,"no_payment_or_checkout_submit":true,"no_destructive_actions_without_approval":true,"screenshot_artifact_redaction":true,"session_expiry_required":true,"activation_status":"adapter_poc_required"}',
       `status` = 'planned'
 WHERE `binding_key` = 'auto_browser_takeover_essam';

UPDATE `browser_runtime_bindings`
   SET `policy_json` = '{"session_reuse_approval_required":true,"domain_allowlist_required":true,"audit_required":true,"session_expiry_required":true,"no_cookie_token_echo":true,"no_payment_or_checkout_submit":true,"activation_status":"adapter_poc_required"}',
       `status` = 'planned'
 WHERE `binding_key` = 'vessel_persistent_essam';

UPDATE `browser_runtime_bindings`
   SET `policy_json` = '{"domain_allowlist_required":true,"audit_required":true,"public_data_only":true,"credential_intake_required":true,"cost_controls_required":true,"no_login_or_private_account_use":true,"activation_status":"credential_and_adapter_poc_required"}',
       `status` = 'planned'
 WHERE `binding_key` = 'oxylabs_cloud_extraction';
