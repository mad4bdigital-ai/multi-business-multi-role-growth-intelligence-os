import { createAuthenticatedPrincipal } from "../domain/model.js";
import {
  assertAuthorizedScopeRepository,
  assertPrincipalRepository,
} from "./repositoryPorts.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationFunction,
  requireApplicationObject,
  requireApplicationString,
  sanitizeApplicationValue,
} from "./applicationSupport.js";

function fail(code, message, status = 403, details = {}) {
  throw new ContextApplicationError(code, message, status, details);
}

function optionalString(value, fieldName) {
  if (value == null || value === "") return null;
  return requireApplicationString(value, fieldName);
}

function uniqueSortedRefs(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array.`);
  return [...new Set(value.map((entry) => requireApplicationString(entry, fieldName)))].sort();
}

function parseOptionalInstant(value, fieldName) {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${fieldName} must be a valid timestamp.`);
  }
  return parsed;
}

function scopeAllows(scopeRefs, tenantRef) {
  return scopeRefs.includes("*") || scopeRefs.includes(tenantRef);
}

function assertActiveWindow({ status, revokedAt, notBefore, expiresAt, prefix, now }) {
  if (revokedAt) {
    fail(`${prefix}_revoked`, `${prefix.replaceAll("_", " ")} has been revoked.`);
  }
  const normalizedStatus = requireApplicationString(status, `${prefix}.status`).toLowerCase();
  if (normalizedStatus !== "active") {
    fail(`${prefix}_status_not_active`, `${prefix.replaceAll("_", " ")} is not active.`);
  }
  const normalizedNotBefore = parseOptionalInstant(notBefore, `${prefix}.notBefore`);
  if (normalizedNotBefore && now.getTime() < normalizedNotBefore.getTime()) {
    fail(`${prefix}_not_yet_active`, `${prefix.replaceAll("_", " ")} is not active yet.`);
  }
  const normalizedExpiresAt = parseOptionalInstant(expiresAt, `${prefix}.expiresAt`);
  if (normalizedExpiresAt && now.getTime() >= normalizedExpiresAt.getTime()) {
    fail(`${prefix}_expired`, `${prefix.replaceAll("_", " ")} has expired.`);
  }
}

function resolveSignedScope({ principalType, registryRefs, signedRefs }) {
  if (principalType === "tenant_user" && signedRefs.length === 0) {
    fail(
      "principal_signed_scope_required",
      "Tenant user authentication evidence must include signed tenant scope.",
    );
  }
  for (const tenantRef of signedRefs) {
    if (!scopeAllows(registryRefs, tenantRef)) {
      fail(
        "principal_signed_scope_mismatch",
        "Signed tenant scope exceeds the authoritative principal record.",
        403,
        { tenant_ref: tenantRef },
      );
    }
  }
  const resolvedRefs = signedRefs.length > 0 ? signedRefs : registryRefs;
  if (principalType === "tenant_user" && resolvedRefs.includes("*")) {
    fail(
      "principal_global_scope_not_allowed",
      "Tenant users cannot resolve to global tenant scope.",
    );
  }
  if (resolvedRefs.length === 0) {
    fail("principal_tenant_scope_empty", "No authorized tenant scope remains.");
  }
  return resolvedRefs;
}

async function revalidateTenantMemberships({
  principalType,
  principalRef,
  tenantRefs,
  authorizedScopeRepository,
}) {
  if (principalType !== "tenant_user") return [];
  const evidence = [];
  for (const tenantRef of tenantRefs) {
    const scope = await authorizedScopeRepository.findAuthorizedScope({
      tenantRef,
      userRef: principalRef,
    });
    const membershipStatus = scope?.membership?.status || null;
    if (!scope || membershipStatus !== "active") {
      fail(
        "principal_membership_not_active",
        "Current tenant membership does not authorize this principal.",
        403,
        { tenant_ref: tenantRef, membership_status: membershipStatus },
      );
    }
    evidence.push({
      tenantRef,
      userRef: principalRef,
      role: scope.membership?.role || null,
      status: membershipStatus,
      sourceRef: scope.membership?.sourceRef || scope.sourceRef || null,
      versionRef: scope.membership?.versionRef || scope.versionRef || null,
      workspaceRefs: (scope.workspaces || [])
        .map((workspace) => workspace.workspaceRef)
        .filter(Boolean)
        .sort(),
    });
  }
  return evidence;
}

