-- Sprint 68: Workspace invitation control tenant tools

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
('workspace_invitation_revoke','Workspace Invitation Revoke','Owner/admin revokes a pending workspace invitation.','POST','/me/workspaces/{tenant_id}/invitations/{invitation_id}/revoke',JSON_ARRAY('tenant_id','invitation_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'invitation_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id','invitation_id'),'additionalProperties',false),NULL,'tenant,workspace,invitations,state_changing,no_secrets,owner_required',1,328),
('workspace_invitation_resend','Workspace Invitation Resend','Owner/admin regenerates a workspace invitation token and extends expiry.','POST','/me/workspaces/{tenant_id}/invitations/{invitation_id}/resend',JSON_ARRAY('tenant_id','invitation_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'invitation_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id','invitation_id'),'additionalProperties',false),NULL,'tenant,workspace,invitations,state_changing,no_secrets,owner_required,token_response',1,329),
('workspace_invitations_expire_stale','Workspace Invitations Expire Stale','Owner/admin marks expired pending workspace invitations as expired.','POST','/me/workspaces/{tenant_id}/invitations/expire-stale',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id'),'additionalProperties',false),NULL,'tenant,workspace,invitations,state_changing,no_secrets,owner_required',1,330)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
