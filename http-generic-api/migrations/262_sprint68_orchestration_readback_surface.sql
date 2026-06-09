-- Sprint 68: Orchestration Intelligence readback surface.
--
-- Adds read-only views and an admin tool registry row for reading the
-- orchestration graph, latest snapshots, and recommendations. This migration
-- does not create snapshots, recommendations, provider calls, credential reads,
-- spend changes, external writes, deploys, or publishing behavior.
--
-- Idempotent. Additive/read-only surface only. No secrets.

CREATE OR REPLACE VIEW `v_platform_orchestration_graph_readiness` AS
SELECT
  p.plugin_key,
  p.display_name,
  p.domain_key,
  p.engine_key,
  p.policy_key,
  p.readback_tool_key,
  p.status AS plugin_status,
  COALESCE(sc.stage_count, 0) AS stage_count,
  COALESCE(sc.active_stage_count, 0) AS active_stage_count,
  COALESCE(ec.edge_count, 0) AS edge_count,
  COALESCE(ec.active_edge_count, 0) AS active_edge_count,
  CASE
    WHEN p.plugin_key = 'ads_provider_governance_orchestrator' THEN 7
    ELSE 1
  END AS expected_stage_count,
  CASE
    WHEN p.plugin_key = 'ads_provider_governance_orchestrator' THEN 6
    ELSE 0
  END AS expected_edge_count,
  CASE
    WHEN p.status = 'active'
     AND COALESCE(sc.active_stage_count, 0) >= CASE WHEN p.plugin_key = 'ads_provider_governance_orchestrator' THEN 7 ELSE 1 END
     AND COALESCE(ec.active_edge_count, 0) >= CASE WHEN p.plugin_key = 'ads_provider_governance_orchestrator' THEN 6 ELSE 0 END
    THEN 'ready_readonly_graph_seeded'
    ELSE 'degraded_graph_incomplete'
  END AS readiness_status,
  JSON_OBJECT(
    'plugin_key', p.plugin_key,
    'stage_count', COALESCE(sc.stage_count, 0),
    'active_stage_count', COALESCE(sc.active_stage_count, 0),
    'edge_count', COALESCE(ec.edge_count, 0),
    'active_edge_count', COALESCE(ec.active_edge_count, 0),
    'readback_tool_key', p.readback_tool_key,
    'no_provider_call', true,
    'no_credential_payload_read', true,
    'no_spend_change', true,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM `platform_orchestration_plugins` p
LEFT JOIN (
  SELECT plugin_key,
         COUNT(*) AS stage_count,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_stage_count
    FROM `platform_orchestration_stages`
   GROUP BY plugin_key
) sc ON sc.plugin_key = p.plugin_key
LEFT JOIN (
  SELECT plugin_key,
         COUNT(*) AS edge_count,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_edge_count
    FROM `platform_orchestration_edges`
   GROUP BY plugin_key
) ec ON ec.plugin_key = p.plugin_key;

CREATE OR REPLACE VIEW `v_platform_orchestration_ads_governance_readiness` AS
SELECT
  'ads_provider_governance_orchestrator' AS plugin_key,
  COALESCE(g.stage_count, 0) AS stage_count,
  COALESCE(g.edge_count, 0) AS edge_count,
  7 AS expected_stage_count,
  6 AS expected_edge_count,
  (SELECT COUNT(*) FROM `ads_provider_capability_profile_registry` WHERE provider_key = 'google_ads') AS google_ads_profile_rows,
  (SELECT COUNT(*) FROM `ads_provider_preflight_contract_registry` WHERE applies_to_provider_family = 'ads_provider' AND status = 'active') AS google_ads_contract_rows,
  (SELECT COUNT(*) FROM `ads_provider_preflight_surface_blueprint_registry` WHERE required_contract_key = 'ads_provider_preflight_contract_v1' AND status = 'active') AS google_ads_blueprint_rows,
  (SELECT COUNT(*) FROM `execution_enablement_registry` WHERE provider_key = 'google_ads' AND execution_enabled = 1) AS google_ads_enabled_execution_rows,
  CASE
    WHEN COALESCE(g.stage_count, 0) >= 7 AND COALESCE(g.edge_count, 0) >= 6
    THEN 'ready_readonly_ads_governance_graph'
    ELSE 'degraded_ads_governance_graph_incomplete'
  END AS readiness_status,
  CASE
    WHEN (SELECT COUNT(*) FROM `execution_enablement_registry` WHERE provider_key = 'google_ads' AND execution_enabled = 1) = 0
    THEN 'policy_disabled_by_design'
    ELSE 'execution_enablement_present_requires_separate_gate'
  END AS execution_enablement_classification,
  JSON_OBJECT(
    'provider_key','google_ads',
    'execution_enabled_default', false,
    'recommendation_only', true,
    'provider_execution_allowed', false,
    'no_provider_call', true,
    'no_credential_payload_read', true,
    'no_spend_change', true,
    'secrets_included', false
  ) AS safety_json,
  0 AS secrets_included
FROM (
  SELECT stage_count, edge_count
    FROM `v_platform_orchestration_graph_readiness`
   WHERE plugin_key = 'ads_provider_governance_orchestrator'
   LIMIT 1
) g;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'orchestration_intelligence_readback_policy_v1',
       JSON_OBJECT(
         'rule','orchestration_intelligence_readback_read_only',
         'route','/platform/orchestration/readback',
         'tool_key','platform_orchestration_readback',
         'views',JSON_ARRAY('v_platform_orchestration_graph_readiness','v_platform_orchestration_ads_governance_readiness'),
         'no_provider_call',true,
         'no_spend_change',true,
         'no_credential_payload_read',true,
         'no_external_write',true,
         'secrets_included',false
       ),
       'orchestration_intelligence|orchestration_readback|graph_readiness|recommendation_readback',
       'platformOrchestrationReadback|platformPluginRoutes|admin_platform_endpoint_tools|platform_orchestration_*',
       'TRUE',
       'Read-only orchestration graph/snapshot/recommendation readback surface. No execution is performed.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='orchestration_intelligence_readback_policy_v1'
);

UPDATE `platform_orchestration_plugins`
   SET `readback_tool_key` = 'platform_orchestration_readback',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `plugin_key` = 'ads_provider_governance_orchestrator';

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_orchestration_readback',
  'Platform Orchestration Readback',
  'Read-only orchestration graph, latest state snapshots, and recommendation readback. Defaults to ads_provider_governance_orchestrator. Never executes provider calls, reads credential payloads, mutates spend, deploys, publishes, or returns secrets.',
  'POST',
  '/platform/orchestration/readback',
  NULL,
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'plugin_key',JSON_OBJECT('type','string','default','ads_provider_governance_orchestrator'),
      'include_snapshots',JSON_OBJECT('type','boolean','default',true),
      'include_recommendations',JSON_OBJECT('type','boolean','default',true),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',50,'default',10)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,orchestration_intelligence,readback,read_only,no_execution,no_secrets,ads_provider_governance',
  1,
  640
) ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`),
  `updated_at` = CURRENT_TIMESTAMP;
