-- Sprint 67: Workspace resource grant assignment tools
-- Owner/admin state-changing surfaces for assigning and revoking workspace resource grants.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
('workspace_resource_grant_create','Workspace Resource Grant Create','Owner/admin grants a scoped workspace resource permission to an active workspace member.','POST','/me/workspaces/{tenant_id}/resource-grants',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'grantee_user_id',JSON_OBJECT('type','string'),'resource_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('workspace','brand','site','app','asset','workflow','agent','vault')),'resource_ref',JSON_OBJECT('type','string'),'permission',JSON_OBJECT('type','string','enum',JSON_ARRAY('admin','manage','operate','edit','comment','view')),'expires_at',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id','grantee_user_id','resource_type'),'additionalProperties',false),NULL,'tenant,workspace,resource_grants,state_changing,no_secrets,owner_required',1,323),
('workspace_resource_grant_revoke','Workspace Resource Grant Revoke','Owner/admin revokes an active workspace resource grant.','POST','/me/workspaces/{tenant_id}/resource-grants/{grant_id}/revoke',JSON_ARRAY('tenant_id','grant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'grant_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id','grant_id'),'additionalProperties',false),NULL,'tenant,workspace,resource_grants,state_changing,no_secrets,owner_required',1,324)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
