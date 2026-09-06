import { createHash } from "node:crypto";
import { createExecutionTicket, executeRemediationStep, sanitizeEvidence } from "./recoveryKernel.js";

const BRIDGE_CONTRACT = "mad4b.recovery-action-bridge.v2";
const TYPED_CONFIRMATION_CONTRACT = "mad4b.recovery-typed-confirmation.v1";
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
  "getApprovalByPlanStep",
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
  "approval_id",
  "expected_sha",
  "typed_confirmation",
  "idempotency_key",
]);
const COMMON_REQUIRED_KEYS = Object.freeze(["plan_id", "plan_hash", "step_id", "idempotency_key"]);
const SERVER_APPROVAL_REQUIRED_KEYS = Object.freeze(["approval_id", "expected_sha", "typed_confirmation"]);
const SHA_RE = /^[0-9a-f]{40}$/iu;
const TYPED_CONFIRMATION_RE = /^APPROVE PRODUCTION RECOVERY (approval:[0-9a-f]{16,64}) (step:[0-9a-f]{16,64}) ([0-9a-f]{40})$/u;
const SERVER_RESOLVER_METHOD = "resolveApprovedExecutionApproval";

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

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function missingKeys(input, keys) {
  return keys.filter((key) => input[key] === undefined || input[key] === null || input[key] === "");
}

function parseTypedConfirmation(value) {
  const candidate = text(value, 512);
  const match = TYPED_CONFIRMATION_RE.exec(candidate);
  if (!match) return null;
  return Object.freeze({
    typed_confirmation: candidate,
    approval_id: match[1],
    step_id: match[2],
    expected_sha: match[3].toLowerCase(),
  });
}

