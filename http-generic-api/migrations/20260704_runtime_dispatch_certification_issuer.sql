-- Runtime dispatch certification issuer bootstrap.
-- Additive and idempotent. Internal metadata only: no provider call, no external write,
-- credential payload read, secret access, or direct runtime certification issue.
INSERT INTO execution_policies (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES (
  'Runtime Dispatch Governance',
  'runtime_dispatch_certification_issue_v1',
  JSON_OBJECT(
    'tool_key', 'runtime_dispatch_certification_issue',
    'purpose', 'Issue bounded dispatch certifications with typed confirmation, capability envelope, evidence, expiry, and same-cycle readback.',
    'target_table', 'runtime_dispatch_certification_registry',
    'allowed_write_scope', JSON_ARRAY('runtime_dispatch_certification_registry'),
    'forbid_apply_allowed_true', TRUE,
    'requires_evidence_ref', TRUE,
    'requires_expiry', TRUE,
    'requires_readback', TRUE,
    'provider_call_allowed', FALSE,
    'external_send_allowed', FALSE,
    'raw_secret_access_allowed', FALSE,
    'secrets_included', FALSE
  ),
  'TRUE',
  'gpt_tools_call|tool_dispatch|runtime.dispatch.certification.issue|runtime_dispatch_certification_issue',
  'gptToolsRoutes|runtimeDispatchCertificationIssuer|runtime_dispatch_certification_registry',
  'TRUE',
  'Governs the bounded runtime_dispatch_certification_issue Admin virtual tool. Bootstrap does not issue any target certification.'
)
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value),
  active = VALUES(active),
  execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry (
  certification_key,
  surface_key,
  surface_family,
  tool_or_action_key,
  risk_class,
  certification_status,
  smoke_strategy,
  dispatch_allowed,
  apply_allowed,
  requires_resource_authority,
  requires_dry_run,
  requires_audit_evidence,
  requires_readback,
  last_evidence_ref,
  last_certified_at,
  expires_at,
  notes
)
VALUES (
  'runtime_dispatch_certification_issue_bootstrap_v1',
  'runtime_dispatch_certification_issue',
  'platform_registry',
  'runtime_dispatch_certification_issue',
  'D',
  'bootstrap_certified',
  'unit_test_and_policy_bootstrap_readback',
  1,
  0,
  1,
  0,
  1,
  1,
  'test-runtime-dispatch-certification-issuer.mjs plus metadata-only bootstrap policy readback',
  CURRENT_TIMESTAMP,
  DATE_ADD(NOW(), INTERVAL 90 DAY),
  'Bootstrap dispatch certification for the issuer itself. It allows dispatch only; apply_allowed remains false and target certifications still require envelope, typed confirmation, bounded evidence, expiry, and readback.'
)
ON DUPLICATE KEY UPDATE
  surface_key = VALUES(surface_key),
  surface_family = VALUES(surface_family),
  tool_or_action_key = VALUES(tool_or_action_key),
  risk_class = VALUES(risk_class),
  certification_status = VALUES(certification_status),
  smoke_strategy = VALUES(smoke_strategy),
  dispatch_allowed = VALUES(dispatch_allowed),
  apply_allowed = VALUES(apply_allowed),
  requires_resource_authority = VALUES(requires_resource_authority),
  requires_dry_run = VALUES(requires_dry_run),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  last_evidence_ref = VALUES(last_evidence_ref),
  last_certified_at = VALUES(last_certified_at),
  expires_at = VALUES(expires_at),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
