-- Sprint 68: Workspace ownership and member control tenant tools

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
('workspace_member_update','Workspace Member Update','Owner/admin updates a workspace member role with last-owner safeguards.','PATCH','/me/workspaces/{tenant_id}/members/{user_id}',JSON_ARRAY('tenant_id','user_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'user_id',JSON_OBJECT('type','string'),'role',JSON_OBJECT('type','string','enum',JSON_ARRAY('owner','admin','editor','operator','viewer','member'))),'required',JSON_ARRAY('tenant_id','user_id','role'),'additionalProperties',false),NULL,'tenant,workspace,members,state_changing,no_secrets,owner_required,last_owner_guard',1,325),
('workspace_member_remove','Workspace Member Remove','Owner/admin revokes a workspace member and active resource grants with last-owner safeguards.','POST','/me/workspaces/{tenant_id}/members/{user_id}/remove',JSON_ARRAY('tenant_id','user_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'user_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id','user_id'),'additionalProperties',false),NULL,'tenant,workspace,members,state_changing,no_secrets,owner_required,last_owner_guard',1,326),
('workspace_ownership_transfer','Workspace Ownership Transfer','Owner/admin promotes an active member to owner and optionally demotes the current owner.','POST','/me/workspaces/{tenant_id}/ownership/transfer',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'target_user_id',JSON_OBJECT('type','string'),'demote_current_owner',JSON_OBJECT('type','boolean')),'required',JSON_ARRAY('tenant_id','target_user_id'),'additionalProperties',false),NULL,'tenant,workspace,ownership,state_changing,no_secrets,owner_required,last_owner_guard',1,327)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
