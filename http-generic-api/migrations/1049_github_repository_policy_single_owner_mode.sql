-- GitHub main policy single-owner mode metadata and tool-schema upgrade.
-- no_provider_call=true; no_external_write=true; no_credential_payload_read=true;
-- no_protected_ref_mutation=true; no_force_push=true; secrets_included=false.

UPDATE execution_policies
SET policy_value = JSON_SET(
      CASE WHEN JSON_VALID(policy_value) THEN policy_value ELSE JSON_OBJECT() END,
      '$.review_policy_mode','auto_single_owner_or_independent',
      '$.required_approving_review_count_independent',1,
      '$.required_approving_review_count_single_owner',0,
      '$.single_owner_exact_head_attestation_required',TRUE,
      '$.single_owner_gate_check','Single Owner Review Gate',
      '$.required_status_checks',JSON_ARRAY(
        'Syntax Check','Unit & Integration Tests','Architecture Drift Detection','Execution Resolver Gate',
        'Evaluate changed feature phases','Execute current phase journeys','Single Owner Review Gate'
      )
    ),
    notes='Fail-closed main review policy with automatic single-owner exact-head attestation fallback; independent approval resumes when another eligible human exists.',
    updated_at=CURRENT_TIMESTAMP
WHERE policy_group='Repository Automation Governance' AND policy_key='github_repository_policy_controller_v1';

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      CASE WHEN JSON_VALID(input_schema) THEN input_schema ELSE JSON_OBJECT() END,
      '$.properties.single_owner_mode',JSON_OBJECT(
        'type','boolean',
        'description','Optional explicit request; succeeds only when live collaborator readback proves complete permissions and exactly one eligible human collaborator.'
      )
    ),
    description=CONCAT(
      description,
      ' Single-owner mode uses an exact-head governed review check instead of GitHub-native self-approval and automatically ceases to apply when another eligible human collaborator exists.'
    ),
    updated_at=CURRENT_TIMESTAMP
WHERE tool_key IN ('github_repository_policy_controller','repository_automation_policy_controller');

UPDATE platform_plugin_capabilities
SET metadata_json = JSON_SET(
      CASE WHEN JSON_VALID(metadata_json) THEN metadata_json ELSE JSON_OBJECT() END,
      '$.review_policy_mode','auto_single_owner_or_independent',
      '$.single_owner_gate_check','Single Owner Review Gate',
      '$.single_owner_exact_head_attestation_required',TRUE
    ), updated_at=CURRENT_TIMESTAMP
WHERE capability_key='repository_policy_controller';

INSERT INTO governed_migration_authorization_registry
  (migration_file,authorization_status,authorization_source,policy_key,risk_tier,requires_preflight,requires_confirmation,allow_record_only,allow_apply,notes,metadata_json)
VALUES
  ('1049_github_repository_policy_single_owner_mode.sql','authorized','migration_seed','governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize metadata/schema registration for collaborator-aware single-owner review mode. No GitHub policy is applied by this migration.',
   JSON_OBJECT(
      'scope','github_repository_policy_single_owner_mode_registration',
      'live_github_policy_apply',false,
      'provider_calls',false,
      'external_writes',false,
      'protected_ref_mutation',false,
      'force_push',false,
      'secrets_included',false
   ))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),
  authorization_source=VALUES(authorization_source),
  policy_key=VALUES(policy_key),
  risk_tier=VALUES(risk_tier),
  requires_preflight=VALUES(requires_preflight),
  requires_confirmation=VALUES(requires_confirmation),
  allow_record_only=VALUES(allow_record_only),
  allow_apply=VALUES(allow_apply),
  notes=VALUES(notes),
  metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
