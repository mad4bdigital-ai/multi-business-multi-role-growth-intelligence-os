#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routesSource = readFileSync('routes/supportTicketRoutes.js', 'utf8');
const registry = readFileSync('openapi-route-contracts.yaml', 'utf8');
const contract = readFileSync('openapi/support-ticket-admin-remaining.yaml', 'utf8');

const contracts = [
  ['post', '/admin/support/tickets/:ticket_id/notification-ack', 'POST /admin/support/tickets/{ticket_id}/notification-ack', 'adminSupportTicketNotificationAck', 'acknowledgeAdminSupportTicketNotification'],
  ['get', '/admin/support/tickets/auto-resolve/candidates', 'GET /admin/support/tickets/auto-resolve/candidates', 'adminSupportTicketAutoResolveCandidates', 'listAdminSupportTicketAutoResolveCandidates'],
  ['post', '/admin/support/tickets/:ticket_id/auto-resolve/propose', 'POST /admin/support/tickets/{ticket_id}/auto-resolve/propose', 'adminSupportTicketAutoResolvePropose', 'proposeAdminSupportTicketAutoResolution'],
  ['get', '/admin/activation/ticket-inbox', 'GET /admin/activation/ticket-inbox', 'adminActivationTicketInbox', 'getAdminActivationTicketInbox'],
  ['post', '/admin/support/tickets/:ticket_id/admin-feedback', 'POST /admin/support/tickets/{ticket_id}/admin-feedback', 'adminSupportTicketFeedback', 'appendAdminSupportTicketFeedback'],
  ['get', '/admin/support/tickets', 'GET /admin/support/tickets', 'adminSupportTickets', 'listAdminSupportTickets'],
  ['get', '/admin/support/tickets/:ticket_id', 'GET /admin/support/tickets/{ticket_id}', 'adminSupportTicketById', 'getAdminSupportTicket'],
  ['post', '/admin/support/tickets/:ticket_id/approval-hold', 'POST /admin/support/tickets/{ticket_id}/approval-hold', 'adminSupportTicketApprovalHold', 'createAdminSupportTicketApprovalHold'],
  ['post', '/admin/support/tickets/:ticket_id/execution-plan', 'POST /admin/support/tickets/{ticket_id}/execution-plan', 'adminSupportTicketExecutionPlan', 'createAdminSupportTicketExecutionPlan'],
  ['post', '/admin/support/tickets/:ticket_id/workflow-run', 'POST /admin/support/tickets/{ticket_id}/workflow-run', 'adminSupportTicketWorkflowRun', 'createAdminSupportTicketWorkflowRun'],
  ['post', '/admin/support/tickets/:ticket_id/step-runs', 'POST /admin/support/tickets/{ticket_id}/step-runs', 'adminSupportTicketStepRuns', 'createAdminSupportTicketStepRuns'],
  ['post', '/admin/support/tickets/:ticket_id/approval-hold/decision', 'POST /admin/support/tickets/{ticket_id}/approval-hold/decision', 'adminSupportTicketApprovalHoldDecision', 'decideAdminSupportTicketApprovalHold'],
  ['post', '/admin/support/tickets/:ticket_id/brand-mapping-remediation/complete', 'POST /admin/support/tickets/{ticket_id}/brand-mapping-remediation/complete', 'adminSupportTicketBrandMappingRemediationComplete', 'completeAdminSupportTicketBrandMappingRemediation'],
  ['post', '/admin/support/tickets/:ticket_id/brand-ref-selection/request', 'POST /admin/support/tickets/{ticket_id}/brand-ref-selection/request', 'adminSupportTicketBrandRefSelectionRequest', 'requestAdminSupportTicketBrandRefSelection'],
  ['post', '/admin/support/tickets/:ticket_id/new-brand-ref-approval/request', 'POST /admin/support/tickets/{ticket_id}/new-brand-ref-approval/request', 'adminSupportTicketNewBrandRefApprovalRequest', 'requestAdminSupportTicketNewBrandRefApproval'],
];

assert.equal(contracts.length, 15);
for (const [method, expressPath, signature, pathItem, operationId] of contracts) {
  assert(routesSource.includes(`router.${method}("${expressPath}"`), `runtime route missing: ${method.toUpperCase()} ${expressPath}`);
  assert(registry.includes(`  ${signature}:`), `precise registry signature missing: ${signature}`);
  assert(registry.includes(`    path_item_ref: './openapi/support-ticket-admin-remaining.yaml#/${pathItem}'`), `precise path item ref missing: ${signature}`);
  assert(contract.includes(`${pathItem}:\n  ${method}:`), `path item missing: ${pathItem}`);
  assert(contract.includes(`operationId: ${operationId}`), `operationId missing: ${operationId}`);
}

assert.equal((contract.match(/adminBearerAuth: \[\]/g) || []).length, 15);
assert.equal((contract.match(/backendApiKeyAuth: \[\]/g) || []).length, 15);
assert.equal((contract.match(/x-registry-exposure: admin_tool/g) || []).length, 15);
assert.equal((contract.match(/x-openai-isConsequential: true/g) || []).length, 10);
assert.equal((contract.match(/x-openai-isConsequential: false/g) || []).length, 5);
assert(!contract.includes('security: []'));
assert(!contract.includes('TODO'));
assert(!contract.includes('client_secret'));
assert(!contract.includes('access_token'));

console.log(JSON.stringify({
  ok: true,
  contract: 'mad4b.support-ticket-admin-remaining-openapi-contracts.v1',
  precise_admin_routes: contracts.length,
  admin_bearer_operations: 15,
  backend_api_key_operations: 15,
  consequential_operations: 10,
  read_or_proposal_operations: 5,
  source_bound: true,
  repository_mutation_performed: false,
  provider_dispatch_performed: false,
  secrets_included: false,
}, null, 2));
