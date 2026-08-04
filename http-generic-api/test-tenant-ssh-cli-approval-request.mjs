import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const migration = readFileSync("migrations/200_sprint66_tenant_ssh_cli_approval_request_tool.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(routes.includes('randomUUID'), "approval requests must use generated UUID identifiers");
assert(routes.includes('/me/infrastructure/ssh/connections/:connection_id/cli/approval-request'), "explicit SSH CLI approval request route must exist");
assert(routes.includes('loadTenantConnection(pool, req, connectionId, "ssh_key_pair")'), "approval request must load tenant-scoped SSH connection");
assert(routes.includes('readinessFor(row, "ssh_key_pair")'), "approval request must enforce readiness");
assert(routes.includes('buildSshCliDryRunPlan'), "approval request must reuse allowlisted dry-run validation");
assert(routes.includes('createSshCliApprovalRequest'), "approval request must persist a reviewable request");
assert(routes.includes('tenant_ssh_cli_approval_requests'), "approval request must write the dedicated approval table");
assert(routes.includes('approval_holds'), "approval request must create a platform approval hold");
assert(routes.includes('execution_context_json'), "approval request hold must write execution context JSON");
assert(routes.includes('tenant_ssh_cli_approval_requests'), "approval hold context must identify tenant SSH approval request as parent");
assert(routes.includes('resolved_parent_reference'), "approval hold context must classify the parent relationship as resolved");
assert(routes.includes('supervisor_approval'), "approval request must require supervisor/workspace approval");
assert(routes.includes('workspace_owner'), "approval request must require workspace owner role");
assert(routes.includes('execution_enabled: false'), "approval request must not enable execution");
assert(routes.includes('approval_decision_required_before_execute'), "approval request must identify gated future execution");
assert(routes.includes('approval_decision_required_before_execute'), "approval request must still hand off to approval decision before execute");
assert(!migration.includes('tenant_ssh_cli_allowlisted_execute'), "approval request migration must not register an execute tool");
assert(routes.includes('secrets_included: false'), "approval request must never return secrets");

assert(migration.includes('CREATE TABLE IF NOT EXISTS tenant_ssh_cli_approval_requests'), "migration must create approval request table idempotently");
assert(migration.includes('command_argv_json JSON NOT NULL'), "approval table must store argv as JSON, not freeform command text");
assert(migration.includes('tenant_ssh_cli_approval_request_create'), "migration must register approval request tenant tool");
assert(migration.includes('/me/infrastructure/ssh/connections/{connection_id}/cli/approval-request'), "migration must use explicit approval request path");
assert(migration.includes('no_execute'), "migration tags must disclose no execution");
assert(migration.includes('no_command'), "migration tags must disclose no command execution");
assert(migration.includes('no_network'), "migration tags must disclose no network connection");
assert(migration.includes('no_auth'), "migration tags must disclose no auth");
assert(migration.includes('no_secrets'), "migration tags must include no_secrets");
assert(runner.includes('"200_sprint66_tenant_ssh_cli_approval_request_tool.sql"'), "governed migration runner must allowlist migration 200");
assert(openapi.includes('/me/infrastructure/ssh/connections/{connection_id}/cli/approval-request'), "OpenAPI must document tenant SSH CLI approval request endpoint");
assert(openapi.includes('tenantSshCliApprovalRequestCreate'), "OpenAPI must expose a stable operationId for SSH CLI approval request");
assert(openapi.includes('Does not authenticate, open a network connection, execute commands'), "OpenAPI must document no-auth/no-network/no-command scope");

console.log("Tenant SSH CLI approval request guard passed");
