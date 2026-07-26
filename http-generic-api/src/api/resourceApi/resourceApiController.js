import { parsePageSize, resourceError } from "../../domain/resourceApi/resourceCatalog.js";

export function errorEnvelope(code, message, details = undefined) {
  return {
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
    secrets_included: false,
  };
}

export function replyResourceError(res, error, fallbackCode) {
  const status = Number(error?.status) || 500;
  return res.status(status).json(
    errorEnvelope(error?.code || fallbackCode, error?.message || "Unexpected resource API failure.", error?.details)
  );
}

function success(body = {}) {
  return { ok: true, ...body, secrets_included: false };
}

function handler(fallbackCode, callback) {
  return async (req, res) => {
    try {
      const result = await callback(req, res);
      if (result === undefined || res.headersSent) return result;
      const status = Number(result.status) || 200;
      return res.status(status).json(success(result.body || result));
    } catch (error) {
      return replyResourceError(res, error, fallbackCode);
    }
  };
}

export function createResourceApiController({ service }) {
  if (!service) throw new TypeError("Resource API controller requires an application service.");

  const adminResourceTypes = handler("resource_types_list_failed", async () => ({
    body: service.listResourceTypes(),
  }));

  const adminResourceType = handler("resource_type_get_failed", async (req) => ({
    body: service.getResourceType(req.params.resourceKey),
  }));

  const adminResourcesList = handler("resource_list_failed", async (req) => ({
    body: {
      resourceKey: req.params.resourceKey,
      ...(await service.adminListResources(req.params.resourceKey, req.query)),
    },
  }));

  const adminResourceGet = handler("resource_get_failed", async (req) => ({
    body: {
      resource: await service.adminGetResource(req.params.resourceKey, req.params.resourceId),
    },
  }));

  const adminResourceCreate = handler("resource_create_failed", async (req) => ({
    status: 201,
    body: {
      resource: await service.adminCreateResource(req.params.resourceKey, req.body || {}, req.auth),
      readback: "same_cycle",
    },
  }));

  const adminResourceUpdate = handler("resource_update_failed", async (req) => ({
    body: {
      resource: await service.adminUpdateResource(req.params.resourceKey, req.params.resourceId, req.body || {}),
      readback: "same_cycle",
    },
  }));

  const adminResourceArchive = handler("resource_archive_failed", async (req) => ({
    body: {
      resource: await service.adminSetResourceLifecycle(req.params.resourceKey, req.params.resourceId, "archived"),
      readback: "same_cycle",
    },
  }));

  const adminResourceRestore = handler("resource_restore_failed", async (req) => ({
    body: {
      resource: await service.adminSetResourceLifecycle(req.params.resourceKey, req.params.resourceId, "active"),
      readback: "same_cycle",
    },
  }));

  const adminResourcePurge = (req, res) => res.status(409).json(
    errorEnvelope("purge_not_enabled", "Hard purge is disabled. Use governed archive and retention policies.")
  );

  const adminResourcePermissions = handler("resource_permissions_failed", async (req) => ({
    body: await service.adminResourcePermissions(req.params.resourceKey, req.params.resourceId),
  }));

  const adminResourceRevisions = handler("resource_revisions_failed", async (req) => {
    const result = await service.resourceRevisions(req.params.resourceKey, req.params.resourceId);
    return { body: { ...result, count: result.revisions.length } };
  });

  const adminResourceItemChanges = handler("resource_changes_failed", async (req) => {
    const result = await service.resourceChanges(
      req.params.resourceKey,
      req.query,
      null,
      req.params.resourceId
    );
    return { body: { ...result, count: result.items.length } };
  });

  const adminResourceChanges = handler("resource_changes_failed", async (req) => {
    if (!req.query.resourceKey) throw resourceError("resource_key_required", "resourceKey is required.", 400);
    return { body: await service.resourceChanges(req.query.resourceKey, req.query) };
  });

  const adminCoverageAudit = handler("resource_coverage_audit_failed", async (req) => ({
    body: await service.adminCoverageAudit({
      persist: String(req.query.persist || "true") !== "false",
      findingLimit: parsePageSize(req.query.limit, 250),
    }),
  }));

  const adminOperationGet = handler("operation_get_failed", async (req) => ({
    body: { operation: await service.adminGetOperation(req.params.operationId) },
  }));

  const tenantCatalog = handler("tenant_resource_catalog_failed", async (req) => {
    const result = await service.tenantCatalog(req.params.tenant_id, req.auth);
    return {
      body: {
        tenant_id: req.params.tenant_id,
        resources: result.resources,
        count: result.count,
      },
    };
  });

  const tenantResourcesList = handler("tenant_resource_list_failed", async (req) => {
    const result = await service.tenantListResources(
      req.params.tenant_id,
      req.params.resourceKey,
      req.query,
      req.auth
    );
    return {
      body: {
        tenant_id: req.params.tenant_id,
        resourceKey: req.params.resourceKey,
        ...result.page,
      },
    };
  });

  const tenantResourceGet = handler("tenant_resource_get_failed", async (req) => {
    const result = await service.tenantGetResource(
      req.params.tenant_id,
      req.params.resourceKey,
      req.params.resourceId,
      req.auth
    );
    return { body: { resource: result.resource } };
  });

  const tenantResourceCreate = handler("tenant_resource_create_failed", async (req) => ({
    status: 201,
    body: {
      resource: await service.tenantCreateResource(
        req.params.tenant_id,
        req.params.resourceKey,
        req.body || {},
        req.auth
      ),
      readback: "same_cycle",
    },
  }));

  const tenantResourceUpdate = handler("tenant_resource_update_failed", async (req) => ({
    body: {
      resource: await service.tenantUpdateResource(
        req.params.tenant_id,
        req.params.resourceKey,
        req.params.resourceId,
        req.body || {},
        req.auth
      ),
      readback: "same_cycle",
    },
  }));

  const tenantResourceArchive = handler("tenant_resource_archive_failed", async (req) => ({
    body: {
      resource: await service.tenantSetResourceLifecycle(
        req.params.tenant_id,
        req.params.resourceKey,
        req.params.resourceId,
        "archived",
        req.auth
      ),
      readback: "same_cycle",
    },
  }));

  const tenantResourceRestore = handler("tenant_resource_restore_failed", async (req) => ({
    body: {
      resource: await service.tenantSetResourceLifecycle(
        req.params.tenant_id,
        req.params.resourceKey,
        req.params.resourceId,
        "active",
        req.auth
      ),
      readback: "same_cycle",
    },
  }));

  const tenantResourcePermissions = handler("tenant_resource_permissions_failed", async (req) => ({
    body: await service.tenantPermissions(
      req.params.tenant_id,
      req.params.resourceKey,
      req.params.resourceId,
      req.auth
    ),
  }));

  const tenantResourceRevisions = handler("tenant_resource_revisions_failed", async (req) => {
    const result = await service.tenantRevisions(
      req.params.tenant_id,
      req.params.resourceKey,
      req.params.resourceId,
      req.auth
    );
    return { body: { ...result, count: result.revisions.length } };
  });

  const tenantResourceItemChanges = handler("tenant_resource_changes_failed", async (req) => {
    const result = await service.tenantChanges(
      req.params.tenant_id,
      req.params.resourceKey,
      req.query,
      req.auth,
      req.params.resourceId
    );
    return { body: { ...result, count: result.items.length } };
  });

  const tenantResourceChanges = handler("tenant_resource_changes_failed", async (req) => {
    if (!req.query.resourceKey) throw resourceError("resource_key_required", "resourceKey is required.", 400);
    return {
      body: await service.tenantChanges(
        req.params.tenant_id,
        req.query.resourceKey,
        req.query,
        req.auth
      ),
    };
  });

  const tenantOperationGet = handler("tenant_operation_get_failed", async (req) => ({
    body: {
      operation: await service.tenantGetOperation(
        req.params.tenant_id,
        req.params.operationId,
        req.auth
      ),
    },
  }));

  const sessionList = handler("session_list_failed", async (req) => {
    const page = await service.listSessions(req.query, req.auth);
    return {
      body: {
        sessions: page.items,
        count: page.count,
        nextPageToken: page.nextPageToken,
      },
    };
  });

  const sessionGet = handler("session_get_failed", async (req) => ({
    body: { session: await service.getSession(req.params.id, req.auth) },
  }));

  const sessionTurns = handler("session_turns_failed", async (req) => {
    const result = await service.getSessionTurns(req.params.id, req.query, req.auth);
    return {
      body: {
        session_id: req.params.id,
        turns: result.items,
        count: result.items.length,
        nextAfter: result.nextAfter,
        full_content_returned: false,
      },
    };
  });

  const sessionSummary = handler("session_summary_failed", async (req) => {
    const result = await service.getSessionSummary(req.params.id, req.auth);
    return { body: { session_id: req.params.id, summary: result.summary } };
  });

  const sessionEvents = handler("session_events_failed", async (req) => {
    const result = await service.getSessionEvents(req.params.id, req.query, req.auth);
    return {
      body: {
        session_id: req.params.id,
        events: result.items,
        count: result.items.length,
      },
    };
  });

  const sessionTranscript = handler("session_transcript_failed", async (req) => {
    const result = await service.getSessionTranscript(req.params.id, req.query, req.auth);
    return {
      body: {
        session_id: req.params.id,
        mode: "preview",
        transcript: result.transcript,
        count: result.transcript.length,
        nextAfter: result.nextAfter,
        full_content_storage: "drive_doc_and_jsonl",
        full_content_returned: false,
      },
    };
  });

  const sessionSummaryGenerate = handler("session_summary_generate_failed", async (req) => {
    const result = await service.generateSessionSummary(req.params.id, req.body || {}, req.auth);
    return {
      body: {
        session_id: req.params.id,
        generation: result.generation,
        summary: result.summary,
        readback: "same_cycle",
      },
    };
  });

  return {
    adminResourceTypes,
    adminResourceType,
    adminResourcesList,
    adminResourceGet,
    adminResourceCreate,
    adminResourceUpdate,
    adminResourceArchive,
    adminResourceRestore,
    adminResourcePurge,
    adminResourcePermissions,
    adminResourceRevisions,
    adminResourceItemChanges,
    adminResourceChanges,
    adminCoverageAudit,
    adminOperationGet,
    tenantCatalog,
    tenantResourcesList,
    tenantResourceGet,
    tenantResourceCreate,
    tenantResourceUpdate,
    tenantResourceArchive,
    tenantResourceRestore,
    tenantResourcePermissions,
    tenantResourceRevisions,
    tenantResourceItemChanges,
    tenantResourceChanges,
    tenantOperationGet,
    sessionList,
    sessionGet,
    sessionTurns,
    sessionSummary,
    sessionEvents,
    sessionTranscript,
    sessionSummaryGenerate,
  };
}

export const _testingResourceApiController = { success, handler };
