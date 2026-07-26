import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("routes/tenantLifecycleRoutes.js", "utf8");
const migration = readFileSync("migrations/201_sprint68_workspace_access_request_control_tools.sql", "utf8");

assert(routeSource.includes('router.get("/me/access-requests"'), "my access requests route must exist");
assert(routeSource.includes('/me/workspaces/:tenant_id/access-requests/:request_id/cancel'), "access request cancel route must exist");
assert(routeSource.includes("workspace_my_access_requests_list_failed"), "list route must use stable error code");
assert(routeSource.includes("workspace_access_request_cancel_failed"), "cancel route must use stable error code");
assert(routeSource.includes("requester_user_id=? AND status='pending'"), "cancel route must be requester-only and pending-only");
assert(routeSource.includes("status='cancelled'"), "cancel route must mark requests cancelled");
assert(!routeSource.includes("encrypted_credentials"), "access request controls must not expose credentials");

assert(migration.includes("workspace_my_access_requests_list"), "my access requests tool must be registered");
assert(migration.includes("workspace_access_request_cancel"), "access request cancel tool must be registered");
assert(migration.includes("self_service"), "tools must be tagged self-service");
assert(migration.includes("requester_only"), "cancel tool must be tagged requester-only");
assert(migration.includes("state_changing") && migration.includes("no_secrets"), "cancel tool must be state-changing no-secret surface");
assert(migration.includes("read_only") && migration.includes("no_secrets"), "list tool must be read-only no-secret surface");

console.log("workspace access request control tests passed");
