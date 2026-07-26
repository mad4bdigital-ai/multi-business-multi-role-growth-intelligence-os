-- Sprint 67: Execution log context dimensions.
-- Additive schema expansion for tenant/user/brand/workspace/request/resource attribution.
-- No destructive SQL. Values are nullable for backward compatibility.

ALTER TABLE execution_log
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NULL AFTER log_source_writeback,
  ADD COLUMN IF NOT EXISTS tenant_key VARCHAR(128) NULL AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NULL AFTER tenant_key,
  ADD COLUMN IF NOT EXISTS workspace_key VARCHAR(128) NULL AFTER workspace_id,
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) NULL AFTER workspace_key,
  ADD COLUMN IF NOT EXISTS actor_id VARCHAR(64) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(64) NULL AFTER actor_id,
  ADD COLUMN IF NOT EXISTS brand_id VARCHAR(64) NULL AFTER actor_type,
  ADD COLUMN IF NOT EXISTS brand_key VARCHAR(128) NULL AFTER brand_id,
  ADD COLUMN IF NOT EXISTS activity_id VARCHAR(64) NULL AFTER brand_key,
  ADD COLUMN IF NOT EXISTS activity_type VARCHAR(128) NULL AFTER activity_id,
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(128) NULL AFTER activity_type,
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(128) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(128) NULL AFTER session_id,
  ADD COLUMN IF NOT EXISTS parent_action_key VARCHAR(191) NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS endpoint_key VARCHAR(191) NULL AFTER parent_action_key,
  ADD COLUMN IF NOT EXISTS tool_key VARCHAR(191) NULL AFTER endpoint_key,
  ADD COLUMN IF NOT EXISTS app_key VARCHAR(191) NULL AFTER tool_key,
  ADD COLUMN IF NOT EXISTS action_key VARCHAR(191) NULL AFTER app_key,
  ADD COLUMN IF NOT EXISTS connected_system_id VARCHAR(64) NULL AFTER action_key,
  ADD COLUMN IF NOT EXISTS credential_ref_id VARCHAR(191) NULL AFTER connected_system_id,
  ADD COLUMN IF NOT EXISTS resource_type VARCHAR(128) NULL AFTER credential_ref_id,
  ADD COLUMN IF NOT EXISTS resource_id VARCHAR(191) NULL AFTER resource_type,
  ADD COLUMN IF NOT EXISTS target_type VARCHAR(128) NULL AFTER resource_id,
  ADD COLUMN IF NOT EXISTS target_id VARCHAR(191) NULL AFTER target_type,
  ADD COLUMN IF NOT EXISTS environment VARCHAR(64) NULL AFTER target_id,
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(191) NULL AFTER environment,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(191) NULL AFTER correlation_id,
  ADD COLUMN IF NOT EXISTS execution_context_json JSON NULL AFTER idempotency_key;

CREATE INDEX IF NOT EXISTS idx_execution_log_tenant_created ON execution_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_log_user_created ON execution_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_log_brand_created ON execution_log (brand_id, brand_key, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_log_workspace_created ON execution_log (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_log_request_created ON execution_log (request_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_log_action_created ON execution_log (parent_action_key, endpoint_key, tool_key, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_log_resource_created ON execution_log (resource_type, resource_id, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_log_correlation ON execution_log (correlation_id);

UPDATE execution_log
   SET tenant_id = COALESCE(tenant_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.tenant_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.tenantId')), 'null')),
       workspace_id = COALESCE(workspace_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.workspace_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.workspaceId')), 'null')),
       user_id = COALESCE(user_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.user_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.userId')), 'null')),
       actor_id = COALESCE(actor_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.actor_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.actorId')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.user_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.userId')), 'null')),
       actor_type = COALESCE(actor_type, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.actor_type')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.actorType')), 'null'), CASE WHEN COALESCE(user_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.user_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.userId')), 'null')) IS NOT NULL THEN 'user' ELSE NULL END),
       brand_id = COALESCE(brand_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.brand_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.brandId')), 'null')),
       brand_key = COALESCE(brand_key, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.brand_key')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.brandKey')), 'null')),
       activity_id = COALESCE(activity_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.activity_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.activityId')), 'null')),
       activity_type = COALESCE(activity_type, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.activity_type')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.activityType')), 'null')),
       request_id = COALESCE(request_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.request_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.requestId')), 'null')),
       session_id = COALESCE(session_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.session_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.sessionId')), 'null')),
       conversation_id = COALESCE(conversation_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.conversation_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.conversationId')), 'null')),
       app_key = COALESCE(app_key, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.app_key')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.appKey')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.plugin_key')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.pluginKey')), 'null')),
       action_key = COALESCE(action_key, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.action_key')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.actionKey')), 'null')),
       connected_system_id = COALESCE(connected_system_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.connected_system_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.connectedSystemId')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.connection_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.connectionId')), 'null')),
       resource_type = COALESCE(resource_type, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.resource_type')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.resourceType')), 'null')),
       resource_id = COALESCE(resource_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.resource_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.resourceId')), 'null')),
       target_type = COALESCE(target_type, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.target_type')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.targetType')), 'null')),
       target_id = COALESCE(target_id, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.target_id')), 'null'), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(output_summary, '$.targetId')), 'null')),
       correlation_id = COALESCE(correlation_id, execution_trace_id_writeback),
       execution_context_json = COALESCE(execution_context_json, JSON_OBJECT('source','backfill_from_output_summary','secrets_included',false))
 WHERE JSON_VALID(output_summary)
   AND (
     tenant_id IS NULL OR workspace_id IS NULL OR user_id IS NULL OR actor_id IS NULL OR brand_id IS NULL OR brand_key IS NULL
     OR activity_id IS NULL OR activity_type IS NULL OR request_id IS NULL OR session_id IS NULL OR conversation_id IS NULL
     OR app_key IS NULL OR action_key IS NULL OR connected_system_id IS NULL OR resource_type IS NULL OR resource_id IS NULL
     OR target_type IS NULL OR target_id IS NULL OR correlation_id IS NULL OR execution_context_json IS NULL
   );
