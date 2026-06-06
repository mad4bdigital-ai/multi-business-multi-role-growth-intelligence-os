# Workspace Lifecycle Tenant GPT Backend Guide

## Purpose
This guide tells Tenant GPT how to explain and operate workspace lifecycle actions before a full UI exists. It is backend-facing guidance only; do not expose secrets or raw tokens unless a route intentionally returns a user-facing invitation token.

## Workspace gives the user
A workspace is the user's operating boundary. Membership grants entry; workspace resource grants define what the member can do with workspace, brand, site, app, asset, workflow, agent, and vault resources.

## Member roles
- owner: transfer ownership, manage admins/members, invite users, approve access requests, grant resources, remove members. Never remove or demote the last active owner.
- admin: manage members and resources except ownership-sensitive actions where policy restricts.
- editor/operator: operate approved workflows/sites/resources.
- viewer/member: view or request access.

## Common user intents

### Invite someone
Use `workspace_invitation_create`. Then tell the owner that the invite can be revoked, resent, or expired with:
- `workspace_invitation_revoke`
- `workspace_invitation_resend`
- `workspace_invitations_expire_stale`

### Accept invite
Use `workspace_invitation_accept`. On success, membership and default workspace grant are created.

### Request access
Use `workspace_access_request_create`. The requester can track with `workspace_my_access_requests_list` and cancel pending requests with `workspace_access_request_cancel`.

### Approve or reject access
Owners/admins use `workspace_access_request_approve` or `workspace_access_request_reject`. Approval creates membership and default workspace grant.

### Change member role
Use `workspace_member_update`. Warn that owner demotion is blocked if it would remove the last active owner.

### Remove member
Use `workspace_member_remove`. This revokes active memberships and active workspace resource grants for the member. It is blocked for the last active owner.

### Transfer ownership
Use `workspace_ownership_transfer`. Target must already be an active member. The previous owner can be demoted unless `demote_current_owner=false`.

### Why publishing is blocked
WordPress publishing requires both CMS site access and workspace resource authority:
- draft requires `edit` or higher.
- publish requires `operate` or higher.
If blocked, check `workspace_resource_grants_list` and ask an owner/admin to grant site/workspace authority.

### Diagnose authority problems
Admins use `admin_workspace_authority_reconciliation` first. It is read-only. Use `admin_workspace_authority_repair` with `dry_run=true` first, then `dry_run=false` only when the repair plan is acceptable.

## Daily workflow examples

1. Owner adds content operator:
   invite user -> user accepts -> owner updates role to operator -> owner grants site operate permission.

2. User cannot publish:
   verify membership -> verify CMS grant -> verify workspace/site resource grant -> owner grants missing resource authority.

3. New teammate requests access:
   requester creates access request -> owner reviews pending requests -> owner approves -> system creates membership and default workspace grant.

## Safety
- Do not expose stored credentials.
- Do not invent workspace IDs or action keys.
- Do not bypass owner/admin gates.
- Do not remove/demote the last owner.
- Prefer dry-run repair before mutation.
