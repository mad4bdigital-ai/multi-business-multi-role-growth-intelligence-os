-- Sprint 68: Session insight candidate scope-link monitoring.
-- Ensures typed session insight candidates are connected into the dynamic memory_scope_links layer.
-- Monitoring only: no promotion, runtime retrieval, or candidate mutation.

CREATE OR REPLACE VIEW `v_session_insight_scope_link_issues` AS
SELECT
  c.insight_id,
  c.source_session_id,
  c.source_summary_id,
  c.insight_type,
  'candidate_missing_scope_links' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'insight_id', c.insight_id,
    'source_session_id', c.source_session_id,
    'source_summary_id', c.source_summary_id,
    'insight_type', c.insight_type,
    'promotion_status', c.promotion_status,
    'secrets_included', false
  ) AS evidence_json
FROM `session_insight_candidates` c
LEFT JOIN `memory_scope_links` l
  ON l.resource_type = 'session_insight_candidate'
 AND l.resource_ref = c.insight_id
 AND l.linkage_type = 'insight_candidate_scope_attachment'
 AND l.lifecycle_status = 'active'
WHERE c.lifecycle_status = 'active'
GROUP BY c.insight_id, c.source_session_id, c.source_summary_id, c.insight_type, c.promotion_status
HAVING COUNT(l.id) = 0
UNION ALL
SELECT
  c.insight_id,
  c.source_session_id,
  c.source_summary_id,
  c.insight_type,
  'candidate_scope_link_unregistered_type' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'insight_id', c.insight_id,
    'scope_type', l.scope_type,
    'scope_ref', l.scope_ref,
    'secrets_included', false
  ) AS evidence_json
FROM `session_insight_candidates` c
JOIN `memory_scope_links` l
  ON l.resource_type = 'session_insight_candidate'
 AND l.resource_ref = c.insight_id
 AND l.linkage_type = 'insight_candidate_scope_attachment'
LEFT JOIN `memory_scope_type_registry` r ON r.scope_type = l.scope_type
WHERE c.lifecycle_status = 'active'
  AND l.lifecycle_status = 'active'
  AND r.scope_type IS NULL
UNION ALL
SELECT
  c.insight_id,
  c.source_session_id,
  c.source_summary_id,
  c.insight_type,
  'candidate_scope_link_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'insight_id', c.insight_id,
    'scope_type', l.scope_type,
    'scope_ref', l.scope_ref,
    'secrets_included', l.secrets_included
  ) AS evidence_json
FROM `session_insight_candidates` c
JOIN `memory_scope_links` l
  ON l.resource_type = 'session_insight_candidate'
 AND l.resource_ref = c.insight_id
 AND l.linkage_type = 'insight_candidate_scope_attachment'
WHERE c.lifecycle_status = 'active'
  AND l.lifecycle_status = 'active'
  AND l.secrets_included <> 0;
