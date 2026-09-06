import { createHash, randomUUID } from "node:crypto";
import { verifyExecutionTicket } from "./recoveryExecutionTicket.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";

export const STAGING_BOOTSTRAP_EXECUTION_AUTHORITY_CONTRACT = "mad4b.staging-bootstrap-execution-authority.v2";
export const STAGING_BOOTSTRAP_RESERVATION_RECEIPT_CONTRACT = "mad4b.staging-bootstrap-reservation-receipt.v1";
export const STAGING_BOOTSTRAP_READBACK_EVIDENCE_CONTRACT = "mad4b.staging-bootstrap-local-readback-evidence.v1";
export const STAGING_BOOTSTRAP_READBACK_RECEIPT_CONTRACT = "mad4b.staging-bootstrap-readback-receipt.v1";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TICKET_ID = /^ticket:[A-Za-z0-9._:-]{8,160}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const ROLE = /^(runtime|governance|runtime_persistence)$/u;
const ALLOWED_OPERATIONS = new Set(["grants", "migration", "database.rebuild_empty"]);
const SENSITIVE_KEY_RE = /(password|secret|credential|authorization|private[_-]?key|connection[_-]?string|database[_-]?name|db[_-]?(?:user|password)|hostname|username|raw[_-]?sql|command)/iu;
const RESERVATION_TTL_MS = 10 * 60 * 1000;
const READBACK_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

const text = (value, max = 512) => String(value ?? "").trim().slice(0, max);
const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

function fail(code, message, details = {}, status = 503) {
  throw Object.assign(new Error(message), { code, status, details: { ...details, secrets_included: false } });
}

function requireSha(value, field, pattern = SHA256, code = "RECOVERY_TICKET_BINDING_MISMATCH") {
  const normalized = text(value, 128).toLowerCase();
  if (!pattern.test(normalized)) fail(code, `${field} must be a full SHA value.`, { field }, 409);
  return normalized;
}

function hasSensitiveKey(value, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (Array.isArray(value)) return value.some((item) => hasSensitiveKey(item, depth + 1));
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, child]) => SENSITIVE_KEY_RE.test(key) || hasSensitiveKey(child, depth + 1));
}

function normalizeExpected(expected = {}) {
  const operation = text(expected.operation, 96);
  const targetKey = text(expected.target_key, 128);
  const idempotencyKey = text(expected.idempotency_key, 160);
  if (!ALLOWED_OPERATIONS.has(operation) || targetKey !== "staging-runtime" || !SAFE_ID.test(idempotencyKey)) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Staging bootstrap ticket binding is invalid.", { operation, target_key: targetKey }, 409);
  const binding = {
    production_sha: requireSha(expected.production_sha || expected.expected_sha, "expected_sha", SHA40, "STAGING_SHA_MISMATCH"),
    target_key: targetKey,
    target_fingerprint: requireSha(expected.target_fingerprint, "target_fingerprint"),
    operation,
    plan_hash: requireSha(expected.plan_hash, "plan_hash"),
    idempotency_key: idempotencyKey,
    role_selection_hash: text(expected.role_selection_hash, 128) ? requireSha(expected.role_selection_hash, "role_selection_hash") : null,
    grant_binding_hash: text(expected.grant_binding_hash, 128) ? requireSha(expected.grant_binding_hash, "grant_binding_hash") : null,
  };
  if (operation === "grants" && !binding.grant_binding_hash) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Grant repair requires an exact grant binding hash.", {}, 409);
  return binding;
}

function resolveAuthorityGraph(env = process.env) {
  stagingRecoveryAuthorityInternals.runtime({ environment: "staging", runtime_class: "local_windows_docker", requested_mode: "injected_non_live", production_live: false }, env);
  const roots = stagingRecoveryAuthorityInternals.roots(env);
  return stagingRecoveryAuthorityInternals.adapters(roots.readiness, env).adapters;
}

function receiptPayload(receipt) {
  if (!isObject(receipt)) return null;
  return Object.fromEntries(Object.entries(receipt).filter(([key]) => !["receipt_hash", "signature", "secrets_included"].includes(key)));
}

