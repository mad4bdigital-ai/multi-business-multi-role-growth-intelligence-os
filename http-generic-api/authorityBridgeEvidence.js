export async function writeAuthorityBridgeDriftEvidence(plan = {}, authorityBridge = {}, deps = {}) {
  if (!Number(authorityBridge.blocker_count || 0)) {
    return { required: false, ok: true, secrets_included: false };
  }
  const writer = deps.writeExecutionEvidence ||
    (await import("./executionEvidenceLogger.js")).writeExecutionEvidence;
  const traceId = plan.plan_id || plan.run_id;
  if (!traceId) {
    return { required: true, ok: false, error: "authority_bridge_trace_id_missing", secrets_included: false };
  }
  try {
    const evidence = await writer({
      pool: deps.pool,
      traceId,
      entryType: "agent_authority_bridge_drift",
      executionClass: "agent_runtime_authority",
      sourceLayer: "governed_agent_execution_context",
      executionMode: authorityBridge.mode || "observe_only",
      decisionTrigger: "pre_model_authority_resolution",
      executionStatus: authorityBridge.allowed === false ? "failed" : "success_with_warnings",
      outputSummary: {
        authority_mode: authorityBridge.mode || "observe_only",
        authority_allowed: authorityBridge.allowed !== false,
        blocker_count: Number(authorityBridge.blocker_count || 0),
        blocker_codes: (authorityBridge.blockers || []).map((blocker) => blocker.code).filter(Boolean),
        secrets_included: false,
      },
      tenantId: plan.tenant_id,
      userId: plan.user_id,
      actorId: plan.actor_id || plan.agent_id || plan.user_id,
      actorType: plan.actor_id || plan.user_id ? "user" : "agent",
      brandKey: plan.brand_key || plan.target_key,
      parentActionKey: "agent_authority_bridge_resolve",
      resourceType: "execution_plan",
      resourceId: plan.plan_id || null,
      targetType: "agent_runtime",
      targetId: plan.agent_id || null,
      correlationId: traceId,
      idempotencyKey: `authority-bridge:${traceId}:${authorityBridge.mode || "observe_only"}`,
    });
    return {
      required: true,
      ok: evidence?.ok === true && Boolean(evidence?.row?.id),
      execution_log_id: evidence?.row?.id || null,
      execution_status: evidence?.row?.execution_status || null,
      trace_id: evidence?.trace_id || traceId,
      secrets_included: false,
    };
  } catch (error) {
    return {
      required: true,
      ok: false,
      error: error?.code || error?.message || "authority_bridge_execution_log_write_failed",
      secrets_included: false,
    };
  }
}
