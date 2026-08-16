import { assertActAsUserExecutionContext, resolveActAsUserExecutionContext } from "./actAsUserExecutionPolicy.js";

function adapterError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredMethod(repository, method, label) {
  if (!repository || typeof repository[method] !== "function") {
    throw adapterError("act_as_user_adapter_dependency_missing", `${label}.${method} is required.`);
  }
  return repository[method].bind(repository);
}

export function createActAsUserRuntimeAdapter({
  sessionRepository,
  revocationRepository,
  auditRepository,
  readbackRepository,
  now = () => new Date(),
  liveExecutionEnabled = false,
  shadowOnly = false,
} = {}) {
  const sessionRead = requiredMethod(sessionRepository, "read", "sessionRepository");
  const sessionCreate = requiredMethod(sessionRepository, "create", "sessionRepository");
  const sessionRevoke = requiredMethod(sessionRepository, "revoke", "sessionRepository");
  const isRevoked = requiredMethod(revocationRepository, "isRevoked", "revocationRepository");
  const auditAppend = requiredMethod(auditRepository, "append", "auditRepository");
  const readbackRecord = requiredMethod(readbackRepository, "record", "readbackRepository");

  async function createSession(input) {
    if (liveExecutionEnabled !== true && shadowOnly !== true) {
      throw adapterError("act_as_user_live_execution_disabled", "Live Act-as-User session creation is disabled; use the shadow adapter contract.");
    }
    const context = resolveActAsUserExecutionContext({ ...input, now: now() });
    const session = await sessionCreate({
      ...context,
      sessionType: "act_as_user",
      liveExecutionEnabled: liveExecutionEnabled === true,
      shadowOnly: shadowOnly === true,
    });
    await auditAppend({ event: "act_as_user_session_created", actorId: context.actorId, targetId: context.targetId, tenantId: context.tenantId, sessionId: session?.sessionId || null, secretsIncluded: false });
    return Object.freeze({ ...context, sessionId: session?.sessionId || null, status: shadowOnly ? "shadow" : "live" });
  }

  async function authorizeDispatch({ sessionId, requestedOperation, requestedTool, request } = {}) {
    const session = await sessionRead(sessionId);
    if (!session) throw adapterError("act_as_user_session_not_found", "Act-as-User session was not found.");
    if (await isRevoked(sessionId)) throw adapterError("act_as_user_revoked", "Act-as-User session has been revoked.");
    const context = assertActAsUserExecutionContext(session.context || session, { now: now() });
    if (context.requestedOperation !== requestedOperation || (context.requestedTool && context.requestedTool !== requestedTool)) {
      throw adapterError("act_as_user_dispatch_scope_mismatch", "Dispatch request does not match the immutable Act-as-User session scope.");
    }
    await auditAppend({ event: "act_as_user_dispatch_authorized", actorId: context.actorId, targetId: context.targetId, tenantId: context.tenantId, sessionId, requestedOperation, requestedTool: requestedTool || null, requestId: request?.requestId || null, secretsIncluded: false });
    return Object.freeze({ ...context, sessionId, dispatchAuthorized: true });
  }

  async function revokeSession({ sessionId, reason } = {}) {
    const result = await sessionRevoke(sessionId, reason || "revoked");
    await auditAppend({ event: "act_as_user_session_revoked", sessionId, reason: reason || "revoked", secretsIncluded: false });
    return result;
  }

  async function recordReadback({ sessionId, context, readback } = {}) {
    if (!context?.dispatchAuthorized) throw adapterError("act_as_user_readback_context_required", "Authorized Act-as-User context is required for readback.");
    const result = await readbackRecord({ sessionId, actorId: context.actorId, targetId: context.targetId, tenantId: context.tenantId, readback, secretsIncluded: false });
    await auditAppend({ event: "act_as_user_readback_recorded", sessionId, actorId: context.actorId, targetId: context.targetId, tenantId: context.tenantId, secretsIncluded: false });
    return result;
  }

  return Object.freeze({ createSession, authorizeDispatch, revokeSession, recordReadback });
}

export function createActAsUserShadowAdapter({ now = () => new Date() } = {}) {
  const sessions = new Map();
  const revoked = new Set();
  const audit = [];
  const readbacks = [];
  const adapter = createActAsUserRuntimeAdapter({
    now,
    liveExecutionEnabled: false,
    shadowOnly: true,
    sessionRepository: {
      async create(session) {
        const sessionId = `shadow-act-as-user-${sessions.size + 1}`;
        sessions.set(sessionId, { sessionId, context: session });
        return { sessionId };
      },
      async read(sessionId) { return sessions.get(sessionId) || null; },
      async revoke(sessionId, reason) { revoked.add(sessionId); return { sessionId, revoked: true, reason }; },
    },
    revocationRepository: { async isRevoked(sessionId) { return revoked.has(sessionId); } },
    auditRepository: { async append(event) { audit.push(Object.freeze({ ...event })); } },
    readbackRepository: { async record(readback) { readbacks.push(Object.freeze({ ...readback })); return { recorded: true }; } },
  });
  return Object.freeze({ adapter, sessions, revoked, audit, readbacks });
}
