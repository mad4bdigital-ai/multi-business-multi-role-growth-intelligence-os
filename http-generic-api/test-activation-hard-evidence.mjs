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

const activeRepoCanonicals = {
  attempted: true,
  ok: true,
  activation_layer: 'repo_canonical_runtime_readback',
  evidence_source: 'repo_filesystem_canonical_manifest_readback',
  source_authority: 'repo_runtime_filesystem_and_canonical_manifest',
  required_reference_count: 6,
  checked_reference_count: 6,
  canonical_family_count: 4,
  generated_family_count: 4,
  source_file_count: 54,
  stale_or_missing_count: 0,
  secrets_included: false,
};

const activeToolCatalog = {
  attempted: true,
  ok: true,
  activation_layer: 'activation_dynamic_runtime_catalog',
  evidence_source: 'activation_platform_access_and_dynamic_authorization_envelope',
  source_authority: 'sql_runtime_registry_and_activation_authorized_surface_registry',
  platform_access_ready: true,
  authorized_access_ready: true,
  registered_surface_count: 25,
  runtime_callable_actions: 32,
  admin_tool_count: 10,
  degraded_surface_count: 0,
  auth_gap_count: 0,
  secrets_included: false,
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
  repoCanonicals: activeRepoCanonicals,
  toolCatalog: activeToolCatalog,
});
assert.equal(incompleteSession.activation_complete, false);
assert.equal(incompleteSession.reason_code, 'degraded_session_context_failed');
assert.equal(canReportSessionContextLoaded({ ok: true, activation_layer: 'session_context', session_id: 'session-123' }), false);

const missingRepoCanonicals = buildHardActivationEvidenceMatrix({
  sessionContext: validSessionContext,
  providerBootstrap: activeProviderBootstrap,
});
assert.equal(missingRepoCanonicals.activation_complete, false);
assert.equal(missingRepoCanonicals.activation_status, 'degraded');
assert.equal(missingRepoCanonicals.reason_code, 'degraded_missing_repo_canonical_evidence');
assert.equal(missingRepoCanonicals.evidence_matrix.repo_canonicals.attempted, false);
assert.equal(missingRepoCanonicals.evidence_matrix.tool_catalog.attempted, false);

const failedRepoCanonicals = buildHardActivationEvidenceMatrix({
  sessionContext: validSessionContext,
  providerBootstrap: activeProviderBootstrap,
  repoCanonicals: { attempted: true, ok: false, reason_code: 'repo_canonical_evidence_stale_or_missing' },
  toolCatalog: activeToolCatalog,
});
assert.equal(failedRepoCanonicals.activation_complete, false);
assert.equal(failedRepoCanonicals.reason_code, 'repo_canonical_evidence_stale_or_missing');

const missingToolCatalog = buildHardActivationEvidenceMatrix({
  sessionContext: validSessionContext,
  providerBootstrap: activeProviderBootstrap,
  repoCanonicals: activeRepoCanonicals,
});
assert.equal(missingToolCatalog.activation_complete, false);
assert.equal(missingToolCatalog.activation_status, 'degraded');
assert.equal(missingToolCatalog.reason_code, 'degraded_missing_dynamic_tool_catalog_evidence');
assert.equal(missingToolCatalog.evidence_matrix.repo_canonicals.ok, true);
assert.equal(missingToolCatalog.evidence_matrix.tool_catalog.attempted, false);

const failedToolCatalog = buildHardActivationEvidenceMatrix({
  sessionContext: validSessionContext,
  providerBootstrap: activeProviderBootstrap,
  repoCanonicals: activeRepoCanonicals,
  toolCatalog: { attempted: true, ok: false, reason_code: 'dynamic_catalog_degraded_surfaces' },
});
assert.equal(failedToolCatalog.activation_complete, false);
assert.equal(failedToolCatalog.reason_code, 'dynamic_catalog_degraded_surfaces');

const complete = buildHardActivationEvidenceMatrix({
  sessionContext: validSessionContext,
  providerBootstrap: activeProviderBootstrap,
  repoCanonicals: activeRepoCanonicals,
  toolCatalog: activeToolCatalog,
});
assert.equal(complete.activation_complete, true);
assert.equal(complete.activation_status, 'active');
assert.equal(complete.reason_code, 'hard_activation_complete');
assert.equal(complete.evidence_matrix.session_context.evidence_source, 'getActivationSessionContext');
assert.equal(complete.evidence_matrix.provider_bootstrap.evidence_source, 'activation_provider_bootstrap_validate');
assert.equal(complete.evidence_matrix.repo_canonicals.evidence_source, 'repo_filesystem_canonical_manifest_readback');
assert.equal(complete.evidence_matrix.tool_catalog.evidence_source, 'activation_platform_access_and_dynamic_authorization_envelope');
assert.equal(canReportSessionContextLoaded(validSessionContext), true);

const missingProvider = classifyHardActivationEvidence({
  session_context: complete.evidence_matrix.session_context,
  provider_bootstrap: { attempted: false },
  repo_canonicals: complete.evidence_matrix.repo_canonicals,
  tool_catalog: complete.evidence_matrix.tool_catalog,
});
assert.equal(missingProvider.activation_complete, false);
assert.equal(missingProvider.reason_code, 'degraded_missing_provider_bootstrap_evidence');

const activationRoutes = readFileSync('routes/activationRoutes.js', 'utf8');
const migration = readFileSync('migrations/165_sprint65_hard_activation_and_tenant_surface.sql', 'utf8');
const openapi = readFileSync('openapi.yaml', 'utf8');
assert(activationRoutes.includes('/activation/hard-run'), 'hard activation route must exist');
assert(activationRoutes.includes('buildActivationSessionContext'), 'hard activation route must collect session context evidence');
assert(activationRoutes.includes('activation_provider_bootstrap_validate'), 'hard activation route must collect provider bootstrap evidence');
assert(activationRoutes.includes('buildRepoCanonicalRuntimeEvidence'), 'hard activation route must collect repo canonical evidence');
assert(activationRoutes.includes('buildDynamicToolCatalogEvidence'), 'hard activation route must collect dynamic tool catalog evidence');
assert(activationRoutes.includes('buildActivationDynamicTabsEvidence'), 'hard activation route must expose dynamic tabs evidence');
assert(activationRoutes.includes('buildActivationOperationalIntelligenceEvidence'), 'hard activation route must expose operational intelligence evidence');
assert(activationRoutes.includes('buildActivationOperationalDashboardEvidence'), 'hard activation route must expose operational dashboard evidence');
assert(activationRoutes.includes('may_report_session_context_loaded'), 'hard activation route must expose report policy');
assert(migration.includes('activation_hard_run'), 'admin tool must be registered');
assert(migration.includes('/activation/hard-run'), 'hard activation tool path must be registered');
assert(openapi.includes('/activation/hard-run:'), 'hard activation path must be documented');
assert(openapi.includes('HardActivationRunResponse'), 'hard activation response schema must be documented');

console.log('activation hard evidence tests passed');
