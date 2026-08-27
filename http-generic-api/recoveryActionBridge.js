import { createExecutionTicket, executeRemediationStep, sanitizeEvidence } from "./recoveryKernel.js";

const BRIDGE_CONTRACT = "mad4b.recovery-action-bridge.v1";
const REQUIRED_STORE_METHODS = Object.freeze([
  "getPlan",
  "getRunByIdempotency",
  "getExecutionTicket",
  "putExecutionTicket",
  "claimExecution",
  "reserveApproval",
  "releaseApprovalReservation",
  "releaseExecutionClaim",
  "reserveExecutionTicket",
  "finalizeExecutionTicket",

  "appendEvidenceEvent",
  "putRun",
  "putIdempotencyReceipt",
]);
const TICKET_OUTPUT_KEYS = /^(?:execution_ticket_(?:id|hash)|ticket_(?:id|hash)|signature)$/iu;
const CALLER_TICKET_KEYS = new Set([
  "execution_ticket_id",
  "execution_ticket_hash",
  "ticket_id",
  "ticket_hash",
  "signature",
  "ticket",
]);
const INPUT_KEYS = new Set([
  "plan_id",
  "plan_hash",
  "step_id",
  "approval_token",
  "idempotency_key",
]);

function bridgeError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, database_mutation_performed: false, secrets_included: false };
  return error;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertInput(input) {
  if (!isObject(input)) throw bridgeError(400, "recovery_action_bridge_input_invalid", "Recovery Action bridge input must be a JSON object.");
  const unexpected = Object.keys(input).filter((key) => !INPUT_KEYS.has(key));
  if (unexpected.length) {
    const ticketFields = unexpected.filter((key) => CALLER_TICKET_KEYS.has(key));
    throw bridgeError(
      400,
      ticketFields.length ? "recovery_action_bridge_caller_ticket_forbidden" : "recovery_action_bridge_input_field_forbidden",
      ticketFields.length ? "Execution ticket identifiers, hashes, and signatures are server-issued and cannot be supplied by the caller." : "Recovery Action bridge accepts only plan, step, approval, and idempotency references.",
      { fields: unexpected },
    );
  }
  const required = ["plan_id", "plan_hash", "step_id", "approval_token", "idempotency_key"];
  const missing = required.filter((key) => input[key] === undefined || input[key] === null || input[key] === "");
  if (missing.length) throw bridgeError(400, "recovery_action_bridge_required_field_missing", "Recovery Action bridge input is missing required fields.", { fields: missing });
  return { ...input };
}

function assertAdminPrincipal(adminPrincipal) {
  if (adminPrincipal?.verified !== true) {
    throw bridgeError(403, "recovery_action_bridge_admin_required", "A verified admin principal is required for the private Recovery Action bridge.");
  }
}

function assertDependencies({ recoveryStore, executionTicketSigner, approvalVerifier, recoveryLock, readbackVerifier, hostBreakglassMutationExecutor, deploymentIdentityProvider }) {
  const missing = [];
  if (!recoveryStore || typeof recoveryStore !== "object") {
    missing.push({ component: "recoveryStore", missing_methods: REQUIRED_STORE_METHODS });
  } else {
    const missingMethods = REQUIRED_STORE_METHODS.filter((method) => typeof recoveryStore[method] !== "function");
    if (missingMethods.length) missing.push({ component: "recoveryStore", missing_methods: missingMethods });
    if (typeof recoveryStore.finalizeApproval !== "function" && typeof recoveryStore.markApprovalUsed !== "function") {
      missing.push({ component: "recoveryStore", missing_methods: ["finalizeApproval_or_markApprovalUsed"] });
    }
    if (!recoveryStore.executionTicketVerifier || typeof recoveryStore.executionTicketVerifier.verify !== "function") {
      missing.push({ component: "recoveryStore.executionTicketVerifier", missing_methods: ["verify"] });
    }
  }
  if (!executionTicketSigner || typeof executionTicketSigner.sign !== "function") missing.push({ component: "executionTicketSigner", missing_methods: ["sign"] });
  if (!approvalVerifier || typeof approvalVerifier.verify !== "function") missing.push({ component: "approvalVerifier", missing_methods: ["verify"] });
  if (!recoveryLock || typeof recoveryLock.acquire !== "function" || typeof recoveryLock.heartbeat !== "function" || typeof recoveryLock.assertFence !== "function" || typeof recoveryLock.release !== "function") {
    missing.push({ component: "recoveryLock", missing_methods: ["acquire", "heartbeat", "assertFence", "release"].filter((method) => typeof recoveryLock?.[method] !== "function") });
  }
  if (!readbackVerifier || typeof readbackVerifier.verify !== "function") missing.push({ component: "readbackVerifier", missing_methods: ["verify"] });
  if (!(typeof hostBreakglassMutationExecutor === "function" || typeof hostBreakglassMutationExecutor?.execute === "function")) missing.push({ component: "hostBreakglassMutationExecutor", missing_methods: ["execute"] });
  if (!deploymentIdentityProvider || typeof deploymentIdentityProvider.readAttestation !== "function") missing.push({ component: "deploymentIdentityProvider", missing_methods: ["readAttestation"] });
  if (missing.length) throw bridgeError(503, "recovery_action_bridge_authority_unavailable", "The private Recovery Action bridge is fail-closed until durable ticket, approval, deployment identity, lock, executor, and readback authorities are all configured.", { missing_components: missing });
}

