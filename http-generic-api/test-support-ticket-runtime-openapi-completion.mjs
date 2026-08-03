#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routesSource = readFileSync('routes/supportTicketRoutes.js', 'utf8');
const registry = readFileSync('openapi-route-contracts.yaml', 'utf8');
const contract = readFileSync('openapi/support-ticket-runtime-completion.yaml', 'utf8');

const contracts = [
  {
    "method": "get",
    "expressPath": "/admin/tenant-requests",
    "signature": "GET /admin/tenant-requests",
    "pathItem": "listAdminTenantRequests",
    "operationId": "listAdminTenantRequests",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "get",
    "expressPath": "/admin/tenant-requests/:ticketId",
    "signature": "GET /admin/tenant-requests/{ticketId}",
    "pathItem": "getAdminTenantRequest",
    "operationId": "getAdminTenantRequest",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "get",
    "expressPath": "/tenants/:tenantId/requests",
    "signature": "GET /tenants/{tenantId}/requests",
    "pathItem": "listTenantRequests",
    "operationId": "listTenantRequests",
    "exposure": "tenant_user",
    "consequential": false
  },
  {
    "method": "get",
    "expressPath": "/tenants/:tenantId/requests/:ticketId",
    "signature": "GET /tenants/{tenantId}/requests/{ticketId}",
    "pathItem": "getTenantRequest",
    "operationId": "getTenantRequest",
    "exposure": "tenant_user",
    "consequential": false
  },
  {
    "method": "get",
    "expressPath": "/admin/support/tickets/auth-email-outbox/status",
    "signature": "GET /admin/support/tickets/auth-email-outbox/status",
    "pathItem": "getAdminSupportTicketAuthEmailOutboxStatus",
    "operationId": "getAdminSupportTicketAuthEmailOutboxStatus",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/auth-email-outbox/dry-run",
    "signature": "POST /admin/support/tickets/auth-email-outbox/dry-run",
    "pathItem": "dryRunAdminSupportTicketAuthEmailOutbox",
    "operationId": "dryRunAdminSupportTicketAuthEmailOutbox",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/auth-email-outbox/skip-ineligible",
    "signature": "POST /admin/support/tickets/auth-email-outbox/skip-ineligible",
    "pathItem": "skipIneligibleAdminSupportTicketAuthEmailOutbox",
    "operationId": "skipIneligibleAdminSupportTicketAuthEmailOutbox",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/auth-email-outbox/apply",
    "signature": "POST /admin/support/tickets/auth-email-outbox/apply",
    "pathItem": "applyAdminSupportTicketAuthEmailOutbox",
    "operationId": "applyAdminSupportTicketAuthEmailOutbox",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "get",
    "expressPath": "/admin/support/tickets/external-delivery/control/overview",
    "signature": "GET /admin/support/tickets/external-delivery/control/overview",
    "pathItem": "getAdminSupportTicketExternalDeliveryControlOverview",
    "operationId": "getAdminSupportTicketExternalDeliveryControlOverview",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-delivery/control/allowlist/upsert",
    "signature": "POST /admin/support/tickets/external-delivery/control/allowlist/upsert",
    "pathItem": "upsertAdminSupportTicketExternalDeliveryAllowlist",
    "operationId": "upsertAdminSupportTicketExternalDeliveryAllowlist",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-delivery/control/allowlist/disable",
    "signature": "POST /admin/support/tickets/external-delivery/control/allowlist/disable",
    "pathItem": "disableAdminSupportTicketExternalDeliveryAllowlist",
    "operationId": "disableAdminSupportTicketExternalDeliveryAllowlist",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-delivery/control/adapter/dispatch",
    "signature": "POST /admin/support/tickets/external-delivery/control/adapter/dispatch",
    "pathItem": "setAdminSupportTicketExternalDeliveryAdapterDispatch",
    "operationId": "setAdminSupportTicketExternalDeliveryAdapterDispatch",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-delivery/control/gmail/revoke",
    "signature": "POST /admin/support/tickets/external-delivery/control/gmail/revoke",
    "pathItem": "revokeAdminSupportTicketExternalDeliveryGmailConnection",
    "operationId": "revokeAdminSupportTicketExternalDeliveryGmailConnection",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/tenant-user/create-simulation",
    "signature": "POST /admin/support/tickets/tenant-user/create-simulation",
    "pathItem": "createAdminSupportTicketTenantUserSimulation",
    "operationId": "createAdminSupportTicketTenantUserSimulation",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/reconcile",
    "signature": "POST /admin/support/tickets/reconcile",
    "pathItem": "reconcileAdminSupportTickets",
    "operationId": "reconcileAdminSupportTickets",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/sla/reconcile",
    "signature": "POST /admin/support/tickets/sla/reconcile",
    "pathItem": "reconcileAdminSupportTicketSla",
    "operationId": "reconcileAdminSupportTicketSla",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-credential/orchestration-plan",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-credential/orchestration-plan",
    "pathItem": "planAdminSupportTicketExternalCredentialOrchestration",
    "operationId": "planAdminSupportTicketExternalCredentialOrchestration",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-credential/approve-activate-bind-verify",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-credential/approve-activate-bind-verify",
    "pathItem": "approveActivateBindVerifyAdminSupportTicketExternalCredential",
    "operationId": "approveActivateBindVerifyAdminSupportTicketExternalCredential",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-credential/activation-plan",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-credential/activation-plan",
    "pathItem": "planAdminSupportTicketExternalCredentialActivation",
    "operationId": "planAdminSupportTicketExternalCredentialActivation",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-credential/activate-and-bind",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-credential/activate-and-bind",
    "pathItem": "activateBindAdminSupportTicketExternalCredential",
    "operationId": "activateBindAdminSupportTicketExternalCredential",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-secret/intake-plan",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-secret/intake-plan",
    "pathItem": "planAdminSupportTicketExternalSecretIntake",
    "operationId": "planAdminSupportTicketExternalSecretIntake",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-secret/reference/register",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-secret/reference/register",
    "pathItem": "registerAdminSupportTicketExternalSecretReference",
    "operationId": "registerAdminSupportTicketExternalSecretReference",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-secret/reference/activate",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-secret/reference/activate",
    "pathItem": "activateAdminSupportTicketExternalSecretReference",
    "operationId": "activateAdminSupportTicketExternalSecretReference",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "get",
    "expressPath": "/admin/support/tickets/external-delivery/credential-candidates",
    "signature": "GET /admin/support/tickets/external-delivery/credential-candidates",
    "pathItem": "listAdminSupportTicketExternalCredentialCandidates",
    "operationId": "listAdminSupportTicketExternalCredentialCandidates",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-delivery/credential-binding/request",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-delivery/credential-binding/request",
    "pathItem": "requestAdminSupportTicketExternalCredentialBinding",
    "operationId": "requestAdminSupportTicketExternalCredentialBinding",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-delivery/credential-binding/decision",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-delivery/credential-binding/decision",
    "pathItem": "decideAdminSupportTicketExternalCredentialBinding",
    "operationId": "decideAdminSupportTicketExternalCredentialBinding",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-send/provider-adapter-future-pr-scope/plan",
    "signature": "POST /admin/support/tickets/external-send/provider-adapter-future-pr-scope/plan",
    "pathItem": "planAdminSupportTicketExternalAdapterFuturePrScope",
    "operationId": "planAdminSupportTicketExternalAdapterFuturePrScope",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-send/provider-adapter-future-pr-scope/record",
    "signature": "POST /admin/support/tickets/external-send/provider-adapter-future-pr-scope/record",
    "pathItem": "recordAdminSupportTicketExternalAdapterFuturePrScope",
    "operationId": "recordAdminSupportTicketExternalAdapterFuturePrScope",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-send/provider-adapter-readiness/plan",
    "signature": "POST /admin/support/tickets/external-send/provider-adapter-readiness/plan",
    "pathItem": "planAdminSupportTicketExternalAdapterReadiness",
    "operationId": "planAdminSupportTicketExternalAdapterReadiness",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-send/provider-adapter-readiness/record",
    "signature": "POST /admin/support/tickets/external-send/provider-adapter-readiness/record",
    "pathItem": "recordAdminSupportTicketExternalAdapterReadiness",
    "operationId": "recordAdminSupportTicketExternalAdapterReadiness",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-send/provider-adapter-readiness/decision",
    "signature": "POST /admin/support/tickets/external-send/provider-adapter-readiness/decision",
    "pathItem": "decideAdminSupportTicketExternalAdapterReadiness",
    "operationId": "decideAdminSupportTicketExternalAdapterReadiness",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-send/provider-adapter-enablement/candidates",
    "signature": "POST /admin/support/tickets/external-send/provider-adapter-enablement/candidates",
    "pathItem": "listAdminSupportTicketExternalProviderEnablementCandidates",
    "operationId": "listAdminSupportTicketExternalProviderEnablementCandidates",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/external-send/provider-adapter-enablement/propose",
    "signature": "POST /admin/support/tickets/external-send/provider-adapter-enablement/propose",
    "pathItem": "proposeAdminSupportTicketExternalProviderAdapterEnablement",
    "operationId": "proposeAdminSupportTicketExternalProviderAdapterEnablement",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "get",
    "expressPath": "/admin/support/tickets/external-send/provider-contracts",
    "signature": "GET /admin/support/tickets/external-send/provider-contracts",
    "pathItem": "listAdminSupportTicketExternalProviderContracts",
    "operationId": "listAdminSupportTicketExternalProviderContracts",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-send/provider-gate-plan",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-send/provider-gate-plan",
    "pathItem": "planAdminSupportTicketExternalSendProviderGate",
    "operationId": "planAdminSupportTicketExternalSendProviderGate",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-send/provider-gate-attempt",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-send/provider-gate-attempt",
    "pathItem": "recordAdminSupportTicketExternalSendProviderGateAttempt",
    "operationId": "recordAdminSupportTicketExternalSendProviderGateAttempt",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-send/execution-plan",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-send/execution-plan",
    "pathItem": "planAdminSupportTicketExternalSendExecution",
    "operationId": "planAdminSupportTicketExternalSendExecution",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-send/execution-record",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-send/execution-record",
    "pathItem": "recordAdminSupportTicketExternalSendExecution",
    "operationId": "recordAdminSupportTicketExternalSendExecution",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-delivery/readiness",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-delivery/readiness",
    "pathItem": "checkAdminSupportTicketExternalDeliveryReadiness",
    "operationId": "checkAdminSupportTicketExternalDeliveryReadiness",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-delivery/approval/request",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-delivery/approval/request",
    "pathItem": "requestAdminSupportTicketExternalDeliveryApproval",
    "operationId": "requestAdminSupportTicketExternalDeliveryApproval",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-delivery/approval/decision",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-delivery/approval/decision",
    "pathItem": "decideAdminSupportTicketExternalDeliveryApproval",
    "operationId": "decideAdminSupportTicketExternalDeliveryApproval",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/external-delivery/completion-certification",
    "signature": "POST /admin/support/tickets/{ticket_id}/external-delivery/completion-certification",
    "pathItem": "certifyAdminSupportTicketExternalDeliveryCompletion",
    "operationId": "certifyAdminSupportTicketExternalDeliveryCompletion",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "get",
    "expressPath": "/admin/support/tickets/notifications/adapters",
    "signature": "GET /admin/support/tickets/notifications/adapters",
    "pathItem": "listAdminSupportTicketNotificationAdapters",
    "operationId": "listAdminSupportTicketNotificationAdapters",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/notification-delivery/preview",
    "signature": "POST /admin/support/tickets/{ticket_id}/notification-delivery/preview",
    "pathItem": "previewAdminSupportTicketNotificationDelivery",
    "operationId": "previewAdminSupportTicketNotificationDelivery",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/notification-delivery/dispatch",
    "signature": "POST /admin/support/tickets/{ticket_id}/notification-delivery/dispatch",
    "pathItem": "dispatchAdminSupportTicketNotificationDelivery",
    "operationId": "dispatchAdminSupportTicketNotificationDelivery",
    "exposure": "admin_tool",
    "consequential": true
  },
  {
    "method": "get",
    "expressPath": "/admin/support/tickets/notifications/queue",
    "signature": "GET /admin/support/tickets/notifications/queue",
    "pathItem": "listAdminSupportTicketNotificationQueue",
    "operationId": "listAdminSupportTicketNotificationQueue",
    "exposure": "admin_tool",
    "consequential": false
  },
  {
    "method": "post",
    "expressPath": "/admin/support/tickets/:ticket_id/notification-cycle",
    "signature": "POST /admin/support/tickets/{ticket_id}/notification-cycle",
    "pathItem": "createAdminSupportTicketNotificationCycle",
    "operationId": "createAdminSupportTicketNotificationCycle",
    "exposure": "admin_tool",
    "consequential": true
  }
];

