function rows(value) {
  return Array.isArray(value) ? value : [];
}

export function buildConnectorAuthorityProjection({ systems = [], installations = [] } = {}) {
  const activeInstallationsBySystem = new Map();
  for (const installation of rows(installations)) {
    if (String(installation?.status || "").trim().toLowerCase() !== "active") continue;
    const systemId = String(installation?.system_id || "").trim();
    if (!systemId) continue;
    const current = activeInstallationsBySystem.get(systemId) || [];
    current.push(installation);
    activeInstallationsBySystem.set(systemId, current);
  }

  return rows(systems).map((system) => {
    const systemId = String(system?.system_id || "").trim();
    const registryStatus = String(system?.status || "unknown").trim().toLowerCase();
    const activeInstallations = activeInstallationsBySystem.get(systemId) || [];
    const blockedReasonCodes = [];
    if (registryStatus !== "active") blockedReasonCodes.push("CONNECTOR_REGISTRY_NOT_ACTIVE");
    if (!activeInstallations.length) blockedReasonCodes.push("CONNECTION_INSTALLATION_REQUIRED");

    return {
      system_id: systemId,
      tenant_id: system?.tenant_id || null,
      system_key: system?.system_key || null,
      connector_family: system?.connector_family || system?.provider_family || null,
      registry_status: registryStatus,
      authorization_status: "visible",
      configuration_status: "not_evaluated",
      installation_status: activeInstallations.length ? "installed" : "not_installed",
      credential_status: "not_evaluated",
      connectivity_status: "not_evaluated",
      certification_status: "not_evaluated",
      freshness_status: "current",
      execution_readiness: blockedReasonCodes.length ? "blocked" : "candidate",
      active_installation_count: activeInstallations.length,
      blocked_reason_codes: blockedReasonCodes,
      secrets_included: false,
    };
  });
}

export function evaluateConnectedSystemProjectionDrift({
  isAdmin = false,
  scopeMode = null,
  registeredCount = 0,
  visibleCount = 0,
} = {}) {
  const driftDetected = Boolean(
    isAdmin &&
    scopeMode === "platform_global" &&
    Number(registeredCount || 0) > 0 &&
    Number(visibleCount || 0) === 0
  );
  return {
    ok: !driftDetected,
    drift_detected: driftDetected,
    issue_code: driftDetected ? "AUTHORITY_PROJECTION_DRIFT_CONNECTED_SYSTEMS" : null,
    registered_count: Number(registeredCount || 0),
    visible_count: Number(visibleCount || 0),
    secrets_included: false,
  };
}
