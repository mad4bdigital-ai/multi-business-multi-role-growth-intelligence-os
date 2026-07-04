-- Dynamic session archive capability-family authorization.
-- Additive and idempotent. Policy metadata only: no archive backfill, Drive write,
-- provider call, external send, credential payload read, secret access, or destructive operation.
INSERT INTO execution_policies (policy_group,policy_key,policy_value,active,execution_scope,affects_layer,blocking,notes) VALUES (
 'Session Archive Governance','session_archive_write_capability_family_v1',
 JSON_OBJECT(
  'capability_family','session_archive_write','default_decision','deny','enforcement_mode','blocking',
  'tool_bindings',JSON_OBJECT(
   'gpt_session_turns_write_batch',JSON_OBJECT(
    'operation_mode','apply','operation','append_turns','caller_types',JSON_ARRAY('admin','tenant'),
    'resource_scope','active_session','resource_id_arg','id','item_arg','turns','max_items',20,
    'require_gpt_action_originator',TRUE,'require_exact_tenant_scope',TRUE,'require_exact_user_scope',TRUE,
    'mutation_policy_declared',TRUE,'envelope_required',FALSE,'readback_required',TRUE,'audit_required',TRUE),
   'gpt_session_archive_backfill',JSON_OBJECT(
    'mode_arg','dry_run','default_mode','dry_run','operations',JSON_OBJECT(
     'dry_run',JSON_OBJECT('operation','preview_rebuild','caller_types',JSON_ARRAY('admin'),'mutation_policy_declared',FALSE,'envelope_required',FALSE),
     'apply',JSON_OBJECT(
      'operation','rebuild_transcript','caller_types',JSON_ARRAY('admin'),
      'resource_ids_args',JSON_ARRAY('session_ids','session_id'),'explicit_resource_ids_required',TRUE,'max_items',25,
      'reason_arg','reason','min_reason_chars',12,'typed_confirmation','APPLY_SESSION_ARCHIVE_BACKFILL',
      'mutation_policy_declared',TRUE,'envelope_required',TRUE,
      'accepted_app_keys',JSON_ARRAY('platform_orchestration'),
      'accepted_intents',JSON_ARRAY('session_archive_write','session_archive_backfill'),
      'accepted_capability_keys',JSON_ARRAY('session_archive_write'),
      'apply_allowed_required',TRUE,'readback_required',TRUE,'audit_required',TRUE))),
  'provider_call_allowed',FALSE,'external_send_allowed',FALSE,'destructive_write_allowed',FALSE,
  'raw_secret_access_allowed',FALSE,'secrets_included',FALSE),
 'TRUE','gpt_tools_call|tool_dispatch|session_archive_write|append_turns|preview_rebuild|rebuild_transcript|gpt_session_turns_write_batch|gpt_session_archive_backfill',
 'gptToolsRoutes|gptSessionRoutes|releaseRoutes|sessionArchiveService|admin|tenant','TRUE',
 'Capability-family policy for bounded session transcript append and governed JSONL transcript reconstruction.')
ON DUPLICATE KEY UPDATE policy_value=VALUES(policy_value),active='TRUE',execution_scope=VALUES(execution_scope),affects_layer=VALUES(affects_layer),blocking='TRUE',notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;
UPDATE admin_platform_endpoint_tools SET
 tags=CONCAT_WS(',',NULLIF(tags,''),IF(FIND_IN_SET('capability_family:session_archive_write',tags)=0,'capability_family:session_archive_write',NULL),IF(FIND_IN_SET('same_cycle_readback',tags)=0,'same_cycle_readback',NULL)),
 updated_at=CURRENT_TIMESTAMP WHERE tool_key='gpt_session_turns_write_batch';
UPDATE admin_platform_endpoint_tools SET
 tags=CONCAT_WS(',',NULLIF(tags,''),IF(FIND_IN_SET('capability_family:session_archive_write',tags)=0,'capability_family:session_archive_write',NULL),IF(FIND_IN_SET('capability_envelope',tags)=0,'capability_envelope',NULL),IF(FIND_IN_SET('typed_confirmation',tags)=0,'typed_confirmation',NULL),IF(FIND_IN_SET('same_cycle_readback',tags)=0,'same_cycle_readback',NULL)),
 input_schema=JSON_SET(IF(JSON_VALID(input_schema),input_schema,JSON_OBJECT('type','object','properties',JSON_OBJECT(),'additionalProperties',FALSE)),
  '$.properties.capability_envelope_id',JSON_OBJECT('type','string','description','Required only when dry_run=false. Must resolve to session_archive_write.'),
  '$.properties.confirm',JSON_OBJECT('type','string','description','Required only when dry_run=false. Exact value APPLY_SESSION_ARCHIVE_BACKFILL.')),
 updated_at=CURRENT_TIMESTAMP WHERE tool_key='gpt_session_archive_backfill';
