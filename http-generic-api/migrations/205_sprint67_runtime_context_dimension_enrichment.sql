-- Sprint 67: Runtime context dimension enrichment.
-- Additive/idempotent enrichment only. No schema changes and no destructive SQL.
-- Completes fillable context dimensions from already-linked runtime records.

UPDATE telemetry_spans ts
JOIN workflow_runs wr
  ON wr.run_id COLLATE utf8mb4_unicode_ci = ts.run_id COLLATE utf8mb4_unicode_ci
   SET ts.user_id = COALESCE(ts.user_id, wr.user_id),
       ts.actor_id = COALESCE(ts.actor_id, wr.actor_id, wr.user_id),
       ts.actor_type = COALESCE(ts.actor_type, wr.actor_type, CASE WHEN wr.user_id IS NOT NULL THEN 'user' ELSE NULL END),
       ts.brand_id = COALESCE(ts.brand_id, wr.brand_id),
       ts.brand_key = COALESCE(ts.brand_key, wr.brand_key),
       ts.workspace_id = COALESCE(ts.workspace_id, wr.workspace_id),
       ts.workspace_key = COALESCE(ts.workspace_key, wr.workspace_key),
       ts.request_id = COALESCE(ts.request_id, wr.request_id),
       ts.session_id = COALESCE(ts.session_id, wr.session_id),
       ts.conversation_id = COALESCE(ts.conversation_id, wr.conversation_id),
       ts.correlation_id = COALESCE(ts.correlation_id, wr.correlation_id, ts.trace_id),
       ts.execution_context_json = COALESCE(ts.execution_context_json, JSON_OBJECT('source','workflow_runs_context_enrichment','secrets_included',false))
 WHERE ts.run_id IS NOT NULL
   AND (ts.user_id IS NULL OR ts.actor_id IS NULL OR ts.actor_type IS NULL
     OR ts.brand_key IS NULL OR ts.workspace_id IS NULL OR ts.workspace_key IS NULL
     OR ts.request_id IS NULL OR ts.session_id IS NULL OR ts.conversation_id IS NULL
     OR ts.execution_context_json IS NULL);

UPDATE audit_log al
JOIN execution_plans ep
  ON ep.plan_id COLLATE utf8mb4_unicode_ci = al.resource_id COLLATE utf8mb4_unicode_ci
   SET al.tenant_id = COALESCE(al.tenant_id, ep.tenant_id),
       al.workspace_id = COALESCE(al.workspace_id, ep.workspace_id),
       al.workspace_key = COALESCE(al.workspace_key, ep.workspace_key),
       al.user_id = COALESCE(al.user_id, ep.user_id),
       al.actor_id = COALESCE(al.actor_id, ep.actor_id, ep.user_id, al.actor_id),
       al.actor_type = COALESCE(al.actor_type, ep.actor_type, CASE WHEN ep.user_id IS NOT NULL THEN 'user' ELSE al.actor_type END),
       al.brand_id = COALESCE(al.brand_id, ep.brand_id),
       al.brand_key = COALESCE(al.brand_key, ep.brand_key),
       al.request_id = COALESCE(al.request_id, ep.request_id),
       al.session_id = COALESCE(al.session_id, ep.session_id),
       al.conversation_id = COALESCE(al.conversation_id, ep.conversation_id),
       al.correlation_id = COALESCE(al.correlation_id, ep.correlation_id, al.audit_id),
       al.execution_context_json = COALESCE(al.execution_context_json, JSON_OBJECT('source','execution_plan_context_enrichment','secrets_included',false))
 WHERE al.resource_type = 'execution_plan'
   AND (al.tenant_id IS NULL OR al.user_id IS NULL OR al.actor_id IS NULL
     OR al.brand_key IS NULL OR al.workspace_id IS NULL OR al.workspace_key IS NULL
     OR al.request_id IS NULL OR al.session_id IS NULL OR al.conversation_id IS NULL
     OR al.execution_context_json IS NULL);

CREATE OR REPLACE VIEW v_runtime_context_dimension_enrichment_fillable AS
SELECT 'telemetry_from_workflow_runs' AS check_name,
       COUNT(*) AS linked_rows,
       SUM(ts.tenant_id IS NULL AND wr.tenant_id IS NOT NULL) AS fillable_tenant,
       SUM(ts.user_id IS NULL AND wr.user_id IS NOT NULL) AS fillable_user,
       SUM((ts.brand_key IS NULL OR ts.brand_key = '') AND wr.brand_key IS NOT NULL) AS fillable_brand,
       SUM((ts.workspace_id IS NULL OR ts.workspace_key IS NULL) AND (wr.workspace_id IS NOT NULL OR wr.workspace_key IS NOT NULL)) AS fillable_workspace
  FROM telemetry_spans ts
  JOIN workflow_runs wr ON wr.run_id COLLATE utf8mb4_unicode_ci = ts.run_id COLLATE utf8mb4_unicode_ci
UNION ALL
SELECT 'audit_from_execution_plans',
       COUNT(*),
       SUM(al.tenant_id IS NULL AND ep.tenant_id IS NOT NULL),
       SUM(al.user_id IS NULL AND ep.user_id IS NOT NULL),
       SUM((al.brand_key IS NULL OR al.brand_key = '') AND ep.brand_key IS NOT NULL),
       SUM((al.workspace_id IS NULL OR al.workspace_key IS NULL) AND (ep.workspace_id IS NOT NULL OR ep.workspace_key IS NOT NULL))
  FROM audit_log al
  JOIN execution_plans ep ON ep.plan_id COLLATE utf8mb4_unicode_ci = al.resource_id COLLATE utf8mb4_unicode_ci
 WHERE al.resource_type = 'execution_plan';