function asExecutor(value) {
  if (typeof value === "function") return { execute: value };
  return value;
}

function stripTicketOutput(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => stripTicketOutput(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !TICKET_OUTPUT_KEYS.test(key))
      .slice(0, 300)
      .map(([key, child]) => [key, stripTicketOutput(child, depth + 1)]),
  );
}

export function sanitizeRecoveryActionBridgeOutput(value) {
  return stripTicketOutput(sanitizeEvidence(value));
}

function bridgeReceipt(execution, request, { ticketIssueState = "not_issued", forwarded } = {}) {
  const normalizedTicketIssueState = ["issued_now", "preexisting", "not_issued"].includes(ticketIssueState) ? ticketIssueState : "not_issued";
  return sanitizeRecoveryActionBridgeOutput({
    ok: execution?.ok !== false,
    contract: BRIDGE_CONTRACT,
    status: execution?.status || "accepted",
    phase: execution?.phase || null,
    run_id: execution?.run_id || null,
    plan_id: execution?.plan_id || request.plan_id,
    plan_hash: execution?.plan_hash || request.plan_hash,
    step_id: execution?.step_id || request.step_id,
    idempotency_key: execution?.idempotency_key || request.idempotency_key,
    execution,
    ticket_issue_state: normalizedTicketIssueState,
    server_issued_execution_ticket: normalizedTicketIssueState !== "not_issued",
    execution_ticket_forwarded_internally: forwarded === true,
    execution_ticket_returned: false,
    readback_required: execution?.readback_required !== false,
    database_mutation_performed: execution?.mutation_attestation?.database_mutation_performed === true,
    secrets_included: false,
  });
}

export async function issueAndExecuteApprovedRecoveryStep(input = {}, {
  env = process.env,
  adminPrincipal,
  recoveryStore,
  executionTicketSigner,
  approvalVerifier,
  approvalStore,
  recoveryLock,
  readbackVerifier,
  hostBreakglassMutationExecutor,
  deploymentIdentityProvider,
  unsupportedBroker,
  migrationLedger,
} = {}) {
  const request = assertInput(input);
  assertAdminPrincipal(adminPrincipal);
  assertDependencies({ recoveryStore, executionTicketSigner, approvalVerifier, recoveryLock, readbackVerifier, hostBreakglassMutationExecutor, deploymentIdentityProvider });

  const existing = await recoveryStore.getRunByIdempotency(request.idempotency_key);
  if (existing) {
    const replay = await executeRemediationStep(
      request,
      {
        env,
        adminPrincipal,
        recoveryStore,
        approvalVerifier,
        approvalStore,
        recoveryLock,
        readbackVerifier,
        deploymentIdentityProvider,
        mutationExecutor: asExecutor(hostBreakglassMutationExecutor),
        unsupportedBroker,
        migrationLedger,
      },
    );
    return bridgeReceipt(replay, request, { ticketIssueState: "preexisting", forwarded: false });
  }

  const ticket = await createExecutionTicket(
    {
      plan_id: request.plan_id,
      plan_hash: request.plan_hash,
      step_id: request.step_id,
      approval_token: request.approval_token,
      idempotency_key: request.idempotency_key,
    },
    { recoveryStore, executionTicketSigner, deploymentIdentityProvider, approvalVerifier, approvalStore },
  );

  const execution = await executeRemediationStep(
    {
      plan_id: request.plan_id,
      plan_hash: request.plan_hash,
      step_id: request.step_id,
      approval_token: request.approval_token,
      idempotency_key: request.idempotency_key,
      execution_ticket_id: ticket.ticket_id,
    },
    {
      env,
      adminPrincipal,
      recoveryStore,
      approvalVerifier,
      approvalStore,
      recoveryLock,
      readbackVerifier,
      deploymentIdentityProvider,
      mutationExecutor: asExecutor(hostBreakglassMutationExecutor),
      unsupportedBroker,
      migrationLedger,
    },
  );

  return bridgeReceipt(execution, request, { ticketIssueState: "issued_now", forwarded: true });
}

export const _testingRecoveryActionBridge = Object.freeze({
  BRIDGE_CONTRACT,
  REQUIRED_STORE_METHODS,
  CALLER_TICKET_KEYS,
  INPUT_KEYS,
  assertInput,
  assertAdminPrincipal,
  assertDependencies,
  stripTicketOutput,
});