function signerProjection(payload) {
  // executionTicketVerifier intentionally excludes ticket_id from ticket signatures.
  // The receipt_hash still commits to the complete payload, including ticket_id.
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "ticket_id"));
}

async function signReceipt(signer, payload, domain) {
  const receiptHash = digest({ domain, payload });
  const signature = await signer.sign({ payload: signerProjection(payload), ticket_hash: receiptHash });
  if (!text(signature, 4096)) fail("RECOVERY_READBACK_UNVERIFIED", "Server receipt signing failed closed.");
  return { ...payload, receipt_hash: receiptHash, signature, secrets_included: false };
}

async function verifyReceipt(verifier, receipt, { contract, domain, now = Date.now() } = {}) {
  const payload = receiptPayload(receipt);
  if (!payload || payload.contract !== contract || receipt?.secrets_included !== false) fail("RECOVERY_READBACK_UNVERIFIED", "Server receipt envelope is invalid.", {}, 409);
  const receiptHash = requireSha(receipt.receipt_hash, "receipt_hash", SHA256, "RECOVERY_READBACK_UNVERIFIED");
  if (receiptHash !== digest({ domain, payload })) fail("RECOVERY_READBACK_UNVERIFIED", "Server receipt hash does not match its canonical payload.", {}, 409);
  const valid = await verifier.verify({ ticket: { ...payload, ticket_hash: receiptHash, signature: receipt.signature, secrets_included: false }, ticket_hash: receiptHash });
  if (valid !== true) fail("RECOVERY_READBACK_UNVERIFIED", "Server receipt signature verification failed.", {}, 409);
  const issuedAt = Date.parse(payload.receipt_issued_at || "");
  const expiresAt = Date.parse(payload.receipt_expires_at || "");
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > Number(now) + CLOCK_SKEW_MS || expiresAt <= Number(now)) fail("RECOVERY_READBACK_STALE", "Server receipt is stale or has an invalid timestamp.", { reconciliation_required: true, automatic_rerun_allowed: false }, 409);
  return payload;
}

function assertReceiptBinding(payload, { ticketId, ticketHash, binding, reservationGeneration = null } = {}) {
  const mismatch = payload.ticket_id !== ticketId
    || payload.execution_ticket_hash !== ticketHash
    || payload.expected_sha !== binding.production_sha
    || payload.target_key !== binding.target_key
    || payload.target_fingerprint !== binding.target_fingerprint
    || payload.operation !== binding.operation
    || payload.plan_hash !== binding.plan_hash
    || payload.idempotency_key !== binding.idempotency_key
    || (payload.grant_binding_hash || null) !== binding.grant_binding_hash
    || (payload.role_selection_hash || null) !== binding.role_selection_hash
    || (reservationGeneration && payload.reservation_generation !== reservationGeneration);
  if (mismatch) fail(payload.expected_sha !== binding.production_sha ? "STAGING_SHA_MISMATCH" : "RECOVERY_TICKET_BINDING_MISMATCH", "Receipt is not bound to this exact ticket reservation and repair plan.", { reconciliation_required: true, automatic_rerun_allowed: false }, 409);
}