assert.equal(contracts.length, 47);
assert.equal(new Set(contracts.map((entry) => entry.signature)).size, 47);
assert.equal(new Set(contracts.map((entry) => entry.operationId)).size, 47);

for (const entry of contracts) {
  const { method, expressPath, signature, pathItem, operationId, exposure, consequential } = entry;
  assert(routesSource.includes(`router.${method}("${expressPath}"`), `runtime route missing: ${method.toUpperCase()} ${expressPath}`);
  assert(registry.includes(`  ${signature}:`), `precise registry signature missing: ${signature}`);
  assert(registry.includes(`    path_item_ref: './openapi/support-ticket-runtime-completion.yaml#/${pathItem}'`), `precise path item ref missing: ${signature}`);
  assert(registry.includes(`    exposure: ${exposure}`), `registry exposure missing: ${signature}`);
  assert(contract.includes(`${pathItem}:\n  ${method}:`), `path item missing: ${pathItem}`);
  assert(contract.includes(`operationId: ${operationId}`), `operationId missing: ${operationId}`);
  assert(contract.includes(`x-registry-exposure: ${exposure}`), `path item exposure missing: ${pathItem}`);
  assert(contract.includes(`x-openai-isConsequential: ${consequential ? 'true' : 'false'}`), `consequential classification missing: ${pathItem}`);
  if (exposure === 'tenant_user') {
    assert(contract.includes('security: [{ userJwtAuth: [] }]'), `tenant JWT security missing: ${pathItem}`);
  }
}

