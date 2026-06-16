-- Sprint 69: governed database lifecycle registry upsert admin tool.
-- Missing-only is the default selection mode. Existing rows require both
-- --include-existing and the separate refresh confirmation token.
-- The runner performs no drop, delete, archive, truncate, or compaction.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'database_table_lifecycle_registry_upsert',
  'Database Table Lifecycle Registry Upsert',
  'Dry-run or confirmation-gated lifecycle metadata upsert. Defaults to missing tables only and performs same-cycle missing-row readback. Existing-row refresh requires a separate confirmation. No drop, delete, archive, truncate, compaction, or secret access.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','database_table_lifecycle_registry_upsert'),
      'extra_args',JSON_OBJECT(
        'type','array',
        'items',JSON_OBJECT('type','string'),
        'maxItems',6,
        'description','Allowed flags: --dry-run, --apply, --limit N, --confirm APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_UPSERT. Existing-row refresh additionally requires --include-existing and APPLY_DATABASE_TABLE_LIFECYCLE_REGISTRY_REFRESH_EXISTING.'
      )
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,database_lifecycle,registry_upsert,state_changing,dry_run_default,typed_confirmation,transaction,readback,no_drop,no_delete,no_archive_execution,no_compaction_execution,no_secrets',
  1,
  340
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
