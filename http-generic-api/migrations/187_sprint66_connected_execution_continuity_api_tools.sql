-- Sprint 66: connected execution continuity API tools.
-- Registers metadata-only connected execution session/checkpoint/evidence/resume action tools.
-- These tools do not execute pending resume actions and do not enable a background worker.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'connected_execution_session_upsert',
    'Connected Execution Session Upsert',
    'Create or update a DB-backed connected execution session. Metadata only; does not execute pending actions or run a worker.',
    'POST',
    '/connected-execution/sessions',
    '[]',
    '{"type":"object","additionalProperties":true,"properties":{"connected_session_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"root_plan_id":{"type":"string"},"current_run_id":{"type":"string"},"current_step_run_id":{"type":"string"},"mode":{"type":"string","enum":["single_turn","connected_rounds","worker_driven"],"default":"connected_rounds"},"status":{"type":"string","enum":["draft","ready","running","paused","awaiting_user","awaiting_approval","blocked","completed","failed","cancelled"],"default":"ready"},"resume_policy":{"type":"object"},"budget_policy":{"type":"object"},"checkpoint_policy":{"type":"object"},"resume_cursor":{"type":"object"},"last_checkpoint":{"type":"object"},"next_action":{"type":"object"},"max_rounds":{"type":"integer","minimum":1,"maximum":1000}}}',
    NULL,
    'admin,connected_execution,continuity,session,metadata_write,no_worker,no_action_execution,no_secrets',
    1,
    4400
  ),
  (
    'connected_execution_latest_checkpoint_get',
    'Connected Execution Latest Checkpoint Get',
    'Read the latest DB-backed connected execution checkpoint for a session. Read-only and secret-free by contract.',
    'GET',
    '/connected-execution/sessions/{connected_session_id}/checkpoint',
    '["connected_session_id"]',
    '{"type":"object","additionalProperties":false,"required":["connected_session_id"],"properties":{"connected_session_id":{"type":"string","minLength":1}}}',
    NULL,
    'admin,connected_execution,continuity,checkpoint,read_only,no_worker,no_action_execution,no_secrets',
    1,
    4401
  ),
  (
    'connected_execution_evidence_report_create',
    'Connected Execution Evidence Report Create',
    'Append a sanitized evidence report to a connected execution session and update its resume cursor. Does not execute actions.',
    'POST',
    '/connected-execution/sessions/{connected_session_id}/evidence-reports',
    '["connected_session_id"]',
    '{"type":"object","additionalProperties":true,"required":["connected_session_id","stage"],"properties":{"connected_session_id":{"type":"string","minLength":1},"evidence_report_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"plan_id":{"type":"string"},"run_id":{"type":"string"},"step_run_id":{"type":"string"},"stage":{"type":"string","minLength":1},"status":{"type":"string","enum":["checkpoint","progress","blocked","handoff","resume_ready","completed","failed"],"default":"checkpoint"},"summary":{"type":"object"},"evidence":{"type":"object"},"ci":{"type":"object"},"readiness":{"type":"object"},"artifact_refs":{"type":"array"},"blockers":{"type":"array"},"next_action":{"type":"object"},"first_resume_instruction":{"type":"string","maxLength":512}}}',
    NULL,
    'admin,connected_execution,continuity,evidence,metadata_write,no_worker,no_action_execution,no_secrets',
    1,
    4402
  ),
  (
    'connected_execution_resume_action_enqueue',
    'Connected Execution Resume Action Enqueue',
    'Record a pending resume action for a connected execution session. Queue metadata only; does not claim or execute the action.',
    'POST',
    '/connected-execution/sessions/{connected_session_id}/resume-actions',
    '["connected_session_id"]',
    '{"type":"object","additionalProperties":true,"required":["connected_session_id","action_kind"],"properties":{"connected_session_id":{"type":"string","minLength":1},"resume_action_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"action_order":{"type":"integer","minimum":1},"action_kind":{"type":"string","enum":["tool_call","repo_operation","db_operation","provider_operation","local_device_operation","document_generation","analysis_step","approval_request","user_prompt","stop"]},"action_key":{"type":"string"},"action_payload":{"type":"object"},"guardrails":{"type":"object"}}}',
    NULL,
    'admin,connected_execution,continuity,resume_action,metadata_write,no_worker,no_action_execution,no_secrets',
    1,
    4403
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);

INSERT INTO runtime_dispatch_certification_registry
  (certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status,
   smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run,
   requires_audit_evidence, requires_readback, notes)
VALUES
  ('connected_execution_continuity_api_tools_v1', 'connected_execution_continuity', 'execution_continuity', 'connected_execution_session_upsert',
   'B', 'metadata_write_registered', 'session_checkpoint_evidence_resume_metadata_only', 1, 0, 0, 1, 1, 1,
   'Connected execution continuity API tools persist session/checkpoint/evidence/resume metadata only. They do not claim or execute pending actions and do not enable background work.')
ON DUPLICATE KEY UPDATE
  surface_key = VALUES(surface_key),
  surface_family = VALUES(surface_family),
  tool_or_action_key = VALUES(tool_or_action_key),
  risk_class = VALUES(risk_class),
  certification_status = VALUES(certification_status),
  smoke_strategy = VALUES(smoke_strategy),
  dispatch_allowed = VALUES(dispatch_allowed),
  apply_allowed = VALUES(apply_allowed),
  requires_resource_authority = VALUES(requires_resource_authority),
  requires_dry_run = VALUES(requires_dry_run),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  notes = VALUES(notes);
