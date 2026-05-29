import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildHardActivationEvidenceMatrix,
  canReportSessionContextLoaded,
  classifyHardActivationEvidence,
} from './activationHardEvidence.js';

const validSessionContext = {
  ok: true,
  activation_layer: 'session_context',
  session_id: 'session-123',
  session_management: { status_written: 'active', new_session_opened: true },
  platform_access: { access_scope: 'platform_admin_all' },
  conversation_memory: { status: 'available' },
};

const activeProviderBootstrap = {
  ok: true,
  activation_layer: 'provider_bootstrap_system_tool',
  runtime_classification: {
    activation_status: 'active',
    reason_code: 'provider_chain_complete',
  },
  evidence: {
    drive_attempted: true,
    drive_ok: true,
    sheets_attempted: true,
    sheets_ok: true,
    github_attempted: true,
    github_ok: true,
    bootstrap_row_read: true,
    validation_complete: true,
  },
};

const providerOnly = buildHardActivationEvidenceMatrix({ providerBootstrap: activeProviderBootstrap });
assert.equal(providerOnly.activation_complete, false);
assert.equal(providerOnly.activation_status, 'degraded');
assert.equal(providerOnly.reason_code, 'degraded_missing_session_context_evidence');
assert.equal(providerOnly.evidence_matrix.session_context.attempted, false);
assert.equal(providerOnly.evidence_matrix.provider_bootstrap.ok, true);

const incompleteSession = buildHardActivationEvidenceMatrix({
  sessionContext: { ok: true, activation_layer: 'session_context', session_id: 'session-123' },
  providerBootstrap: activeProviderBootstrap,
});
assert.equal(incompleteSession.activation_complete, false);
assert.equal(incompleteSession.reason_code, 'degraded_session_context_failed');
assert.equal(canReportSessionContextLoaded({ ok: true, activation_layer: 'session_context', session_id: 'session-123' }), false);

const complete = buildHardActivationEvidenceMatrix({
  sessionContext: validSessionContext,
  providerBootstrap: activeProviderBootstrap,
});
assert.equal(complete.activation_complete, true);
assert.equal(complete.activation_status, 'active');
assert.equal(complete.reason_code, 'hard_activation_complete');
assert.equal(complete.evidence_matrix.session_context.evidence_source, 'getActivationSessionContext');
assert.equal(complete.evidence_matrix.provider_bootstrap.evidence_source, 'activation_provider_bootstrap_validate');
assert.equal(canReportSessionContextLoaded(validSessionContext), true);

const missingProvider = classifyHardActivationEvidence({
  session_context: complete.evidence_matrix.session_context,
  provider_bootstrap: { attempted: false },
});
assert.equal(missingProvider.activation_complete, false);
assert.equal(missingProvider.reason_code, 'degraded_missing_provider_bootstrap_evidence');

const activationRoutes = readFileSync('routes/activationRoutes.js', 'utf8');
const migration = readFileSync('migrations/165_sprint65_hard_activation_and_tenant_surface.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');
assert(activationRoutes.includes('/activation/hard-run'), 'hard activation route must exist');
assert(activationRoutes.includes('buildActivationSessionContext'), 'hard activation route must collect session context evidence');
assert(activationRoutes.includes('activation_provider_bootstrap_validate'), 'hard activation route must collect provider bootstrap evidence');
assert(activationRoutes.includes('may_report_session_context_loaded'), 'hard activation route must expose report policy');
assert(migration.includes('activation_hard_run'), 'admin tool must be registered');
assert(migration.includes('/activation/hard-run'), 'hard activation tool path must be registered');
assert(openapi.includes('/activation/hard-run:'), 'hard activation path must be documented');
assert(openapi.includes('HardActivationRunResponse'), 'hard activation response schema must be documented');

console.log('activation hard evidence tests passed');
