-- Sprint 68 finalization: Admin workspace authority reconciliation and repair tools

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
('admin_workspace_authority_reconciliation','Admin Workspace Authority Reconciliation','Read workspace authority reconciliation summary and optional details.','GET','/admin/workspace-authority/reconciliation',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('include_details',JSON_OBJECT('type','boolean'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',200)),'additionalProperties',false),NULL,'admin,workspace,authority,reconciliation,read_only,no_secrets',1,620),
('admin_workspace_authority_repair','Admin Workspace Authority Repair','Run governed workspace authority auto-healing against reconciliation views. Defaults to dry_run unless dry_run=false.','POST','/admin/workspace-authority/repair',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('dry_run',JSON_OBJECT('type','boolean')),'additionalProperties',false),NULL,'admin,workspace,authority,repair,state_changing,no_secrets,dry_run_default',1,621)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
