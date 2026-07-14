-- Persist successful read-only Hostinger provider validation and complete the
-- associated credential-intake continuation task.
--
-- Evidence collected before this migration:
-- - GET /api/vps/v1/virtual-machines returned HTTP 200.
-- - GET /api/vps/v1/public-keys returned HTTP 200 with bounded inventory metadata.
-- - http_generic_api_connector health returned healthy with DB, Redis, queue, and worker ready.
--
-- Safety contract:
-- - no_provider_call
-- - no_credential_payload_read
-- - no_raw_secrets
-- - no_external_send
-- - no_external_write
-- - secrets_included_false
--
-- This migration records validation evidence only. It does not call Hostinger,
-- decrypt credentials, deploy code, or mutate any provider resource.

UPDATE user_app_connections
SET validation_status = 'validated',
    last_validated_at = CURRENT_TIMESTAMP,
    last_used_at = CURRENT_TIMESTAMP
WHERE connection_id = 'd43275c7-2e41-4686-9c32-b3fff36efb7d'
  AND app_key = 'hostinger'
  AND auth_type = 'api_key'
  AND status = 'active'
  AND validation_status IN ('promoted_to_platform_secrets', 'validated');

UPDATE platform_pending_tasks
SET status = 'done',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    description = 'Hostinger credential intake continuation validated successfully. Two read-only Hostinger API inventory calls returned HTTP 200, and the platform runtime health check reported DB, Redis, queue, and worker ready.',
    brief = 'Connection d43275c7-2e41-4686-9c32-b3fff36efb7d passed read-only Hostinger provider validation and platform runtime smoke checks. No VPS, SSH, deploy, or provider mutation was performed.',
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.provider_validation_status', 'validated',
      '$.provider_validation_mode', 'read_only',
      '$.provider_validation_http_status', 200,
      '$.provider_validation_endpoints', JSON_ARRAY('/api/vps/v1/virtual-machines', '/api/vps/v1/public-keys'),
      '$.runtime_health_status', 'healthy',
      '$.validated_connection_id', 'd43275c7-2e41-4686-9c32-b3fff36efb7d',
      '$.provider_mutation_performed', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260714_validate_hostinger_connection_and_complete_continuation_task',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = 'adc3d06f-7f0b-11f1-9a4d-d342cf4a053c'
  AND task_key = 'credential_intake_completed:dd9f8870-0fe4-4059-b315-c14869bd3b8f'
  AND source_surface = 'credential_intake.completed'
  AND title = 'Validate credential intake continuation for hostinger'
  AND status = 'pending';
