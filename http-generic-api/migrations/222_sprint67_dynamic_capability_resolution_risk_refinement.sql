-- Sprint 67: Dynamic capability resolution risk-aware refinement.
-- Scope: runtime policy update only. Migration 221 is already applied and must
-- remain checksum-stable; this migration records the high-risk source priority
-- refinement without rewriting the applied migration.

UPDATE platform_runtime_config
   SET config_json = JSON_SET(
         config_json,
         '$.source_tier_priority_high_risk',
         JSON_ARRAY('client_dedicated','remote_dedicated_runtime','brand_managed','tenant_managed','workspace_owner_managed','freelancer_managed_service','agency_managed_service','local_device_runtime','user_owned_personal','platform_managed_fallback','blocked_requires_setup'),
         '$.low_risk_workspace_context_required',
         false,
         '$.risk_refinement_notes',
         'Critical/high-risk operations prefer client/remote dedicated authority before user-owned credentials. Low-risk reads may resolve without workspace context when tenant/app evidence is sufficient.'
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'dynamic_capability_resolution_policy_v1';
