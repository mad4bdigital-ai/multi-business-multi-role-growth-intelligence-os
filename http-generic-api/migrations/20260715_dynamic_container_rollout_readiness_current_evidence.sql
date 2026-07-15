-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Dynamic Container rollout readiness must use current governed evidence while preserving historical evidence views.

CREATE OR REPLACE VIEW `v_container_latest_shadow_run_summary` AS
SELECT
  latest.shadow_run_id,
  COUNT(c.comparison_id) AS sample_count,
  SUM(c.comparison_status = 'match') AS match_count,
  SUM(c.comparison_status = 'mismatch') AS mismatch_count,
  SUM(c.comparison_status = 'mismatch' AND c.mismatch_codes_json LIKE '%critical%') AS critical_mismatch_count,
  SUM(c.comparison_status = 'not_comparable') AS not_comparable_count,
  ROUND(
    100.0 * SUM(c.comparison_status = 'mismatch') /
    NULLIF(SUM(c.comparison_status IN ('match','mismatch')),0),
    4
  ) AS mismatch_percent,
  ROUND(AVG(c.latency_ms),3) AS average_latency_ms,
  MAX(c.created_at) AS last_compared_at
FROM (
  SELECT
    SUBSTRING_INDEX(SUBSTRING_INDEX(legacy_evidence_ref,':',2),':',-1) AS shadow_run_id
  FROM container_shadow_comparisons
  WHERE legacy_evidence_ref LIKE 'dynamic-container-shadow-sampler:%'
  ORDER BY created_at DESC, comparison_id DESC
  LIMIT 1
) latest
LEFT JOIN container_shadow_comparisons c
  ON c.legacy_evidence_ref LIKE CONCAT('dynamic-container-shadow-sampler:',latest.shadow_run_id,':%')
GROUP BY latest.shadow_run_id;

CREATE OR REPLACE VIEW `v_container_latest_shadow_performance_summary` AS
SELECT
  ranked.shadow_run_id,
  COUNT(*) AS sample_count,
  ROUND(AVG(ranked.duration_ms),3) AS average_latency_ms,
  ROUND(MAX(CASE WHEN ranked.percentile_rank <= 0.95 THEN ranked.duration_ms END),3) AS p95_latency_ms,
  ROUND(MAX(CASE WHEN ranked.percentile_rank <= 0.99 THEN ranked.duration_ms END),3) AS p99_latency_ms,
  SUM(ranked.within_budget = 1) AS within_budget_count,
  MAX(ranked.created_at) AS last_sample_at
FROM (
  SELECT
    latest.shadow_run_id,
    p.duration_ms,
    p.within_budget,
    p.created_at,
    PERCENT_RANK() OVER (ORDER BY p.duration_ms) AS percentile_rank
  FROM (
    SELECT
      SUBSTRING_INDEX(SUBSTRING_INDEX(legacy_evidence_ref,':',2),':',-1) AS shadow_run_id
    FROM container_shadow_comparisons
    WHERE legacy_evidence_ref LIKE 'dynamic-container-shadow-sampler:%'
    ORDER BY created_at DESC, comparison_id DESC
    LIMIT 1
  ) latest
  JOIN container_shadow_comparisons c
    ON c.legacy_evidence_ref LIKE CONCAT('dynamic-container-shadow-sampler:',latest.shadow_run_id,':%')
  JOIN container_resolution_performance_samples p
    ON p.resolution_id = c.resolution_id
   AND p.mode = 'shadow'
) ranked
GROUP BY ranked.shadow_run_id;

CREATE OR REPLACE VIEW `v_container_latest_shadow_audit_coverage` AS
SELECT
  latest.shadow_run_id,
  COUNT(c.comparison_id) AS comparison_sample_count,
  SUM(
    CASE
      WHEN l.resolution_id IS NOT NULL
       AND l.mode = 'shadow'
       AND l.provider_call_made = 0
       AND l.credential_payload_read = 0
       AND l.secrets_included = 0
       AND c.secrets_included = 0
      THEN 1 ELSE 0
    END
  ) AS audited_sample_count,
  ROUND(
    100.0 * SUM(
      CASE
        WHEN l.resolution_id IS NOT NULL
         AND l.mode = 'shadow'
         AND l.provider_call_made = 0
         AND l.credential_payload_read = 0
         AND l.secrets_included = 0
         AND c.secrets_included = 0
        THEN 1 ELSE 0
      END
    ) / NULLIF(COUNT(c.comparison_id),0),
    4
  ) AS audit_coverage_percent,
  MAX(c.created_at) AS last_audited_at
FROM (
  SELECT
    SUBSTRING_INDEX(SUBSTRING_INDEX(legacy_evidence_ref,':',2),':',-1) AS shadow_run_id
  FROM container_shadow_comparisons
  WHERE legacy_evidence_ref LIKE 'dynamic-container-shadow-sampler:%'
  ORDER BY created_at DESC, comparison_id DESC
  LIMIT 1
) latest
LEFT JOIN container_shadow_comparisons c
  ON c.legacy_evidence_ref LIKE CONCAT('dynamic-container-shadow-sampler:',latest.shadow_run_id,':%')
LEFT JOIN container_effective_context_ledger l
  ON l.resolution_id = c.resolution_id
GROUP BY latest.shadow_run_id;

