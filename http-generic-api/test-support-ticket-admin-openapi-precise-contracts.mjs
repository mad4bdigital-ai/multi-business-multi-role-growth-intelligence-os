#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routesSource = readFileSync('routes/supportTicketRoutes.js', 'utf8');
const registry = readFileSync('openapi-route-contracts.yaml', 'utf8');
const tenantContract = readFileSync('openapi/support-tickets.yaml', 'utf8');
const commonContract = readFileSync('openapi/support-ticket-admin-common.yaml', 'utf8');
const brandContract = readFileSync('openapi/support-ticket-admin-brand.yaml', 'utf8');
const executionContract = readFileSync('openapi/support-ticket-admin-execution.yaml', 'utf8');

const contracts = [
  ['/admin/support/tickets/:ticket_id/new-brand-ref-approval/approve', 'POST /admin/support/tickets/{ticket_id}/new-brand-ref-approval/approve', 'support-ticket-admin-brand.yaml', 'adminSupportTicketNewBrandRefApprovalApprove', 'approveAdminSupportTicketNewBrandRef'],
  ['/admin/support/tickets/:ticket_id/brand-ref-selection/approve-and-complete', 'POST /admin/support/tickets/{ticket_id}/brand-ref-selection/approve-and-complete', 'support-ticket-admin-brand.yaml', 'adminSupportTicketBrandRefSelectionApproveAndComplete', 'approveAndCompleteAdminSupportTicketBrandRefSelection'],
  ['/admin/support/tickets/:ticket_id/brand-ref-selection/approve', 'POST /admin/support/tickets/{ticket_id}/brand-ref-selection/approve', 'support-ticket-admin-brand.yaml', 'adminSupportTicketBrandRefSelectionApprove', 'approveAdminSupportTicketBrandRefSelection'],
  ['/admin/support/tickets/:ticket_id/brand-ref-resolution', 'POST /admin/support/tickets/{ticket_id}/brand-ref-resolution', 'support-ticket-admin-brand.yaml', 'adminSupportTicketBrandRefResolution', 'resolveAdminSupportTicketBrandRefs'],
  ['/admin/support/tickets/:ticket_id/brand-mapping-remediation/finalize', 'POST /admin/support/tickets/{ticket_id}/brand-mapping-remediation/finalize', 'support-ticket-admin-brand.yaml', 'adminSupportTicketBrandMappingRemediationFinalize', 'finalizeAdminSupportTicketBrandMappingRemediation'],
  ['/admin/support/tickets/:ticket_id/brand-mapping-remediation/verified-apply', 'POST /admin/support/tickets/{ticket_id}/brand-mapping-remediation/verified-apply', 'support-ticket-admin-brand.yaml', 'adminSupportTicketBrandMappingRemediationVerifiedApply', 'applyVerifiedAdminSupportTicketBrandMappingRemediation'],
  ['/admin/support/tickets/:ticket_id/brand-mapping-remediation', 'POST /admin/support/tickets/{ticket_id}/brand-mapping-remediation', 'support-ticket-admin-brand.yaml', 'adminSupportTicketBrandMappingRemediationApply', 'applyAdminSupportTicketBrandMappingRemediation'],
  ['/admin/support/tickets/:ticket_id/diagnostic-chain', 'POST /admin/support/tickets/{ticket_id}/diagnostic-chain', 'support-ticket-admin-execution.yaml', 'adminSupportTicketDiagnosticChain', 'runAdminSupportTicketDiagnosticChain'],
  ['/admin/support/tickets/:ticket_id/step-run/execute', 'POST /admin/support/tickets/{ticket_id}/step-run/execute', 'support-ticket-admin-execution.yaml', 'adminSupportTicketStepRunExecute', 'executeAdminSupportTicketStepRun'],
  ['/admin/support/tickets/:ticket_id/step-run', 'POST /admin/support/tickets/{ticket_id}/step-run', 'support-ticket-admin-execution.yaml', 'adminSupportTicketStepRunUpdate', 'updateAdminSupportTicketStepRun'],
  ['/admin/support/tickets/:ticket_id/runtime-sync', 'POST /admin/support/tickets/{ticket_id}/runtime-sync', 'support-ticket-admin-execution.yaml', 'adminSupportTicketRuntimeSync', 'syncAdminSupportTicketRuntimeStatus'],
  ['/admin/support/tickets/:ticket_id/link-workflow', 'POST /admin/support/tickets/{ticket_id}/link-workflow', 'support-ticket-admin-execution.yaml', 'adminSupportTicketWorkflowLink', 'linkAdminSupportTicketWorkflow'],
  ['/admin/support/tickets/:ticket_id/transition', 'POST /admin/support/tickets/{ticket_id}/transition', 'support-ticket-admin-execution.yaml', 'adminSupportTicketTransition', 'transitionAdminSupportTicket'],
  ['/admin/support/tickets/:ticket_id/assign', 'POST /admin/support/tickets/{ticket_id}/assign', 'support-ticket-admin-execution.yaml', 'adminSupportTicketAssign', 'assignAdminSupportTicket'],
  ['/admin/support/tickets/:ticket_id/events', 'POST /admin/support/tickets/{ticket_id}/events', 'support-ticket-admin-execution.yaml', 'adminSupportTicketEvents', 'appendAdminSupportTicketEvent'],
];

assert.equal(contracts.length, 15);
for (const [expressPath, signature, file, pathItem, operationId] of contracts) {
  assert(routesSource.includes(`router.post("${expressPath}"`), `runtime route missing: ${expressPath}`);
  assert(registry.includes(`  ${signature}:`), `precise registry signature missing: ${signature}`);
  assert(registry.includes("    route_file: 'routes/supportTicketRoutes.js'"), 'registry must remain source-bound');
  assert(
    registry.includes(`    path_item_ref: './openapi/${file}#/${pathItem}'`),
    `precise path item ref missing: ${signature}`,
  );
  const source = file.includes('brand') ? brandContract : executionContract;
  assert(source.includes(`${pathItem}:\n  post:`), `path item missing: ${pathItem}`);
  assert(source.includes(`operationId: ${operationId}`), `operationId missing: ${operationId}`);
}

for (const source of [brandContract, executionContract]) {
  assert(source.includes('adminBearerAuth: []'));
  assert(source.includes('backendApiKeyAuth: []'));
  assert(source.includes('x-registry-exposure: admin_tool'));
  assert(source.includes('x-openai-isConsequential:'));
  assert(source.includes("./support-ticket-admin-common.yaml#/parameters/SupportTicketId"));
  assert(source.includes("./support-ticket-admin-common.yaml#/schemas/AdminSupportTicketActionRequest"));
  assert(!source.includes('security: []'));
  assert(!source.includes('TODO'));
}

assert(commonContract.includes('secrets_included: { type: boolean, const: false }'));
assert(commonContract.includes('provider_dispatch_performed'));
assert(commonContract.includes('external_send_performed'));
assert.equal((tenantContract.match(/userJwtAuth: \[\]/g) || []).length, 4, 'all four tenant operations must declare userJwtAuth');
assert(!tenantContract.includes('security: []'));

console.log(JSON.stringify({
  ok: true,
  contract: 'mad4b.support-ticket-openapi-precise-contracts.v1',
  precise_admin_routes: contracts.length,
  tenant_user_jwt_operations: 4,
  source_bound: true,
  repository_mutation_performed: false,
  provider_dispatch_performed: false,
  secrets_included: false,
}, null, 2));
