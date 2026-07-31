import {
  assertBrandManagementAuthorityRepository,
  assertConnectionOwnershipRepository,
  assertProviderConnectionAccessRepository,
  assertProviderConsentReadinessRepository,
  assertWorkspaceOwnershipRepository,
} from "./repositoryPorts.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationObject,
  requireApplicationString,
} from "./applicationSupport.js";

const OPERATIONS = new Set(["list", "authorize", "reconnect", "revoke"]);
const MUTATING_OPERATIONS = new Set(["authorize", "reconnect", "revoke"]);
const COMPANY_MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const FORBIDDEN_IDENTITY_FIELDS = Object.freeze([
  "principalRef",
  "userRef",
  "effectiveUserRef",
  "ownerUserRef",
  "ownerScopeType",
  "ownerScopeRef",
]);
const FORBIDDEN_RECONNECT_BINDINGS = Object.freeze([
  "providerKey",
  "expectedConnectionRevision",
  "expectedProviderAccountRef",
  "expectedProviderAccountBindingHash",
  "authorizationRevision",
  "connectionRevision",
]);

function fail(code, message, status = 403, details = {}) {
  throw new ContextApplicationError(code, message, status, details);
}

function optionalString(value, fieldName) {
  if (value == null || value === "") return null;
  return requireApplicationString(value, fieldName);
}

function assertServiceMethod(service, serviceName, methodName) {
  if (!service || typeof service !== "object" || typeof service[methodName] !== "function") {
    throw new TypeError(`${serviceName} with ${methodName} is required.`);
  }
  return service;
}

function rejectCallerAuthority(input, operation) {
  for (const fieldName of FORBIDDEN_IDENTITY_FIELDS) {
    if (Object.hasOwn(input, fieldName)) {
      fail(
        "provider_consent_caller_identity_forbidden",
        "Provider consent identity and owner scope must be derived from authenticated authority.",
        422,
        { field: fieldName },
      );
    }
  }
  if (operation === "reconnect") {
    for (const fieldName of FORBIDDEN_RECONNECT_BINDINGS) {
      if (Object.hasOwn(input, fieldName)) {
        fail(
          "provider_consent_caller_binding_forbidden",
          "Reconnect provider, revision, and account bindings must be derived from the live connection.",
          422,
          { field: fieldName },
        );
      }
    }
  }
}

function normalizeLimit(value) {
  if (value == null || value === "") return 50;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new TypeError("limit must be an integer between 1 and 100.");
  }
  return parsed;
}

function normalizeRequest(operation, input = {}) {
  if (!OPERATIONS.has(operation)) throw new TypeError("Unsupported provider consent operation.");
  const source = requireApplicationObject(input, "providerConsentRequest");
  rejectCallerAuthority(source, operation);
  const authentication = requireApplicationObject(source.authentication, "authentication");
  const tenantRef = requireApplicationString(source.tenantRef, "tenantRef");
  const workspaceRef = requireApplicationString(source.workspaceRef, "workspaceRef");
  const brandRef = optionalString(source.brandRef, "brandRef");
  const connectionRef = optionalString(source.connectionRef, "connectionRef");

  if ((operation === "reconnect" || operation === "revoke") && !connectionRef) {
    throw new TypeError(`${operation} requires connectionRef.`);
  }
  if ((operation === "list" || operation === "authorize") && connectionRef) {
    throw new TypeError(`${operation} does not accept connectionRef.`);
  }

  return Object.freeze({
    authentication,
    tenantRef,
    workspaceRef,
    brandRef,
    connectionRef,
    providerKey:
      operation === "authorize"
        ? requireApplicationString(source.providerKey, "providerKey")
        : null,
    requestedProviderScopes:
      operation === "authorize" || operation === "reconnect"
        ? source.requestedProviderScopes || []
        : [],
    redirectTargetRef:
      operation === "authorize" || operation === "reconnect"
        ? requireApplicationString(source.redirectTargetRef, "redirectTargetRef")
        : null,
    reasonCode:
      operation === "revoke"
        ? optionalString(source.reasonCode, "reasonCode") || "user_requested"
        : null,
    limit: operation === "list" ? normalizeLimit(source.limit) : null,
    cursor: operation === "list" ? optionalString(source.cursor, "cursor") : null,
  });
}

