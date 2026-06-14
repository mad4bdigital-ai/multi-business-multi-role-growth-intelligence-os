-- Sprint 69: governed cleanup of superseded closed-PR branches.
-- Purpose: keep generic unmerged branch deletion blocked while enabling one
-- evidence-bound cleanup recipe for closed PR branches whose non-generated
-- changed files are covered by explicit replacement commits already on main.
-- Safety: additive/idempotent policy update, no provider call in migration,
-- no credential payload read, no raw secrets, no external send. secrets_included=false.

UPDATE execution_policies
SET policy_value = JSON_SET(
      CASE WHEN JSON_VALID(policy_value) THEN policy_value ELSE JSON_OBJECT() END,
      '$.allow_superseded_closed_pr_branch_delete', true,
      '$.superseded_branch_delete_requires_closed_pr', true,
      '$.superseded_branch_delete_requires_no_open_pr', true,
      '$.superseded_branch_delete_requires_main_ancestor_replacement', true,
      '$.superseded_branch_delete_requires_changed_file_coverage', true,
      '$.superseded_branch_delete_requires_fresh_sha_evidence', true,
      '$.superseded_branch_delete_requires_capability_envelope', true,
      '$.superseded_branch_delete_requires_same_cycle_readback', true,
      '$.superseded_branch_delete_generated_path_prefixes', JSON_ARRAY('docs/auto-docs-agent/'),
      '$.superseded_branch_delete_required_label', 'superseded',
      '$.superseded_branch_delete_max_ahead_commits', 20,
      '$.superseded_branch_delete_max_replacement_commits', 20,
      '$.superseded_branch_delete_max_changed_files', 100,
      '$.superseded_branch_delete_typed_confirmation_prefix', 'DELETE_SUPERSEDED_BRANCH',
      '$.superseded_branch_delete_direct_main_write_allowed', false,
      '$.superseded_branch_delete_force_allowed', false,
      '$.superseded_branch_delete_generic_fallback_allowed', false,
      '$.secrets_included', false
    ),
    notes = CONCAT(
      COALESCE(notes,''),
      CASE WHEN notes IS NULL OR notes='' THEN '' ELSE '\n' END,
      'Sprint 69: github_superseded_branch_cleanup may delete a closed-PR work branch only after replacement commits on main cover every non-generated changed file, fresh SHA/fingerprint evidence matches, capability approval and typed confirmation pass, and same-cycle missing-ref readback succeeds. Generic unmerged deletion remains blocked.'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'Repository Mutation Governance'
  AND policy_key = 'Stale Duplicate Branch Merge Guard'
  AND active = 'TRUE'
  AND blocking = 'TRUE';

CREATE OR REPLACE VIEW v_superseded_branch_cleanup_policy_readback AS
SELECT
  policy_group,
  policy_key,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.allow_superseded_closed_pr_branch_delete')) AS cleanup_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_closed_pr')) AS requires_closed_pr,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_no_open_pr')) AS requires_no_open_pr,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_main_ancestor_replacement')) AS requires_main_ancestor_replacement,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_changed_file_coverage')) AS requires_changed_file_coverage,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_fresh_sha_evidence')) AS requires_fresh_sha_evidence,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_capability_envelope')) AS requires_capability_envelope,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_same_cycle_readback')) AS requires_same_cycle_readback,
  JSON_EXTRACT(policy_value, '$.superseded_branch_delete_generated_path_prefixes') AS generated_path_prefixes,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_required_label')) AS required_label,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_max_ahead_commits')) AS max_ahead_commits,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_force_allowed')) AS force_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_generic_fallback_allowed')) AS generic_fallback_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.secrets_included')) AS policy_secrets_included,
  0 AS secrets_included
FROM execution_policies
WHERE policy_group = 'Repository Mutation Governance'
  AND policy_key = 'Stale Duplicate Branch Merge Guard';

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('311_sprint69_superseded_closed_pr_branch_cleanup.sql','authorized','migration_seed',
   'governed_migration_runner_authorization_v1','high',1,1,1,1,
   'Authorize the additive superseded closed-PR branch cleanup policy and readback view.',
   JSON_OBJECT('tool_key','github_superseded_branch_cleanup','generic_unmerged_delete_allowed',false,'force_allowed',false,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status),
  authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key),
  risk_tier = VALUES(risk_tier),
  requires_preflight = VALUES(requires_preflight),
  requires_confirmation = VALUES(requires_confirmation),
  allow_record_only = VALUES(allow_record_only),
  allow_apply = VALUES(allow_apply),
  notes = VALUES(notes),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;