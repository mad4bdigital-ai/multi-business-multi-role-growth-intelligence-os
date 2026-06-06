import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const migration = readFileSync("migrations/201_sprint66_tenant_ssh_cli_approval_decision_tools.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(routes.includes('/me/infrastructure/ssh/cli/approval-requests/:request_id'), "approval status route must exist");
assert(routes.includes('/me/infrastructure/ssh/cli/approval-requests/:request_id/decision'), "approval decision route must exist");
assert(routes.includes('loadSshCliApprovalRequest'), "approval routes must load tenant-scoped approval requests");
assert(routes.includes('WHERE r.request_id = ? AND r.tenant_id = ?'), "approval readback must scope by tenant_id");
assert(routes.includes('assertWorkspaceApprovalRole'), "approval decisions must enforce workspace approval role");
assert(routes.includes('memberships WHERE tenant_id = ? AND user_id = ?'), "approval decisions must verify tenant membership");
assert(routes.includes('["owner", "workspace_owner", "admin"].includes(role)'), "approval decisions must restrict allowed approver roles");
assert(routes.includes('normalizeApprovalDecision'), "approval decisions must validate decision enum");
assert(routes.includes('decision must be approved or rejected'), "approval decisions must reject invalid decisions");
assert(routes.includes('UPDATE tenant_ssh_cli_approval_requests'), "approval decision must update approval request state");
assert(routes.includes('UPDATE approval_holds'), "approval decision must update linked platform hold state");
assert(routes.includes("AND status = 'open'"), "approval decision must only update open requests/holds");
assert(routes.includes('execute_tool_enabled: false'), "approval decision must not enable execute tool");
assert(routes.includes('execution_enabled: false'), "approval decision responses must keep execution disabled");
assert(!routes.includes('/cli/execute'), "SSH CLI execute route must not exist in decision phase");
assert(!migration.includes('tenant_ssh_cli_allowlisted_execute'), "decision migration must not register an execute tool");
assert(routes.includes('secrets_included: false'), "approval status/decision must never return secrets");

assert(migration.includes('tenant_ssh_cli_approval_request_status'), "migration must register approval status tool");
assert(migration.includes('tenant_ssh_cli_approval_request_decide'), "migration must register approval decision tool");
assert(migration.includes('/me/infrastructure/ssh/cli/approval-requests/{request_id}'), "migration must use explicit status path");
assert(migration.includes('/me/infrastructure/ssh/cli/approval-requests/{request_id}/decision'), "migration must use explicit decision path");
assert(migration.includes('workspace_owner_required'), "decision tool tags must require workspace owner");
assert(migration.includes('state_changing'), "decision tool tags must disclose state change");
assert(migration.includes('no_execute'), "migration tags must disclose no execution");
assert(migration.includes('no_command'), "migration tags must disclose no command execution");
assert(migration.includes('no_network'), "migration tags must disclose no network connection");
assert(migration.includes('no_auth'), "migration tags must disclose no auth");
assert(migration.includes('no_secrets'), "migration tags must include no_secrets");
assert(runner.includes('"201_sprint66_tenant_ssh_cli_approval_decision_tools.sql"'), "governed migration runner must allowlist migration 201");
assert(openapi.includes('/me/infrastructure/ssh/cli/approval-requests/{request_id}'), "OpenAPI must document approval status endpoint");
assert(openapi.includes('/me/infrastructure/ssh/cli/approval-requests/{request_id}/decision'), "OpenAPI must document approval decision endpoint");
assert(openapi.includes('tenantSshCliApprovalRequestStatus'), "OpenAPI must expose status operationId");
assert(openapi.includes('tenantSshCliApprovalRequestDecide'), "OpenAPI must expose decision operationId");
assert(openapi.includes('does not authenticate, open a network connection, execute commands, or enable execution'), "OpenAPI must document no-auth/no-network/no-command/no-execute scope");

console.log("Tenant SSH CLI approval decision guard passed");