function normalizeReadinessEvidence(evidence, request) {
  if (!evidence || typeof evidence !== "object") {
    fail(
      "provider_consent_runtime_not_ready",
      "Provider consent runtime readiness is unavailable.",
      503,
      { operation: request.operation },
    );
  }
  const status = optionalString(evidence.status, "readiness.status") || "unknown";
  const ready =
    status === "ready"
    && evidence.migrationReadbackVerified === true
    && evidence.applicationUseCasesEnabled === true;
  if (!ready) {
    fail(
      "provider_consent_runtime_not_ready",
      "Provider consent use cases remain blocked until governed readiness is verified.",
      503,
      {
        operation: request.operation,
        readiness_status: status,
        migration_readback_verified: evidence.migrationReadbackVerified === true,
        application_use_cases_enabled: evidence.applicationUseCasesEnabled === true,
        reason_code: optionalString(evidence.reasonCode, "readiness.reasonCode"),
      },
    );
  }
  return Object.freeze({
    status,
    versionRef: optionalString(evidence.versionRef, "readiness.versionRef"),
    migrationReadbackVerified: true,
    applicationUseCasesEnabled: true,
  });
}

async function assertReadiness(repository, operation, request) {
  const evidence = await repository.findProviderConsentReadiness({
    operation,
    tenantRef: request.tenantRef,
    workspaceRef: request.workspaceRef,
    brandRef: request.brandRef,
  });
  return normalizeReadinessEvidence(evidence, { operation });
}

function findMembershipEvidence(resolved, tenantRef) {
  const evidence = resolved?.sourceEvidence?.membershipEvidence;
  if (!Array.isArray(evidence)) return null;
  return evidence.find((entry) => entry?.tenantRef === tenantRef) || null;
}

async function resolveAuthenticatedActor(principalResolverService, request) {
  const resolved = await principalResolverService.resolve({
    authentication: request.authentication,
    requestedTenantRefs: [request.tenantRef],
  });
  const principal = requireApplicationObject(resolved?.principal, "resolvedPrincipal");
  const principalType = requireApplicationString(principal.principalType, "principal.principalType");
  const principalRef = requireApplicationString(principal.principalRef, "principal.principalRef");
  if (principalType !== "tenant_user") {
    fail(
      "provider_consent_tenant_user_required",
      "Provider consent use cases require an authenticated tenant user.",
      403,
      { principal_type: principalType },
    );
  }
  if (!Array.isArray(principal.authorizedTenantRefs) || !principal.authorizedTenantRefs.includes(request.tenantRef)) {
    fail(
      "provider_consent_tenant_scope_rejected",
      "Authenticated tenant scope does not authorize this provider consent request.",
      403,
      { tenant_ref: request.tenantRef },
    );
  }
  const membership = findMembershipEvidence(resolved, request.tenantRef);
  if (!membership || membership.status !== "active") {
    fail(
      "provider_consent_membership_not_active",
      "Current tenant membership does not authorize provider consent.",
      403,
      { tenant_ref: request.tenantRef },
    );
  }
  const workspaceRefs = Array.isArray(membership.workspaceRefs) ? membership.workspaceRefs : [];
  if (!workspaceRefs.includes(request.workspaceRef)) {
    fail(
      "provider_consent_workspace_membership_required",
      "The authenticated user is not an active member of the requested workspace.",
      403,
      { tenant_ref: request.tenantRef, workspace_ref: request.workspaceRef },
    );
  }
  return Object.freeze({
    principalType,
    principalRef,
    userRef: principalRef,
    membershipRole: optionalString(membership.role, "membership.role"),
    authenticationRef: optionalString(
      resolved?.sourceEvidence?.authenticationRef,
      "sourceEvidence.authenticationRef",
    ),
    principalVersionRef: optionalString(
      resolved?.sourceEvidence?.principalVersionRef,
      "sourceEvidence.principalVersionRef",
    ),
    membershipVersionRef: optionalString(
      membership.versionRef,
      "membership.versionRef",
    ),
  });
}

