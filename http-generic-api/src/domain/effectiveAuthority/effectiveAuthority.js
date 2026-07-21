export const CONNECTOR_INVENTORY_CAPABILITY_KEY = "connector.inventory.read";

const FORBIDDEN_EVIDENCE_KEY = /(secret|token|password|private[_-]?key|api[_-]?key|credential|ciphertext)/i;

export class EffectiveAuthorityError extends Error {
  constructor(code, message, status = 500, details = undefined) {
    super(message);
    this.name = "EffectiveAuthorityError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function normalizeAuthorityLimit(value, fallback = 25, maximum = 100) {
  if (value == null || value === "") return fallback;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new EffectiveAuthorityError(
      "AUTHORITY_LIMIT_INVALID",
      "limit must be a positive integer.",
      400,
      { field: "limit" }
    );
  }
  const parsed = Number.parseInt(text, 10);
  if (parsed < 1 || parsed > maximum) {
    throw new EffectiveAuthorityError(
      "AUTHORITY_LIMIT_OUT_OF_RANGE",
      `limit must be between 1 and ${maximum}.`,
      400,
      { field: "limit", minimum: 1, maximum }
    );
  }
  return parsed;
}

export function encodeAuthorityCursor(systemId) {
  const normalized = cleanString(systemId);
  return normalized ? Buffer.from(normalized, "utf8").toString("base64url") : null;
}

export function decodeAuthorityCursor(cursor) {
  const normalized = cleanString(cursor);
  if (!normalized) return null;
  try {
    const decoded = Buffer.from(normalized, "base64url").toString("utf8").trim();
    if (!decoded || encodeAuthorityCursor(decoded) !== normalized) throw new Error("non-canonical cursor");
    return decoded;
  } catch {
    throw new EffectiveAuthorityError(
      "AUTHORITY_CURSOR_INVALID",
      "cursor is invalid or malformed.",
      400,
      { field: "cursor" }
    );
  }
}

export function normalizeSemanticCapability(row) {
  if (!row) {
    throw new EffectiveAuthorityError(
      "CAPABILITY_NOT_REGISTERED",
      "The requested semantic capability is not registered.",
      503
    );
  }
  const status = cleanString(row.status);
  if (status !== "active") {
    throw new EffectiveAuthorityError(
      "CAPABILITY_NOT_ACTIVE",
      "The requested semantic capability is not active.",
      409,
      { status }
    );
  }
  return Object.freeze({
    key: cleanString(row.capability_key ?? row.capabilityKey),
    displayName: cleanString(row.display_name ?? row.displayName),
    resourceType: cleanString(row.resource_type ?? row.resourceType),
    operation: cleanString(row.operation_key ?? row.operationKey),
    riskClass: cleanString(row.risk_class ?? row.riskClass),
    executionMode: cleanString(row.default_execution_mode ?? row.defaultExecutionMode),
    requiresConnection: Boolean(row.requires_connection ?? row.requiresConnection),
    requiresWorkspaceAuthority: Boolean(
      row.requires_workspace_authority ?? row.requiresWorkspaceAuthority
    ),
    requiresApproval: Boolean(row.requires_approval ?? row.requiresApproval),
    requiresAuditEvidence: Boolean(
      row.requires_audit_evidence ?? row.requiresAuditEvidence
    ),
    requiresReadback: Boolean(row.requires_readback ?? row.requiresReadback),
    schemaVersion: Number(row.schema_version ?? row.schemaVersion ?? 1),
    status,
  });
}

export function buildConnectorReadinessItem(row = {}) {
  const registryStatus = cleanString(row.status ?? row.registry_status) || "unknown";
  const activeInstallationCount = Math.max(
    0,
    Number.parseInt(String(row.active_installation_count ?? 0), 10) || 0
  );
  const blockedReasonCodes = [];
  if (registryStatus !== "active") blockedReasonCodes.push("CONNECTOR_REGISTRY_NOT_ACTIVE");
  if (activeInstallationCount === 0) {
    blockedReasonCodes.push("CONNECTION_INSTALLATION_REQUIRED");
  }

  const item = {
    systemId: cleanString(row.system_id ?? row.systemId),
    tenantId: cleanString(row.tenant_id ?? row.tenantId),
    systemKey: cleanString(row.system_key ?? row.systemKey),
    displayName: cleanString(row.display_name ?? row.displayName),
    providerFamily: cleanString(row.provider_family ?? row.providerFamily),
    connectorFamily: cleanString(row.connector_family ?? row.connectorFamily),
    registryStatus,
    authorizationStatus: "visible",
    configurationStatus: "not_evaluated",
    installationStatus: activeInstallationCount > 0 ? "installed" : "not_installed",
    credentialStatus: "not_evaluated",
    connectivityStatus: "not_evaluated",
    certificationStatus: "not_evaluated",
    freshnessStatus: "current",
    executionReadiness: blockedReasonCodes.length ? "blocked" : "candidate",
    activeInstallationCount,
    blockedReasonCodes,
    secretsIncluded: false,
  };
  assertNoSecretEvidence(item);
  return Object.freeze(item);
}

export function assertNoSecretEvidence(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSecretEvidence);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
    if (normalizedKey === "secretsincluded") {
      if (item !== false) {
        throw new EffectiveAuthorityError(
          "AUTHORITY_SECRET_EVIDENCE_FORBIDDEN",
          "Authority evidence cannot include secret material.",
          500
        );
      }
      continue;
    }
    if (FORBIDDEN_EVIDENCE_KEY.test(key)) {
      throw new EffectiveAuthorityError(
        "AUTHORITY_SECRET_EVIDENCE_FORBIDDEN",
        "Authority evidence cannot include secret material.",
        500,
        { field: key }
      );
    }
    assertNoSecretEvidence(item);
  }
}

export function buildEffectiveAuthorityManifest({
  decisionId,
  resolution,
  capability,
  resourceKey,
  evaluatedAt,
  ttlSeconds = 300,
}) {
  const now = evaluatedAt instanceof Date ? evaluatedAt : new Date(evaluatedAt || Date.now());
  const expiresAt = new Date(now.getTime() + Math.min(Math.max(ttlSeconds, 1), 3600) * 1000);
  const manifest = {
    decisionId,
    decision: "shadow_ready",
    authorityGranted: false,
    enforcementMode: "shadow_only",
    principal: resolution.principal,
    subjectScope: {
      scopeId: resolution.scope.scopeId,
      scopeKey: resolution.scope.scopeKey,
      scopeType: resolution.scope.scopeType,
      tenantId: resolution.scope.tenantId,
      version: resolution.scope.version,
      selectionMode: resolution.selectionMode,
    },
    capability,
    resource: {
      type: "connector_collection",
      key: resourceKey,
    },
    readiness: {
      identity: "ready",
      scope: "ready",
      membership: "not_applicable",
      capability: "ready",
      resource: "ready",
      policy: "ready",
      grant: "ready",
      binding: "not_applicable",
      connection: "not_applicable",
      endpoint: "not_applicable",
      certification: "not_applicable",
      approval: "not_applicable",
      freshness: "ready",
      system: "ready",
    },
    projectionEligibility: {
      toolCatalog: false,
      dynamicTabs: false,
      dashboard: true,
      connectorInventory: true,
      execution: false,
    },
    gaps: [],
    versions: {
      authorityScope: String(resolution.scope.version),
      capabilitySchema: String(capability.schemaVersion),
    },
    evaluatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    providerCalls: false,
    credentialPayloadReads: false,
    externalWrites: false,
    secretsIncluded: false,
  };
  assertNoSecretEvidence(manifest);
  return Object.freeze(manifest);
}
