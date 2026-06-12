-- 962_sprint68_smoke_branch_cleanup_gate.sql
-- Purpose: allow deletion of unmerged governed smoke branches only when the
-- repository mutation preflight receives an exact typed confirmation. This does
-- not allow protected branch deletion or generic unmerged branch deletion.
-- Safety:
--   no_provider_call=true
--   no_credential_payload_read=true
--   no_raw_secrets=true
--   no_external_send=true
--   no_external_write=true
--   secrets_included=false

UPDATE execution_policies
SET policy_value = JSON_SET(
      CASE WHEN JSON_VALID(policy_value) THEN policy_value ELSE JSON_OBJECT() END,
      '$.allow_unmerged_smoke_branch_delete', true,
      '$.unmerged_smoke_branch_delete_prefixes', JSON_ARRAY('gpt/smoke-'),
      '$.unmerged_smoke_branch_delete_requires_typed_confirmation', true,
      '$.unmerged_smoke_branch_delete_typed_confirmation_prefix', 'DELETE_UNMERGED_SMOKE_BRANCH',
      '$.unmerged_smoke_branch_delete_direct_main_write_allowed', false,
      '$.unmerged_smoke_branch_delete_merge_allowed', false,
      '$.secrets_included', false
    ),
    notes = CONCAT(COALESCE(notes,''), CASE WHEN notes IS NULL OR notes='' THEN '' ELSE '\n' END,
      'Sprint 68: allow governed cleanup of unmerged gpt/smoke-* branches only with exact typed confirmation. Protected branch deletion and generic unmerged branch deletion remain blocked.'),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'Repository Mutation Governance'
  AND policy_key = 'Stale Duplicate Branch Merge Guard'
  AND active = 'TRUE'
  AND blocking = 'TRUE';

CREATE OR REPLACE VIEW v_smoke_branch_cleanup_gate_readback AS
SELECT
  policy_group,
  policy_key,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.allow_unmerged_smoke_branch_delete')) AS allow_unmerged_smoke_branch_delete,
  JSON_EXTRACT(policy_value, '$.unmerged_smoke_branch_delete_prefixes') AS unmerged_smoke_branch_delete_prefixes,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.unmerged_smoke_branch_delete_requires_typed_confirmation')) AS requires_typed_confirmation,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.unmerged_smoke_branch_delete_typed_confirmation_prefix')) AS typed_confirmation_prefix,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.unmerged_smoke_branch_delete_direct_main_write_allowed')) AS direct_main_write_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.unmerged_smoke_branch_delete_merge_allowed')) AS merge_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.secrets_included')) AS policy_secrets_included,
  0 AS secrets_included
FROM execution_policies
WHERE policy_group = 'Repository Mutation Governance'
  AND policy_key = 'Stale Duplicate Branch Merge Guard';