function validateWorkspaceOwnership(record, request) {
  if (!record) {
    fail(
      "provider_consent_workspace_not_found",
      "No authoritative workspace ownership record was found.",
      404,
      { tenant_ref: request.tenantRef, workspace_ref: request.workspaceRef },
    );
  }
  if (record.tenantRef !== request.tenantRef || record.workspaceRef !== request.workspaceRef) {
    fail(
      "provider_consent_workspace_context_mismatch",
      "Workspace ownership does not match the authenticated request context.",
      409,
    );
  }
  const ownershipType = requireApplicationString(
    record.workspaceOwnershipType,
    "workspaceOwnership.workspaceOwnershipType",
  );
  if (ownershipType !== "personal" && ownershipType !== "company") {
    fail(
      "provider_consent_workspace_ownership_unclassified",
      "Workspace ownership is not eligible for provider consent.",
      409,
      { workspace_ownership_type: ownershipType },
    );
  }
  return ownershipType;
}

function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => requireApplicationString(entry, "brandAuthority.permissions[]")))].sort();
}

function brandPermissionAllows(permissions, operation) {
  if (permissions.includes("provider_connection.manage")) return true;
  return operation === "list" && permissions.includes("provider_connection.read");
}

async function resolveOwnerScope({
  operation,
  request,
  actor,
  workspaceOwnershipRepository,
  brandManagementAuthorityRepository,
}) {
  const workspace = await workspaceOwnershipRepository.findWorkspaceOwnership({
    tenantRef: request.tenantRef,
    workspaceRef: request.workspaceRef,
  });
  const ownershipType = validateWorkspaceOwnership(workspace, request);

  if (request.brandRef) {
    if (ownershipType === "personal") {
      fail(
        "provider_consent_brand_on_personal_workspace_forbidden",
        "Brand provider consent cannot be attached to a personal workspace.",
        409,
      );
    }
    const authority = await brandManagementAuthorityRepository.findBrandManagementAuthority({
      tenantRef: request.tenantRef,
      workspaceRef: request.workspaceRef,
      brandRef: request.brandRef,
      principalRef: actor.principalRef,
    });
    if (!authority || authority.status !== "active") {
      fail(
        "provider_consent_brand_authority_required",
        "Active brand-management authority is required.",
        403,
        { brand_ref: request.brandRef },
      );
    }
    if (
      authority.tenantRef !== request.tenantRef
      || authority.workspaceRef !== request.workspaceRef
      || authority.brandRef !== request.brandRef
      || authority.principalRef !== actor.principalRef
    ) {
      fail(
        "provider_consent_brand_authority_mismatch",
        "Brand-management authority does not match the exact authenticated context.",
        409,
      );
    }
    const permissions = normalizePermissions(authority.permissions);
    if (!brandPermissionAllows(permissions, operation)) {
      fail(
        "provider_consent_brand_permission_required",
        "Brand authority does not permit this provider-connection operation.",
        403,
        { operation, brand_ref: request.brandRef },
      );
    }
    return Object.freeze({
      ownerScopeType: "brand",
      ownerScopeRef: request.brandRef,
      brandRef: request.brandRef,
      workspaceOwnershipRevision: Number(workspace.ownershipRevision || 0),
      authorityVersionRef: optionalString(authority.versionRef, "brandAuthority.versionRef"),
    });
  }

  if (ownershipType === "personal") {
    if (workspace.ownerUserRef !== actor.userRef) {
      fail(
        "provider_consent_personal_owner_mismatch",
        "Personal workspace owner does not match the authenticated user.",
        403,
        { workspace_ref: request.workspaceRef },
      );
    }
    return Object.freeze({
      ownerScopeType: "personal_workspace",
      ownerScopeRef: request.workspaceRef,
      brandRef: null,
      workspaceOwnershipRevision: Number(workspace.ownershipRevision || 0),
      authorityVersionRef: actor.membershipVersionRef,
    });
  }

  if (MUTATING_OPERATIONS.has(operation) && !COMPANY_MANAGER_ROLES.has(actor.membershipRole || "")) {
    fail(
      "provider_consent_company_management_required",
      "Company-workspace provider connection changes require owner, admin, or manager membership.",
      403,
      { membership_role: actor.membershipRole || null, operation },
    );
  }
  return Object.freeze({
    ownerScopeType: "company_workspace",
    ownerScopeRef: request.workspaceRef,
    brandRef: null,
    workspaceOwnershipRevision: Number(workspace.ownershipRevision || 0),
    authorityVersionRef: actor.membershipVersionRef,
  });
}

