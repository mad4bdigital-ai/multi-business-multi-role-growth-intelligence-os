-- Sprint 69 follow-up: bounded superseded branch cleanup limit for verified legacy branches.
-- Changes one numeric policy bound only. All closed-PR, label, replacement ancestry,
-- file coverage, fresh SHA, capability envelope, no-force, audit, and readback guards remain required.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

UPDATE execution_policies
   SET policy_value = JSON_SET(
         CAST(policy_value AS JSON),
         '$.superseded_branch_delete_max_ahead_commits',
         30
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE policy_group = 'Repository Mutation Governance'
   AND policy_key = 'Stale Duplicate Branch Merge Guard'
   AND active = 'TRUE'
   AND blocking = 'TRUE'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.allow_superseded_closed_pr_branch_delete')) = 'true'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_closed_pr')) = 'true'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_no_open_pr')) = 'true'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_main_ancestor_replacement')) = 'true'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_changed_file_coverage')) = 'true'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_fresh_sha_evidence')) = 'true'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_capability_envelope')) = 'true'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_same_cycle_readback')) = 'true'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_required_label')) = 'superseded'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_force_allowed')) = 'false'
   AND JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_generic_fallback_allowed')) = 'false'
   AND COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_max_ahead_commits')) AS UNSIGNED), 20) < 30;
