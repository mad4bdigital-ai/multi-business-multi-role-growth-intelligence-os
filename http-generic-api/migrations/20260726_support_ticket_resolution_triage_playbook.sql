INSERT INTO tenant_resolution_playbooks (
  playbook_key, root_family, display_name, description, tenant_visible,
  required_capability_key, risk_level, diagnostic_tool_key, decision_tool_key,
  apply_tool_key, readback_tool_key, approval_required, readback_required,
  status, policy_json, secrets_included
) VALUES (
  'tenant_resolution_triage_v1',
  'general_operational_review',
  'Governed support ticket triage',
  'Classify a support problem, collect diagnostic evidence, select a specialized playbook or governed remediation, require approval for state-changing work, and verify readback.',
  1, NULL, 'medium', NULL, NULL, NULL, NULL, 1, 1, 'active',
  JSON_OBJECT(
    'allowed_roles', JSON_ARRAY('tenant_admin','tenant_owner','platform_admin','platform_owner'),
    'problem_types', JSON_ARRAY('access_and_permissions','workflow','billing','tenant_onboarding','platform_bug','managed_service','general_support'),
    'steps', JSON_ARRAY(
      JSON_OBJECT('step_key','review_ticket_classification','mode','read_only'),
      JSON_OBJECT('step_key','collect_diagnostic_evidence','mode','read_only'),
      JSON_OBJECT('step_key','select_specialized_playbook_or_governed_remediation','mode','decision'),
      JSON_OBJECT('step_key','request_approval_if_state_changing','mode','approval'),
      JSON_OBJECT('step_key','apply_via_governed_tool','mode','apply'),
      JSON_OBJECT('step_key','verify_readback','mode','readback')
    ),
    'automatic_apply_allowed', FALSE,
    'provider_write_allowed', FALSE,
    'external_send_allowed', FALSE,
    'secrets_included', FALSE
  ),
  0
)
ON DUPLICATE KEY UPDATE
  root_family = VALUES(root_family),
  display_name = VALUES(display_name),
  description = VALUES(description),
  tenant_visible = VALUES(tenant_visible),
  risk_level = VALUES(risk_level),
  approval_required = VALUES(approval_required),
  readback_required = VALUES(readback_required),
  status = VALUES(status),
  policy_json = VALUES(policy_json),
  secrets_included = 0,
  updated_at = CURRENT_TIMESTAMP;