function validateConnectionOwnership(connection, request, ownerScope) {
  if (!connection) {
    fail(
      "provider_consent_connection_not_found",
      "No exact provider connection was found.",
      404,
      { connection_ref: request.connectionRef },
    );
  }
  if (
    connection.tenantRef !== request.tenantRef
    || connection.workspaceRef !== request.workspaceRef
    || connection.connectionRef !== request.connectionRef
  ) {
    fail(
      "provider_consent_connection_context_mismatch",
      "Provider connection does not match the exact tenant and workspace context.",
      409,
    );
  }
  if (
    connection.ownerScopeType !== ownerScope.ownerScopeType
    || connection.ownerScopeRef !== ownerScope.ownerScopeRef
    || (connection.brandRef || null) !== (ownerScope.brandRef || null)
  ) {
    fail(
      "provider_consent_connection_owner_scope_mismatch",
      "Provider connection does not belong to the exact authorized owner scope.",
      409,
    );
  }
  if (connection.status !== "active") {
    fail(
      "provider_consent_connection_not_active",
      "Provider connection is not active.",
      409,
      { connection_status: connection.status || null },
    );
  }
  const connectionRevision = Number(connection.connectionRevision);
  if (!Number.isSafeInteger(connectionRevision) || connectionRevision < 0) {
    fail(
      "provider_consent_connection_revision_invalid",
      "Provider connection revision is invalid.",
      409,
    );
  }
  if (!connection.providerAccountRef && !connection.providerAccountBindingHash) {
    fail(
      "provider_consent_provider_account_binding_missing",
      "Provider connection lacks a durable provider-account binding.",
      409,
    );
  }
  return Object.freeze({
    connectionRef: connection.connectionRef,
    providerKey: requireApplicationString(connection.providerKey, "connection.providerKey"),
    connectionRevision,
    authorizationRevision: Number(connection.authorizationRevision || 0),
    providerAccountRef: optionalString(connection.providerAccountRef, "connection.providerAccountRef"),
    providerAccountBindingHash: optionalString(
      connection.providerAccountBindingHash,
      "connection.providerAccountBindingHash",
    ),
  });
}

async function resolveConnection({
  request,
  actor,
  ownerScope,
  connectionOwnershipRepository,
}) {
  const connection = await connectionOwnershipRepository.findConnectionOwnership({
    tenantRef: request.tenantRef,
    workspaceRef: request.workspaceRef,
    connectionRef: request.connectionRef,
    effectiveUserRef:
      ownerScope.ownerScopeType === "personal_workspace" ? actor.userRef : null,
    brandRef: ownerScope.ownerScopeType === "brand" ? ownerScope.brandRef : null,
  });
  return validateConnectionOwnership(connection, request, ownerScope);
}

function projectConnection(record, request, ownerScope) {
  if (!record || typeof record !== "object") {
    fail("provider_consent_connection_projection_invalid", "Connection projection is invalid.", 409);
  }
  if (
    record.tenantRef !== request.tenantRef
    || record.workspaceRef !== request.workspaceRef
    || record.ownerScopeType !== ownerScope.ownerScopeType
    || record.ownerScopeRef !== ownerScope.ownerScopeRef
    || (record.brandRef || null) !== (ownerScope.brandRef || null)
  ) {
    fail(
      "provider_consent_connection_projection_scope_mismatch",
      "Connection projection escaped the exact authorized owner scope.",
      409,
    );
  }
  return {
    connectionRef: requireApplicationString(record.connectionRef, "connection.connectionRef"),
    providerKey: requireApplicationString(record.providerKey, "connection.providerKey"),
    status: requireApplicationString(record.status, "connection.status"),
    ownerScopeType: ownerScope.ownerScopeType,
    ownerScopeRef: ownerScope.ownerScopeRef,
    brandRef: ownerScope.brandRef,
    connectionRevision: Number(record.connectionRevision || 0),
    authorizationRevision: Number(record.authorizationRevision || 0),
    updatedAt: optionalString(record.updatedAt, "connection.updatedAt"),
  };
}

