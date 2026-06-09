-- Sprint 68: Live checkout cleanup capability gate hardening (migration 256)
-- Scope: update admin tool contract and register policy for apply-mode capability envelope enforcement.
-- Additive/idempotent; no secrets.

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
  'Live Checkout Cleanup Requires Capability Envelope',
  JSON_OBJECT(
    'rule','live_checkout_cleanup_apply_requires_capability_envelope',
    'tool_key','live_checkout_cleanup',
    'runtime_surface','admin_control.shell.live_checkout_cleanup',
    'mode','apply',
    'dry_run_requires_capability_envelope',false,
    'apply_requires_capability_envelope',true,
    'accepted_app_keys',JSON_ARRAY('github'),
    'accepted_operation_intents',JSON_ARRAY('live_checkout_cleanup','live_checkout_cleanup_apply','repo_mutation','repo_patch_apply'),
    'requires_confirmation','APPLY_LIVE_CHECKOUT_CLEANUP',
    'allowed_paths',JSON_ARRAY('http-generic-api/test-tenant-gpt-customer-safe-resource-escalation.mjs'),
    'allowed_root_logs',JSON_ARRAY('console.log','stderr.log'),
    'delete_logs_requires_flag',true,
    'blocks_content_diffs',true,
    'audit_required',true,
    'secrets_included',false
  ),
  'TRUE',
  'admin_tool_dispatch,repository_maintenance,live_checkout_cleanup,capability_envelope',
  'adminCliRoutes,live-checkout-cleanup,capabilityResolutionEnvelopeGuard,execution_policies',
  'TRUE',
  'live_checkout_cleanup dry-run remains open for diagnostics; apply mode requires a ready capability envelope, explicit confirmation, allowlisted paths only, and no-secret audit evidence.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),
  active=VALUES(active),
  execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),
  blocking=VALUES(blocking),
  notes=VALUES(notes),
  updated_at=NOW();

UPDATE admin_platform_endpoint_tools
   SET description = 'Dry-run/apply cleanup for allowlisted live checkout drift. Dry-run is diagnostic; apply requires capability envelope, APPLY_LIVE_CHECKOUT_CLEANUP confirmation, allowlisted paths, and --delete-logs for root log deletion.',
       input_schema = JSON_OBJECT(
         'type','object',
         'properties',JSON_OBJECT(
           'tool',JSON_OBJECT('type','string','const','shell'),
           'action',JSON_OBJECT('type','string','const','run'),
           'alias',JSON_OBJECT('type','string','const','live_checkout_cleanup'),
           'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',18,'description','Use --dry-run or --apply. Optional repeated --path. Apply requires --capability-envelope-id=<uuid> and --confirm=APPLY_LIVE_CHECKOUT_CLEANUP. Root log deletion also requires --delete-logs.')
         ),
         'required',JSON_ARRAY('tool','action','alias'),
         'additionalProperties',false
       ),
       tags = 'admin,repo,live_checkout,cleanup,dry_run,guarded_apply,capability_envelope,no_secrets,allowlisted_paths,metadata_drift,eol_drift,root_logs',
       updated_at = NOW()
 WHERE tool_key = 'live_checkout_cleanup';