export function createPrincipalResolverService({
  principalRepository,
  authorizedScopeRepository,
  clock = () => new Date(),
}) {
  assertPrincipalRepository(principalRepository);
  assertAuthorizedScopeRepository(authorizedScopeRepository);
  requireApplicationFunction(clock, "clock");

  async function resolve(input = {}) {
    const authentication = requireApplicationObject(input.authentication, "authentication");
    const principalType = requireApplicationString(
      authentication.principalType,
      "authentication.principalType",
    );
    const principalRef = requireApplicationString(
      authentication.principalRef,
      "authentication.principalRef",
    );
    const now = input.now instanceof Date ? input.now : clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("clock must return a valid Date.");
    }

    assertActiveWindow({
      status: authentication.status,
      revokedAt: authentication.revokedAt,
      notBefore: authentication.notBefore,
      expiresAt: authentication.expiresAt,
      prefix: "principal_authentication",
      now,
    });

    const record = await principalRepository.findPrincipal({ principalType, principalRef });
    if (!record) {
      fail("principal_not_found", "No authoritative principal record was found.", 404);
    }
    const recordType = requireApplicationString(record.principalType, "principalRecord.principalType");
    const recordRef = requireApplicationString(record.principalRef, "principalRecord.principalRef");
    if (recordRef !== principalRef) {
      fail("principal_reference_mismatch", "Authentication and registry principal references differ.");
    }
    if (recordType !== principalType) {
      fail("principal_type_mismatch", "Authentication and registry principal types differ.");
    }

    assertActiveWindow({
      status: record.status,
      revokedAt: record.revokedAt,
      notBefore: record.validFrom,
      expiresAt: record.expiresAt,
      prefix: "principal",
      now,
    });

    const registryRefs = uniqueSortedRefs(
      record.authorizedTenantRefs,
      "principalRecord.authorizedTenantRefs",
    );
    const signedRefs = uniqueSortedRefs(
      authentication.authorizedTenantRefs,
      "authentication.authorizedTenantRefs",
    );
    const authorizedTenantRefs = resolveSignedScope({
      principalType,
      registryRefs,
      signedRefs,
    });
    const requestedTenantRefs = uniqueSortedRefs(
      input.requestedTenantRefs,
      "requestedTenantRefs",
    );
    for (const tenantRef of requestedTenantRefs) {
      if (!scopeAllows(authorizedTenantRefs, tenantRef)) {
        fail(
          "principal_scope_expansion_not_allowed",
          "Requested tenant scope exceeds the authenticated principal scope.",
          403,
          { tenant_ref: tenantRef },
        );
      }
    }

    const recordAttributes = requireApplicationObject(
      record.attributes || {},
      "principalRecord.attributes",
    );
    if (principalType === "delegated_agent") {
      const authenticationDelegator = optionalString(
        authentication.delegatedByPrincipalRef,
        "authentication.delegatedByPrincipalRef",
      );
      const recordDelegator = optionalString(
        record.delegatedByPrincipalRef || recordAttributes.delegatedByPrincipalRef,
        "principalRecord.delegatedByPrincipalRef",
      );
      if (!authenticationDelegator || !recordDelegator) {
        fail(
          "principal_delegation_evidence_required",
          "Delegated agents require an authoritative delegation chain.",
        );
      }
      if (authenticationDelegator !== recordDelegator) {
        fail(
          "principal_delegation_chain_mismatch",
          "Authentication and registry delegation chains differ.",
        );
      }
    }

    const membershipEvidence = await revalidateTenantMemberships({
      principalType,
      principalRef,
      tenantRefs: authorizedTenantRefs,
      authorizedScopeRepository,
    });
    const principal = createAuthenticatedPrincipal({
      principalType,
      principalRef,
      authorizedTenantRefs,
      attributes: sanitizeApplicationValue(recordAttributes),
    });

    return freezeApplicationValue({
      status: "resolved",
      principal,
      requestedTenantRefs,
      sourceEvidence: {
        authenticationRef: optionalString(
          authentication.authenticationRef,
          "authentication.authenticationRef",
        ),
        authenticationSourceRef: optionalString(
          authentication.sourceRef,
          "authentication.sourceRef",
        ),
        authenticationVersionRef: optionalString(
          authentication.versionRef,
          "authentication.versionRef",
        ),
        principalSourceRef: optionalString(record.sourceRef, "principalRecord.sourceRef"),
        principalVersionRef: optionalString(record.versionRef, "principalRecord.versionRef"),
        membershipEvidence,
      },
      evaluatedAt: now.toISOString(),
      automaticWritePerformed: false,
      providerCallMade: false,
      credentialPayloadRead: false,
      secretsIncluded: false,
    });
  }

  return Object.freeze({ resolve });
}

export const _testingPrincipalResolverService = Object.freeze({
  assertActiveWindow,
  resolveSignedScope,
  scopeAllows,
});