function baseResult(operation, request, actor, ownerScope, readiness) {
  return {
    operation,
    tenantRef: request.tenantRef,
    workspaceRef: request.workspaceRef,
    brandRef: ownerScope.brandRef,
    ownerScopeType: ownerScope.ownerScopeType,
    ownerScopeRef: ownerScope.ownerScopeRef,
    principalRef: actor.principalRef,
    userRef: actor.userRef,
    readinessVersionRef: readiness.versionRef,
    workspaceOwnershipRevision: ownerScope.workspaceOwnershipRevision,
    authorityVersionRef: ownerScope.authorityVersionRef,
    providerCallMade: false,
    credentialPayloadRead: false,
    secretsIncluded: false,
  };
}

export function createAuthenticatedProviderConsentUseCaseService({
  principalResolverService,
  providerConsentReadinessRepository,
  workspaceOwnershipRepository,
  brandManagementAuthorityRepository,
  connectionOwnershipRepository,
  providerConnectionAccessRepository,
  providerConsentService,
} = {}) {
  const principalResolver = assertServiceMethod(
    principalResolverService,
    "principalResolverService",
    "resolve",
  );
  const readinessRepository = assertProviderConsentReadinessRepository(
    providerConsentReadinessRepository,
  );
  const workspaceRepository = assertWorkspaceOwnershipRepository(workspaceOwnershipRepository);
  const brandAuthorityRepository = assertBrandManagementAuthorityRepository(
    brandManagementAuthorityRepository,
  );
  const connectionRepository = assertConnectionOwnershipRepository(connectionOwnershipRepository);
  const connectionAccessRepository = assertProviderConnectionAccessRepository(
    providerConnectionAccessRepository,
  );
  const consentService = assertServiceMethod(providerConsentService, "providerConsentService", "issue");

  async function authorizeOperation(operation, input) {
    const request = normalizeRequest(operation, input);
    const readiness = await assertReadiness(readinessRepository, operation, request);
    const actor = await resolveAuthenticatedActor(principalResolver, request);
    const ownerScope = await resolveOwnerScope({
      operation,
      request,
      actor,
      workspaceOwnershipRepository: workspaceRepository,
      brandManagementAuthorityRepository: brandAuthorityRepository,
    });
    return { request, readiness, actor, ownerScope };
  }

  async function list(input = {}) {
    const context = await authorizeOperation("list", input);
    const page = await connectionAccessRepository.listProviderConnections({
      tenantRef: context.request.tenantRef,
      workspaceRef: context.request.workspaceRef,
      brandRef: context.ownerScope.brandRef,
      ownerScopeType: context.ownerScope.ownerScopeType,
      ownerScopeRef: context.ownerScope.ownerScopeRef,
      limit: context.request.limit,
      cursor: context.request.cursor,
    });
    const records = Array.isArray(page?.connections) ? page.connections : [];
    const projected = records
      .map((record) => projectConnection(record, context.request, context.ownerScope))
      .sort((left, right) =>
        left.providerKey.localeCompare(right.providerKey)
        || left.connectionRef.localeCompare(right.connectionRef));
    return freezeApplicationValue({
      ...baseResult("list", context.request, context.actor, context.ownerScope, context.readiness),
      connections: projected,
      nextCursor: optionalString(page?.nextCursor, "nextCursor"),
      automaticWritePerformed: false,
    });
  }

  async function authorize(input = {}) {
    const context = await authorizeOperation("authorize", input);
    const issued = await consentService.issue({
      flowType: "authorize",
      providerKey: context.request.providerKey,
      principalRef: context.actor.principalRef,
      userRef: context.actor.userRef,
      tenantRef: context.request.tenantRef,
      workspaceRef: context.request.workspaceRef,
      brandRef: context.ownerScope.brandRef,
      ownerScopeType: context.ownerScope.ownerScopeType,
      ownerScopeRef: context.ownerScope.ownerScopeRef,
      requestedProviderScopes: context.request.requestedProviderScopes,
      redirectTargetRef: context.request.redirectTargetRef,
    });
    return freezeApplicationValue({
      ...baseResult("authorize", context.request, context.actor, context.ownerScope, context.readiness),
      authorizationState: issued.authorizationState,
      stateRef: issued.stateRef,
      providerKey: issued.providerKey,
      expiresAt: issued.expiresAt,
      stateRevision: issued.stateRevision,
      persistedStatus: issued.persistedStatus,
      automaticWritePerformed: true,
    });
  }

  async function reconnect(input = {}) {
    const context = await authorizeOperation("reconnect", input);
    const connection = await resolveConnection({
      request: context.request,
      actor: context.actor,
      ownerScope: context.ownerScope,
      connectionOwnershipRepository: connectionRepository,
    });
    const issued = await consentService.issue({
      flowType: "reconnect",
      providerKey: connection.providerKey,
      principalRef: context.actor.principalRef,
      userRef: context.actor.userRef,
      tenantRef: context.request.tenantRef,
      workspaceRef: context.request.workspaceRef,
      brandRef: context.ownerScope.brandRef,
      ownerScopeType: context.ownerScope.ownerScopeType,
      ownerScopeRef: context.ownerScope.ownerScopeRef,
      targetConnectionRef: connection.connectionRef,
      expectedConnectionRevision: connection.connectionRevision,
      expectedProviderAccountRef: connection.providerAccountRef,
      expectedProviderAccountBindingHash: connection.providerAccountBindingHash,
      requestedProviderScopes: context.request.requestedProviderScopes,
      redirectTargetRef: context.request.redirectTargetRef,
    });
    return freezeApplicationValue({
      ...baseResult("reconnect", context.request, context.actor, context.ownerScope, context.readiness),
      authorizationState: issued.authorizationState,
      stateRef: issued.stateRef,
      providerKey: connection.providerKey,
      connectionRef: connection.connectionRef,
      expectedConnectionRevision: connection.connectionRevision,
      expiresAt: issued.expiresAt,
      stateRevision: issued.stateRevision,
      persistedStatus: issued.persistedStatus,
      automaticWritePerformed: true,
    });
  }

  async function revoke(input = {}) {
    const context = await authorizeOperation("revoke", input);
    const connection = await resolveConnection({
      request: context.request,
      actor: context.actor,
      ownerScope: context.ownerScope,
      connectionOwnershipRepository: connectionRepository,
    });
    const revoked = await connectionAccessRepository.revokeProviderConnection({
      tenantRef: context.request.tenantRef,
      workspaceRef: context.request.workspaceRef,
      brandRef: context.ownerScope.brandRef,
      ownerScopeType: context.ownerScope.ownerScopeType,
      ownerScopeRef: context.ownerScope.ownerScopeRef,
      connectionRef: connection.connectionRef,
      expectedConnectionRevision: connection.connectionRevision,
      principalRef: context.actor.principalRef,
      userRef: context.actor.userRef,
      reasonCode: context.request.reasonCode,
    });
    if (
      !revoked
      || revoked.connectionRef !== connection.connectionRef
      || revoked.status !== "revoked"
      || Number(revoked.connectionRevision) <= connection.connectionRevision
    ) {
      fail(
        "provider_consent_revoke_readback_invalid",
        "Provider connection revocation did not return a valid revision-advancing readback.",
        409,
      );
    }
    return freezeApplicationValue({
      ...baseResult("revoke", context.request, context.actor, context.ownerScope, context.readiness),
      connectionRef: connection.connectionRef,
      providerKey: connection.providerKey,
      status: "revoked",
      previousConnectionRevision: connection.connectionRevision,
      connectionRevision: Number(revoked.connectionRevision),
      reasonCode: context.request.reasonCode,
      automaticWritePerformed: true,
    });
  }

  return Object.freeze({ list, authorize, reconnect, revoke });
}

export const _testingAuthenticatedProviderConsentUseCaseService = Object.freeze({
  brandPermissionAllows,
  normalizeLimit,
  normalizeReadinessEvidence,
  normalizeRequest,
  projectConnection,
  rejectCallerAuthority,
  validateConnectionOwnership,
  validateWorkspaceOwnership,
});