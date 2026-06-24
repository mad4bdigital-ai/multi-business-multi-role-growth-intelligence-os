-- Sprint 69: platform degradation prevention policies.
-- Additive and idempotent. No provider calls, external writes, or secrets.

INSERT INTO `execution_policies`
  (`policy_group`,`policy_key`,`policy_value`,`active`,`execution_scope`,`affects_layer`,`blocking`,`notes`)
VALUES
  ('Activation Guidance Governance','activation_guidance_admin_superset_v1',JSON_OBJECT(
    'admin_is_tenant_intelligence_superset',TRUE,
    'minimum_response_profile','evidence',
    'require_dynamic_tenant_snapshot',TRUE,
    'require_brand_snapshot',TRUE,
    'require_skill_coverage_summary',TRUE,
    'forbid_connection_only_healthy_classification',TRUE,
    'unavailable_metric_value',NULL,
    'secrets_included',FALSE
  ),'TRUE','activation|admin_gpt|tenant_gpt','activationGuidanceService|tenantActivationSnapshot|gpt_instructions','TRUE','Prevents Admin GPT from omitting tenant intelligence and prevents false healthy or false zero activation claims.'),
  ('OpenAPI Contract Governance','custom_gpt_schema_zero_warning_gate_v1',JSON_OBJECT(
    'openapi_version','3.1.0',
    'reject_empty_schema_nodes',TRUE,
    'reject_unresolved_refs',TRUE,
    'require_response_object_properties',TRUE,
    'require_split_schema_parity',TRUE,
    'builder_warning_budget',0,
    'secrets_included',FALSE
  ),'TRUE','openapi|custom_gpt_actions|release','openapi|split-openapi|ci','TRUE','Blocks generated Custom GPT schemas that produce Builder warnings or drift from canonical OpenAPI.'),
  ('Credential Intake Governance','credential_intake_render_preflight_v1',JSON_OBJECT(
    'require_page_render_preflight',TRUE,
    'revoke_superseded_pending_sessions',TRUE,
    'automatic_retry_limit_after_render_failure',0,
    'require_safe_failure_reference',TRUE,
    'forbid_secret_chat_fallback',TRUE,
    'secrets_included',FALSE
  ),'TRUE','credential_intake|tenant_connect|platform_plugins','credentialIntakeRoutes|tenantPlatformPluginRoutes','TRUE','Prevents repeated broken intake links and requires auditable safe failures.'),
  ('Session Continuity Governance','gpt_session_archive_continuity_v1',JSON_OBJECT(
    'prefer_explicit_session_pin',TRUE,
    'allow_latest_active_session_fallback',TRUE,
    'require_tool_turn_archive',TRUE,
    'warn_only_when_no_active_session_exists',TRUE,
    'secrets_included',FALSE
  ),'TRUE','gpt_tools|session_archive|activation','gptToolsRoutes|sessionArchiveService','TRUE','Prevents tool evidence loss when a newly activated session has no user or assistant turn yet.'),
  ('WordPress Runtime Governance','tenant_wordpress_draft_resolution_v1',JSON_OBJECT(
    'prefer_wordpress_rest_before_mcp_fallback',TRUE,
    'require_brand_authority',TRUE,
    'require_draft_authority',TRUE,
    'require_credential_validation',TRUE,
    'require_smoke_certification',TRUE,
    'require_capability_envelope',TRUE,
    'require_post_id_readback',TRUE,
    'forbid_metadata_only_connection_as_ready',TRUE,
    'secrets_included',FALSE
  ),'TRUE','tenant_wordpress|draft|publish','wordpressBlogPublishOrchestrator|platformPluginResolver|tenant_guidance','TRUE','Keeps WordPress draft resolution governed and prevents unvalidated MCP fallback.')
ON DUPLICATE KEY UPDATE
  `policy_value`=VALUES(`policy_value`),`active`=VALUES(`active`),`execution_scope`=VALUES(`execution_scope`),
  `affects_layer`=VALUES(`affects_layer`),`blocking`=VALUES(`blocking`),`notes`=VALUES(`notes`),`updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_runtime_config` (`config_key`,`config_json`,`status`,`note`)
VALUES ('platform_degradation_prevention_v1',JSON_OBJECT(
  'activation_contract_gate',TRUE,
  'custom_gpt_schema_warning_budget',0,
  'credential_intake_render_preflight',TRUE,
  'session_archive_fallback','latest_active_session',
  'runtime_false_healthy_prevention',TRUE,
  'unavailable_metric_value',NULL,
  'secrets_included',FALSE
),'active','Cross-surface runtime guardrails for activation, schemas, credential intake, session continuity, and WordPress readiness.')
ON DUPLICATE KEY UPDATE `config_json`=VALUES(`config_json`),`status`=VALUES(`status`),`note`=VALUES(`note`),`updated_at`=CURRENT_TIMESTAMP;
