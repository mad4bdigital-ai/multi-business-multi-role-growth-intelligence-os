-- Sprint 66: Workspace lifecycle foundation
-- Adds owner invitations, access requests, and tenant-facing tools.

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS created_by varchar(36) NULL AFTER status,
  ADD COLUMN IF NOT EXISTS accepted_by varchar(36) NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS revoked_by varchar(36) NULL AFTER accepted_by,
  ADD COLUMN IF NOT EXISTS accepted_at datetime NULL AFTER revoked_by,
  ADD COLUMN IF NOT EXISTS revoked_at datetime NULL AFTER accepted_at,
  ADD COLUMN IF NOT EXISTS metadata_json longtext NULL AFTER revoked_at;

CREATE TABLE IF NOT EXISTS workspace_access_requests (
  request_id varchar(36) NOT NULL PRIMARY KEY,
  tenant_id varchar(36) NOT NULL,
  requester_user_id varchar(36) NOT NULL,
  requester_email varchar(255) NOT NULL,
  requested_role varchar(64) NOT NULL DEFAULT 'member',
  status enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  reason text NULL,
  reviewed_by varchar(36) NULL,
  reviewed_at datetime NULL,
  metadata_json longtext NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  UNIQUE KEY uq_workspace_access_pending (tenant_id, requester_user_id, status),
  KEY idx_workspace_access_tenant_status (tenant_id, status),
  KEY idx_workspace_access_requester (requester_user_id),
  KEY idx_workspace_access_reviewed_by (reviewed_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
('workspace_members_list','Workspace Members List','List members in a workspace when the signed-in user is an active member.','GET','/me/workspaces/{tenant_id}/members',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id'),'additionalProperties',false),NULL,'tenant,workspace,members,read_only,no_secrets',1,300),
('workspace_invitation_create','Workspace Invitation Create','Owner/admin creates a pending invitation for a workspace member.','POST','/me/workspaces/{tenant_id}/invitations',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'email',JSON_OBJECT('type','string'),'role',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id','email'),'additionalProperties',false),NULL,'tenant,workspace,invitations,state_changing,no_secrets',1,301),
('workspace_invitations_list','Workspace Invitations List','Owner/admin lists workspace invitations.','GET','/me/workspaces/{tenant_id}/invitations',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'status',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id'),'additionalProperties',false),NULL,'tenant,workspace,invitations,read_only,no_secrets',1,302),
('workspace_invitation_accept','Workspace Invitation Accept','Signed-in user accepts a pending invitation matching their email.','POST','/me/invitations/accept',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('token',JSON_OBJECT('type','string')),'required',JSON_ARRAY('token'),'additionalProperties',false),NULL,'tenant,workspace,invitations,state_changing,no_secrets',1,303),
('workspace_access_request_create','Workspace Access Request Create','Signed-in user requests access to a workspace.','POST','/me/workspaces/{tenant_id}/access-requests',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'requested_role',JSON_OBJECT('type','string'),'reason',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id'),'additionalProperties',false),NULL,'tenant,workspace,access_requests,state_changing,no_secrets',1,304),
('workspace_access_requests_list','Workspace Access Requests List','Owner/admin lists workspace access requests.','GET','/me/workspaces/{tenant_id}/access-requests',JSON_ARRAY('tenant_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'status',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id'),'additionalProperties',false),NULL,'tenant,workspace,access_requests,read_only,no_secrets',1,305),
('workspace_access_request_approve','Workspace Access Request Approve','Owner/admin approves a pending workspace access request and creates membership.','POST','/me/workspaces/{tenant_id}/access-requests/{request_id}/approve',JSON_ARRAY('tenant_id','request_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'request_id',JSON_OBJECT('type','string'),'role',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id','request_id'),'additionalProperties',false),NULL,'tenant,workspace,access_requests,state_changing,no_secrets',1,306),
('workspace_access_request_reject','Workspace Access Request Reject','Owner/admin rejects a pending workspace access request.','POST','/me/workspaces/{tenant_id}/access-requests/{request_id}/reject',JSON_ARRAY('tenant_id','request_id'),JSON_OBJECT('type','object','properties',JSON_OBJECT('tenant_id',JSON_OBJECT('type','string'),'request_id',JSON_OBJECT('type','string'),'reason',JSON_OBJECT('type','string')),'required',JSON_ARRAY('tenant_id','request_id'),'additionalProperties',false),NULL,'tenant,workspace,access_requests,state_changing,no_secrets',1,307)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);