function assertInput(input) {
  if (!isObject(input)) throw bridgeError(400, "recovery_action_bridge_input_invalid", "Recovery Action bridge input must be a JSON object.");
  const unexpected = Object.keys(input).filter((key) => !INPUT_KEYS.has(key));
  if (unexpected.length) {
    const ticketFields = unexpected.filter((key) => CALLER_TICKET_KEYS.has(key));
    throw bridgeError(
      400,
      ticketFields.length ? "recovery_action_bridge_caller_ticket_forbidden" : "recovery_action_bridge_input_field_forbidden",
      ticketFields.length ? "Execution ticket identifiers, hashes, and signatures are server-issued and cannot be supplied by the caller." : "Recovery Action bridge accepts only plan, step, approval confirmation references, and idempotency.",
      { fields: unexpected },
    );
  }
  const missingCommon = missingKeys(input, COMMON_REQUIRED_KEYS);
  if (missingCommon.length) throw bridgeError(400, "recovery_action_bridge_required_field_missing", "Recovery Action bridge input is missing required fields.", { fields: missingCommon });

  const approvalTransport = text(input.approval_token, 512);
  const transportedConfirmation = parseTypedConfirmation(approvalTransport);
  const explicitConfirmationFieldsPresent = SERVER_APPROVAL_REQUIRED_KEYS.some((key) => input[key] !== undefined && input[key] !== null && input[key] !== "");

  // Compatibility path for already-published private schemas: the field remains
  // named approval_token in those schemas, but when it contains the exact server-
  // issued confirmation phrase it is treated only as confirmation transport. It is
  // never forwarded to approval verification as a token.
  if (transportedConfirmation) {
    if (explicitConfirmationFieldsPresent) {
      throw bridgeError(400, "recovery_action_bridge_approval_mode_conflict", "Typed confirmation must use either the explicit v2 fields or the legacy schema transport field, never both.");
    }
    if (transportedConfirmation.step_id !== input.step_id) {
      throw bridgeError(409, "recovery_action_bridge_confirmation_step_mismatch", "The transported typed confirmation is bound to a different recovery step.");
    }
    return {
      ...input,
      approval_token: undefined,
      approval_id: transportedConfirmation.approval_id,
      expected_sha: transportedConfirmation.expected_sha,
      typed_confirmation: transportedConfirmation.typed_confirmation,
      approval_mode: "server_managed_confirmation",
      confirmation_transport: "legacy_schema_field",
    };
  }

  if (approvalTransport && explicitConfirmationFieldsPresent) {
    throw bridgeError(400, "recovery_action_bridge_approval_mode_conflict", "Caller approval-token mode and server-managed typed-confirmation mode cannot be mixed.");
  }
  if (!approvalTransport) {
    const missingServerApproval = missingKeys(input, SERVER_APPROVAL_REQUIRED_KEYS);
    if (missingServerApproval.length) {
      throw bridgeError(400, "recovery_action_bridge_server_approval_required", "Production Admin GPT execution requires approval_id, expected_sha, and the exact typed confirmation; approval material is resolved only inside the server.", { fields: missingServerApproval });
    }
    if (!SHA_RE.test(text(input.expected_sha, 64))) {
      throw bridgeError(400, "recovery_action_bridge_expected_sha_invalid", "expected_sha must be a full 40-character Git SHA.");
    }
  }
  return {
    ...input,
    approval_mode: approvalTransport ? "caller_token_legacy" : "server_managed_confirmation",
    confirmation_transport: approvalTransport ? null : "explicit_v2_fields",
  };
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

function approvalMaterialResolver(approvalIssuer, approvalStore) {
  if (approvalIssuer && typeof approvalIssuer[SERVER_RESOLVER_METHOD] === "function") {
    return { owner: approvalIssuer, resolve: approvalIssuer[SERVER_RESOLVER_METHOD] };
  }
  if (approvalStore && typeof approvalStore[SERVER_RESOLVER_METHOD] === "function") {
    return { owner: approvalStore, resolve: approvalStore[SERVER_RESOLVER_METHOD] };
  }
  return null;
}

function assertServerApprovalResolver(approvalIssuer, approvalStore) {
  const resolver = approvalMaterialResolver(approvalIssuer, approvalStore);
  if (!resolver) {
    throw bridgeError(503, "recovery_action_bridge_server_approval_resolver_unavailable", "Server-managed typed confirmation requires a server authority that can resolve the already-approved execution approval internally; no approval token may be supplied by the GPT.");
  }
  return resolver;
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

export function buildRecoveryTypedConfirmationRequirements({ approval_id, plan_hash, step_id, expected_sha, expires_at = null } = {}) {
  const approvalId = text(approval_id, 160);
  const planHash = text(plan_hash, 128).toLowerCase();
  const stepId = text(step_id, 160);
  const expectedSha = text(expected_sha, 64).toLowerCase();
  if (!approvalId || !/^[0-9a-f]{64}$/u.test(planHash) || !stepId || !SHA_RE.test(expectedSha)) {
    throw bridgeError(409, "recovery_action_bridge_confirmation_binding_invalid", "Typed confirmation can be issued only for a complete approval, immutable plan hash, step, and exact Production SHA.");
  }
  const binding = {
    contract: TYPED_CONFIRMATION_CONTRACT,
    approval_id: approvalId,
    plan_hash: planHash,
    step_id: stepId,
    expected_sha: expectedSha,
  };
  return Object.freeze({
    ...binding,
    confirmation_phrase: `APPROVE PRODUCTION RECOVERY ${approvalId} ${stepId} ${expectedSha}`,
    confirmation_binding_hash: stableHash(binding),
    case_sensitive: true,
    single_use: true,
    ...(expires_at ? { expires_at: text(expires_at, 64) } : {}),
    approval_token_not_returned: true,
    legacy_schema_transport_supported: true,
    secrets_included: false,
  });
}

async function readBoundApproval(request, { recoveryStore, approvalStore } = {}) {
  let boundRecord = null;
  if (recoveryStore && typeof recoveryStore.getApprovalByPlanStep === "function") {
    boundRecord = await recoveryStore.getApprovalByPlanStep(request.plan_id, request.step_id);
  }
  if (!boundRecord && approvalStore && typeof approvalStore.getChallenge === "function") {
    boundRecord = await approvalStore.getChallenge(request.plan_hash, request.step_id);
  }
  if (!boundRecord) throw bridgeError(401, "recovery_action_bridge_approval_not_found", "The bound approval challenge is unavailable.");
  const expectedSha = text(request.expected_sha, 64).toLowerCase();
  const bindingsMatch = boundRecord.approval_id === request.approval_id
    && boundRecord.plan_id === request.plan_id
    && boundRecord.plan_hash === request.plan_hash
    && boundRecord.step_id === request.step_id
    && text(boundRecord.expected_sha, 64).toLowerCase() === expectedSha;
  if (!bindingsMatch) {
    throw bridgeError(409, "recovery_action_bridge_approval_binding_mismatch", "The approval is not bound to the exact requested plan, step, approval ID, and Production SHA.");
  }
  if (boundRecord.used === true || !boundRecord.expires_at || Date.parse(boundRecord.expires_at) <= Date.now()) {
    throw bridgeError(409, "recovery_action_bridge_approval_not_executable", "The approval is expired or already consumed.");
  }
  return boundRecord;
}

async function resolveServerManagedApprovalToken(request, { adminPrincipal, recoveryStore, approvalStore, approvalIssuer } = {}) {
  const resolver = assertServerApprovalResolver(approvalIssuer, approvalStore);
  const approval = await readBoundApproval(request, { recoveryStore, approvalStore });
  const requirements = buildRecoveryTypedConfirmationRequirements(approval);
  if (request.typed_confirmation !== requirements.confirmation_phrase) {
    throw bridgeError(401, "recovery_action_bridge_typed_confirmation_invalid", "The typed confirmation does not exactly match the server-issued approval challenge.", {
      confirmation_binding_hash: requirements.confirmation_binding_hash,
      approval_id: approval.approval_id,
    });
  }
  const resolved = await resolver.resolve.call(resolver.owner, sanitizeEvidence({
    approval_id: approval.approval_id,
    plan_id: approval.plan_id,
    plan_hash: approval.plan_hash,
    step_id: approval.step_id,
    step_hash: approval.step_hash,
    expected_sha: approval.expected_sha,
    target_key: approval.target_key,
    target_fingerprint: approval.step_target_fingerprint || approval.target_fingerprint,
    target_role: approval.target_role,
    confirmation_binding_hash: requirements.confirmation_binding_hash,
    idempotency_key: request.idempotency_key,
    admin_principal_verified: adminPrincipal?.verified === true,
    secrets_included: false,
  }));
  const token = typeof resolved === "string" ? resolved : text(resolved?.approval_token, 512);
  if (!token || token.length < 16) {
    throw bridgeError(401, "recovery_action_bridge_server_approval_unresolved", "The server approval authority did not resolve usable approval material for the exact approved step.");
  }
  return { token, approval, requirements };
}

function bridgeReceipt(execution, request, { ticketIssueState = "not_issued", forwarded, approvalMode = "caller_token_legacy" } = {}) {
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
    approval_id: request.approval_id || null,
    expected_sha: request.expected_sha || null,
    idempotency_key: execution?.idempotency_key || request.idempotency_key,
    execution,
    approval_mode: approvalMode,
    confirmation_transport: request.confirmation_transport || null,
    approval_material_resolved_server_side: approvalMode === "server_managed_confirmation",
    approval_token_returned: false,
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
  approvalIssuer,
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
      {
        plan_id: request.plan_id,
        plan_hash: request.plan_hash,
        step_id: request.step_id,
        idempotency_key: request.idempotency_key,
        ...(request.approval_mode === "caller_token_legacy" ? { approval_token: request.approval_token } : {}),
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
    return bridgeReceipt(replay, request, { ticketIssueState: "preexisting", forwarded: false, approvalMode: request.approval_mode });
  }

  let approvalToken = request.approval_token;
  if (request.approval_mode === "server_managed_confirmation") {
    const serverApproval = await resolveServerManagedApprovalToken(request, { adminPrincipal, recoveryStore, approvalStore, approvalIssuer });
    approvalToken = serverApproval.token;
  }

  const ticket = await createExecutionTicket(
    {
      plan_id: request.plan_id,
      plan_hash: request.plan_hash,
      step_id: request.step_id,
      approval_token: approvalToken,
      idempotency_key: request.idempotency_key,
    },
    { recoveryStore, executionTicketSigner, deploymentIdentityProvider, approvalVerifier, approvalStore },
  );

  const execution = await executeRemediationStep(
    {
      plan_id: request.plan_id,
      plan_hash: request.plan_hash,
      step_id: request.step_id,
      approval_token: approvalToken,
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

  return bridgeReceipt(execution, request, {
    ticketIssueState: "issued_now",
    forwarded: true,
    approvalMode: request.approval_mode,
  });
}

export const _testingRecoveryActionBridge = Object.freeze({
  BRIDGE_CONTRACT,
  TYPED_CONFIRMATION_CONTRACT,
  REQUIRED_STORE_METHODS,
  CALLER_TICKET_KEYS,
  INPUT_KEYS,
  COMMON_REQUIRED_KEYS,
  SERVER_APPROVAL_REQUIRED_KEYS,
  TYPED_CONFIRMATION_RE,
  SERVER_APPROVAL_RESOLVER_METHOD: SERVER_RESOLVER_METHOD,
  parseTypedConfirmation,
  assertInput,
  assertAdminPrincipal,
  assertDependencies,
  approvalMaterialResolver,
  stripTicketOutput,
  readBoundApproval,
});
