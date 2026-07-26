-- Sprint 68: Governed live checkout cleanup tool.
-- Scope: admin-only local checkout cleanup dry-run/apply through shell alias.
-- Additive, idempotent, no secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'live_checkout_cleanup',
  'Live Checkout Cleanup',
  'Dry-run/apply cleanup for allowlisted live checkout drift. Compares working tree against HEAD, blocks content diffs, and can refresh metadata/eol drift for an allowlisted test file or delete explicitly allowlisted root log artifacts.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','live_checkout_cleanup'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',16,'description','Use --dry-run or --apply. Optional repeated --path. Apply requires --confirm=APPLY_LIVE_CHECKOUT_CLEANUP. Root log deletion also requires --delete-logs.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,repo,live_checkout,cleanup,dry_run,guarded_apply,no_secrets,allowlisted_paths,metadata_drift,eol_drift,root_logs',
  1,
  445
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys),
  input_schema=VALUES(input_schema),
  tags=VALUES(tags),
  is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order);
