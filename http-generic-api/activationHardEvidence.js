export const HARD_ACTIVATION_REASON_CODES = Object.freeze({
  ACTIVE: "hard_activation_complete",
  MISSING_SESSION_CONTEXT: "degraded_missing_session_context_evidence",
  SESSION_CONTEXT_FAILED: "degraded_session_context_failed",
  MISSING_PROVIDER_BOOTSTRAP: "degraded_missing_provider_bootstrap_evidence",
  PROVIDER_BOOTSTRAP_FAILED: "provider_bootstrap_incomplete",
  MISSING_REPO_CANONICALS: "degraded_missing_repo_canonical_evidence",
  REPO_CANONICALS_FAILED: "degraded_repo_canonical_evidence_failed",
  MISSING_DYNAMIC_TOOL_CATALOG: "degraded_missing_dynamic_tool_catalog_evidence",
  DYNAMIC_TOOL_CATALOG_FAILED: "degraded_dynamic_tool_catalog_failed",
});

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function summarizeSessionContextEvidence(sessionContext = null) {
  const attempted = isObject(sessionContext);
  const ok = attempted && sessionContext.ok === true;
  const activationLayer = attempted ? sessionContext.activation_layer || null : null;
  const sessionId = attempted ? sessionContext.session_id || null : null;
  const sessionManagement = attempted && isObject(sessionContext.session_management) ? sessionContext.session_management : null;
  const platformAccess = attempted && isObject(sessionContext.platform_access) ? sessionContext.platform_access : null;
  const conversationMemory = attempted && isObject(sessionContext.conversation_memory) ? sessionContext.conversation_memory : null;

  const requiredFieldsPresent = Boolean(
    ok &&
    activationLayer === "session_context" &&
    hasString(sessionId) &&
    sessionManagement &&
    platformAccess &&
    conversationMemory?.status
  );

  return {
    attempted,
    ok: ok && requiredFieldsPresent,
    activation_layer: activationLayer,
    session_id: sessionId,
    session_opened: sessionManagement?.status_written === "active" || sessionManagement?.new_session_opened === true || hasString(sessionId),
    platform_access_present: Boolean(platformAccess),
    conversation_memory_present: Boolean(conversationMemory?.status),
    required_fields_present: requiredFieldsPresent,
    evidence_source: attempted ? "getActivationSessionContext" : null,
  };
}

export function summarizeProviderBootstrapEvidence(providerBootstrap = null) {
  const attempted = isObject(providerBootstrap);
  const evidence = attempted && isObject(providerBootstrap.evidence) ? providerBootstrap.evidence : {};
  const runtimeClassification = attempted && isObject(providerBootstrap.runtime_classification)
    ? providerBootstrap.runtime_classification
    : {};
  const ok = attempted && (
    providerBootstrap.ok === true || runtimeClassification.activation_status === "active"
  );
  return {
    attempted,
    ok,
    activation_layer: attempted ? providerBootstrap.activation_layer || null : null,
    activation_status: runtimeClassification.activation_status || null,
    reason_code: runtimeClassification.reason_code || null,
    drive_attempted: Boolean(evidence.drive_attempted),
    drive_ok: Boolean(evidence.drive_ok),
    sheets_attempted: Boolean(evidence.sheets_attempted),
    sheets_ok: Boolean(evidence.sheets_ok),
    github_attempted: Boolean(evidence.github_attempted),
    github_ok: Boolean(evidence.github_ok),
    bootstrap_row_read: Boolean(evidence.bootstrap_row_read),
    validation_complete: Boolean(evidence.validation_complete),
    evidence_source: attempted ? "activation_provider_bootstrap_validate" : null,
  };
}

export function summarizeRepoCanonicalEvidence(repoCanonicals = null) {
  const attempted = isObject(repoCanonicals) && repoCanonicals.attempted === true;
  const ok = attempted && repoCanonicals.ok === true;
  return {
    attempted,
    ok,
    activation_layer: attempted ? repoCanonicals.activation_layer || "repo_canonical_runtime_readback" : null,
    evidence_source: attempted ? repoCanonicals.evidence_source || "repo_canonical_runtime_readback" : null,
    required_reference_count: Number(repoCanonicals?.required_reference_count || 0),
    checked_reference_count: Number(repoCanonicals?.checked_reference_count || 0),
    canonical_family_count: Number(repoCanonicals?.canonical_family_count || 0),
    generated_family_count: Number(repoCanonicals?.generated_family_count || 0),
    source_file_count: Number(repoCanonicals?.source_file_count || 0),
    stale_or_missing_count: Number(repoCanonicals?.stale_or_missing_count || 0),
    source_authority: repoCanonicals?.source_authority || null,
    reason_code: ok ? null : repoCanonicals?.reason_code || HARD_ACTIVATION_REASON_CODES.REPO_CANONICALS_FAILED,
  };
}

