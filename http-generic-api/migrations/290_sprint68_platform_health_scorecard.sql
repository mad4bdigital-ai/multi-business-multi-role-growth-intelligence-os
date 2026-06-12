-- Sprint 68: Platform Health Scorecard
-- Purpose:
--   Adds a DB-backed platform health scorecard that summarizes the core runtime-contract,
--   tool-bus, orchestration, migration authorization, release readiness, and credential
--   readiness surfaces into a stable readback view and admin tool.
-- Safety:
--   Idempotent metadata/readback migration. No provider calls. No secrets.

CREATE OR REPLACE VIEW `v_platform_health_scorecard_components` AS
SELECT
  'schema_contract_health' AS component_key,
  CASE
    WHEN a.actions_with_legacy_file_id = 0
     AND e.active_endpoints_missing_schema = 0
     AND e.execution_ready_missing_schema = 0
    THEN 'pass' ELSE 'fail'
  END AS status,
  JSON_OBJECT(
    'actions_total', a.actions_total,
    'active_actions', a.active_actions,
    'sql_backed_actions', a.sql_backed_actions,
    'actions_with_legacy_file_id', a.actions_with_legacy_file_id,
    'active_endpoints', e.active_endpoints,
    'active_endpoints_missing_schema', e.active_endpoints_missing_schema,
    'execution_ready_endpoints', e.execution_ready_endpoints,
    'execution_ready_missing_schema', e.execution_ready_missing_schema,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM (
  SELECT COUNT(*) AS actions_total,
         SUM(status='active') AS active_actions,
         SUM(openai_schema_file_id LIKE 'action_schema:%') AS sql_backed_actions,
         SUM(openai_schema_file_id IS NOT NULL AND openai_schema_file_id <> '' AND openai_schema_file_id NOT LIKE 'action_schema:%') AS actions_with_legacy_file_id
    FROM actions
) a
CROSS JOIN (
  SELECT SUM(status='active') AS active_endpoints,
         SUM(status='active' AND schema_json IS NULL) AS active_endpoints_missing_schema,
         SUM(execution_readiness='ready') AS execution_ready_endpoints,
         SUM(execution_readiness='ready' AND schema_json IS NULL) AS execution_ready_missing_schema
    FROM endpoints
) e
UNION ALL
SELECT
  'tool_bus_health' AS component_key,
  CASE
    WHEN tt.recursive_tenant_tools_active = 0
     AND at.invalid_admin_tool_input_schema = 0
     AND at.enabled_runtime_endpoint_call_tools >= 1
    THEN 'pass' ELSE 'fail'
  END AS status,
  JSON_OBJECT(
    'recursive_tenant_tools_active', tt.recursive_tenant_tools_active,
    'admin_tools_total', at.admin_tools_total,
    'enabled_admin_tools', at.enabled_admin_tools,
    'invalid_admin_tool_input_schema', at.invalid_admin_tool_input_schema,
    'enabled_runtime_endpoint_call_tools', at.enabled_runtime_endpoint_call_tools,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM (
  SELECT COUNT(*) AS recursive_tenant_tools_active
    FROM tenant_platform_endpoint_tools
   WHERE is_enabled=1 AND http_path IN ('/system/tools/call','/gpt/tools/call')
) tt
CROSS JOIN (
  SELECT COUNT(*) AS admin_tools_total,
         SUM(is_enabled=1) AS enabled_admin_tools,
         SUM(input_schema IS NOT NULL AND input_schema <> '' AND NOT JSON_VALID(input_schema)) AS invalid_admin_tool_input_schema,
         SUM(is_enabled=1 AND (tool_key='runtime_endpoint_call' OR tags LIKE '%runtime_endpoint_call%' OR http_path LIKE '%runtime-endpoint%')) AS enabled_runtime_endpoint_call_tools
    FROM admin_platform_endpoint_tools
) at
UNION ALL
SELECT
  'orchestration_graph_health' AS component_key,
  CASE
    WHEN COUNT(*) >= 3
     AND SUM(plugin_status='active') = COUNT(*)
     AND SUM(readiness_status='ready_readonly_graph_seeded') = COUNT(*)
     AND SUM(secrets_included=1) = 0
    THEN 'pass' ELSE 'fail'
  END AS status,
  JSON_OBJECT(
    'graph_count', COUNT(*),
    'ready_graph_count', SUM(readiness_status='ready_readonly_graph_seeded'),
    'active_graph_count', SUM(plugin_status='active'),
    'secret_graph_rows', SUM(secrets_included=1),
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM v_platform_orchestration_graph_readiness
UNION ALL
SELECT
  'external_delivery_health' AS component_key,
  CASE
    WHEN readiness_status='ready_no_send_external_delivery_graph'
     AND stage_count >= expected_stage_count
     AND edge_count >= expected_edge_count
     AND enabled_external_delivery_tool_count = no_external_send_tool_count
     AND completion_certification_tool_count >= 1
     AND secrets_included = 0
    THEN 'pass' ELSE 'fail'
  END AS status,
  JSON_OBJECT(
    'readiness_status', readiness_status,
    'stage_count', stage_count,
    'edge_count', edge_count,
    'enabled_external_delivery_tool_count', enabled_external_delivery_tool_count,
    'no_external_send_tool_count', no_external_send_tool_count,
    'completion_certification_tool_count', completion_certification_tool_count,
    'secrets_included', secrets_included
  ) AS evidence_json,
  0 AS secrets_included
FROM v_platform_orchestration_external_delivery_readiness
UNION ALL
SELECT
  'migration_authorization_health' AS component_key,
  CASE
    WHEN ar.authorization_registry_rows > 0
     AND ar.unauthorized_recent_migration_count = 0
     AND ar.authorized_rows > 0
    THEN 'pass' ELSE 'fail'
  END AS status,
  JSON_OBJECT(
    'authorization_registry_rows', ar.authorization_registry_rows,
    'authorized_rows', ar.authorized_rows,
    'disabled_rows', ar.disabled_rows,
    'unauthorized_recent_migration_count', ar.unauthorized_recent_migration_count,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM (
  SELECT
    (SELECT COUNT(*) FROM governed_migration_authorization_registry) AS authorization_registry_rows,
    (SELECT COUNT(*) FROM governed_migration_authorization_registry WHERE authorization_status='authorized') AS authorized_rows,
    (SELECT COUNT(*) FROM governed_migration_authorization_registry WHERE authorization_status='disabled') AS disabled_rows,
    (SELECT COUNT(*)
       FROM governed_migration_ledger l
       LEFT JOIN governed_migration_authorization_registry r ON r.migration_file = l.migration_file
      WHERE l.mode='apply'
        AND l.applied_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND r.migration_file IS NULL) AS unauthorized_recent_migration_count
) ar
UNION ALL
SELECT
  'release_readiness_health' AS component_key,
  CASE
    WHEN rr.latest_run_id IS NULL THEN 'warn'
    WHEN rr.fail_count = 0 AND rr.warn_count = 0 THEN 'pass'
    WHEN rr.fail_count = 0 THEN 'warn'
    ELSE 'fail'
  END AS status,
  JSON_OBJECT(
    'latest_run_id', rr.latest_run_id,
    'checked_at', rr.checked_at,
    'pass_count', rr.pass_count,
    'warn_count', rr.warn_count,
    'fail_count', rr.fail_count,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM (
  SELECT latest.run_id AS latest_run_id,
         MAX(l.checked_at) AS checked_at,
         SUM(l.status='pass') AS pass_count,
         SUM(l.status='warn') AS warn_count,
         SUM(l.status='fail') AS fail_count
    FROM (SELECT run_id FROM release_readiness_log ORDER BY checked_at DESC LIMIT 1) latest
    LEFT JOIN release_readiness_log l ON l.run_id = latest.run_id
   GROUP BY latest.run_id
) rr
UNION ALL
SELECT
  'provider_credential_health' AS component_key,
  CASE
    WHEN c.error_systems = 0 AND c.problem_credentials = 0 THEN 'pass'
    WHEN c.error_systems <= 2 THEN 'warn'
    ELSE 'fail'
  END AS status,
  JSON_OBJECT(
    'connected_systems_total', c.connected_systems_total,
    'active_systems', c.active_systems,
    'error_systems', c.error_systems,
    'api_credentials_total', c.api_credentials_total,
    'problem_credentials', c.problem_credentials,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM (
  SELECT
    (SELECT COUNT(*) FROM connected_systems) AS connected_systems_total,
    (SELECT COUNT(*) FROM connected_systems WHERE status='active') AS active_systems,
    (SELECT COUNT(*) FROM connected_systems WHERE status IN ('error','failed')) AS error_systems,
    (SELECT COUNT(*) FROM api_credentials) AS api_credentials_total,
    (SELECT COUNT(*) FROM api_credentials WHERE status IN ('error','failed','revoked','expired')) AS problem_credentials
) c;

CREATE OR REPLACE VIEW `v_platform_health_scorecard` AS
SELECT
  CASE
    WHEN SUM(status='fail') > 0 THEN 'fail'
    WHEN SUM(status='warn') > 0 THEN 'warn'
    ELSE 'pass'
  END AS overall_status,
  COUNT(*) AS component_count,
  SUM(status='pass') AS pass_count,
  SUM(status='warn') AS warn_count,
  SUM(status='fail') AS fail_count,
  JSON_ARRAYAGG(JSON_OBJECT(
    'component_key', component_key,
    'status', status,
    'evidence', evidence_json,
    'secrets_included', secrets_included
  )) AS components_json,
  MAX(secrets_included) AS secrets_included
FROM v_platform_health_scorecard_components;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order, created_at, updated_at)
VALUES
  ('platform_health_scorecard','Platform Health Scorecard','Read-only DB-backed platform health scorecard across Tool Bus, schema contracts, orchestration graphs, migration authorization, release readiness, and credential readiness.','POST','/platform/health/scorecard',NULL,'{"type":"object","properties":{"include_components":{"type":"boolean","default":true}}}',NULL,'platform,health,scorecard,readback,no_provider_call,no_secrets',1,1200,NOW(),CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  input_schema=VALUES(input_schema),
  tags=VALUES(tags),
  is_enabled=1,
  updated_at=CURRENT_TIMESTAMP;