function validateReadbackEvidence(evidence, { ticketId, binding, reservationGeneration, now = Date.now() } = {}) {
  if (!isObject(evidence) || evidence.contract !== STAGING_BOOTSTRAP_READBACK_EVIDENCE_CONTRACT || evidence.secrets_included !== false || hasSensitiveKey(evidence)) fail("RECOVERY_READBACK_UNVERIFIED", "Readback evidence is missing, malformed, or contains forbidden sensitive fields.", { reconciliation_required: true }, 409);
  const allowed = new Set(["contract", "ticket_id", "reservation_generation", "expected_sha", "target_key", "target_fingerprint", "operation", "plan_hash", "idempotency_key", "grant_binding_hash", "role_selection_hash", "status", "observed_at", "same_cycle", "database_mutation_performed", "grant_readback_by_role", "postconditions_fingerprint", "mutation_evidence_fingerprint", "secrets_included"]);
  const unexpected = Object.keys(evidence).filter((key) => !allowed.has(key));
  if (unexpected.length) fail("RECOVERY_READBACK_UNVERIFIED", "Readback evidence contains fields outside the fixed contract.", { fields: unexpected, reconciliation_required: true }, 409);
  const wrongSha = text(evidence.expected_sha, 64).toLowerCase() !== binding.production_sha;
  const mismatch = evidence.ticket_id !== ticketId
    || evidence.reservation_generation !== reservationGeneration
    || wrongSha
    || evidence.target_key !== binding.target_key
    || text(evidence.target_fingerprint, 128).toLowerCase() !== binding.target_fingerprint
    || evidence.operation !== binding.operation
    || text(evidence.plan_hash, 128).toLowerCase() !== binding.plan_hash
    || evidence.idempotency_key !== binding.idempotency_key
    || text(evidence.grant_binding_hash, 128).toLowerCase() !== (binding.grant_binding_hash || "")
    || text(evidence.role_selection_hash, 128).toLowerCase() !== (binding.role_selection_hash || "");
  if (mismatch) fail(wrongSha ? "STAGING_SHA_MISMATCH" : "RECOVERY_TICKET_BINDING_MISMATCH", "Readback evidence is not bound to the reserved ticket and exact plan.", { reconciliation_required: true, automatic_rerun_allowed: false }, 409);
  if (evidence.same_cycle !== true || evidence.database_mutation_performed !== true) fail("RECOVERY_READBACK_UNVERIFIED", "Readback evidence must prove same-cycle verification after the reserved mutation.", { reconciliation_required: true, automatic_rerun_allowed: false }, 409);
  const observedAt = Date.parse(evidence.observed_at || "");
  if (!Number.isFinite(observedAt) || Number(now) - observedAt > READBACK_TTL_MS || observedAt > Number(now) + CLOCK_SKEW_MS) fail("RECOVERY_READBACK_STALE", "Readback evidence is stale or has an invalid observation time.", { reconciliation_required: true, automatic_rerun_allowed: false }, 409);
  if (binding.operation === "grants") {
    if (!isObject(evidence.grant_readback_by_role) || !Object.keys(evidence.grant_readback_by_role).length) fail("RECOVERY_READBACK_UNVERIFIED", "Grant repair requires canonical role readback evidence.", { reconciliation_required: true }, 409);
    for (const [role, entry] of Object.entries(evidence.grant_readback_by_role)) {
      const invalid = !ROLE.test(role) || !isObject(entry) || Object.keys(entry).some((key) => !["ready", "evidence_fingerprint"].includes(key)) || entry.ready !== true || !SHA256.test(text(entry.evidence_fingerprint, 128).toLowerCase());
      if (invalid) fail("RECOVERY_READBACK_UNVERIFIED", "Every grant role requires ready=true plus a canonical readback fingerprint.", { role, reconciliation_required: true }, 409);
    }
  }
  for (const field of ["postconditions_fingerprint", "mutation_evidence_fingerprint"]) {
    if (text(evidence[field], 128) && !SHA256.test(text(evidence[field], 128).toLowerCase())) fail("RECOVERY_READBACK_UNVERIFIED", `${field} is invalid.`, {}, 409);
  }
  const normalized = stable(evidence);
  return {
    evidence_hash: digest(normalized),
    result_fingerprint: digest({
      ticket_id: ticketId,
      reservation_generation: reservationGeneration,
      expected_sha: binding.production_sha,
      target_fingerprint: binding.target_fingerprint,
      operation: binding.operation,
      plan_hash: binding.plan_hash,
      grant_binding_hash: binding.grant_binding_hash,
      role_selection_hash: binding.role_selection_hash,
      status: text(evidence.status, 96),
      grant_readback_by_role: evidence.grant_readback_by_role || null,
      postconditions_fingerprint: text(evidence.postconditions_fingerprint, 128).toLowerCase() || null,
      mutation_evidence_fingerprint: text(evidence.mutation_evidence_fingerprint, 128).toLowerCase() || null,
    }),
  };
}

