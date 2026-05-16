-- Sprint 56b: Connector registry diagnostic views.
--
-- Read-only views for app to action bindings and connector family coverage.
-- These views are diagnostics only and do not change runtime dispatch behavior.

CREATE OR REPLACE VIEW `v_app_integration_capability_map` AS
SELECT
  ai.app_key,
  ai.display_name AS app_display_name,
  ai.category AS app_category,
  ai.auth_type AS app_auth_type,
  ai.status AS app_status,
  b.action_key,
  b.binding_role,
  b.credential_source,
  b.exposure_default,
  b.status AS binding_status,
  a.connector_family,
  a.runtime_capability_class,
  a.runtime_callable,
  a.primary_executor,
  a.api_key_mode,
  COALESCE(ep.active_endpoints, 0) AS active_endpoints,
  COALESCE(tx.active_tool_exports, 0) AS active_tool_exports,
  COALESCE(uc.active_connections, 0) AS active_user_connections
FROM `app_integrations` ai
LEFT JOIN `app_integration_action_bindings` b
  ON CONVERT(b.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
 AND b.status = 'active'
LEFT JOIN `actions` a
  ON CONVERT(a.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT parent_action_key, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_endpoints
  FROM `endpoints`
  GROUP BY parent_action_key
) ep
  ON CONVERT(ep.parent_action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT parent_action_key, COUNT(*) AS active_tool_exports
  FROM `platform_endpoint_tool_exports`
  WHERE status = 'active'
  GROUP BY parent_action_key
) tx
  ON CONVERT(tx.parent_action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT app_key, COUNT(*) AS active_connections
  FROM `user_app_connections`
  WHERE status = 'active'
  GROUP BY app_key
) uc
  ON CONVERT(uc.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_connector_family_coverage` AS
SELECT
  r.connector_family,
  r.provider_family,
  r.display_name,
  r.protocol_type,
  r.provider_domain_mode,
  r.connection_scope,
  r.runtime_layer,
  r.default_auth_mode,
  r.status AS registry_status,
  COALESCE(ac.action_count, 0) AS action_count,
  COALESCE(ac.active_action_count, 0) AS active_action_count,
  COALESCE(ep.endpoint_count, 0) AS endpoint_count,
  COALESCE(ep.active_endpoint_count, 0) AS active_endpoint_count,
  COALESCE(cs.system_count, 0) AS connected_system_count,
  COALESCE(cs.active_system_count, 0) AS active_connected_system_count
FROM `connector_family_registry` r
LEFT JOIN (
  SELECT connector_family, COUNT(*) AS action_count, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_action_count
  FROM `actions`
  GROUP BY connector_family
) ac
  ON CONVERT(ac.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(r.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT connector_family, COUNT(*) AS endpoint_count, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_endpoint_count
  FROM `endpoints`
  GROUP BY connector_family
) ep
  ON CONVERT(ep.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(r.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT connector_family, COUNT(*) AS system_count, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_system_count
  FROM `connected_systems`
  GROUP BY connector_family
) cs
  ON CONVERT(cs.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(r.connector_family USING utf8mb4) COLLATE utf8mb4_unicode_ci;
