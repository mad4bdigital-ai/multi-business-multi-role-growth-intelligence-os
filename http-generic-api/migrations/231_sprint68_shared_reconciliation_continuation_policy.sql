-- Sprint 68: Shared reconciliation continuation policy
-- Generalizes interruption recovery for admin, tenant, user, and local/device flows.
-- Pattern: checkpoint -> detect drift -> classify risk -> dry-run repair -> verify -> apply -> audit -> resume.

INSERT INTO execution_policies (
  policy_group,
  policy_key,
  policy_value,
  active,
  execution_scope,
  affects_layer,
  blocking,
  notes
) VALUES (
  'Shared Reconciliation Governance',
  'Shared Reconciliation Engine Continuation Contract',
  JSON_OBJECT(
    'rule','shared_reconciliation_engine_continuation_contract',
    'engine_key','shared_reconciliation_continuation_v1',
    'actor_scopes',JSON_OBJECT(
      'admin','platform-wide authority, including repository and deployment adapters',
      'tenant','tenant-scoped resources only; no platform repository mutation',
      'user','own tenant/user resources only',
      'local_device','device-scoped allowlisted resources only'
    ),
    'resource_scope_boundaries',JSON_ARRAY(
      'platform_requires_admin_or_system',
      'tenant_actor_must_match_tenant_id',
      'user_actor_must_match_user_id',
      'local_device_actor_must_match_device_id',
      'tenant_user_cannot_reconcile_repository_or_platform_scope'
    ),
    'generalized_interruption_signals',JSON_ARRAY(
      'tool_time_exhausted',
      'session_expired',
      'transport_timeout',
      'connector_unavailable',
      'branch_diverged',
      'deploy_reload_pending',
      'fallback_unsupported_command',
      'credential_intake_required',
      'approval_required'
    ),
    'required_sequence',JSON_ARRAY(
      'continuation_checkpoint_required',
      'detect_drift',
      'classify_risk',
      'dry_run_repair',
      'verify',
      'apply_repair',
      'audit',
      'resume_original_operation'
    ),
    'checkpoint_contract',JSON_OBJECT(
      'requires_reconciliation_before_resume',true,
      'must_include',JSON_ARRAY('operation_key','actor_scope','resource_scope','resource_fingerprint','current_stage','interruption_signal','resume_metadata'),
      'must_exclude',JSON_ARRAY('raw_secret','access_token','refresh_token','client_secret','password','private_key'),
      'secrets_included',false
    ),
    'adapter_examples',JSON_ARRAY(
      'git_branch_reconciliation_adapter',
      'workspace_authority_reconciliation_adapter',
      'credential_intake_resume_adapter',
      'connector_capability_repair_adapter',
      'deployment_reload_reconciliation_adapter',
      'job_resume_refetch_adapter'
    ),
    'apply_gate',JSON_OBJECT(
      'direct_resume_allowed_when','resource_fingerprint_unchanged',
      'drift_resume_requires',JSON_ARRAY('dry_run_repair_ok','verify_ok','scope_rechecked','audit_payload_ready'),
      'unsafe_states',JSON_ARRAY('missing_checkpoint','scope_mismatch','dirty_unbounded_state','conflict_without_safe_resolution','secret_material_in_checkpoint')
    )
  ),
  'TRUE',
  'admin_tool_dispatch,tenant_tool_dispatch,user_action_dispatch,device_tool_dispatch,connector_dispatch,job_runner,repository_maintenance,deployment_maintenance',
  'sharedReconciliationEngine,repo_patch_apply,admin_branch_reconcile,workspace_authority,credential_intake,connector_capability_repair,hostinger_deploy_reload,execution_jobs',
  'TRUE',
  'Every resumable governed operation must persist a no-secret continuation checkpoint and run reconciliation before resuming after interruption or drift.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
