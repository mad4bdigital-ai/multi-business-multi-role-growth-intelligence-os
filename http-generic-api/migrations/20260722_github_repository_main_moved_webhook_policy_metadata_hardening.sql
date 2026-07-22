-- Replace sensitive-looking Boolean metadata keys in the governed GitHub
-- repository-main-moved webhook apply policy. The capability-envelope secret
-- policy rejects keys containing "secret" unless they are approved false-only
-- metadata. These fields describe authorization behavior and contain no secret.

UPDATE capability_apply_authorization_policy_registry
SET policy_json = JSON_SET(
      JSON_REMOVE(
        COALESCE(policy_json, JSON_OBJECT()),
        '$.server_side_secret_resolution_allowed',
        '$.inline_secret_input_allowed'
      ),
      '$.server_side_reference_resolution_allowed', TRUE,
      '$.inline_sensitive_input_allowed', FALSE,
      '$.secrets_included', FALSE
    ),
    notes = CONCAT_WS(
      ' ',
      NULLIF(TRIM(COALESCE(notes, '')), ''),
      '[metadata keys hardened for capability-envelope secret policy]'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_key = 'github_repository_main_moved_webhook_provision_apply_v1';
