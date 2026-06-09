-- Sprint 68: Ads provider governance snapshot proposal surface.
--
-- Registers a proposal-only route/tool that derives a snapshot_candidate and
-- recommendation_candidate from existing governance ledgers and orchestration
-- readback. It does not write platform_orchestration_state_snapshots or
-- platform_orchestration_recommendations yet.
--
-- Idempotent. No provider calls, no credential payload reads, no spend changes,
-- no external writes, no deploy/publish, and no secrets.

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'ads_provider_governance_snapshot_proposal_policy_v1',
       JSON_OBJECT(
         'rule','ads_provider_governance_snapshot_proposal_only',
         'route','/platform/orchestration/ads-provider/snapshot-propose',
         'tool_key','ads_provider_governance_snapshot_propose',
         'writes_database',false,
         'produces',JSON_ARRAY('snapshot_candidate','recommendation_candidate'),
         'no_provider_call',true,
         'no_spend_change',true,
         'no_credential_payload_read',true,
         'no_external_write',true,
         'secrets_included',false
       ),
       'orchestration_intelligence|ads_provider_governance|snapshot_proposal|recommendation_proposal',
       'adsProviderGovernanceSnapshotProposal|platformPluginRoutes|admin_platform_endpoint_tools|platform_orchestration_*',
       'TRUE',
       'Proposal-only Ads Provider Governance snapshot/recommendation surface. No persistence or execution is performed.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='ads_provider_governance_snapshot_proposal_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'ads_provider_governance_snapshot_propose',
  'Ads Provider Governance Snapshot Propose',
  'Proposal-only snapshot and recommendation candidate generator for Ads Provider Governance. Defaults to google_ads and derives metadata from governance registries/ledgers. Does not write snapshots or recommendations, call providers, read credential payloads, mutate spend, deploy, publish, or return secrets.',
  'POST',
  '/platform/orchestration/ads-provider/snapshot-propose',
  NULL,
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'provider_key',JSON_OBJECT('type','string','default','google_ads')
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,orchestration_intelligence,ads_provider_governance,snapshot_proposal,recommendation_proposal,read_only,no_execution,no_secrets,no_provider_call,no_spend_change',
  1,
  641
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
