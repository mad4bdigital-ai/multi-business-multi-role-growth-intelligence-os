-- Sprint 68: Live checkout cleanup capability gate (migration 255)
-- Scope: harden existing live_checkout_cleanup admin tool so apply mode requires a valid capability envelope.
-- Additive/idempotent, no secrets.

UPDATE admin_platform_endpoint_tools
   SET description = 'Dry-run/apply cleanup for allowlisted live checkout drift. Dry-run is read-only. Apply requires --confirm=APPLY_LIVE_CHECKOUT_CLEANUP and --capability-envelope-id for a valid GitHub/repo mutation capability envelope. Root log deletion also requires --delete-logs.',
       input_schema = JSON_OBJECT(
         'type','object',
         'properties',JSON_OBJECT(
           'tool',JSON_OBJECT('type','string','const','shell'),
           'action',JSON_OBJECT('type','string','const','run'),
           'alias',JSON_OBJECT('type','string','const','live_checkout_cleanup'),
           'extra_args',JSON_OBJECT(
             'type','array',
             'items',JSON_OBJECT('type','string'),
             'maxItems',18,
             'description','Use --dry-run or --apply. Optional repeated --path. Apply requires --confirm=APPLY_LIVE_CHECKOUT_CLEANUP and --capability-envelope-id=<uuid>. Root log deletion also requires --delete-logs.'
           )
         ),
         'required',JSON_ARRAY('tool','action','alias'),
         'additionalProperties',false
       ),
       tags = 'admin,repo,live_checkout,cleanup,dry_run,guarded_apply,capability_envelope,no_secrets,allowlisted_paths,metadata_drift,eol_drift,root_logs',
       updated_at = NOW()
 WHERE tool_key = 'live_checkout_cleanup';

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
  'Repository Mutation Governance',
  'Live Checkout Cleanup Capability Gate',
  JSON_OBJECT(
    'rule','live_checkout_cleanup_apply_requires_capability_envelope',
    'tool_key','live_checkout_cleanup',
    'script','http-generic-api/scripts/live-checkout-cleanup.mjs',
    'dry_run_requires_capability_envelope',false,
    'apply_requires_capability_envelope',true,
    'accepted_app_key','github',
    'accepted_operation_intents',JSON_ARRAY('live_checkout_cleanup','live_checkout_cleanup_apply','repo_mutation','repo_patch_apply'),
    'accepted_runtime_surfaces',JSON_ARRAY('live_checkout_cleanup','admin_control','repo_patch_apply'),
    'apply_requires_confirm','APPLY_LIVE_CHECKOUT_CLEANUP',
    'root_log_delete_requires_flag','--delete-logs',
    'allowlisted_paths',JSON_ARRAY('http-generic-api/test-tenant-gpt-customer-safe-resource-escalation.mjs','console.log','stderr.log'),
    'blocked_behaviors',JSON_ARRAY('arbitrary_path_cleanup','content_diff_restore','secret_env_access','unapproved_apply','root_log_delete_without_delete_logs'),
    'audit_contract',JSON_OBJECT(
      'apply_audit_required',true,
      'must_include',JSON_ARRAY('capability_envelope','paths_checked','applied_count','blocked_count','delete_logs'),
      'must_exclude',JSON_ARRAY('raw_secret','access_token','refresh_token','client_secret','password','private_key'),
      'secrets_included',false
    ),
    'secrets_included',false
  ),
  'TRUE',
  'admin_tool_dispatch,repository_checkout_cleanup,capability_envelope,local_checkout_maintenance',
  'adminCliRoutes,live-checkout-cleanup,admin_platform_endpoint_tools,execution_policies,capability_resolution_envelope_ledger',
  'TRUE',
  'Live checkout cleanup apply mode is a repo mutation surface and must require a valid GitHub/repo mutation capability envelope in addition to typed confirmation and path allowlists.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();
