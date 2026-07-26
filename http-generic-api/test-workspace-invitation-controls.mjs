import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("routes/tenantLifecycleRoutes.js", "utf8");
const migration = readFileSync("migrations/200_sprint68_workspace_invitation_control_tools.sql", "utf8");

assert(routeSource.includes('/me/workspaces/:tenant_id/invitations/:invitation_id/revoke'), "invitation revoke route must exist");
assert(routeSource.includes('/me/workspaces/:tenant_id/invitations/:invitation_id/resend'), "invitation resend route must exist");
assert(routeSource.includes('/me/workspaces/:tenant_id/invitations/expire-stale'), "expire stale invitations route must exist");
assert(routeSource.includes("workspace_invitation_revoke_failed"), "revoke route must use stable error code");
assert(routeSource.includes("workspace_invitation_resend_failed"), "resend route must use stable error code");
assert(routeSource.includes("workspace_invitations_expire_failed"), "expire route must use stable error code");
assert(routeSource.includes("status='revoked'"), "revoke route must mark invitations revoked");
assert(routeSource.includes("status IN ('pending','expired','revoked')"), "resend route must support pending/expired/revoked invitations only");
assert(routeSource.includes("expires_at=DATE_ADD(NOW(), INTERVAL 14 DAY)"), "resend route must extend invitation expiry");
assert(routeSource.includes("expires_at < NOW()"), "expire route must only expire stale invitations");
assert(routeSource.includes("requireWorkspaceOwner"), "invitation controls must be owner/admin gated");
assert(!routeSource.includes("encrypted_credentials"), "invitation controls must not expose credentials");

assert(migration.includes("workspace_invitation_revoke"), "revoke tool must be registered");
assert(migration.includes("workspace_invitation_resend"), "resend tool must be registered");
assert(migration.includes("workspace_invitations_expire_stale"), "expire stale tool must be registered");
assert(migration.includes("owner_required"), "invitation control tools must require owner/admin");
assert(migration.includes("state_changing") && migration.includes("no_secrets"), "invitation control tools must be state-changing no-secret surfaces");

console.log("workspace invitation control tests passed");
