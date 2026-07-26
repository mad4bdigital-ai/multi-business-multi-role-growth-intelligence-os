-- Sprint 68: Workspace access request self-service tenant tools

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
('workspace_my_access_requests_list','Workspace My Access Requests List','List access requests submitted by the signed-in user.','GET','/me/access-requests',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('status',JSON_OBJECT('type','string','enum',JSON_ARRAY('all','pending','approved','rejected','cancelled'))),'additionalProperties',false),NULL,'tenant,workspace,access_requests,read_only,no_secrets,self_service',1,331),
('workspace_access_request_cancel','Workspace Access Request Cancel','Signed-in requester cancels their own pending workspace access request.','POST','/me/workspaces/{tenant_id}/access-requests/{request_id}/cancel',JSON_ARRAY('tenant_id','request_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'request_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id','request_id'),'additionalProperties',false),NULL,'tenant,workspace,access_requests,state_changing,no_secrets,self_service,requester_only',1,332)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
