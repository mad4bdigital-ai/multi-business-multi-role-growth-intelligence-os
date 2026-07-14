-- Reconcile one credential-intake continuation task whose title implied that
-- the task itself was completed while its governed follow-up validation was
-- still pending.
--
-- Safety contract:
-- - no_provider_call
-- - no_credential_payload_read
-- - no_raw_secrets
-- - no_external_send
-- - no_external_write
-- - secrets_included_false
--
-- The task remains pending. This migration changes only the human-facing
-- title/summary fields and preserves the provider/runtime smoke-validation
-- follow-up recorded in context_json.

UPDATE platform_pending_tasks
SET title = 'Validate credential intake continuation for hostinger',
    description = 'Credential intake and automatic promotion completed for hostinger. Provider/runtime readback and smoke validation remain pending; no manual completion message is required.',
    brief = 'Credential intake dd9f8870-0fe4-4059-b315-c14869bd3b8f completed and connection d43275c7-2e41-4686-9c32-b3fff36efb7d was promoted. Continue with governed provider/runtime readback and smoke validation.',
    updated_by = 'migration:20260714_reconcile_hostinger_credential_intake_task_title',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = 'adc3d06f-7f0b-11f1-9a4d-d342cf4a053c'
  AND task_key = 'credential_intake_completed:dd9f8870-0fe4-4059-b315-c14869bd3b8f'
  AND source_surface = 'credential_intake.completed'
  AND status = 'pending'
  AND title = 'Credential intake completed for hostinger'
  AND JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.auto_promotion_status')) = 'completed'
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(context_json, '$.secrets_included')), 'false') = 'false';
