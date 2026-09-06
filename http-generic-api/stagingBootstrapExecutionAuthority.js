import { createHash } from "node:crypto";
import { verifyExecutionTicket } from "./recoveryExecutionTicket.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";

export const STAGING_BOOTSTRAP_EXECUTION_AUTHORITY_CONTRACT = "mad4b.staging-bootstrap-execution-authority.v1";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TICKET_ID = /^ticket:[A-Za-z0-9._:-]{8,160}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const ALLOWED_OPERATIONS = new Set(["grants", "migration", "database.rebuild_empty"]);

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function requireSha(value, field, pattern = SHA256) {
  const normalized = text(value, 128).toLowerCase();
  if (!pattern.test(normalized)) fail("RECOVERY_STAGING_BOOTSTRAP_BINDING_INVALID", `${field} must be a full SHA value.`, { field });
  return normalized;
}

function normalizeExpected(expected = {}) {
  const operation = text(expected.operation, 96);
  if (!ALLOWED_OPERATIONS.has(operation)) fail("RECOVERY_STAGING_BOOTSTRAP_OPERATION_DENIED", "Bootstrap execution-ticket verification is limited to registered Staging mutation operations.", { operation });
  const targetKey = text(expected.target_key, 128);
  if (targetKey !== "staging-runtime") fail("RECOVERY_STAGING_BOOTSTRAP_TARGET_DENIED", "Bootstrap execution-ticket verification is bound to the Staging runtime target.", { target_key: targetKey });
  const idempotencyKey = text(expected.idempotency_key, 160);
  if (!SAFE_ID.test(idempotencyKey)) fail("RECOVERY_STAGING_BOOTSTRAP_IDEMPOTENCY_INVALID", "A bounded correlation/idempotency key is required before ticket reservation.");
  const normalized = {
    production_sha: requireSha(expected.production_sha || expected.expected_sha, "expected_sha", SHA40),
    target_key: targetKey,
    target_fingerprint: requireSha(expected.target_fingerprint, "target_fingerprint"),
    operation,
    plan_hash: requireSha(expected.plan_hash, "plan_hash"),
    idempotency_key: idempotencyKey,
    role_selection_hash: text(expected.role_selection_hash, 128) ? requireSha(expected.role_selection_hash, "role_selection_hash") : null,
    grant_binding_hash: text(expected.grant_binding_hash, 128) ? requireSha(expected.grant_binding_hash, "grant_binding_hash") : null,
  };
  if (operation === "grants" && !normalized.grant_binding_hash) fail("RECOVERY_STAGING_BOOTSTRAP_GRANT_BINDING_REQUIRED", "Grant repair tickets require the canonical grant binding hash.");
  return normalized;
}

function resolveAuthorityGraph(env = process.env) {
  stagingRecoveryAuthorityInternals.runtime({ environment: "staging", runtime_class: "local_windows_docker", requested_mode: "injected_non_live", production_live: false }, env);
  const roots = stagingRecoveryAuthorityInternals.roots(env);
  return stagingRecoveryAuthorityInternals.adapters(roots.readiness, env).adapters;
}

