import {
  RESOURCE_MANIFEST,
  descriptor,
  isAdminPrincipal,
  resourceCapabilities,
  resourceError,
  wrapResource,
} from "../../domain/resourceApi/resourceCatalog.js";
import { requireWorkspaceAssetType } from "../../../workspaceAssetTypeContract.js";

function tenantContext(tenantId, member, auth) {
  return { tenantId, member, auth };
}

function requireResourceType(resourceKey) {
  const resourceDescriptor = descriptor(resourceKey);
  if (!resourceDescriptor) throw resourceError("resource_type_not_found", "Resource type not found.", 404);
  return resourceDescriptor;
}

function requireResource(item, code = "resource_not_found", message = "Resource not found.") {
  if (!item) throw resourceError(code, message, 404);
  return item;
}

function requireAssetOperation(resourceKey, operation) {
  if (resourceKey !== "assets") {
    throw resourceError("operation_not_supported", `${operation} is not enabled for this resource.`, 409);
  }
}

function requireAssetInput(input = {}) {
  if (!input.asset_type || (!input.asset_ref && !input.asset_id) || !input.display_name) {
    throw resourceError(
      "asset_fields_required",
      "asset_type, display_name, and either asset_ref or asset_id are required.",
      400
    );
  }
  input.asset_type = requireWorkspaceAssetType(input.asset_type);
  return input;
}

function ensureSessionAuthorized(auth, session) {
  if (isAdminPrincipal(auth)) return;
  if (!session?.user_id || session.user_id !== auth?.user_id) {
    throw resourceError("forbidden", "Session belongs to a different user.", 403);
  }
}

