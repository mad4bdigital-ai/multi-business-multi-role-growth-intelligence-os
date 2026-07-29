import {
  createAuthenticatedPrincipal,
  deepFreeze,
} from "../domain/model.js";

const PRINCIPAL_TYPES = new Set([
  "tenant_user",
  "admin",
  "service_principal",
  "delegated_agent",
  "registry_defined",
]);

const SECRET_ATTRIBUTE_PATTERN =
  /(authorization|access[_-]?token|refresh[_-]?token|secret|password|credential|private[_-]?key|api[_-]?key)/i;

export class PrincipalResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PrincipalResolutionError";
    this.code = code;
    this.details = deepFreeze({ ...details });
  }
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value;
}

function requireString(value, field, maximumLength = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string.`);
  if (normalized.length > maximumLength) {
    throw new TypeError(`${field} must not exceed ${maximumLength} characters.`);
  }
  return normalized;
}

function optionalString(value, field, maximumLength = 191) {
  if (value === null || value === undefined || value === "") return null;
  return requireString(value, field, maximumLength);
}

function normalizeTimestamp(value, field, { required = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (!required) return null;
    throw new TypeError(`${field} must be a valid timestamp.`);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be a valid timestamp.`);
  }
  return parsed;
}

function normalizeStringArray(values, field) {
  if (values === null || values === undefined) return [];
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array.`);
  return [...new Set(values.map((value) => requireString(value, field)))].sort();
}

function sanitizeAttributeValue(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeAttributeValue(item));
  if (!value || typeof value !== "object") return value;

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SECRET_ATTRIBUTE_PATTERN.test(key)) continue;
    sanitized[key] = sanitizeAttributeValue(nestedValue);
  }
  return sanitized;
}

function sanitizeAttributes(attributes) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return {};
  }
  return sanitizeAttributeValue(attributes);
}

function includesTenantScope(scopes, tenantRef) {
  return scopes.includes("*") || scopes.includes(tenantRef);
}

function intersectTenantScopes(...scopeSets) {
  const explicitCandidates = new Set(
    scopeSets.flatMap((scopes) => scopes.filter((scope) => scope !== "*")),
  );
  return [...explicitCandidates]
    .filter((tenantRef) =>
      scopeSets.every((scopes) => includesTenantScope(scopes, tenantRef)),
    )
    .sort();
}

function normalizeScopeReadback(result) {
  if (Array.isArray(result)) {
    return {
      tenantRefs: normalizeStringArray(result, "authorizedScope.tenantRefs"),
      sourceRef: "authorized_scope_repository",
      version: "unversioned",
    };
  }

  const normalized = requireObject(result, "authorizedScope");
  return {
    tenantRefs: normalizeStringArray(
      normalized.tenantRefs ?? normalized.authorizedTenantRefs,
      "authorizedScope.tenantRefs",
    ),
    sourceRef: requireString(
      normalized.sourceRef ?? "authorized_scope_repository",
      "authorizedScope.sourceRef",
    ),
    version: requireString(
      normalized.version ?? normalized.revision ?? "unversioned",
      "authorizedScope.version",
    ),
  };
}

function validateRepository(repository, methodName, repositoryName) {
  if (!repository || typeof repository[methodName] !== "function") {
    throw new TypeError(`${repositoryName}.${methodName} must be a function.`);
  }
}

function fail(code, message, details = {}) {
  throw new PrincipalResolutionError(code, message, details);
}

export function createPrincipalResolverService({
  principalRepository,
  authorizedScopeRepository,
  clock = () => new Date(),
} = {}) {
  validateRepository(principalRepository, "findPrincipal", "principalRepository");
  validateRepository(
    authorizedScopeRepository,
    "listAuthorizedTenantRefs",
    "authorizedScopeRepository",
  );
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  return Object.freeze({
    async resolve({
      authenticationEvidence,
      requestedPrincipalRef = null,
      requestedPrincipalType = null,
      requestedTenantRefs = [],
    } = {}) {
      const evidence = requireObject(authenticationEvidence, "authenticationEvidence");
      const evaluatedAt = normalizeTimestamp(clock(), "clock");
      const principalRef = requireString(evidence.principalRef, "principalRef");
      const principalType = requireString(
        evidence.principalType,
        "principalType",
        64,
      ).toLowerCase();

      if (!PRINCIPAL_TYPES.has(principalType)) {
        fail("principal_type_unsupported", "The authenticated principal type is unsupported.", {
          principalType,
        });
      }

      const requestedRef = optionalString(
        requestedPrincipalRef,
        "requestedPrincipalRef",
      );
      const requestedType = optionalString(
        requestedPrincipalType,
        "requestedPrincipalType",
        64,
      )?.toLowerCase();
      if (requestedRef && requestedRef !== principalRef) {
        fail(
          "principal_identity_override_rejected",
          "Request input cannot replace the authenticated principal reference.",
        );
      }
      if (requestedType && requestedType !== principalType) {
        fail(
          "principal_identity_override_rejected",
          "Request input cannot replace the authenticated principal type.",
        );
      }

      const evidenceStatus = requireString(
        evidence.status ?? "authenticated",
        "authenticationEvidence.status",
        64,
      ).toLowerCase();
      if (evidenceStatus !== "authenticated") {
        fail(
          "authentication_evidence_not_authenticated",
          "Authentication evidence is not in an authenticated state.",
        );
      }

      const authenticatedAt = normalizeTimestamp(
        evidence.authenticatedAt,
        "authenticationEvidence.authenticatedAt",
      );
      const evidenceExpiresAt = normalizeTimestamp(
        evidence.expiresAt,
        "authenticationEvidence.expiresAt",
      );
      if (authenticatedAt.getTime() > evaluatedAt.getTime()) {
        fail(
          "authentication_evidence_not_yet_valid",
          "Authentication evidence is not yet valid.",
        );
      }
      if (evidenceExpiresAt.getTime() <= evaluatedAt.getTime()) {
        fail(
          "authentication_evidence_expired",
          "Authentication evidence has expired.",
        );
      }

      const evidenceRef = requireString(
        evidence.evidenceRef,
        "authenticationEvidence.evidenceRef",
      );
      const evidenceVersion = requireString(
        evidence.version ?? evidence.evidenceVersion,
        "authenticationEvidence.version",
      );
      const signedTenantRefs = normalizeStringArray(
        evidence.authorizedTenantRefs,
        "authenticationEvidence.authorizedTenantRefs",
      );
      const normalizedRequestedTenantRefs = normalizeStringArray(
        requestedTenantRefs,
        "requestedTenantRefs",
      );

      if (
        (principalType === "tenant_user" || principalType === "delegated_agent") &&
        signedTenantRefs.includes("*")
      ) {
        fail(
          "principal_global_scope_forbidden",
          "Tenant and delegated principals cannot carry global tenant scope.",
        );
      }

      const principalRecord = await principalRepository.findPrincipal({
        principalRef,
        principalType,
      });
      if (!principalRecord) {
        fail("principal_not_found", "The authenticated principal is not registered.", {
          principalRef,
        });
      }

      const record = requireObject(principalRecord, "principalRecord");
      if (requireString(record.principalRef, "principalRecord.principalRef") !== principalRef) {
        fail(
          "principal_ref_mismatch",
          "The registered principal reference does not match authentication evidence.",
        );
      }
      if (
        requireString(record.principalType, "principalRecord.principalType", 64).toLowerCase() !==
        principalType
      ) {
        fail(
          "principal_type_mismatch",
          "The registered principal type does not match authentication evidence.",
        );
      }

      const recordStatus = requireString(
        record.status ?? "active",
        "principalRecord.status",
        64,
      ).toLowerCase();
      if (recordStatus === "revoked" || record.revokedAt) {
        fail("principal_revoked", "The registered principal has been revoked.");
      }
      if (recordStatus !== "active") {
        fail("principal_inactive", "The registered principal is not active.", {
          status: recordStatus,
        });
      }

      const principalValidFrom = normalizeTimestamp(
        record.validFrom,
        "principalRecord.validFrom",
        { required: false },
      );
      const principalExpiresAt = normalizeTimestamp(
        record.expiresAt,
        "principalRecord.expiresAt",
        { required: false },
      );
      if (principalValidFrom && principalValidFrom.getTime() > evaluatedAt.getTime()) {
        fail("principal_not_yet_active", "The registered principal is not yet active.");
      }
      if (principalExpiresAt && principalExpiresAt.getTime() <= evaluatedAt.getTime()) {
        fail("principal_expired", "The registered principal has expired.");
      }

      const principalSourceRef = requireString(
        record.sourceRef,
        "principalRecord.sourceRef",
      );
      const principalVersion = requireString(
        record.version ?? record.revision,
        "principalRecord.version",
      );
      const registryTenantRefs = normalizeStringArray(
        record.authorizedTenantRefs,
        "principalRecord.authorizedTenantRefs",
      );

      const authenticatedDelegatorRef = optionalString(
        evidence.delegatedByPrincipalRef,
        "authenticationEvidence.delegatedByPrincipalRef",
      );
      const registeredDelegatorRef = optionalString(
        record.delegatedByPrincipalRef,
        "principalRecord.delegatedByPrincipalRef",
      );
      if (principalType === "delegated_agent") {
        if (!authenticatedDelegatorRef || !registeredDelegatorRef) {
          fail(
            "delegation_chain_required",
            "Delegated agents require authenticated and registered delegation evidence.",
          );
        }
        if (authenticatedDelegatorRef !== registeredDelegatorRef) {
          fail(
            "delegation_chain_mismatch",
            "Delegated-agent authentication and registry chains do not match.",
          );
        }
      }

      let resolvedTenantRefs;
      let scopeEvidence = {
        sourceRef: "principal_registry",
        version: principalVersion,
      };

      const globalPrincipal =
        principalType === "admin" ||
        (principalType === "service_principal" &&
          signedTenantRefs.includes("*") &&
          registryTenantRefs.includes("*"));

      if (globalPrincipal) {
        if (!signedTenantRefs.includes("*") || !registryTenantRefs.includes("*")) {
          fail(
            "principal_global_scope_unverified",
            "Global principal scope must be present in authentication and registry evidence.",
          );
        }
        resolvedTenantRefs = ["*"];
      } else {
        const scopeReadback = normalizeScopeReadback(
          await authorizedScopeRepository.listAuthorizedTenantRefs({
            principalRef,
            principalType,
          }),
        );
        scopeEvidence = {
          sourceRef: scopeReadback.sourceRef,
          version: scopeReadback.version,
        };
        resolvedTenantRefs = intersectTenantScopes(
          signedTenantRefs,
          registryTenantRefs,
          scopeReadback.tenantRefs,
        );
        if (resolvedTenantRefs.length === 0) {
          fail(
            "principal_scope_unresolved",
            "No tenant scope is authorized by authentication, registry, and current membership evidence.",
          );
        }
      }

      for (const tenantRef of normalizedRequestedTenantRefs) {
        if (!includesTenantScope(resolvedTenantRefs, tenantRef)) {
          fail(
            "principal_scope_expansion_rejected",
            "Request input cannot expand the authenticated principal tenant scope.",
            { tenantRef },
          );
        }
      }

      const selectedTenantRefs =
        normalizedRequestedTenantRefs.length > 0
          ? normalizedRequestedTenantRefs
          : resolvedTenantRefs;
      const sanitizedAttributes = sanitizeAttributes(record.attributes);
      const principal = createAuthenticatedPrincipal({
        principalType,
        principalRef,
        authorizedTenantRefs: selectedTenantRefs,
        attributes: {
          ...sanitizedAttributes,
          authenticationEvidenceRef: evidenceRef,
          authenticationEvidenceVersion: evidenceVersion,
          principalSourceRef,
          principalVersion,
          authorizedScopeSourceRef: scopeEvidence.sourceRef,
          authorizedScopeVersion: scopeEvidence.version,
          delegatedByPrincipalRef: registeredDelegatorRef,
        },
      });

      return deepFreeze({
        status: "resolved",
        principal,
        resolvedTenantRefs: selectedTenantRefs,
        sourceEvidence: {
          authentication: {
            evidenceRef,
            version: evidenceVersion,
            authenticatedAt: authenticatedAt.toISOString(),
            expiresAt: evidenceExpiresAt.toISOString(),
          },
          principalRegistry: {
            sourceRef: principalSourceRef,
            version: principalVersion,
          },
          authorizedScope: scopeEvidence,
        },
        evaluatedAt: evaluatedAt.toISOString(),
        automaticWritePerformed: false,
        providerCallMade: false,
        secretsIncluded: false,
      });
    },
  });
}
