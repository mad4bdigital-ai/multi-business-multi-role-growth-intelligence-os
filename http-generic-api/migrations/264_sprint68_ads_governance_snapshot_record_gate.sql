-- Sprint 68: Ads Provider Governance snapshot record gate.
--
-- Registers a gated persistence route for recording a recomputed proposal into
-- platform_orchestration_state_snapshots and platform_orchestration_recommendations.
-- Runtime must require candidate_sha256, idempotency_key, capability_envelope_id,
-- and apply=true before writing. The route recomputes the proposal before insert.
--
-- Idempotent registry/policy migration only. No destructive SQL. No provider calls,
-- no credential payload reads, no spend changes, no external writes, no deploy/publish,
-- and no secrets.

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'ads_provider_governance_snapshot_record_gate_policy_v1',
       JSON_OBJECT(
         'rule','ads_provider_governance_snapshot_record_gate',
         'route','/platform/orchestration/ads-provider/snapshot-record',
         'tool_key','ads_provider_governance_snapshot_record',
         'requires',JSON_ARRAY('candidate_sha256','idempotency_key','capability_envelope_id','apply_true','proposal_recomputed_same_cycle'),
         'writes_tables',JSON_ARRAY('platform_orchestration_state_snapshots','platform_orchestration_recommendations'),
         'idempotent_by','idempotency_key',
         'default_mode','record_dry_run',
         'no_provider_call',true,
         'no_spend_change',true,
         'no_credential_payload_read',true,
         'no_external_write',true,
         'secrets_included',false
       ),
       'orchestration_intelligence|ads_provider_governance|snapshot_record|recommendation_record',
       'adsProviderGovernanceSnapshotRecord|platformPluginRoutes|admin_platform_endpoint_tools|platform_orchestration_state_snapshots|platform_orchestration_recommendations',
       'TRUE',
       'Gated Ads Provider Governance snapshot/recommendation record route. Writes only after same-cycle proposal hash verification and ready capability envelope.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='ads_provider_governance_snapshot_record_gate_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'ads_provider_governance_snapshot_record',
  'Ads Provider Governance Snapshot Record',
  'Gated persistence route for Ads Provider Governance snapshot/recommendation candidates. Recomputes proposal and verifies candidate_sha256 before recording. Requires idempotency_key, capability_envelope_id, and apply=true. Does not call providers, read credential payloads, mutate spend, deploy, publish, or return secrets.',
  'POST',
  '/platform/orchestration/ads-provider/snapshot-record',
  NULL,
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('candidate_sha256','idempotency_key','capability_envelope_id'),
    'properties',JSON_OBJECT(
      'provider_key',JSON_OBJECT('type','string','default','google_ads'),
      'candidate_sha256',JSON_OBJECT('type','string','minLength',64,'maxLength',64),
      'idempotency_key',JSON_OBJECT('type','string','minLength',3,'maxLength',80),
      'capability_envelope_id',JSON_OBJECT('type','string','minLength',36,'maxLength',36),
      'apply',JSON_OBJECT('type','boolean','default',false)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,orchestration_intelligence,ads_provider_governance,snapshot_record,recommendation_record,gated_write,no_provider_call,no_spend_change,no_secrets',
  1,
  642
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
