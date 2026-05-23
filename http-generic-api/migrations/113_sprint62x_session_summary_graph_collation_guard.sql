-- Sprint 62x: session summary graph collation guard
--
-- Production currently contains two valid utf8mb4 collation families:
-- - session/application tables on utf8mb4_uca1400_ai_ci
-- - graph/json registry tables on utf8mb4_unicode_ci
--
-- Do not perform a broad collation conversion in-place. That would touch many
-- indexed identifier columns and could destabilize existing joins. Instead,
-- expose a canonical view for the known cross-family session-summary graph join
-- and keep the collation cast local to this boundary.

CREATE OR REPLACE VIEW `v_session_summary_graph_attachments` AS
SELECT
  ss.summary_id,
  ss.session_id,
  ss.tenant_id,
  ss.user_id,
  ss.workspace_key,
  ss.created_at AS summary_created_at,
  ja.asset_id,
  ja.asset_key,
  ja.asset_type,
  ja.source_asset_ref,
  ja.transport_status,
  ja.validation_status,
  ja.active_status,
  l.link_id,
  l.subject_type,
  l.subject_ref,
  l.linkage_type,
  l.scope_label,
  l.status AS link_status,
  e.edge_id,
  e.source_node_id,
  e.edge_type,
  e.target_node_id,
  e.runtime_enforced,
  e.lifecycle_status AS edge_lifecycle_status
FROM `session_summaries` ss
LEFT JOIN `json_assets` ja
  ON ja.source_asset_ref = ss.summary_id COLLATE utf8mb4_unicode_ci
LEFT JOIN `json_asset_subject_links` l
  ON l.asset_id = ja.asset_id
LEFT JOIN `platform_graph_edges` e
  ON e.source_pk = l.link_id;