export function createResourceApiService({
  repository,
  summarizeSession,
  runCoverageAudit,
  deploymentCommitSha = null,
}) {
  if (!repository) throw new TypeError("Resource API service requires a repository.");

  async function requireMembership(auth, tenantId, activeRepository = repository) {
    const member = await activeRepository.findMembership(auth.user_id, tenantId);
    if (!member || member.status !== "active" || member.tenant_status !== "active") {
      throw resourceError("active_membership_required", "Active workspace membership required.", 403);
    }
    return member;
  }

  async function withMutationTransaction(operation) {
    if (typeof repository.withTransaction !== "function") {
      throw resourceError(
        "resource_transaction_unavailable",
        "Resource mutation requires an atomic transaction with verified rollback.",
        503
      );
    }
    return repository.withTransaction(operation);
  }

  function listResourceTypes() {
    return {
      resources: RESOURCE_MANIFEST.resources,
      count: RESOURCE_MANIFEST.resources.length,
      policy: RESOURCE_MANIFEST.new_feature_gate,
    };
  }

  function getResourceType(resourceKey) {
    const resource = RESOURCE_MANIFEST.resources.find((row) => row.resource_key === resourceKey);
    if (!resource) throw resourceError("resource_type_not_found", "Resource type not found.", 404);
    return {
      resource,
      capabilities: resourceCapabilities(resource.resource_key, { admin: true }),
    };
  }

  async function adminListResources(resourceKey, query) {
    requireResourceType(resourceKey);
    return repository.listResource(resourceKey, query);
  }

  async function adminGetResource(resourceKey, resourceId) {
    requireResourceType(resourceKey);
    const item = requireResource(await repository.getResource(resourceKey, resourceId));
    return wrapResource(resourceKey, item, resourceCapabilities(resourceKey, { admin: true, item }));
  }

  async function adminCreateResource(resourceKey, input, auth) {
    requireAssetOperation(resourceKey, "Create");
    requireAssetInput(input);
    if (!input.tenant_id) throw resourceError("tenant_id_required", "tenant_id is required.", 400);
    return withMutationTransaction(async (transactionRepository) => {
      const resourceId = await transactionRepository.insertAsset({
        tenantId: input.tenant_id,
        actorId: auth?.user_id || "platform_admin",
        input,
      });
      const item = requireResource(await transactionRepository.getResource("assets", resourceId));
      return wrapResource("assets", item, resourceCapabilities("assets", { admin: true, item }));
    });
  }

  async function adminUpdateResource(resourceKey, resourceId, input) {
    requireAssetOperation(resourceKey, "Update");
    return withMutationTransaction(async (transactionRepository) => {
      const item = requireResource(await transactionRepository.getResource("assets", resourceId));
      const allowed = resourceCapabilities("assets", { admin: true, item }).canUpdate;
      if (!allowed) throw resourceError("asset_update_forbidden", "Asset update is not permitted.", 403);
      const updated = await transactionRepository.updateAssetFields(resourceId, input);
      if (!updated) throw resourceError("no_supported_update_fields", "No supported fields were supplied.", 400);
      const readback = requireResource(await transactionRepository.getResource("assets", resourceId));
      return wrapResource("assets", readback, resourceCapabilities("assets", { admin: true, item: readback }));
    });
  }

  async function adminSetResourceLifecycle(resourceKey, resourceId, lifecycleStatus) {
    requireAssetOperation(resourceKey, lifecycleStatus === "archived" ? "Archive" : "Restore");
    return withMutationTransaction(async (transactionRepository) => {
      const item = requireResource(await transactionRepository.getResource("assets", resourceId));
      const capabilities = resourceCapabilities("assets", { admin: true, item });
      const allowed = lifecycleStatus === "archived" ? capabilities.canArchive : capabilities.canRestore;
      if (!allowed) throw resourceError("asset_lifecycle_forbidden", `Asset ${lifecycleStatus} is not permitted.`, 403);
      await transactionRepository.setAssetLifecycle(resourceId, lifecycleStatus);
      const readback = requireResource(await transactionRepository.getResource("assets", resourceId));
      return wrapResource("assets", readback, resourceCapabilities("assets", { admin: true, item: readback }));
    });
  }

  async function adminResourcePermissions(resourceKey, resourceId) {
    requireResourceType(resourceKey);
    const item = requireResource(await repository.getResource(resourceKey, resourceId));
    return {
      resourceKey,
      resourceId,
      capabilities: resourceCapabilities(resourceKey, { admin: true, item }),
      authority: "platform_admin",
    };
  }

  async function resourceRevisions(resourceKey, resourceId, context = null) {
    requireResourceType(resourceKey);
    return requireResource(
      await repository.listRevisions(resourceKey, resourceId, context),
      "resource_not_found",
      "Resource not found."
    );
  }

  async function resourceChanges(resourceKey, query, context = null, resourceId = null) {
    requireResourceType(resourceKey);
    return repository.listChanges(resourceKey, query, context, resourceId);
  }

  async function adminCoverageAudit({ persist = true, findingLimit = 250 } = {}) {
    if (!runCoverageAudit) throw resourceError("coverage_auditor_unavailable", "Coverage auditor is unavailable.", 503);
    return runCoverageAudit({
      triggerSource: "admin_api",
      commitSha: deploymentCommitSha,
      persist,
      findingLimit,
    });
  }

  async function adminGetOperation(operationId) {
    const item = requireResource(
      await repository.getResource("executions", operationId),
      "operation_not_found",
      "Operation not found."
    );
    return wrapResource("executions", item, resourceCapabilities("executions", { admin: true, item }));
  }

  async function tenantCatalog(tenantId, auth) {
    const member = await requireMembership(auth, tenantId);
    const resources = RESOURCE_MANIFEST.resources
      .filter((row) => row.tenant)
      .map((row) => ({
        resource_key: row.resource_key,
        display_name: row.display_name,
        operations: row.operations,
        capabilities: resourceCapabilities(row.resource_key, { member, auth }),
      }));
    return { member, resources, count: resources.length };
  }

  async function tenantListResources(tenantId, resourceKey, query, auth) {
    requireResourceType(resourceKey);
    const member = await requireMembership(auth, tenantId);
    return {
      member,
      page: await repository.listResource(resourceKey, query, tenantContext(tenantId, member, auth)),
    };
  }

  async function tenantGetResource(tenantId, resourceKey, resourceId, auth) {
    requireResourceType(resourceKey);
    const member = await requireMembership(auth, tenantId);
    const context = tenantContext(tenantId, member, auth);
    const item = requireResource(await repository.getResource(resourceKey, resourceId, context));
    return {
      member,
      resource: wrapResource(
        resourceKey,
        item,
        resourceCapabilities(resourceKey, { member, item, auth })
      ),
    };
  }

  async function tenantCreateResource(tenantId, resourceKey, input, auth) {
    requireAssetOperation(resourceKey, "Create");
    requireAssetInput(input);
    return withMutationTransaction(async (transactionRepository) => {
      const member = await requireMembership(auth, tenantId, transactionRepository);
      const context = tenantContext(tenantId, member, auth);
      const resourceId = await transactionRepository.insertAsset({ tenantId, actorId: auth.user_id, input });
      const item = requireResource(await transactionRepository.getResource("assets", resourceId, context));
      return wrapResource("assets", item, resourceCapabilities("assets", { member, item, auth }));
    });
  }

  async function tenantUpdateResource(tenantId, resourceKey, resourceId, input, auth) {
    requireAssetOperation(resourceKey, "Update");
    return withMutationTransaction(async (transactionRepository) => {
      const member = await requireMembership(auth, tenantId, transactionRepository);
      const context = tenantContext(tenantId, member, auth);
      const item = requireResource(await transactionRepository.getResource("assets", resourceId, context));
      if (!resourceCapabilities("assets", { member, item, auth }).canUpdate) {
        throw resourceError("asset_update_forbidden", "Asset update is not permitted.", 403);
      }
      const updated = await transactionRepository.updateAssetFields(resourceId, input);
      if (!updated) throw resourceError("no_supported_update_fields", "No supported fields were supplied.", 400);
      const readback = requireResource(await transactionRepository.getResource("assets", resourceId, context));
      return wrapResource("assets", readback, resourceCapabilities("assets", { member, item: readback, auth }));
    });
  }

  async function tenantSetResourceLifecycle(tenantId, resourceKey, resourceId, lifecycleStatus, auth) {
    requireAssetOperation(resourceKey, lifecycleStatus === "archived" ? "Archive" : "Restore");
    return withMutationTransaction(async (transactionRepository) => {
      const member = await requireMembership(auth, tenantId, transactionRepository);
      const context = tenantContext(tenantId, member, auth);
      const item = requireResource(await transactionRepository.getResource("assets", resourceId, context));
      const capabilities = resourceCapabilities("assets", { member, item, auth });
      const allowed = lifecycleStatus === "archived" ? capabilities.canArchive : capabilities.canRestore;
      if (!allowed) throw resourceError("asset_lifecycle_forbidden", `Asset ${lifecycleStatus} is not permitted.`, 403);
      await transactionRepository.setAssetLifecycle(resourceId, lifecycleStatus);
      const readback = requireResource(await transactionRepository.getResource("assets", resourceId, context));
      return wrapResource("assets", readback, resourceCapabilities("assets", { member, item: readback, auth }));
    });
  }

  async function tenantPermissions(tenantId, resourceKey, resourceId, auth) {
    requireResourceType(resourceKey);
    const member = await requireMembership(auth, tenantId);
    const context = tenantContext(tenantId, member, auth);
    const item = requireResource(await repository.getResource(resourceKey, resourceId, context));
    return {
      membership_role: member.role,
      capabilities: resourceCapabilities(resourceKey, { member, item, auth }),
    };
  }

  async function tenantRevisions(tenantId, resourceKey, resourceId, auth) {
    const member = await requireMembership(auth, tenantId);
    return resourceRevisions(resourceKey, resourceId, tenantContext(tenantId, member, auth));
  }

  async function tenantChanges(tenantId, resourceKey, query, auth, resourceId = null) {
    const member = await requireMembership(auth, tenantId);
    return resourceChanges(resourceKey, query, tenantContext(tenantId, member, auth), resourceId);
  }

  async function tenantGetOperation(tenantId, operationId, auth) {
    const member = await requireMembership(auth, tenantId);
    const context = tenantContext(tenantId, member, auth);
    const item = requireResource(
      await repository.getResource("executions", operationId, context),
      "operation_not_found",
      "Operation not found."
    );
    return wrapResource("executions", item, resourceCapabilities("executions", { member, item, auth }));
  }

  async function listSessions(query, auth) {
    const effectiveQuery = { ...query };
    if (!isAdminPrincipal(auth)) {
      if (!auth?.user_id) throw resourceError("authentication_required", "Authentication required.", 401);
      effectiveQuery.user_id = auth.user_id;
      if (auth.tenant_id) effectiveQuery.tenant_id = auth.tenant_id;
    }
    return repository.listResource("sessions", effectiveQuery);
  }

  async function getSession(sessionId, auth) {
    const session = requireResource(
      await repository.getResource("sessions", sessionId),
      "session_not_found",
      "Session not found."
    );
    ensureSessionAuthorized(auth, session);
    return session;
  }

  async function getSessionTurns(sessionId, query, auth) {
    const result = requireResource(
      await repository.listSessionTurns(sessionId, query),
      "session_not_found",
      "Session not found."
    );
    ensureSessionAuthorized(auth, result.session);
    return result;
  }

  async function getSessionSummary(sessionId, auth) {
    const result = requireResource(
      await repository.getSessionSummary(sessionId),
      "session_not_found",
      "Session not found."
    );
    ensureSessionAuthorized(auth, result.session);
    return result;
  }

  async function getSessionEvents(sessionId, query, auth) {
    const result = requireResource(
      await repository.listSessionEvents(sessionId, query),
      "session_not_found",
      "Session not found."
    );
    ensureSessionAuthorized(auth, result.session);
    return result;
  }

  async function getSessionTranscript(sessionId, query, auth) {
    if (String(query.mode || "preview") === "full") {
      throw resourceError(
        "full_transcript_adapter_required",
        "Full transcript retrieval requires a governed Drive adapter.",
        409
      );
    }
    const result = await getSessionTurns(sessionId, { ...query, pageSize: query.pageSize || 100 }, auth);
    return {
      ...result,
      transcript: result.items.map(({ turn_index, role, content_preview, action_key, created_at }) => ({
        turn_index,
        role,
        content_preview,
        action_key,
        created_at,
      })),
    };
  }

  async function generateSessionSummary(sessionId, input, auth) {
    if (!summarizeSession) throw resourceError("session_summary_unavailable", "Session summary generation is unavailable.", 503);
    const session = await getSession(sessionId, auth);
    const generation = await summarizeSession({ session, force: Boolean(input?.force) });
    const readback = await getSessionSummary(sessionId, auth);
    return { generation, summary: readback.summary };
  }

  return {
    listResourceTypes,
    getResourceType,
    adminListResources,
    adminGetResource,
    adminCreateResource,
    adminUpdateResource,
    adminSetResourceLifecycle,
    adminResourcePermissions,
    resourceRevisions,
    resourceChanges,
    adminCoverageAudit,
    adminGetOperation,
    tenantCatalog,
    tenantListResources,
    tenantGetResource,
    tenantCreateResource,
    tenantUpdateResource,
    tenantSetResourceLifecycle,
    tenantPermissions,
    tenantRevisions,
    tenantChanges,
    tenantGetOperation,
    listSessions,
    getSession,
    getSessionTurns,
    getSessionSummary,
    getSessionEvents,
    getSessionTranscript,
    generateSessionSummary,
  };
}

export const _testingResourceApiService = {
  tenantContext,
  requireResourceType,
  requireAssetOperation,
  requireAssetInput,
  ensureSessionAuthorized,
};