CREATE OR REPLACE VIEW `v_container_rollout_readiness` AS
SELECT
  p.policy_key,
  p.rollout_mode,
  p.mismatch_threshold_percent,
  p.critical_mismatch_threshold,
  p.p95_budget_ms,
  p.p99_budget_ms,
  p.audit_coverage_required_percent,
  p.minimum_sample_count,
  COALESCE(MAX(s.sample_count),0) AS comparison_sample_count,
  COALESCE(MAX(s.mismatch_count),0) AS mismatch_count,
  COALESCE(MAX(s.critical_mismatch_count),0) AS critical_mismatch_count,
  COALESCE(MAX(s.mismatch_percent),0) AS maximum_mismatch_percent,
  COALESCE(MAX(perf.sample_count),0) AS performance_sample_count,
  COALESCE(MAX(perf.p95_latency_ms),0) AS p95_latency_ms,
  COALESCE(MAX(perf.p99_latency_ms),0) AS p99_latency_ms,
  COALESCE(MAX(audit.comparison_sample_count),0) AS audit_sample_count,
  COALESCE(MAX(audit.audited_sample_count),0) AS audited_sample_count,
  COALESCE(MAX(audit.audit_coverage_percent),0) AS audit_coverage_percent,
  COALESCE((
    SELECT COUNT(*)
    FROM v_container_relationship_issues i
    JOIN container_relationships r
      ON r.relationship_id = i.relationship_id
     AND r.status = 'active'
  ),0) AS relationship_issue_count,
  COALESCE((
    SELECT COUNT(*)
    FROM container_identity_projection_issues i
    WHERE i.projection_run_id = (
      SELECT pr.projection_run_id
      FROM container_projection_runs pr
      WHERE pr.mode = 'apply'
        AND pr.status = 'completed'
      ORDER BY pr.completed_at DESC
      LIMIT 1
    )
      AND i.status IN ('open','held')
      AND i.severity IN ('high','critical')
  ),0) AS high_risk_projection_issue_count,
  CASE WHEN p.rollout_mode IN ('disabled','shadow') THEN 0 ELSE 1 END AS enforcement_requested,
  CASE
    WHEN p.rollout_mode = 'disabled' THEN 'disabled'
    WHEN COALESCE(MAX(s.sample_count),0) < p.minimum_sample_count THEN 'insufficient_samples'
    WHEN COALESCE(MAX(perf.sample_count),0) < p.minimum_sample_count THEN 'insufficient_performance_samples'
    WHEN COALESCE(MAX(s.mismatch_percent),0) > p.mismatch_threshold_percent THEN 'mismatch_threshold_exceeded'
    WHEN COALESCE(MAX(s.critical_mismatch_count),0) > p.critical_mismatch_threshold THEN 'critical_mismatch_threshold_exceeded'
    WHEN COALESCE(MAX(perf.p95_latency_ms),0) > p.p95_budget_ms THEN 'p95_latency_budget_exceeded'
    WHEN COALESCE(MAX(perf.p99_latency_ms),0) > p.p99_budget_ms THEN 'p99_latency_budget_exceeded'
    WHEN COALESCE(MAX(audit.audit_coverage_percent),0) < p.audit_coverage_required_percent THEN 'audit_coverage_below_required'
    WHEN COALESCE((
      SELECT COUNT(*)
      FROM v_container_relationship_issues i
      JOIN container_relationships r
        ON r.relationship_id = i.relationship_id
       AND r.status = 'active'
    ),0) > 0 THEN 'relationship_issues_present'
    WHEN COALESCE((
      SELECT COUNT(*)
      FROM container_identity_projection_issues i
      WHERE i.projection_run_id = (
        SELECT pr.projection_run_id
        FROM container_projection_runs pr
        WHERE pr.mode = 'apply'
          AND pr.status = 'completed'
        ORDER BY pr.completed_at DESC
        LIMIT 1
      )
        AND i.status IN ('open','held')
        AND i.severity IN ('high','critical')
    ),0) > 0 THEN 'projection_issues_present'
    ELSE 'ready_for_review'
  END AS readiness_code,
  0 AS secrets_included
FROM container_rollout_policy_registry p
LEFT JOIN v_container_latest_shadow_run_summary s ON 1 = 1
LEFT JOIN v_container_latest_shadow_performance_summary perf
  ON perf.shadow_run_id = s.shadow_run_id
LEFT JOIN v_container_latest_shadow_audit_coverage audit
  ON audit.shadow_run_id = s.shadow_run_id
WHERE p.status = 'active'
GROUP BY
  p.policy_key,
  p.rollout_mode,
  p.mismatch_threshold_percent,
  p.critical_mismatch_threshold,
  p.p95_budget_ms,
  p.p99_budget_ms,
  p.audit_coverage_required_percent,
  p.minimum_sample_count;

INSERT INTO governed_migration_authorization_registry (
  migration_file, authorization_status, authorization_source, policy_key,
  risk_tier, requires_preflight, requires_confirmation,
  allow_record_only, allow_apply, notes, metadata_json
) VALUES (
  '20260715_dynamic_container_rollout_readiness_current_evidence.sql',
  'authorized',
  'migration_seed',
  'governed_migration_runner_authorization_v1',
  'medium',
  1,
  1,
  0,
  1,
  'Authorize current-evidence Dynamic Container rollout readiness views without deleting historical shadow or projection evidence.',
  JSON_OBJECT(
    'scope','dynamic_container_rollout_readiness_current_evidence',
    'latest_shadow_run_only',true,
    'latest_completed_projection_only',true,
    'active_relationships_only',true,
    'historical_evidence_preserved',true,
    'provider_calls',false,
    'external_writes',false,
    'credential_payload_reads',false,
    'enforcement',false,
    'secrets_included',false
  )
)
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status),
  authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key),
  risk_tier = VALUES(risk_tier),
  requires_preflight = VALUES(requires_preflight),
  requires_confirmation = VALUES(requires_confirmation),
  allow_record_only = VALUES(allow_record_only),
  allow_apply = VALUES(allow_apply),
  notes = VALUES(notes),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;
