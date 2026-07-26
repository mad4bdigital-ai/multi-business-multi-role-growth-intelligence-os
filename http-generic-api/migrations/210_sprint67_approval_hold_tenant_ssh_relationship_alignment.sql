-- Sprint 67: Approval hold tenant SSH relationship alignment.
-- Additive/idempotent diagnostics and context backfill only. No destructive SQL.
-- Tenant SSH CLI approval requests intentionally use approval_holds.run_id as request_id.
-- This migration teaches relationship diagnostics that tenant_ssh_cli_approval_requests is a valid parent surface.

UPDATE approval_holds ah
JOIN tenant_ssh_cli_approval_requests r
  ON r.request_id COLLATE utf8mb4_unicode_ci = ah.run_id COLLATE utf8mb4_unicode_ci
 AND r.hold_id COLLATE utf8mb4_unicode_ci = ah.hold_id COLLATE utf8mb4_unicode_ci
SET ah.user_id = COALESCE(ah.user_id, r.user_id, ah.requested_by),
    ah.actor_id = COALESCE(ah.actor_id, r.user_id, ah.requested_by),
    ah.actor_type = COALESCE(ah.actor_type, CASE WHEN COALESCE(r.user_id, ah.requested_by) IS NOT NULL THEN 'user' ELSE 'system' END),
    ah.request_id = COALESCE(ah.request_id, r.request_id),
    ah.correlation_id = COALESCE(ah.correlation_id, r.request_id, ah.run_id, ah.hold_id),
    ah.execution_context_json = CASE
      WHEN ah.execution_context_json IS NULL
        OR JSON_VALID(ah.execution_context_json) = 0
        OR JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.source')) = 'approval_hold_relationship_backfill'
      THEN JSON_OBJECT(
        'source', 'tenant_infrastructure_routes',
        'parent_table', 'tenant_ssh_cli_approval_requests',
        'request_id', r.request_id,
        'hold_id', ah.hold_id,
        'connection_id', r.connection_id,
        'command_key', r.command_key,
        'relationship_status', 'resolved_parent_reference',
        'secrets_included', false
      )
      ELSE ah.execution_context_json
    END
