import { createHash, randomUUID } from "node:crypto";
import { resolveAccess } from "./accessDecisionEngine.js";
import { createOrAppendSupportTicketWithIntegrityAtomic } from "./supportTicketLifecycleIntegrityCreationService.js";
import {
  MANAGED_STEP_TYPES,
  OPEN_PARENT_STATUSES,
  assertManagedExecutionPayloadSecretFree,
  assertManagedExecutionStepEligibility,
  buildManagedAuthoritySnapshot,
  managedError,
  normalizeManagedExecutionEnvelope,
  optionalString,
  requiredString,
  resolveManagedExecutionGate,
} from "./managedExecutionCore.js";
import { assertManagedExecutionAuthorityStillEffective, resolveManagedExecutionAuthority } from "./managedExecutionAuthority.js";
import { appendManagedEvent, withManagedTransaction } from "./managedExecutionPersistence.js";

export async function createManagedExecutionStep({ pool, runId, input = {}, actorId = null }) {
  const stepKey = requiredString(input.step_key, "step_key", 128);
  const stepType = optionalString(input.step_type, 32) || "action";
  if (!MANAGED_STEP_TYPES.has(stepType)) throw managedError(400, "managed_execution_step_type_invalid", `Unsupported step_type '${stepType}'.`);
  const idempotencyKey = requiredString(input.idempotency_key || input.request_id, "idempotency_key", 191);
  assertManagedExecutionPayloadSecretFree(input.input_json, "step.input_json");

  return withManagedTransaction(pool, async (connection) => {
    const [runRows] = await connection.query("SELECT * FROM workflow_runs WHERE run_id = ? LIMIT 2 FOR UPDATE", [runId]);
    if (runRows.length !== 1) throw managedError(404, "managed_execution_run_not_found", "Managed execution run was not found.");
    const run = runRows[0];
    const [holds] = await connection.query("SELECT * FROM approval_holds WHERE run_id = ? ORDER BY id FOR UPDATE", [runId]);
    const eligibility = assertManagedExecutionStepEligibility({ run, holds });
    if (!eligibility.managed) throw managedError(409, "managed_execution_contract_required", "Run is not owned by managed execution lifecycle.");
    await assertManagedExecutionAuthorityStillEffective({ connection, authoritySnapshot: eligibility.authority_snapshot });

    const [requestRows] = await connection.query(
      "SELECT * FROM managed_execution_step_requests WHERE run_id = ? AND idempotency_key = ? LIMIT 2 FOR UPDATE",
      [runId, idempotencyKey],
    );
    if (requestRows.length > 1) throw managedError(409, "managed_execution_step_idempotency_ambiguous", "Step idempotency key resolved to multiple requests.");
    if (requestRows.length === 1) {
      const existing = requestRows[0];
      const [stepRows] = await connection.query("SELECT * FROM step_runs WHERE step_run_id = ? LIMIT 1", [existing.step_run_id]);
      return { ok: true, reused: true, request: existing, step: stepRows[0] || null, secrets_included: false };
    }

    const [bindingRows] = await connection.query("SELECT * FROM managed_execution_bindings WHERE run_id = ? LIMIT 2 FOR UPDATE", [runId]);
    if (bindingRows.length !== 1) throw managedError(409, "managed_execution_binding_missing", "Managed execution binding is missing or ambiguous.");
    const binding = bindingRows[0];
    const stepRunId = randomUUID();
    const requestId = randomUUID();
    await connection.query(
      `INSERT INTO step_runs
         (step_run_id, run_id, tenant_id, workspace_id, workspace_key, user_id,
          actor_id, actor_type, brand_id, brand_key, request_id, session_id,
          conversation_id, correlation_id, execution_context_json,
          step_key, step_type, assigned_to, input_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stepRunId, runId, run.tenant_id, run.workspace_id || null, run.workspace_key || null,
        run.user_id || null, actorId || run.actor_id || run.user_id || null,
        actorId ? "operator" : (run.actor_type || (run.user_id ? "user" : "system")),
        run.brand_id || null, run.brand_key || null, run.request_id || null,
        run.session_id || null, run.conversation_id || null, run.correlation_id || runId,
        JSON.stringify({ source: "managed_execution_lifecycle", contract: "tenant-managed-execution-v1", run_id: runId, step_run_id: stepRunId, authority_fingerprint_sha256: eligibility.authority_snapshot.fingerprint_sha256, secrets_included: false }),
        stepKey, stepType, optionalString(input.assigned_to, 64), input.input_json === undefined ? null : JSON.stringify(input.input_json),
      ],
    );
    await connection.query(
      `INSERT INTO managed_execution_step_requests
         (request_id, run_id, tenant_id, step_run_id, idempotency_key, step_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [requestId, runId, run.tenant_id, stepRunId, idempotencyKey, stepKey],
    );
    await appendManagedEvent(connection, {
      bindingId: binding.binding_id,
      runId,
      tenantId: binding.tenant_id,
      eventType: "managed_step_created",
      fromState: binding.lifecycle_state,
      toState: binding.lifecycle_state,
      actorId,
      evidence: { step_run_id: stepRunId, step_key: stepKey, idempotency_key_sha256: createHash("sha256").update(idempotencyKey).digest("hex") },
    });
    return {
      ok: true,
      reused: false,
      request: { request_id: requestId, run_id: runId, step_run_id: stepRunId, idempotency_key: idempotencyKey, step_key: stepKey },
      step: { step_run_id: stepRunId, run_id: runId, step_key: stepKey, step_type: stepType, status: "pending" },
      secrets_included: false,
    };
  });
}

export async function createManagedExecutionRun({ pool, input, accessResolver = resolveAccess, ticketCreator = createOrAppendSupportTicketWithIntegrityAtomic }) {
  const envelope = normalizeManagedExecutionEnvelope(input);
  const access = await accessResolver({
    tenant_id: envelope.tenant_id,
    user_id: envelope.user_id,
    risk_level: envelope.policy.risk_level,
    intent_flags: {
      destructive: envelope.effect_class === "destructive",
      external_send: envelope.effect_class === "external_send",
      managed_operation: envelope.effect_class === "managed_operation",
    },
  });
  const gate = resolveManagedExecutionGate({ access_decision: access.decision, effect_class: envelope.effect_class });

  return withManagedTransaction(pool, async (connection) => {
    const readReuse = async (binding, reuseReason) => {
      const [runRows] = await connection.query("SELECT * FROM workflow_runs WHERE run_id = ? LIMIT 1", [binding.run_id]);
      const [holdRows] = await connection.query("SELECT * FROM approval_holds WHERE run_id = ? ORDER BY id", [binding.run_id]);
      return { ok: true, reused: true, reuse_reason: reuseReason, binding, run: runRows[0] || null, holds: holdRows, secrets_included: false };
    };

    const [existingRows] = await connection.query(
      "SELECT * FROM managed_execution_bindings WHERE tenant_id = ? AND idempotency_key = ? LIMIT 2 FOR UPDATE",
      [envelope.tenant_id, envelope.idempotency_key],
    );
    if (existingRows.length > 1) throw managedError(409, "managed_execution_idempotency_ambiguous", "Idempotency key resolved to multiple managed execution bindings.");
    if (existingRows.length === 1) return readReuse(existingRows[0], "idempotency_key");

    const [activeScopeRows] = await connection.query(
      `SELECT b.*
         FROM managed_execution_bindings b
         JOIN workflow_runs r ON r.run_id = b.run_id AND r.tenant_id = b.tenant_id
        WHERE b.tenant_id = ? AND r.user_id = ? AND b.parent_ticket_id = ?
          AND b.capability_key = ? AND b.resource_type = ? AND b.resource_ref = ?
          AND b.effect_class = ?
          AND b.lifecycle_state NOT IN ('verified','failed','cancelled','approval_rejected','approval_expired','rolled_back')
        ORDER BY b.created_at DESC LIMIT 2 FOR UPDATE`,
      [envelope.tenant_id, envelope.user_id, envelope.parent_ticket_id, envelope.capability_key, envelope.resource_type, envelope.resource_ref, envelope.effect_class],
    );
    if (activeScopeRows.length > 1) throw managedError(409, "managed_execution_active_scope_ambiguous", "Multiple active managed executions exist for the same requester and scope.");
    if (activeScopeRows.length === 1) return readReuse(activeScopeRows[0], "active_scope");

    const [parentRows] = await connection.query(
      "SELECT ticket_id, tenant_id, status, lifecycle_state FROM tickets WHERE ticket_id = ? AND tenant_id = ? LIMIT 2 FOR UPDATE",
      [envelope.parent_ticket_id, envelope.tenant_id],
    );
    if (parentRows.length !== 1) throw managedError(404, "managed_execution_parent_ticket_not_found", "Parent ticket was not found for the tenant.");
    if (!OPEN_PARENT_STATUSES.has(parentRows[0].status)) throw managedError(409, "managed_execution_parent_ticket_terminal", "Parent ticket is already terminal.");

    const authority = await resolveManagedExecutionAuthority({ connection, envelope });
    const authoritySnapshot = buildManagedAuthoritySnapshot({ envelope, access, gate, authority });

    const taskResult = await ticketCreator({
      tenant_id: envelope.tenant_id,
      user_id: envelope.user_id,
      actor_id: envelope.user_id,
      actor_type: "tenant_user",
      title: envelope.task_title,
      ticket_type: "managed_service_request",
      category: "managed_task",
      priority: envelope.effect_class === "destructive" ? "urgent" : envelope.effect_class === "read_only" ? "normal" : "high",
      service_mode: "managed",
      lifecycle_state: gate.lifecycle_state,
      customer_status: gate.customer_status,
      source_layer: "managed_execution_lifecycle",
      source_tool: "managed_execution_create",
      source_event: "managed_execution_requested",
      parent_ticket_id: envelope.parent_ticket_id,
      related_ticket_id: envelope.parent_ticket_id,
      target_capability: envelope.capability_key,
      resource: { type: envelope.resource_type, ref: envelope.resource_ref, relationship: "execution_subject" },
      metadata_json: {
        managed_execution_contract: "tenant-managed-execution-v1",
        workflow_key: envelope.workflow_key,
        effect_class: envelope.effect_class,
        resource_type: envelope.resource_type,
        resource_ref: envelope.resource_ref,
        authority_fingerprint_sha256: authoritySnapshot.fingerprint_sha256,
        secrets_included: false,
      },
    }, { pool, connection, externalTransactionActive: true });

    const taskTicketId = taskResult.ticket.ticket_id;
    const runId = randomUUID();
    const bindingId = randomUUID();
    const holdId = gate.requires_approval ? randomUUID() : null;
    const correlationId = envelope.correlation_id || runId;
    const executionContext = {
      source: "managed_execution_lifecycle",
      contract: "tenant-managed-execution-v1",
      binding_id: bindingId,
      parent_ticket_id: envelope.parent_ticket_id,
      task_ticket_id: taskTicketId,
      authority_snapshot: authoritySnapshot,
      secrets_included: false,
    };

    await connection.query(
      `INSERT INTO workflow_runs
         (run_id, tenant_id, workspace_id, workspace_key, user_id, actor_id, actor_type,
          brand_id, brand_key, request_id, session_id, conversation_id, correlation_id,
          execution_context_json, workflow_key, plan_id, service_mode, status, input_json, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'tenant_user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId, envelope.tenant_id, envelope.workspace_id, envelope.workspace_key, envelope.user_id,
        envelope.user_id, envelope.brand_id, envelope.brand_key, envelope.request_id,
        envelope.session_id, envelope.conversation_id, correlationId, JSON.stringify(executionContext),
        envelope.workflow_key, envelope.plan_id, envelope.service_mode, gate.initial_status,
        envelope.input_json === null ? null : JSON.stringify(envelope.input_json),
        gate.initial_status === "pending" ? new Date() : null,
      ],
    );

    if (holdId) {
      await connection.query(
        `INSERT INTO approval_holds
           (hold_id, run_id, tenant_id, workspace_id, workspace_key, requested_by, user_id,
            actor_id, actor_type, brand_id, brand_key, request_id, session_id, conversation_id,
            correlation_id, execution_context_json, hold_type, required_role, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'tenant_user', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
        [
          holdId, runId, envelope.tenant_id, envelope.workspace_id, envelope.workspace_key,
          envelope.user_id, envelope.user_id, envelope.user_id, envelope.brand_id, envelope.brand_key,
          envelope.request_id, envelope.session_id, envelope.conversation_id, correlationId,
          JSON.stringify({ source: "managed_execution_lifecycle", contract: "tenant-managed-execution-v1", binding_id: bindingId, authority_fingerprint_sha256: authoritySnapshot.fingerprint_sha256, secrets_included: false }),
          gate.hold_type, gate.required_role,
        ],
      );
    }

    await connection.query(
      `INSERT INTO managed_execution_bindings
         (binding_id, run_id, tenant_id, parent_ticket_id, task_ticket_id, capability_key,
          resource_type, resource_ref, effect_class, idempotency_key, authority_fingerprint_sha256,
          authority_snapshot_json, lifecycle_state, customer_status, approval_hold_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bindingId, runId, envelope.tenant_id, envelope.parent_ticket_id, taskTicketId,
        envelope.capability_key, envelope.resource_type, envelope.resource_ref, envelope.effect_class,
        envelope.idempotency_key, authoritySnapshot.fingerprint_sha256, JSON.stringify(authoritySnapshot),
        gate.lifecycle_state, gate.customer_status, holdId,
      ],
    );
    await appendManagedEvent(connection, {
      bindingId, runId, tenantId: envelope.tenant_id, eventType: "managed_execution_created",
      toState: gate.lifecycle_state, actorId: envelope.user_id,
      evidence: { task_ticket_id: taskTicketId, approval_hold_id: holdId, effect_class: envelope.effect_class, authority_fingerprint_sha256: authoritySnapshot.fingerprint_sha256 },
    });
    return {
      ok: true,
      reused: false,
      binding: { binding_id: bindingId, run_id: runId, tenant_id: envelope.tenant_id, parent_ticket_id: envelope.parent_ticket_id, task_ticket_id: taskTicketId, lifecycle_state: gate.lifecycle_state, customer_status: gate.customer_status },
      run: { run_id: runId, status: gate.initial_status, execution_context_json: executionContext },
      holds: holdId ? [{ hold_id: holdId, status: "open", hold_type: gate.hold_type }] : [],
      secrets_included: false,
    };
  });
}
