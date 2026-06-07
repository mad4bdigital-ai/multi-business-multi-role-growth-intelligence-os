-- Sprint 67: Require capability resolution envelopes for repository patch apply.
-- Scope: policy/runtime registry only. Runtime enforcement is in routes/gptToolsRoutes.js.
-- Read-only repository inspection remains available without an envelope.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('repo_patch_apply_capability_envelope_requirement_v1',
   JSON_OBJECT(
     'policy_key','repo_patch_apply_capability_envelope_requirement_v1',
     'status','active',
     'app_key','github',
     'tool_key','repo_patch_apply',
     'route','internal://repo-patch-apply',
     'runtime_file','routes/gptToolsRoutes.js',
     'read_only_repo_inspect_requires_envelope',false,
     'repo_patch_apply_requires_envelope',true,
     'envelope_table','capability_resolution_envelope_ledger',
     'required_envelope_status','ready_for_dispatch',
     'required_dispatch_allowed',true,
     'approval_required_must_be_false',true,
     'blocking_gap_count_must_be_zero',true,
     'expired_envelopes_rejected',true,
     'accepted_app_keys',JSON_ARRAY('github'),
     'accepted_intents',JSON_ARRAY('repo_patch_apply','repo_mutation','github_repo_patch','write','create','delete'),
     'tenant_user_match_enforced_when_present',true,
     'marks_envelope_referenced_before_github_token',true,
     'github_app_token_blocked_without_envelope',true,
     'github_content_mutation_blocked_without_envelope',true,
     'existing_preflight_still_required',true,
     'protected_branch_guard_still_required',true,
     'stale_branch_guard_still_required',true,
     'path_safety_guard_still_required',true,
     'secrets_included',false
   ),
   'active',
   'Repository patch apply requires a no-secret capability resolution envelope before GitHub App token resolution or content mutation.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE execution_policies
   SET policy_value = JSON_SET(
         policy_value,
         '$.requires_envelope_id', true,
         '$.envelope_table', 'capability_resolution_envelope_ledger',
         '$.github_token_after_envelope_gate', true
       ),
       notes = CONCAT(notes, ' Repository patch apply requires capability_envelope_id before GitHub App token resolution.'),
       updated_at = CURRENT_TIMESTAMP
 WHERE policy_group = 'Repository Mutation Governance'
   AND policy_key = 'Stale Duplicate Branch Merge Guard'
   AND notes NOT LIKE '%Repository patch apply requires capability_envelope_id%';
