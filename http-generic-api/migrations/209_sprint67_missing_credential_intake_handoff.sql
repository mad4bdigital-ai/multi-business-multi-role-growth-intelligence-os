-- Sprint 67: Missing credential intake handoff policy.
-- Any runtime that hits blocked_missing_secret must return a credential-intake
-- continuation instead of stopping with a manual-only instruction. Platform/admin
-- credentials can use platform-scope intake with auto-promotion metadata; tenant
-- credentials require tenant/user-scoped intake and never promote to platform secrets.

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('Credential Intake Governance','missing_credential_auto_intake_handoff',
 JSON_OBJECT(
   'rule','missing_credential_must_create_or_return_credential_intake_handoff',
   'triggers',JSON_ARRAY('blocked_missing_secret','missing_credential_role'),
   'scopes',JSON_OBJECT(
     'platform_admin','platform-scoped intake may auto-promote mapped platform_secret values after form submission; no raw secrets returned',
     'tenant_user','tenant-scoped intake requires tenant_id and user_id and stores as user_app_connection/tenant-owned credential context'
   ),
   'requires',JSON_ARRAY('tenant_id','credential_role','auth_type_or_inference','dedupe_requirement_key','short_lived_token','no_secret_response','resume_metadata'),
   'forbidden',JSON_ARRAY('manual-only missing credential dead-end','returning raw secret values','marking credential resolved without stored value','promoting tenant credentials to platform scope')
 ),
 'true','credential_resolution|runtime_dispatch|remote_runtime|tenant_actions','credentialIntakeEnforcement,credentialResolver,hostingerSshDeployExecutor,credential_intake_sessions,platform_secrets,tenant_secrets,user_app_connections','true',
 'Missing credentials should route to governed credential intake automatically for both admin/platform and tenant/user contexts, preserving no-secret responses and scope boundaries.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value),
 active=VALUES(active),
 execution_scope=VALUES(execution_scope),
 affects_layer=VALUES(affects_layer),
 blocking=VALUES(blocking),
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO readiness_checks
(check_key, scope, status, severity, check_payload_json, notes)
VALUES
('missing-credential-intake-handoff-v1','credential_intake','pending','high',
 JSON_OBJECT(
   'expected_behavior','blocked_missing_secret returns credential_intake_required handoff when auto intake is enabled',
   'platform_admin_example','ssh_port missing for hostinger_ssh_prod_platform creates remote_ssh_runtime ssh_key_pair intake with platform_secret mapping',
   'tenant_example','tenant api_key/app_password missing creates tenant/user-scoped intake and does not auto-promote platform secrets',
   'secrets_included',false
 ),
 'Readiness passes when CI covers credentialIntakeEnforcement missing credential handoff and at least one runtime route surfaces credential_intake details on missing credential.'
)
ON DUPLICATE KEY UPDATE
 status=VALUES(status),
 severity=VALUES(severity),
 check_payload_json=VALUES(check_payload_json),
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;
