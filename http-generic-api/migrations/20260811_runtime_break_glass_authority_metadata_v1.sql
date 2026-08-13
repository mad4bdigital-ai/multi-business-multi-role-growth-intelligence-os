-- Spec 018 / Runtime Break-Glass Governed Authority Metadata D03-D06
--
-- Registry-only source. Applying this migration is a separate governed action.
-- It does not create or expose a Hostinger mutation route, execute a provider
-- call, read credential payloads, mutate local/runtime files, or authorize an
-- existing capability envelope by itself.
--
-- Reuse boundary:
-- - app: remote_ssh_runtime
-- - capability umbrella: remote_ssh.exec_allowlisted (existing no-arbitrary-shell action)
-- - distinct runtime surface: runtime_break_glass_bounded_file_patch
-- - existing capability_resolution_envelope_ledger + supervisor approval +
--   capability_apply_authorization_policy_registry remain the authority chain.
--
-- Safety attestations:
-- no_provider_call
-- no_credential_payload_read
-- no_external_send
-- no_external_write
-- no_hostinger_runtime_mutation
-- no_protected_branch_write
-- no_unrestricted_shell
-- registry_source_only
-- secrets_included_false

INSERT INTO runtime_dispatch_certification_registry
  (certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
   certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
   requires_resource_authority, requires_dry_run, requires_audit_evidence,
   requires_readback, last_evidence_ref, notes)
VALUES
  ('runtime_break_glass_bounded_file_patch',
   'runtime_break_glass_bounded_file_patch',
   'remote_ssh_runtime',
   'remote_ssh.exec_allowlisted',
   'critical',
   'shadow_authority_registered',
   'critical_envelope_scope_then_approval',
   1,
   0,
   1,
   1,
   1,
   1,
   'spec018:D03-D06:authority-envelope-only',
   'Spec018 D01-D06 authority metadata only. Binds critical envelope issuance to the existing remote_ssh.exec_allowlisted no-arbitrary-shell umbrella and a distinct runtime_break_glass_bounded_file_patch surface. Runtime mutation/executor activation is not part of this migration.')
ON DUPLICATE KEY UPDATE
  surface_key = VALUES(surface_key),
  surface_family = VALUES(surface_family),
  tool_or_action_key = VALUES(tool_or_action_key),
  risk_class = VALUES(risk_class),
  certification_status = VALUES(certification_status),
  smoke_strategy = VALUES(smoke_strategy),
  dispatch_allowed = VALUES(dispatch_allowed),
  apply_allowed = VALUES(apply_allowed),
  requires_resource_authority = VALUES(requires_resource_authority),
  requires_dry_run = VALUES(requires_dry_run),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  last_evidence_ref = VALUES(last_evidence_ref),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO capability_apply_authorization_policy_registry
  (policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
   allow_external_write, allow_credential_binding, allow_no_credential_binding,
   requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
   requires_audit_evidence, requires_readback, requires_typed_confirmation,
   requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes)
VALUES
  ('runtime_break_glass_bounded_file_patch_apply_policy_v1',
   'remote_ssh_runtime',
   'remote_ssh.exec_allowlisted',
   'runtime_break_glass_bounded_file_patch',
   'runtime_break_glass_bounded_file_patch',
   'active',
   1,
   1,
   1,
   1,
   1,
   1,
   1,
   1,
   1,
   1,
   JSON_ARRAY('remote_dedicated_runtime','tenant_managed','workspace_owner_managed','platform_managed_fallback'),
   JSON_OBJECT(
     'contract','mad4b.runtime-break-glass.apply-authority.v1',
     'phase','D01-D06',
     'authority_mode','envelope_only_no_executor',
     'risk_class','critical',
     'exact_runtime_surface','runtime_break_glass_bounded_file_patch',
     'requires_scope_fingerprint',true,
     'requires_incident_expiry_within_envelope',true,
     'requires_exact_paths',true,
     'requires_pre_change_hashes',true,
     'requires_post_change_readback',true,
     'requires_runtime_verification_readback',true,
     'forbidden',JSON_ARRAY('freeform_shell','glob_scope','application_root_scope','caller_supplied_scope_fingerprint','runtime_mutation_route','provider_call_during_authorization','credential_payload_read'),
     'secrets_included',false
   ),
   'Apply authorization metadata for the D03-D06 shadow lifecycle only. This row does not expose or invoke a runtime mutation executor; authorization still requires ready_for_dispatch, zero gaps, supervisor approval, typed-confirmation policy, same-cycle dry-run policy, audit, and readback.')
ON DUPLICATE KEY UPDATE
  operation_intent = VALUES(operation_intent),
  status = VALUES(status),
  allow_external_write = VALUES(allow_external_write),
  allow_credential_binding = VALUES(allow_credential_binding),
  allow_no_credential_binding = VALUES(allow_no_credential_binding),
  requires_ready_for_dispatch = VALUES(requires_ready_for_dispatch),
  requires_dispatch_allowed = VALUES(requires_dispatch_allowed),
  requires_zero_blocking_gaps = VALUES(requires_zero_blocking_gaps),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  requires_typed_confirmation = VALUES(requires_typed_confirmation),
  requires_same_cycle_dry_run = VALUES(requires_same_cycle_dry_run),
  allowed_source_tiers_json = VALUES(allowed_source_tiers_json),
  policy_json = VALUES(policy_json),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