const runtime = [];
const routeRe = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
for (const match of routesSource.matchAll(routeRe)) {
  const method = match[1].toUpperCase();
  const path = match[2].replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  runtime.push(`${method} ${path}`);
}
const registered = new Set();
const contractRe = /^\s{2}(GET|POST|PUT|PATCH|DELETE)\s+(.+):\s*$/gm;
for (const match of registry.matchAll(contractRe)) registered.add(`${match[1]} ${match[2]}`);
const missing = [...new Set(runtime)].filter((signature) => !registered.has(signature));
assert.deepEqual(missing, [], `unregistered Support Ticket runtime routes: ${missing.join(', ')}`);

assert.equal(contracts.filter((entry) => entry.exposure === 'admin_tool').length, 45);
assert.equal(contracts.filter((entry) => entry.exposure === 'tenant_user').length, 2);
assert.equal(contracts.filter((entry) => entry.consequential).length, 25);
assert.equal(contracts.filter((entry) => !entry.consequential).length, 22);
assert.equal((contract.match(/adminBearerAuth: \[\]/g) || []).length, 45);
assert.equal((contract.match(/backendApiKeyAuth: \[\]/g) || []).length, 45);
assert.equal((contract.match(/userJwtAuth: \[\]/g) || []).length, 2);
assert(!contract.includes('security: []'));
assert(!contract.includes('TODO'));
assert(!contract.includes('client_secret'));
assert(!contract.includes('access_token'));

console.log(JSON.stringify({
  ok: true,
  contract: 'mad4b.support-ticket-runtime-openapi-completion.v1',
  runtime_routes: new Set(runtime).size,
  newly_registered_routes: contracts.length,
  uncovered_routes: missing.length,
  admin_operations: 45,
  tenant_user_operations: 2,
  consequential_operations: 25,
  read_plan_preview_or_proposal_operations: 22,
  source_bound: true,
  repository_mutation_performed: false,
  provider_dispatch_performed: false,
  secrets_included: false
}, null, 2));
