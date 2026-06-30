-- Spec Kit 006 implementation slice 4: Authority Scope shadow readiness.
-- Additive read-only views only. Existing rollout views and policy rows remain unchanged.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

CREATE OR REPLACE VIEW `v_authority_scope_shadow_summary` AS
SELECT
  COUNT(*) AS sample_count,
  SUM(comparison_status='match') AS match_count,
  SUM(comparison_status='mismatch') AS mismatch_count,
  SUM(comparison_status='unresolved') AS unresolved_count,
  SUM(comparison_status IN ('match','mismatch')) AS comparable_sample_count,
  ROUND(
    100.0 * SUM(comparison_status='mismatch') /
    NULLIF(SUM(comparison_status IN ('match','mismatch')),0),
    4
  ) AS mismatch_percent,
  MAX(created_at) AS last_observed_at,
  0 AS secrets_included
FROM authority_scope_shadow_evidence;

CREATE OR REPLACE VIEW `v_container_rollout_readiness_v2` AS
SELECT
  r.policy_key,
  r.rollout_mode,
  r.mismatch_threshold_percent,
  r.critical_mismatch_threshold,
  r.p95_budget_ms,
  r.p99_budget_ms,
  r.audit_coverage_required_percent,
  r.minimum_sample_count,
  r.comparison_sample_count,
  r.mismatch_count,
  r.critical_mismatch_count,
  r.maximum_mismatch_percent,
  r.performance_sample_count,
  r.p95_latency_ms,
  r.p99_latency_ms,
  r.audit_sample_count,
  r.audited_sample_count,
  r.audit_coverage_percent,
  r.relationship_issue_count,
  r.high_risk_projection_issue_count,
  r.enforcement_requested,
  r.readiness_code AS base_readiness_code,
  COALESCE(s.sample_count,0) AS authority_scope_sample_count,
  COALESCE(s.match_count,0) AS authority_scope_match_count,
  COALESCE(s.mismatch_count,0) AS authority_scope_mismatch_count,
  COALESCE(s.unresolved_count,0) AS authority_scope_unresolved_count,
  COALESCE(s.comparable_sample_count,0) AS authority_scope_comparable_sample_count,
  COALESCE(s.mismatch_percent,0) AS authority_scope_mismatch_percent,
  s.last_observed_at AS authority_scope_last_observed_at,
  CASE
    WHEN r.readiness_code<>'ready_for_review' THEN r.readiness_code
    WHEN COALESCE(s.sample_count,0)<r.minimum_sample_count THEN 'authority_scope_insufficient_samples'
    WHEN COALESCE(s.unresolved_count,0)>0 THEN 'authority_scope_unresolved_present'
    WHEN COALESCE(s.mismatch_percent,0)>r.mismatch_threshold_percent THEN 'authority_scope_mismatch_threshold_exceeded'
    ELSE 'ready_for_review'
  END AS readiness_code,
  0 AS secrets_included
FROM v_container_rollout_readiness r
LEFT JOIN v_authority_scope_shadow_summary s ON 1=1;
