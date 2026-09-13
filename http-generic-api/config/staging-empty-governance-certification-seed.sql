-- Empty local Staging Governance DB only. Independent same-cycle certification
-- is required before the provider apply capability can be dispatched.
INSERT INTO runtime_dispatch_certification_registry
(certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
 certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
 requires_resource_authority, requires_dry_run, requires_audit_evidence,
 requires_readback, last_evidence_ref, last_certified_at, expires_at, notes)
VALUES
('staging_activation_gateway_apply_v1', 'activation_gateway_dark_deploy',
 'cloudflare_worker', 'activation_gateway_dark_deploy', 'D', 'pending',
 'independent_same_cycle_staging_gateway_transaction_certification', 0, 0,
 1, 1, 1, 1, NULL, NULL, NULL,
 'Empty Staging schema bootstrap. No live provider execution or certification is authorized.');