WHERE ah.run_id IS NOT NULL
  AND (ah.user_id IS NULL
       OR ah.actor_id IS NULL
       OR ah.actor_type IS NULL
       OR ah.request_id IS NULL
       OR ah.correlation_id IS NULL
       OR ah.execution_context_json IS NULL
       OR JSON_VALID(ah.execution_context_json) = 0
       OR JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.source')) = 'approval_hold_relationship_backfill');

CREATE OR REPLACE VIEW v_approval_hold_parent_resolution AS
SELECT ah.id,
       ah.hold_id,
       ah.run_id,
       ah.tenant_id,
       ah.user_id,
       ah.actor_id,
       ah.actor_type,
       ah.hold_type,
       ah.status,
       ah.requested_by,
       ah.request_id,
       ah.correlation_id,
       ah.created_at,
       CASE
         WHEN wr.run_id IS NOT NULL THEN 'workflow_runs'
         WHEN lg.call_id IS NOT NULL THEN 'local_gateway_tool_call_log'
         WHEN ssh.request_id IS NOT NULL THEN 'tenant_ssh_cli_approval_requests'
         ELSE NULL
       END AS parent_table,
       COALESCE(wr.run_id, lg.call_id, ssh.request_id) AS parent_id,
       CASE
         WHEN wr.run_id IS NOT NULL OR lg.call_id IS NOT NULL OR ssh.request_id IS NOT NULL THEN 'resolved_parent_reference'
         ELSE 'unresolved_run_reference'
       END AS relationship_status,
       CAST(JSON_OBJECT(
         'tenant_id', ah.tenant_id,
         'status', ah.status,
         'hold_type', ah.hold_type,
         'requested_by', ah.requested_by,
         'created_at', ah.created_at,
         'parent_table', CASE
           WHEN wr.run_id IS NOT NULL THEN 'workflow_runs'
           WHEN lg.call_id IS NOT NULL THEN 'local_gateway_tool_call_log'
           WHEN ssh.request_id IS NOT NULL THEN 'tenant_ssh_cli_approval_requests'
           ELSE NULL
         END,
         'parent_id', COALESCE(wr.run_id, lg.call_id, ssh.request_id),
         'secrets_included', false
       ) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci AS evidence_json
  FROM approval_holds ah
  LEFT JOIN workflow_runs wr
    ON wr.run_id COLLATE utf8mb4_unicode_ci = ah.run_id COLLATE utf8mb4_unicode_ci
  LEFT JOIN local_gateway_tool_call_log lg
    ON lg.call_id COLLATE utf8mb4_unicode_ci = ah.run_id COLLATE utf8mb4_unicode_ci
  LEFT JOIN tenant_ssh_cli_approval_requests ssh
    ON ssh.request_id COLLATE utf8mb4_unicode_ci = ah.run_id COLLATE utf8mb4_unicode_ci
   AND ssh.hold_id COLLATE utf8mb4_unicode_ci = ah.hold_id COLLATE utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_platform_relationship_integrity_summary AS
SELECT 'workflow_runs.plan_id -> execution_plans' relationship_name,'execution_chain' relationship_group,COUNT(*) checked_rows,SUM(wr.plan_id IS NOT NULL AND ep.plan_id IS NULL) missing_rows FROM workflow_runs wr LEFT JOIN execution_plans ep ON ep.plan_id COLLATE utf8mb4_unicode_ci=wr.plan_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'step_runs.run_id -> workflow_runs','execution_chain',COUNT(*),SUM(sr.run_id IS NOT NULL AND wr.run_id IS NULL) FROM step_runs sr LEFT JOIN workflow_runs wr ON wr.run_id COLLATE utf8mb4_unicode_ci=sr.run_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'telemetry_spans.run_id -> workflow_runs','execution_chain',COUNT(*),SUM(ts.run_id IS NOT NULL AND wr.run_id IS NULL) FROM telemetry_spans ts LEFT JOIN workflow_runs wr ON wr.run_id COLLATE utf8mb4_unicode_ci=ts.run_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'sink_dispatch_log.run_id -> workflow_runs','execution_chain',COUNT(*),SUM(sd.run_id IS NOT NULL AND wr.run_id IS NULL) FROM sink_dispatch_log sd LEFT JOIN workflow_runs wr ON wr.run_id COLLATE utf8mb4_unicode_ci=sd.run_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'approval_holds.run_id -> workflow_runs/local_gateway/tenant_ssh_cli_approval_requests','approval_chain',COUNT(*),SUM(parent_table IS NULL) FROM v_approval_hold_parent_resolution
UNION ALL SELECT 'audit_log.execution_plan resource -> execution_plans','audit_chain',COUNT(*),SUM(al.resource_type='execution_plan' AND al.resource_id IS NOT NULL AND ep.plan_id IS NULL) FROM audit_log al LEFT JOIN execution_plans ep ON ep.plan_id COLLATE utf8mb4_unicode_ci=al.resource_id COLLATE utf8mb4_unicode_ci WHERE al.resource_type='execution_plan'
UNION ALL SELECT 'gpt_session_turns.session_id -> customer_sessions','session_chain',COUNT(*),SUM(t.session_id IS NOT NULL AND cs.session_id IS NULL) FROM gpt_session_turns t LEFT JOIN customer_sessions cs ON cs.session_id COLLATE utf8mb4_unicode_ci=t.session_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'session_events.session_id -> customer_sessions','session_chain',COUNT(*),SUM(e.session_id IS NOT NULL AND cs.session_id IS NULL) FROM session_events e LEFT JOIN customer_sessions cs ON cs.session_id COLLATE utf8mb4_unicode_ci=e.session_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'session_events.turn_id -> gpt_session_turns','session_chain',COUNT(*),SUM(e.turn_id IS NOT NULL AND t.turn_id IS NULL) FROM session_events e LEFT JOIN gpt_session_turns t ON t.turn_id COLLATE utf8mb4_unicode_ci=e.turn_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'local_gateway.approval_hold_id -> approval_holds','approval_chain',COUNT(*),SUM(lg.approval_hold_id IS NOT NULL AND ah.hold_id IS NULL) FROM local_gateway_tool_call_log lg LEFT JOIN approval_holds ah ON ah.hold_id COLLATE utf8mb4_unicode_ci=lg.approval_hold_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'app_action_grants.connection -> user_app_connections','app_connection_chain',COUNT(*),SUM(g.connection_id IS NOT NULL AND c.connection_id IS NULL) FROM app_action_grants g LEFT JOIN user_app_connections c ON c.connection_id COLLATE utf8mb4_unicode_ci=g.connection_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'app_action_requests.connection -> user_app_connections','app_connection_chain',COUNT(*),SUM(r.connection_id IS NOT NULL AND c.connection_id IS NULL) FROM app_action_requests r LEFT JOIN user_app_connections c ON c.connection_id COLLATE utf8mb4_unicode_ci=r.connection_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'workspace_app_links.connection -> user_app_connections','app_connection_chain',COUNT(*),SUM(w.connection_id IS NOT NULL AND c.connection_id IS NULL) FROM workspace_app_links w LEFT JOIN user_app_connections c ON c.connection_id COLLATE utf8mb4_unicode_ci=w.connection_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'cms_site_access_grants.site -> cms_sites','cms_chain',COUNT(*),SUM(g.site_id IS NOT NULL AND s.site_id IS NULL) FROM cms_site_access_grants g LEFT JOIN cms_sites s ON s.site_id COLLATE utf8mb4_unicode_ci=g.site_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'cms_site_access_grants.connection -> user_app_connections','cms_chain',COUNT(*),SUM(g.connection_id IS NOT NULL AND c.connection_id IS NULL) FROM cms_site_access_grants g LEFT JOIN user_app_connections c ON c.connection_id COLLATE utf8mb4_unicode_ci=g.connection_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'cms_site_access_grants.claim -> cms_account_claims','cms_chain',COUNT(*),SUM(g.claim_id IS NOT NULL AND cc.claim_id IS NULL) FROM cms_site_access_grants g LEFT JOIN cms_account_claims cc ON cc.claim_id COLLATE utf8mb4_unicode_ci=g.claim_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'app_integration_action_bindings.app -> app_integrations','plugin_binding_chain',COUNT(*),SUM(b.app_key IS NOT NULL AND a.app_key IS NULL) FROM app_integration_action_bindings b LEFT JOIN app_integrations a ON a.app_key COLLATE utf8mb4_unicode_ci=b.app_key COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'app_integration_action_bindings.action -> actions','plugin_binding_chain',COUNT(*),SUM(b.action_key IS NOT NULL AND act.action_key IS NULL) FROM app_integration_action_bindings b LEFT JOIN actions act ON act.action_key COLLATE utf8mb4_unicode_ci=b.action_key COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'app_integration_tool_bindings.tool -> resolved tool registry','plugin_binding_chain',COUNT(*),SUM(b.tool_key IS NOT NULL AND t.tool_key IS NULL AND ati.tool_key IS NULL AND lgt.tool_key IS NULL AND b.tool_key NOT IN ('repo_inspect','repo_patch_apply')) FROM app_integration_tool_bindings b LEFT JOIN admin_platform_endpoint_tools t ON t.tool_key COLLATE utf8mb4_unicode_ci=b.tool_key COLLATE utf8mb4_unicode_ci LEFT JOIN agent_tool_index ati ON ati.tool_key COLLATE utf8mb4_unicode_ci=b.tool_key COLLATE utf8mb4_unicode_ci LEFT JOIN local_gateway_tools lgt ON lgt.tool_key COLLATE utf8mb4_unicode_ci=b.tool_key COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'platform_engine_policy_rules.policy -> registry','policy_chain',COUNT(*),SUM(r.policy_key IS NOT NULL AND pr.policy_key IS NULL) FROM platform_engine_policy_rules r LEFT JOIN platform_engine_policy_registry pr ON pr.policy_key COLLATE utf8mb4_unicode_ci=r.policy_key COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'policy_logic_bindings.source_policy -> execution_policies','policy_chain',COUNT(*),SUM(b.source_policy_table='execution_policies' AND b.source_policy_id IS NOT NULL AND ep.id IS NULL) FROM policy_logic_bindings b LEFT JOIN execution_policies ep ON ep.id=b.source_policy_id
UNION ALL SELECT 'policy_logic_bindings.target_rule -> platform_engine_policy_rules','policy_chain',COUNT(*),SUM(b.target_policy_rule_key IS NOT NULL AND pr.rule_key IS NULL) FROM policy_logic_bindings b LEFT JOIN platform_engine_policy_rules pr ON pr.rule_key COLLATE utf8mb4_unicode_ci=b.target_policy_rule_key COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'policy_logic_bindings.logic_key -> logic_definitions','policy_chain',COUNT(*),SUM(b.logic_key IS NOT NULL AND ld.logic_key IS NULL) FROM policy_logic_bindings b LEFT JOIN logic_definitions ld ON ld.logic_key COLLATE utf8mb4_unicode_ci=b.logic_key COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'connected_reports.session -> connected_sessions','connected_execution_chain',COUNT(*),SUM(r.connected_session_id IS NOT NULL AND s.connected_session_id IS NULL) FROM connected_execution_evidence_reports r LEFT JOIN connected_execution_sessions s ON s.connected_session_id COLLATE utf8mb4_unicode_ci=r.connected_session_id COLLATE utf8mb4_unicode_ci
UNION ALL SELECT 'connected_resume.session -> connected_sessions','connected_execution_chain',COUNT(*),SUM(a.connected_session_id IS NOT NULL AND s.connected_session_id IS NULL) FROM connected_execution_resume_actions a LEFT JOIN connected_execution_sessions s ON s.connected_session_id COLLATE utf8mb4_unicode_ci=a.connected_session_id COLLATE utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_platform_relationship_integrity_issues AS
SELECT CAST('approval_holds.run_id -> workflow_runs/local_gateway/tenant_ssh_cli_approval_requests' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci relationship_name,
       CAST('approval_chain' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci relationship_group,
       CAST(hold_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci source_id,
       CAST(run_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci target_ref,
       CAST('unresolved_run_reference' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci issue_code,
       evidence_json
  FROM v_approval_hold_parent_resolution
 WHERE parent_table IS NULL
UNION ALL
SELECT CAST('app_integration_tool_bindings.tool -> resolved tool registry' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST('plugin_binding_chain' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(b.binding_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(b.tool_key AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST('unresolved_tool_binding' AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,CAST(JSON_OBJECT('app_key',b.app_key,'status',b.status,'notes',b.notes,'secrets_included',false) AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM app_integration_tool_bindings b LEFT JOIN admin_platform_endpoint_tools t ON t.tool_key COLLATE utf8mb4_unicode_ci=b.tool_key COLLATE utf8mb4_unicode_ci LEFT JOIN agent_tool_index ati ON ati.tool_key COLLATE utf8mb4_unicode_ci=b.tool_key COLLATE utf8mb4_unicode_ci LEFT JOIN local_gateway_tools lgt ON lgt.tool_key COLLATE utf8mb4_unicode_ci=b.tool_key COLLATE utf8mb4_unicode_ci WHERE b.tool_key IS NOT NULL AND t.tool_key IS NULL AND ati.tool_key IS NULL AND lgt.tool_key IS NULL AND b.tool_key NOT IN ('repo_inspect','repo_patch_apply');

CREATE OR REPLACE VIEW v_platform_relationship_integrity_score AS
SELECT COUNT(*) relationship_checks,SUM(CASE WHEN COALESCE(missing_rows,0)=0 THEN 1 ELSE 0 END) passing_checks,SUM(CASE WHEN COALESCE(missing_rows,0)>0 THEN 1 ELSE 0 END) failing_checks,SUM(COALESCE(missing_rows,0)) total_missing_rows FROM v_platform_relationship_integrity_summary;
