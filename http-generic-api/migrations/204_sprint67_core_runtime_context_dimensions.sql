-- Sprint 67: Core runtime context dimensions.
-- Additive nullable context columns for runtime/audit/session/trace tables that record activity outside execution_log.
-- Runtime enforcement and existing writes are unchanged. No destructive SQL.

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE telemetry_spans
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER run_id,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE session_events
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER turn_id,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS parent_action_key VARCHAR(191) NULL AFTER correlation_id,
  ADD COLUMN IF NOT EXISTS endpoint_key VARCHAR(191) NULL AFTER parent_action_key,
  ADD COLUMN IF NOT EXISTS app_key VARCHAR(191) NULL AFTER endpoint_key,
  ADD COLUMN IF NOT EXISTS action_key VARCHAR(191) NULL AFTER app_key;

ALTER TABLE gpt_session_turns
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER workspace_key,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE step_runs
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER run_id,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE intent_resolutions
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE execution_plans
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE platform_engine_execution_runs
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE local_gateway_tool_call_log
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS app_key VARCHAR(191) NULL AFTER correlation_id,
  ADD COLUMN IF NOT EXISTS action_key VARCHAR(191) NULL AFTER app_key,
  ADD COLUMN IF NOT EXISTS resource_type VARCHAR(128) NULL AFTER action_key,
  ADD COLUMN IF NOT EXISTS resource_id VARCHAR(191) NULL AFTER resource_type;

ALTER TABLE approval_holds
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER requested_by,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE sink_dispatch_log
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER run_id,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

ALTER TABLE platform_graph_query_log
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NULL AFTER query_id,
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER workspace_key,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS resource_type VARCHAR(128) NULL AFTER correlation_id,
  ADD COLUMN IF NOT EXISTS resource_id VARCHAR(191) NULL AFTER resource_type,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER resource_id;

ALTER TABLE repo_ingestion_jobs
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NULL AFTER job_id,
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER workspace_key,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER correlation_id;

