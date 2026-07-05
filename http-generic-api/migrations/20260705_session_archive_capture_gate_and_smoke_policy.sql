-- Session archive pre-final capture and smoke mutation policy.
-- Additive/idempotent policy and registry update. No transcript content, URLs,
-- provider credential values, or secrets are written.

UPDATE `execution_policies`
   SET `execution_scope` = 'gpt_tools_call|tool_dispatch|session_archive_write|append_turns|preview_rebuild|rebuild_transcript|smoke_drive_writeback|gpt_session_turns_write_batch|gpt_session_archive_backfill|release_session_archive_smoke',
       `policy_value` = '{"capability_family":"session_archive_write","default_decision":"deny","enforcement_mode":"blocking","tool_bindings":{"gpt_session_turns_write_batch":{"operation_mode":"apply","operation":"append_turns","caller_types":["admin","tenant"],"resource_scope":"active_session","resource_id_arg":"id","item_arg":"turns","max_items":20,"require_gpt_action_originator":true,"require_exact_tenant_scope":true,"require_exact_user_scope":true,"mutation_policy_declared":true,"envelope_required":false,"readback_required":true,"audit_required":true},"gpt_session_archive_backfill":{"mode_arg":"dry_run","default_mode":"dry_run","operations":{"dry_run":{"operation":"preview_rebuild","caller_types":["admin"],"mutation_policy_declared":false,"envelope_required":false},"apply":{"operation":"rebuild_transcript","caller_types":["admin"],"resource_ids_args":["session_ids","session_id"],"explicit_resource_ids_required":true,"max_items":25,"reason_arg":"reason","min_reason_chars":12,"typed_confirmation":"APPLY_SESSION_ARCHIVE_BACKFILL","mutation_policy_declared":true,"envelope_required":true,"accepted_app_keys":["platform_orchestration"],"accepted_intents":["session_archive_write","session_archive_backfill"],"accepted_capability_keys":["session_archive_write"],"apply_allowed_required":true,"readback_required":true,"audit_required":true}}},"release_session_archive_smoke":{"operation_mode":"apply","operation":"smoke_drive_writeback","caller_types":["admin"],"typed_confirmation":"RUN_SESSION_ARCHIVE_SMOKE","mutation_policy_declared":true,"envelope_required":true,"accepted_app_keys":["platform_orchestration"],"accepted_intents":["session_archive_write","session_archive_smoke"],"accepted_capability_keys":["session_archive_write"],"apply_allowed_required":false,"readback_required":true,"audit_required":true,"cleanup_default_true":true,"no_external_send":true}},"provider_call_allowed":false,"external_send_allowed":false,"destructive_write_allowed":false,"raw_secret_access_allowed":false,"secrets_included":false}',
       `notes` = 'Capability-family policy for bounded session transcript append, governed JSONL transcript reconstruction, and explicit session archive smoke writeback.',
       `updated_at` = NOW()
 WHERE `policy_key` = 'session_archive_write_capability_family_v1'
   AND `active` = 'TRUE';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
VALUES
  ('Session Archive Governance', 'gpt_session_pre_final_capture_gate_policy_v1', '{"rule":"gpt_session_pre_final_capture_gate","enforcement_mode":"blocking","write_tool":"gpt_session_turns_write_batch","required_before":["final_response","tool_turn_archive"],"required_roles":["user","assistant"],"readback_required":true,"synthetic_turns_allowed":false,"historical_backfill_allowed":false,"tool_only_archive_prevention":true,"response_gate_field":"session_archive_capture_gate","failure_reason_codes":["pre_final_capture_required","no_active_gpt_action_session","tool_turn_archive_readback_failed"],"secrets_included":false}', 'TRUE', 'gpt_tools_call|tool_dispatch|final_response|session_archive_write|gpt_session_turns_write_batch', 'gptToolsRoutes|gptSessionRoutes|sessionArchiveService|admin|tenant', 'TRUE', 'Blocks tool-only GPT action archives by requiring user and assistant turns through gpt_session_turns_write_batch before final response/tool archive.', NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = NOW();

UPDATE `admin_platform_endpoint_tools`
   SET `input_schema` = '{"type":"object","required":["confirm","capability_envelope_id"],"properties":{"tenant_id":{"type":"string","description":"Tenant id for the synthetic smoke session. Defaults to platform tenant."},"user_id":{"type":"string","description":"Synthetic user id for the smoke session. Defaults to a generated session_archive_smoke_* value."},"include_drive_readback":{"type":"boolean","default":true},"cleanup":{"type":"boolean","default":true},"smoke_subfolder":{"type":"string","default":"_smoke_archives"},"force_doc_rollover":{"type":"boolean","default":false,"description":"When true, intentionally lowers the transcript Google Doc rollover threshold after the first turn so the smoke verifies creation of a subsequent transcript part."},"doc_rollover_chars":{"type":"integer","minimum":100,"maximum":1000000,"description":"Optional forced rollover threshold in characters for diagnostic smoke runs."},"confirm":{"type":"string","const":"RUN_SESSION_ARCHIVE_SMOKE"},"capability_envelope_id":{"type":"string","description":"Required for session archive smoke writeback. Must resolve to session_archive_write with readback/audit requirements."}},"additionalProperties":false}',
       `tags` = 'release,session-archive,drive-writeback,activation-readback,smoke,rollover-smoke,read_write,admin,no_secrets,cleanup_default_true,mutation_policy_declared,capability_family:session_archive_write,typed_confirmation,capability_envelope,readback,same_cycle_readback',
       `updated_at` = NOW()
 WHERE `tool_key` = 'release_session_archive_smoke';