export function summarizeDynamicToolCatalogEvidence(toolCatalog = null) {
  const attempted = isObject(toolCatalog) && toolCatalog.attempted === true;
  const ok = attempted && toolCatalog.ok === true;
  return {
    attempted,
    ok,
    activation_layer: attempted ? toolCatalog.activation_layer || "activation_dynamic_runtime_catalog" : null,
    evidence_source: attempted ? toolCatalog.evidence_source || "activation_dynamic_authorization_envelope" : null,
    platform_access_ready: Boolean(toolCatalog?.platform_access_ready),
    authorized_access_ready: Boolean(toolCatalog?.authorized_access_ready),
    registered_surface_count: Number(toolCatalog?.registered_surface_count || 0),
    runtime_callable_actions: Number(toolCatalog?.runtime_callable_actions || 0),
    admin_tool_count: Number(toolCatalog?.admin_tool_count || 0),
    degraded_surface_count: Number(toolCatalog?.degraded_surface_count || 0),
    auth_gap_count: Number(toolCatalog?.auth_gap_count || 0),
    source_authority: toolCatalog?.source_authority || null,
    reason_code: ok ? null : toolCatalog?.reason_code || HARD_ACTIVATION_REASON_CODES.DYNAMIC_TOOL_CATALOG_FAILED,
  };
}

export function classifyHardActivationEvidence(matrix = {}) {
  const session = matrix.session_context || {};
  const provider = matrix.provider_bootstrap || {};
  const repo = matrix.repo_canonicals || {};
  const tools = matrix.tool_catalog || {};

  if (!session.attempted) {
    return { activation_status: "degraded", activation_complete: false, status_authority: "runtime_canonical", reason_code: HARD_ACTIVATION_REASON_CODES.MISSING_SESSION_CONTEXT };
  }
  if (!session.ok) {
    return { activation_status: "degraded", activation_complete: false, status_authority: "runtime_canonical", reason_code: HARD_ACTIVATION_REASON_CODES.SESSION_CONTEXT_FAILED };
  }
  if (!provider.attempted) {
    return { activation_status: "degraded", activation_complete: false, status_authority: "runtime_canonical", reason_code: HARD_ACTIVATION_REASON_CODES.MISSING_PROVIDER_BOOTSTRAP };
  }
  if (!provider.ok) {
    return { activation_status: provider.activation_status || "validating", activation_complete: false, status_authority: "runtime_canonical", reason_code: provider.reason_code || HARD_ACTIVATION_REASON_CODES.PROVIDER_BOOTSTRAP_FAILED };
  }
  if (!repo.attempted) {
    return { activation_status: "degraded", activation_complete: false, status_authority: "runtime_canonical", reason_code: HARD_ACTIVATION_REASON_CODES.MISSING_REPO_CANONICALS };
  }
  if (!repo.ok) {
    return { activation_status: "degraded", activation_complete: false, status_authority: "runtime_canonical", reason_code: repo.reason_code || HARD_ACTIVATION_REASON_CODES.REPO_CANONICALS_FAILED };
  }
  if (!tools.attempted) {
    return { activation_status: "degraded", activation_complete: false, status_authority: "runtime_canonical", reason_code: HARD_ACTIVATION_REASON_CODES.MISSING_DYNAMIC_TOOL_CATALOG };
  }
  if (!tools.ok) {
    return { activation_status: "degraded", activation_complete: false, status_authority: "runtime_canonical", reason_code: tools.reason_code || HARD_ACTIVATION_REASON_CODES.DYNAMIC_TOOL_CATALOG_FAILED };
  }
  return { activation_status: "active", activation_complete: true, status_authority: "runtime_canonical", reason_code: HARD_ACTIVATION_REASON_CODES.ACTIVE };
}

export function buildHardActivationEvidenceMatrix({ sessionContext = null, providerBootstrap = null, repoCanonicals = null, toolCatalog = null } = {}) {
  const matrix = {
    session_context: summarizeSessionContextEvidence(sessionContext),
    provider_bootstrap: summarizeProviderBootstrapEvidence(providerBootstrap),
    repo_canonicals: summarizeRepoCanonicalEvidence(repoCanonicals),
    tool_catalog: summarizeDynamicToolCatalogEvidence(toolCatalog),
  };
  const classification = classifyHardActivationEvidence(matrix);
  return {
    ...classification,
    evidence_matrix: matrix,
    degraded_surfaces: [
      !matrix.session_context.ok ? { surface: "session_context", reason_code: classification.reason_code } : null,
      matrix.provider_bootstrap.attempted && !matrix.provider_bootstrap.ok ? { surface: "provider_bootstrap", reason_code: matrix.provider_bootstrap.reason_code || HARD_ACTIVATION_REASON_CODES.PROVIDER_BOOTSTRAP_FAILED } : null,
      !matrix.provider_bootstrap.attempted ? { surface: "provider_bootstrap", reason_code: HARD_ACTIVATION_REASON_CODES.MISSING_PROVIDER_BOOTSTRAP } : null,
      !matrix.repo_canonicals.attempted ? { surface: "repo_canonicals", reason_code: HARD_ACTIVATION_REASON_CODES.MISSING_REPO_CANONICALS } : null,
      matrix.repo_canonicals.attempted && !matrix.repo_canonicals.ok ? { surface: "repo_canonicals", reason_code: matrix.repo_canonicals.reason_code || HARD_ACTIVATION_REASON_CODES.REPO_CANONICALS_FAILED } : null,
      !matrix.tool_catalog.attempted ? { surface: "tool_catalog", reason_code: HARD_ACTIVATION_REASON_CODES.MISSING_DYNAMIC_TOOL_CATALOG } : null,
      matrix.tool_catalog.attempted && !matrix.tool_catalog.ok ? { surface: "tool_catalog", reason_code: matrix.tool_catalog.reason_code || HARD_ACTIVATION_REASON_CODES.DYNAMIC_TOOL_CATALOG_FAILED } : null,
    ].filter(Boolean),
  };
}

export function canReportSessionContextLoaded(sessionContext = null) {
  return summarizeSessionContextEvidence(sessionContext).ok === true;
}