CREATE INDEX IF NOT EXISTS idx_audit_log_context ON audit_log (tenant_id, user_id, brand_key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_context ON telemetry_spans (tenant_id, user_id, trace_id, started_at);
CREATE INDEX IF NOT EXISTS idx_session_events_context ON session_events (tenant_id, user_id, session_id, event_timestamp);
CREATE INDEX IF NOT EXISTS idx_gpt_session_turns_context ON gpt_session_turns (tenant_id, user_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_context ON workflow_runs (tenant_id, user_id, brand_key, created_at);
CREATE INDEX IF NOT EXISTS idx_step_runs_context ON step_runs (tenant_id, user_id, run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_intent_resolutions_context ON intent_resolutions (tenant_id, user_id, brand_key, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_plans_context ON execution_plans (tenant_id, user_id, brand_key, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_engine_runs_context ON platform_engine_execution_runs (tenant_id, user_id, brand_key, created_at);
CREATE INDEX IF NOT EXISTS idx_local_gateway_context ON local_gateway_tool_call_log (tenant_id, user_id, trace_id, started_at);
CREATE INDEX IF NOT EXISTS idx_approval_holds_context ON approval_holds (tenant_id, user_id, run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sink_dispatch_context ON sink_dispatch_log (tenant_id, user_id, run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_graph_query_context ON platform_graph_query_log (tenant_id, user_id, correlation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_repo_ingestion_context ON repo_ingestion_jobs (tenant_id, user_id, correlation_id, created_at);

UPDATE audit_log
   SET user_id = COALESCE(user_id, CASE WHEN actor_type = 'user' THEN actor_id ELSE NULL END),
       correlation_id = COALESCE(correlation_id, audit_id),
       execution_context_json = COALESCE(execution_context_json, JSON_OBJECT('source','context_dimension_backfill','secrets_included',false))
 WHERE user_id IS NULL OR correlation_id IS NULL OR execution_context_json IS NULL;

UPDATE gpt_session_turns t
JOIN customer_sessions s ON t.session_id COLLATE utf8mb4_unicode_ci = s.session_id COLLATE utf8mb4_unicode_ci
   SET t.tenant_id = COALESCE(t.tenant_id, s.tenant_id),
       t.user_id = COALESCE(t.user_id, s.user_id),
       t.actor_id = COALESCE(t.actor_id, s.user_id),
       t.actor_type = COALESCE(t.actor_type, CASE WHEN s.user_id IS NOT NULL THEN 'user' ELSE NULL END),
       t.brand_key = COALESCE(t.brand_key, s.brand_key),
       t.workspace_key = COALESCE(t.workspace_key, s.workspace_key),
       t.correlation_id = COALESCE(t.correlation_id, t.turn_id, t.session_id),
       t.execution_context_json = COALESCE(t.execution_context_json, JSON_OBJECT('source','customer_sessions_backfill','secrets_included',false))
 WHERE t.tenant_id IS NULL OR t.user_id IS NULL OR t.actor_id IS NULL OR t.actor_type IS NULL OR t.brand_key IS NULL OR t.workspace_key IS NULL OR t.correlation_id IS NULL OR t.execution_context_json IS NULL;

UPDATE session_events e
JOIN customer_sessions s ON s.session_id = e.session_id
   SET e.user_id = COALESCE(e.user_id, s.user_id),
       e.actor_id = COALESCE(e.actor_id, s.user_id),
       e.actor_type = COALESCE(e.actor_type, CASE WHEN s.user_id IS NOT NULL THEN 'user' ELSE NULL END),
       e.brand_key = COALESCE(e.brand_key, s.brand_key),
       e.workspace_key = COALESCE(e.workspace_key, s.workspace_key),
       e.correlation_id = COALESCE(e.correlation_id, e.event_id),
       e.action_key = COALESCE(e.action_key, e.tool_name)
 WHERE e.user_id IS NULL OR e.actor_id IS NULL OR e.actor_type IS NULL OR e.brand_key IS NULL OR e.workspace_key IS NULL OR e.correlation_id IS NULL OR e.action_key IS NULL;

UPDATE workflow_runs wr
LEFT JOIN execution_plans ep ON ep.plan_id = wr.plan_id
   SET wr.workspace_id = COALESCE(wr.workspace_id, ep.workspace_id),
       wr.workspace_key = COALESCE(wr.workspace_key, ep.workspace_key),
       wr.actor_id = COALESCE(wr.actor_id, wr.user_id, ep.user_id),
       wr.actor_type = COALESCE(wr.actor_type, CASE WHEN COALESCE(wr.user_id, ep.user_id) IS NOT NULL THEN 'user' ELSE NULL END),
       wr.brand_id = COALESCE(wr.brand_id, ep.brand_id),
       wr.brand_key = COALESCE(wr.brand_key, ep.brand_key),
       wr.request_id = COALESCE(wr.request_id, ep.request_id),
       wr.session_id = COALESCE(wr.session_id, ep.session_id),
       wr.conversation_id = COALESCE(wr.conversation_id, ep.conversation_id),
       wr.correlation_id = COALESCE(wr.correlation_id, ep.correlation_id, wr.run_id),
       wr.execution_context_json = COALESCE(wr.execution_context_json, JSON_OBJECT('source','execution_plan_backfill','secrets_included',false))
 WHERE wr.actor_id IS NULL OR wr.actor_type IS NULL OR wr.brand_key IS NULL OR wr.correlation_id IS NULL OR wr.execution_context_json IS NULL;

UPDATE step_runs sr
LEFT JOIN workflow_runs wr ON wr.run_id = sr.run_id
   SET sr.user_id = COALESCE(sr.user_id, wr.user_id),
       sr.workspace_id = COALESCE(sr.workspace_id, wr.workspace_id),
       sr.workspace_key = COALESCE(sr.workspace_key, wr.workspace_key),
       sr.actor_id = COALESCE(sr.actor_id, wr.actor_id, wr.user_id),
       sr.actor_type = COALESCE(sr.actor_type, wr.actor_type, CASE WHEN wr.user_id IS NOT NULL THEN 'user' ELSE NULL END),
       sr.brand_id = COALESCE(sr.brand_id, wr.brand_id),
       sr.brand_key = COALESCE(sr.brand_key, wr.brand_key),
       sr.request_id = COALESCE(sr.request_id, wr.request_id),
       sr.session_id = COALESCE(sr.session_id, wr.session_id),
       sr.conversation_id = COALESCE(sr.conversation_id, wr.conversation_id),
       sr.correlation_id = COALESCE(sr.correlation_id, wr.correlation_id, sr.run_id),
       sr.execution_context_json = COALESCE(sr.execution_context_json, JSON_OBJECT('source','workflow_runs_backfill','secrets_included',false))
 WHERE sr.user_id IS NULL OR sr.actor_id IS NULL OR sr.actor_type IS NULL OR sr.brand_key IS NULL OR sr.correlation_id IS NULL OR sr.execution_context_json IS NULL;

UPDATE intent_resolutions
   SET actor_id = COALESCE(actor_id, user_id),
       actor_type = COALESCE(actor_type, CASE WHEN user_id IS NOT NULL THEN 'user' ELSE NULL END),
       correlation_id = COALESCE(correlation_id, resolution_id),
       execution_context_json = COALESCE(execution_context_json, JSON_OBJECT('source','context_dimension_backfill','secrets_included',false))
 WHERE actor_id IS NULL OR actor_type IS NULL OR correlation_id IS NULL OR execution_context_json IS NULL;

UPDATE execution_plans
   SET actor_id = COALESCE(actor_id, user_id),
       actor_type = COALESCE(actor_type, CASE WHEN user_id IS NOT NULL THEN 'user' ELSE NULL END),
       correlation_id = COALESCE(correlation_id, plan_id),
       execution_context_json = COALESCE(execution_context_json, JSON_OBJECT('source','context_dimension_backfill','secrets_included',false))
 WHERE actor_id IS NULL OR actor_type IS NULL OR correlation_id IS NULL OR execution_context_json IS NULL;

UPDATE telemetry_spans
   SET correlation_id = COALESCE(correlation_id, trace_id),
       execution_context_json = COALESCE(execution_context_json, JSON_OBJECT('source','telemetry_trace_backfill','secrets_included',false))
 WHERE correlation_id IS NULL OR execution_context_json IS NULL;

UPDATE platform_engine_execution_runs
   SET user_id = COALESCE(user_id, actor_id),
       actor_type = COALESCE(actor_type, CASE WHEN actor_id IS NOT NULL THEN 'user_or_service' ELSE NULL END),
       correlation_id = COALESCE(correlation_id, trace_id, run_id),
       execution_context_json = COALESCE(execution_context_json, JSON_OBJECT('source','platform_engine_run_backfill','secrets_included',false))
 WHERE user_id IS NULL OR actor_type IS NULL OR correlation_id IS NULL OR execution_context_json IS NULL;

UPDATE local_gateway_tool_call_log
   SET actor_id = COALESCE(actor_id, user_id),
       actor_type = COALESCE(actor_type, CASE WHEN user_id IS NOT NULL THEN 'user' ELSE NULL END),
       correlation_id = COALESCE(correlation_id, trace_id, call_id),
       app_key = COALESCE(app_key, tool_key),
       action_key = COALESCE(action_key, dispatch_tool_key),
       resource_type = COALESCE(resource_type, 'local_gateway_tool_call'),
       resource_id = COALESCE(resource_id, call_id)
 WHERE actor_id IS NULL OR actor_type IS NULL OR correlation_id IS NULL OR app_key IS NULL OR resource_type IS NULL OR resource_id IS NULL;

UPDATE approval_holds ah
LEFT JOIN workflow_runs wr ON wr.run_id = ah.run_id
   SET ah.user_id = COALESCE(ah.user_id, ah.requested_by, wr.user_id),
       ah.workspace_id = COALESCE(ah.workspace_id, wr.workspace_id),
       ah.workspace_key = COALESCE(ah.workspace_key, wr.workspace_key),
       ah.actor_id = COALESCE(ah.actor_id, ah.requested_by, wr.actor_id, wr.user_id),
       ah.actor_type = COALESCE(ah.actor_type, CASE WHEN COALESCE(ah.requested_by, wr.user_id) IS NOT NULL THEN 'user' ELSE NULL END),
       ah.brand_id = COALESCE(ah.brand_id, wr.brand_id),
       ah.brand_key = COALESCE(ah.brand_key, wr.brand_key),
       ah.request_id = COALESCE(ah.request_id, wr.request_id),
       ah.session_id = COALESCE(ah.session_id, wr.session_id),
       ah.conversation_id = COALESCE(ah.conversation_id, wr.conversation_id),
       ah.correlation_id = COALESCE(ah.correlation_id, wr.correlation_id, ah.hold_id),
       ah.execution_context_json = COALESCE(ah.execution_context_json, JSON_OBJECT('source','workflow_runs_backfill','secrets_included',false))
 WHERE ah.user_id IS NULL OR ah.actor_id IS NULL OR ah.actor_type IS NULL OR ah.brand_key IS NULL OR ah.correlation_id IS NULL OR ah.execution_context_json IS NULL;

UPDATE sink_dispatch_log sd
LEFT JOIN workflow_runs wr ON wr.run_id = sd.run_id
   SET sd.user_id = COALESCE(sd.user_id, wr.user_id),
       sd.workspace_id = COALESCE(sd.workspace_id, wr.workspace_id),
       sd.workspace_key = COALESCE(sd.workspace_key, wr.workspace_key),
       sd.actor_id = COALESCE(sd.actor_id, wr.actor_id, wr.user_id),
       sd.actor_type = COALESCE(sd.actor_type, wr.actor_type, CASE WHEN wr.user_id IS NOT NULL THEN 'user' ELSE NULL END),
       sd.brand_id = COALESCE(sd.brand_id, wr.brand_id),
       sd.brand_key = COALESCE(sd.brand_key, wr.brand_key),
       sd.request_id = COALESCE(sd.request_id, wr.request_id),
       sd.session_id = COALESCE(sd.session_id, wr.session_id),
       sd.conversation_id = COALESCE(sd.conversation_id, wr.conversation_id),
       sd.correlation_id = COALESCE(sd.correlation_id, wr.correlation_id, sd.dispatch_id),
       sd.execution_context_json = COALESCE(sd.execution_context_json, JSON_OBJECT('source','workflow_runs_backfill','secrets_included',false))
 WHERE sd.user_id IS NULL OR sd.actor_id IS NULL OR sd.actor_type IS NULL OR sd.brand_key IS NULL OR sd.correlation_id IS NULL OR sd.execution_context_json IS NULL;

UPDATE platform_graph_query_log
   SET correlation_id = COALESCE(correlation_id, query_id),
       resource_type = subject_type,
       execution_context_json = COALESCE(execution_context_json, JSON_OBJECT('source','graph_query_context_backfill','subject_type',subject_type,'subject_ref',subject_ref,'secrets_included',false))
 WHERE correlation_id IS NULL OR execution_context_json IS NULL;

UPDATE repo_ingestion_jobs
   SET tenant_id = COALESCE(tenant_id, CASE WHEN request_scope_type='tenant' THEN request_scope_id ELSE NULL END),
       user_id = COALESCE(user_id, CASE WHEN request_scope_type='user' THEN request_scope_id ELSE requested_by END),
       actor_id = COALESCE(actor_id, requested_by),
       actor_type = COALESCE(actor_type, CASE WHEN requested_by IS NOT NULL THEN 'user_or_service' ELSE NULL END),
       brand_key = COALESCE(brand_key, CASE WHEN request_scope_type='brand' THEN request_scope_id ELSE NULL END),
       correlation_id = COALESCE(correlation_id, job_id),
       execution_context_json = COALESCE(execution_context_json, JSON_OBJECT('source','repo_ingestion_scope_backfill','request_scope_type',request_scope_type,'secrets_included',false))
 WHERE tenant_id IS NULL OR user_id IS NULL OR actor_id IS NULL OR actor_type IS NULL OR brand_key IS NULL OR correlation_id IS NULL OR execution_context_json IS NULL;
