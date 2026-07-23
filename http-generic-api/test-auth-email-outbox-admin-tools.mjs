import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("./routes/supportTicketRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/20260723_auth_email_outbox_admin_tools.sql", import.meta.url), "utf8");

for (const route of [
  "/admin/support/tickets/auth-email-outbox/status",
  "/admin/support/tickets/auth-email-outbox/dry-run",
  "/admin/support/tickets/auth-email-outbox/apply",
]) {
  assert(routes.includes(route), `support ticket routes must expose ${route}`);
  assert(migration.includes(route), `admin tool registry migration must expose ${route}`);
}

for (const toolKey of [
  "auth_email_outbox_status",
  "auth_email_outbox_dry_run",
  "auth_email_outbox_apply",
]) {
  assert(migration.includes(toolKey), `migration must register ${toolKey}`);
}

assert.match(routes, /getAuthEmailOutboxStatus/, "status route must call the service status function");
assert.match(routes, /runAuthEmailOutboxWorker/, "dry-run and apply routes must use the outbox worker service");
assert.match(routes, /dryRun:\s*true/, "dry-run route must never send");
assert.match(routes, /dryRun:\s*false/, "apply route must be explicit and service-gated");
assert.match(routes, /confirm:\s*req\.body\?\.confirm/, "apply route must forward typed confirmation");
assert.match(routes, /resource_authority:\s*"auth_email_outbox"/, "routes must return explicit resource authority evidence");

assert.match(migration, /admin_platform_endpoint_tools/i, "migration must register admin platform endpoint tools");
assert.match(migration, /read_only,dry_run,no_secrets/, "dry-run tool must be read-only and no-secrets tagged");
assert.match(migration, /mutation,external_delivery,approval_required,no_secrets/, "apply tool must be mutation and approval tagged");
assert.match(migration, /ON DUPLICATE KEY UPDATE/i, "migration must be idempotent");
assert.doesNotMatch(migration, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i, "migration must not be destructive");
assert.doesNotMatch(routes, /auth_email_outbox_worker/, "official routes must not depend on shell aliases");

console.log("auth email outbox admin tool registration tests passed");