export function createStagingBootstrapExecutionAuthority({ env = process.env } = {}) {
  const graph = resolveAuthorityGraph(env);
  const store = graph.recoveryStore;
  const signatureVerifier = graph.executionTicketVerifier;
  const partialReceiptStore = graph.partialReceiptStore;
  if (!store || typeof store.getExecutionTicket !== "function" || typeof store.reserveExecutionTicket !== "function" || typeof store.finalizeExecutionTicket !== "function") {
    fail("RECOVERY_STAGING_BOOTSTRAP_STORE_UNAVAILABLE", "Durable Staging execution-ticket storage is unavailable.");
  }
  if (!signatureVerifier || typeof signatureVerifier.verify !== "function") fail("RECOVERY_STAGING_BOOTSTRAP_VERIFIER_UNAVAILABLE", "The server-managed Staging execution-ticket signature verifier is unavailable.");

  return Object.freeze({
    contract: STAGING_BOOTSTRAP_EXECUTION_AUTHORITY_CONTRACT,
    environment: "staging",
    production_authority: false,
    async verifyForBootstrap({ ticket_id, ticket_hash, expected } = {}) {
      const ticketId = text(ticket_id, 180);
      const ticketHash = requireSha(ticket_hash, "ticket_hash");
      if (!TICKET_ID.test(ticketId)) fail("RECOVERY_STAGING_BOOTSTRAP_TICKET_ID_INVALID", "execution ticket ID is invalid.");
      const binding = normalizeExpected(expected);
      const ticket = await store.getExecutionTicket(ticketId);
      if (!ticket) fail("RECOVERY_STAGING_BOOTSTRAP_TICKET_NOT_FOUND", "The server-issued Staging execution ticket is not available.");
      if (text(ticket.ticket_hash, 128).toLowerCase() !== ticketHash) fail("RECOVERY_STAGING_BOOTSTRAP_TICKET_HASH_MISMATCH", "The execution ticket hash does not match the durable ticket.");
      try {
        await verifyExecutionTicket(ticket, { verifier: signatureVerifier, expected: binding });
      } catch (error) {
        fail("RECOVERY_STAGING_BOOTSTRAP_TICKET_INVALID", "The Staging execution ticket failed cryptographic or binding verification.", { binding_failure: text(error?.message || "ticket_verification_failed", 180) });
      }
      const reservation = await store.reserveExecutionTicket({
        ticket_id: ticketId,
        ticket_hash: ticketHash,
        idempotency_key: binding.idempotency_key,
        plan_hash: binding.plan_hash,
        target_key: binding.target_key,
        operation: binding.operation,
        grant_binding_hash: binding.grant_binding_hash,
        reserved_for: "staging_local_bootstrap",
        secrets_included: false,
      });
      if (reservation?.reserved !== true) {
        return {
          valid: false,
          reserved: false,
          reason: "ticket_already_reserved_or_finalized",
          reconciliation_required: true,
          automatic_rerun_allowed: false,
          database_mutation_performed: false,
          secrets_included: false,
        };
      }
      return {
        valid: true,
        reserved: true,
        contract: STAGING_BOOTSTRAP_EXECUTION_AUTHORITY_CONTRACT,
        reservation_fingerprint: digest({ ticket_id: ticketId, ticket_hash: ticketHash, ...binding }),
        reconciliation_required: false,
        database_mutation_performed: false,
        secrets_included: false,
      };
    },
    async finalizeForBootstrap({ ticket_id, ticket_hash, expected, readback } = {}) {
      const ticketId = text(ticket_id, 180);
      const ticketHash = requireSha(ticket_hash, "ticket_hash");
      if (!TICKET_ID.test(ticketId)) fail("RECOVERY_STAGING_BOOTSTRAP_TICKET_ID_INVALID", "execution ticket ID is invalid.");
      const binding = normalizeExpected(expected);
      if (!readback || readback.verified !== true || readback.same_cycle !== true || readback.database_mutation_performed !== true) {
        fail("RECOVERY_STAGING_BOOTSTRAP_READBACK_REQUIRED", "Ticket finalization requires a verified same-cycle local database readback.", { reconciliation_required: true, automatic_rerun_allowed: false });
      }
      const readbackHash = requireSha(readback.evidence_hash, "readback.evidence_hash");
      const finalized = await store.finalizeExecutionTicket({
        ticket_id: ticketId,
        ticket_hash: ticketHash,
        idempotency_key: binding.idempotency_key,
        plan_hash: binding.plan_hash,
        target_key: binding.target_key,
        operation: binding.operation,
        outcome: "verified",
        same_cycle_readback: true,
        readback_evidence_hash: readbackHash,
        provider_acknowledged: true,
        secrets_included: false,
      });
      if (finalized?.finalized !== true) fail("RECOVERY_STAGING_BOOTSTRAP_FINALIZATION_DENIED", "The durable ticket reservation could not be finalized; reconciliation is required.", { reconciliation_required: true, automatic_rerun_allowed: false });
      await store.putIdempotencyReceipt(binding.idempotency_key, {
        contract: STAGING_BOOTSTRAP_EXECUTION_AUTHORITY_CONTRACT,
        status: "verified",
        target_key: binding.target_key,
        operation: binding.operation,
        plan_hash: binding.plan_hash,
        readback_evidence_hash: readbackHash,
        finalized_at: new Date().toISOString(),
        secrets_included: false,
      });
      return { finalized: true, status: "verified", readback_evidence_hash: readbackHash, secrets_included: false };
    },
    partialReceiptStore: Object.freeze({
      async putImmutablePartialRebuildReceipt(receipt) {
        if (!partialReceiptStore || typeof partialReceiptStore.putImmutablePartialRebuildReceipt !== "function") fail("RECOVERY_STAGING_PARTIAL_RECEIPT_STORE_UNAVAILABLE", "Immutable Staging partial-mutation receipt storage is unavailable.");
        return partialReceiptStore.putImmutablePartialRebuildReceipt({ ...receipt, environment: "staging", production_authority: false, secrets_included: false });
      },
    }),
  });
}

export const _testingStagingBootstrapExecutionAuthority = Object.freeze({ normalizeExpected, digest, resolveAuthorityGraph });
