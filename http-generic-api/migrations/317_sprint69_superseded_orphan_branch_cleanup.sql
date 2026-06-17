-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Sprint 69: explicit orphan branch cleanup support.
-- Purpose: preserve the generic unmerged-branch delete block while allowing a no-PR
-- orphan branch to be deleted only when replacement commits are on the default branch
-- and every non-generated branch file is byte-equivalent to the current default branch.

UPDATE execution_policies
SET policy_value = JSON_SET(
      CASE WHEN JSON_VALID(policy_value) THEN policy_value ELSE JSON_OBJECT() END,
      '$.allow_superseded_orphan_branch_delete', true,
      '$.superseded_orphan_branch_requires_no_matching_pr', true,
      '$.superseded_orphan_branch_requires_main_ancestor_replacement', true,
      '$.superseded_orphan_branch_requires_changed_file_coverage', true,
      '$.superseded_orphan_branch_requires_content_equivalence', true,
      '$.superseded_orphan_branch_requires_fresh_sha_evidence', true,
      '$.superseded_orphan_branch_requires_capability_envelope', true,
      '$.superseded_orphan_branch_requires_same_cycle_readback', true,
      '$.superseded_orphan_branch_direct_main_write_allowed', false,
      '$.superseded_orphan_branch_force_allowed', false,
      '$.secrets_included', false
    ),
    notes = CONCAT(
      COALESCE(notes,''),
      CASE WHEN notes IS NULL OR notes='' THEN '' ELSE '\n' END,
      'Sprint 69: explicit orphan cleanup requires zero matching PRs, replacement commits on the default branch, complete non-generated file coverage, exact branch/default Git blob equivalence, fresh evidence, capability approval, typed confirmation, audit, and same-cycle missing-ref readback.'
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
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.allow_superseded_closed_pr_branch_delete')) AS closed_pr_cleanup_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.allow_superseded_orphan_branch_delete')) AS orphan_cleanup_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_closed_pr')) AS requires_closed_pr,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_no_open_pr')) AS requires_no_open_pr,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_orphan_branch_requires_no_matching_pr')) AS orphan_requires_no_matching_pr,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_main_ancestor_replacement')) AS requires_main_ancestor_replacement,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_changed_file_coverage')) AS requires_changed_file_coverage,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_orphan_branch_requires_content_equivalence')) AS orphan_requires_content_equivalence,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_fresh_sha_evidence')) AS requires_fresh_sha_evidence,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_capability_envelope')) AS requires_capability_envelope,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_requires_same_cycle_readback')) AS requires_same_cycle_readback,
  JSON_EXTRACT(policy_value, '$.superseded_branch_delete_generated_path_prefixes') AS generated_path_prefixes,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_required_label')) AS required_label,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_max_ahead_commits')) AS max_ahead_commits,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_branch_delete_force_allowed')) AS force_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.superseded_orphan_branch_force_allowed')) AS orphan_force_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.secrets_included')) AS policy_secrets_included,
  0 AS secrets_included
FROM execution_policies
WHERE policy_group = 'Repository Mutation Governance'
  AND policy_key = 'Stale Duplicate Branch Merge Guard';

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('317_sprint69_superseded_orphan_branch_cleanup.sql','authorized','migration_seed',
   'governed_migration_runner_authorization_v1','high',1,1,1,1,
   'Authorize explicit orphan branch cleanup only with zero matching PRs and exact non-generated Git blob equivalence.',
   JSON_OBJECT('tool_key','github_superseded_branch_cleanup','orphan_mode_opt_in',true,'content_equivalence_required',true,'generic_unmerged_delete_allowed',false,'force_allowed',false,'secrets_included',false))
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