export function createStagingBootstrapExecutionAuthority({ env = process.env } = {}) {
  const graph = resolveAuthorityGraph(env);
  const store = graph.recoveryStore;
  const signatureVerifier = graph.executionTicketVerifier;
  const receiptSigner = graph.executionTicketSigner;
  const partialReceiptStore = graph.partialReceiptStore;
  if (!store || typeof store.getExecutionTicket !== "function" || typeof store.reserveExecutionTicket !== "function" || typeof store.finalizeExecutionTicket !== "function" || typeof store.putIdempotencyReceipt !== "function" || typeof store.appendEvidenceEvent !== "function") fail("RECOVERY_STAGING_BOOTSTRAP_STORE_UNAVAILABLE", "Durable Staging execution-ticket storage is unavailable.");
  if (!signatureVerifier?.verify || !receiptSigner?.sign) fail("RECOVERY_STAGING_BOOTSTRAP_VERIFIER_UNAVAILABLE", "The server-managed Staging Ed25519 authority is unavailable.");

  const verifyTicketAndBinding = async ({ ticket_id, ticket_hash, expected } = {}) => {
    const ticketId = text(ticket_id, 180);
    const ticketHash = requireSha(ticket_hash, "ticket_hash");
    if (!TICKET_ID.test(ticketId)) fail("RECOVERY_TICKET_BINDING_MISMATCH", "execution ticket ID is invalid.", {}, 409);
    const binding = normalizeExpected(expected);
    const ticket = await store.getExecutionTicket(ticketId);
    if (!ticket || text(ticket.ticket_hash, 128).toLowerCase() !== ticketHash) fail("RECOVERY_TICKET_BINDING_MISMATCH", "The server-issued ticket is absent or hash-mismatched.", {}, ticket ? 409 : 404);
    try { await verifyExecutionTicket(ticket, { verifier: signatureVerifier, expected: binding }); }
    catch (error) { fail("RECOVERY_TICKET_BINDING_MISMATCH", "The Staging execution ticket failed cryptographic or binding verification.", { binding_failure: text(error?.message, 180) }, 409); }
    return { ticketId, ticketHash, binding };
  };

  const authority = {
    contract: STAGING_BOOTSTRAP_EXECUTION_AUTHORITY_CONTRACT,
    environment: "staging",
    production_authority: false,

    async verifyForBootstrap(input = {}) {
      const { ticketId, ticketHash, binding } = await verifyTicketAndBinding(input);
      const reservation = await store.reserveExecutionTicket({ ticket_id: ticketId, ticket_hash: ticketHash, idempotency_key: binding.idempotency_key, plan_hash: binding.plan_hash, target_key: binding.target_key, operation: binding.operation, grant_binding_hash: binding.grant_binding_hash, reserved_for: "staging_local_bootstrap", secrets_included: false });
      if (reservation?.reserved !== true) return { valid: false, reserved: false, reason: "ticket_already_reserved_or_finalized", error_code: "RECOVERY_TICKET_ALREADY_RESERVED", reconciliation_required: true, automatic_rerun_allowed: false, database_mutation_performed: false, secrets_included: false };
      const now = Date.now();
      const reservationGeneration = randomUUID();
      const payload = {
        contract: STAGING_BOOTSTRAP_RESERVATION_RECEIPT_CONTRACT,
        purpose: "staging_bootstrap_ticket_reservation",
        ticket_id: ticketId,
        execution_ticket_hash: ticketHash,
        reservation_generation: reservationGeneration,
        expected_sha: binding.production_sha,
        target_key: binding.target_key,
        target_fingerprint: binding.target_fingerprint,
        operation: binding.operation,
        plan_hash: binding.plan_hash,
        idempotency_key: binding.idempotency_key,
        role_selection_hash: binding.role_selection_hash,
        grant_binding_hash: binding.grant_binding_hash,
        binding_hash: digest(binding),
        receipt_issued_at: new Date(now).toISOString(),
        receipt_expires_at: new Date(now + RESERVATION_TTL_MS).toISOString(),
        receipt_nonce: randomUUID(),
      };
      const reservationReceipt = await signReceipt(receiptSigner, payload, STAGING_BOOTSTRAP_RESERVATION_RECEIPT_CONTRACT);
      await store.appendEvidenceEvent(binding.idempotency_key, { event: "staging_bootstrap_ticket_reserved", phase: "reserved", ticket_id: ticketId, reservation_generation: reservationGeneration, expected_sha: binding.production_sha, plan_hash: binding.plan_hash, binding_hash: digest(binding), receipt_hash: reservationReceipt.receipt_hash, secrets_included: false });
      return { valid: true, reserved: true, contract: STAGING_BOOTSTRAP_EXECUTION_AUTHORITY_CONTRACT, reservation_generation: reservationGeneration, reservation_fingerprint: digest({ ticket_id: ticketId, ticket_hash: ticketHash, reservation_generation: reservationGeneration, ...binding }), reservation_receipt: reservationReceipt, lifecycle_state: "reserved", reconciliation_required: false, database_mutation_performed: false, secrets_included: false };
    },

    async attestReadbackForBootstrap({ ticket_id, ticket_hash, expected, reservation_receipt, evidence } = {}) {
      const { ticketId, ticketHash, binding } = await verifyTicketAndBinding({ ticket_id, ticket_hash, expected });
      const reservation = await verifyReceipt(signatureVerifier, reservation_receipt, { contract: STAGING_BOOTSTRAP_RESERVATION_RECEIPT_CONTRACT, domain: STAGING_BOOTSTRAP_RESERVATION_RECEIPT_CONTRACT });
      assertReceiptBinding(reservation, { ticketId, ticketHash, binding });
      const readback = validateReadbackEvidence(evidence, { ticketId, binding, reservationGeneration: reservation.reservation_generation });
      const now = Date.now();
      const payload = {
        contract: STAGING_BOOTSTRAP_READBACK_RECEIPT_CONTRACT,
        purpose: "staging_bootstrap_same_cycle_readback",
        ticket_id: ticketId,
        execution_ticket_hash: ticketHash,
        reservation_generation: reservation.reservation_generation,
        reservation_receipt_hash: reservation_receipt.receipt_hash,
        expected_sha: binding.production_sha,
        target_key: binding.target_key,
        target_fingerprint: binding.target_fingerprint,
        operation: binding.operation,
        plan_hash: binding.plan_hash,
        idempotency_key: binding.idempotency_key,
        role_selection_hash: binding.role_selection_hash,
        grant_binding_hash: binding.grant_binding_hash,
        binding_hash: digest(binding),
        evidence_hash: readback.evidence_hash,
        result_fingerprint: readback.result_fingerprint,
        receipt_issued_at: new Date(now).toISOString(),
        receipt_expires_at: new Date(now + READBACK_TTL_MS).toISOString(),
        receipt_nonce: randomUUID(),
      };
      const receipt = await signReceipt(receiptSigner, payload, STAGING_BOOTSTRAP_READBACK_RECEIPT_CONTRACT);
      await store.appendEvidenceEvent(binding.idempotency_key, { event: "staging_bootstrap_readback_attested", phase: "verifying", ticket_id: ticketId, reservation_generation: reservation.reservation_generation, expected_sha: binding.production_sha, plan_hash: binding.plan_hash, binding_hash: digest(binding), evidence_hash: readback.evidence_hash, result_fingerprint: readback.result_fingerprint, receipt_hash: receipt.receipt_hash, secrets_included: false });
      return { verified: true, lifecycle_state: "verifying", readback_receipt: receipt, evidence_hash: readback.evidence_hash, result_fingerprint: readback.result_fingerprint, secrets_included: false };
    },

    async finalizeForBootstrap({ ticket_id, ticket_hash, expected, readback_receipt } = {}) {
      const { ticketId, ticketHash, binding } = await verifyTicketAndBinding({ ticket_id, ticket_hash, expected });
      if (!readback_receipt || readback_receipt.contract !== STAGING_BOOTSTRAP_READBACK_RECEIPT_CONTRACT) fail("RECOVERY_READBACK_UNVERIFIED", "Ticket finalization requires a server-signed same-cycle readback receipt; caller booleans and arbitrary hashes are not accepted.", { reconciliation_required: true, automatic_rerun_allowed: false }, 409);
      const receipt = await verifyReceipt(signatureVerifier, readback_receipt, { contract: STAGING_BOOTSTRAP_READBACK_RECEIPT_CONTRACT, domain: STAGING_BOOTSTRAP_READBACK_RECEIPT_CONTRACT });
      assertReceiptBinding(receipt, { ticketId, ticketHash, binding, reservationGeneration: receipt.reservation_generation });
      if (!SHA256.test(text(receipt.evidence_hash, 128).toLowerCase()) || !SHA256.test(text(receipt.result_fingerprint, 128).toLowerCase()) || receipt.binding_hash !== digest(binding)) fail("RECOVERY_READBACK_UNVERIFIED", "Readback receipt evidence or binding fingerprint is invalid.", { reconciliation_required: true }, 409);
      const finalizedAt = new Date().toISOString();
      const finalized = await store.finalizeExecutionTicket({ ticket_id: ticketId, ticket_hash: ticketHash, idempotency_key: binding.idempotency_key, plan_hash: binding.plan_hash, target_key: binding.target_key, operation: binding.operation, reservation_generation: receipt.reservation_generation, outcome: "verified", same_cycle_readback: true, readback_evidence_hash: receipt.evidence_hash, result_fingerprint: receipt.result_fingerprint, provider_acknowledged: true, secrets_included: false });
      if (finalized?.finalized !== true) fail("RECOVERY_RECONCILIATION_REQUIRED", "The durable ticket reservation could not be finalized; reconciliation is required and replay is forbidden.", { reconciliation_required: true, automatic_rerun_allowed: false }, 409);
      const audit = { contract: STAGING_BOOTSTRAP_EXECUTION_AUTHORITY_CONTRACT, status: "finalized", ticket_id: ticketId, run_id: binding.idempotency_key, expected_sha: binding.production_sha, repair_key: binding.operation === "grants" ? "staging_database_access_repair" : binding.operation, target_key: binding.target_key, plan_hash: binding.plan_hash, binding_hash: digest(binding), evidence_hash: receipt.evidence_hash, result_fingerprint: receipt.result_fingerprint, reservation_generation: receipt.reservation_generation, finalized_at: finalizedAt, secrets_included: false };
      await store.putIdempotencyReceipt(binding.idempotency_key, audit);
      await store.appendEvidenceEvent(binding.idempotency_key, { event: "staging_bootstrap_ticket_finalized", phase: "finalized", ...audit });
      return { finalized: true, status: "finalized", lifecycle_state: "finalized", readback_evidence_hash: receipt.evidence_hash, result_fingerprint: receipt.result_fingerprint, audit, secrets_included: false };
    },

    partialReceiptStore: Object.freeze({
      async putImmutablePartialRebuildReceipt(receipt) {
        if (!partialReceiptStore?.putImmutablePartialRebuildReceipt) fail("RECOVERY_STAGING_PARTIAL_RECEIPT_STORE_UNAVAILABLE", "Immutable Staging partial-mutation receipt storage is unavailable.");
        return partialReceiptStore.putImmutablePartialRebuildReceipt({ ...receipt, environment: "staging", production_authority: false, reconciliation_required: true, automatic_rerun_allowed: false, secrets_included: false });
      },
    }),
  };
  return Object.freeze(authority);
}

export const _testingStagingBootstrapExecutionAuthority = Object.freeze({ normalizeExpected, digest, resolveAuthorityGraph, hasSensitiveKey, signerProjection, signReceipt, verifyReceipt, validateReadbackEvidence, assertReceiptBinding });
