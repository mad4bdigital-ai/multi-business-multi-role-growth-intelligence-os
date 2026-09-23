import { createHash } from "node:crypto";
import { resolveDurableRoleSelectionProof } from "./hostBreakglassRoleSelectionArtifact.js";

export const PRODUCTION_RECOVERY_DURABLE_EVIDENCE_ADAPTERS_CONTRACT =
  "mad4b.production-recovery-durable-evidence-adapters.v1";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PARTIAL_ID = /^partial:[0-9a-f]{32}$/u;
const INSPECTION_RUN = /^run:github:([1-9][0-9]{0,19})$/u;
const ALLOWED_RECEIPT_KEYS = new Set([
  "contract",
  "receipt_id",
  "status",
  "automatic_rerun_allowed",
  "reconciliation_required",
  "expected_sha",
  "target_key",
  "target_fingerprint",
  "plan_hash",
  "execution_ticket_id",
  "execution_ticket_hash",
  "bundle_manifest_reference",
  "mutation_evidence",
  "environment",
  "production_authority",
  "secrets_included",
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function txt(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = {
    contract: PRODUCTION_RECOVERY_DURABLE_EVIDENCE_ADAPTERS_CONTRACT,
    production_live_enabled: false,
    production_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
    ...details,
  };
  throw error;
}

function requireStore(store) {
  const required = ["putRun", "getRunByIdempotency"];
  const missing = required.filter((method) => typeof store?.[method] !== "function");
  if (missing.length) {
    fail(
      "RECOVERY_PRODUCTION_DURABLE_EVIDENCE_STORE_INCOMPLETE",
      "Durable evidence adapters require the canonical Recovery Control Store.",
      { missing_methods: missing },
    );
  }
  if (store?.independent_of_target_databases !== true || store?.target_database_binding !== "forbidden") {
    fail(
      "RECOVERY_PRODUCTION_DURABLE_EVIDENCE_STORE_NOT_ISOLATED",
      "Durable evidence must remain isolated from every Recovery target database.",
    );
  }
  return store;
}

function assertNoSensitiveKeys(value, path = "receipt", depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.slice(0, 500).forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:password|passwd|private[_-]?key|credential|authorization|cookie|session[_-]?token|access[_-]?token|refresh[_-]?token|api[_-]?key)/iu.test(key)) {
      fail(
        "RECOVERY_PRODUCTION_PARTIAL_RECEIPT_SENSITIVE_FIELD",
        "Partial-mutation receipts cannot contain credentials or secret-bearing fields.",
        { field_path: `${path}.${key}` },
      );
    }
    assertNoSensitiveKeys(child, `${path}.${key}`, depth + 1);
  }
}

function normalizePartialReceipt(receipt = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("RECOVERY_PRODUCTION_PARTIAL_RECEIPT_INVALID", "Partial-mutation receipt must be an object.");
  }
  const unexpected = Object.keys(receipt).filter((key) => !ALLOWED_RECEIPT_KEYS.has(key));
  if (unexpected.length) {
    fail(
      "RECOVERY_PRODUCTION_PARTIAL_RECEIPT_FIELD_FORBIDDEN",
      "Partial-mutation receipt contains fields outside the canonical contract.",
      { fields: unexpected },
    );
  }
  assertNoSensitiveKeys(receipt);
  const normalized = structuredClone(receipt);
  normalized.contract = txt(normalized.contract, 128);
  normalized.receipt_id = txt(normalized.receipt_id, 191).toLowerCase();
  normalized.status = txt(normalized.status, 64);
  normalized.expected_sha = txt(normalized.expected_sha, 40).toLowerCase();
  normalized.target_key = txt(normalized.target_key, 128);
  normalized.target_fingerprint = txt(normalized.target_fingerprint, 64).toLowerCase();
  normalized.plan_hash = txt(normalized.plan_hash, 64).toLowerCase() || null;
  normalized.execution_ticket_id = txt(normalized.execution_ticket_id, 191) || null;
  normalized.execution_ticket_hash = txt(normalized.execution_ticket_hash, 64).toLowerCase() || null;
  normalized.bundle_manifest_reference = txt(normalized.bundle_manifest_reference, 1024) || null;

  if (
    normalized.contract !== "mad4b.hostinger.partial-rebuild-receipt.v1"
    || !PARTIAL_ID.test(normalized.receipt_id)
    || normalized.status !== "reconciliation_required"
    || normalized.automatic_rerun_allowed !== false
    || normalized.reconciliation_required !== true
    || !SHA40.test(normalized.expected_sha)
    || !normalized.target_key
    || !SHA256.test(normalized.target_fingerprint)
    || (normalized.plan_hash !== null && !SHA256.test(normalized.plan_hash))
    || (normalized.execution_ticket_hash !== null && !SHA256.test(normalized.execution_ticket_hash))
    || normalized.secrets_included !== false
  ) {
    fail(
      "RECOVERY_PRODUCTION_PARTIAL_RECEIPT_BINDING_INVALID",
      "Partial-mutation receipt is not completely bound to the exact Recovery execution context.",
    );
  }

  return Object.freeze(normalized);
}

function partialReceiptRecord(receipt) {
  const evidenceHash = digest(receipt);
  return Object.freeze({
    contract: "mad4b.production-recovery-partial-receipt-record.v1",
    run_id: `partial-receipt:${evidenceHash.slice(0, 48)}`,
    idempotency_key: receipt.receipt_id,
    evidence_class: "partial_mutation_receipt",
    evidence_sha256: evidenceHash,
    expected_sha: receipt.expected_sha,
    target_key: receipt.target_key,
    target_fingerprint: receipt.target_fingerprint,
    reconciliation_required: true,
    automatic_rerun_allowed: false,
    partial_rebuild_receipt: structuredClone(receipt),
    secrets_included: false,
  });
}

export function createProductionRecoveryPartialReceiptStore({ recoveryStore } = {}) {
  const store = requireStore(recoveryStore);
  return Object.freeze({
    contract: "mad4b.production-recovery-partial-receipt-store.v1",
    durable: true,
    immutable_identity_binding: true,
    independent_of_target_databases: true,
    async putImmutablePartialRebuildReceipt(receipt) {
      const normalized = normalizePartialReceipt(receipt);
      const record = partialReceiptRecord(normalized);
      await store.putRun(record);
      const readback = await store.getRunByIdempotency(normalized.receipt_id);
      if (
        !readback
        || readback.run_id !== record.run_id
        || readback.evidence_sha256 !== record.evidence_sha256
        || readback.idempotency_key !== normalized.receipt_id
      ) {
        fail(
          "RECOVERY_PRODUCTION_PARTIAL_RECEIPT_READBACK_MISMATCH",
          "Durable partial-receipt readback did not match the exact immutable receipt binding.",
          { receipt_id_hash: digest(normalized.receipt_id) },
        );
      }
      return Object.freeze({
        persisted: true,
        durable: true,
        immutable_identity_binding: true,
        evidence_hash: record.evidence_sha256,
        reconciliation_required: true,
        automatic_rerun_allowed: false,
        production_authority: true,
        secrets_included: false,
      });
    },
  });
}

function canonicalProofRequest(input = {}) {
  const expectedSha = txt(input.expected_sha, 40).toLowerCase();
  const targetKey = txt(input.target_key || "production-runtime", 128);
  const inspectionRunId = txt(
    input.inspection_run_id || input.role_selection_proof?.inspection_run_id,
    128,
  );
  if (
    !SHA40.test(expectedSha)
    || !targetKey
    || !INSPECTION_RUN.test(inspectionRunId)
    || txt(input.operation_key, 64) !== "database.rebuild_empty"
    || txt(input.action, 64) !== "apply_migration"
  ) {
    fail(
      "RECOVERY_PRODUCTION_ROLE_SELECTION_REQUEST_INVALID",
      "Production role-selection proof resolution requires exact SHA, target, durable inspection run, and selected-role rebuild apply semantics.",
    );
  }
  return Object.freeze({
    expected_sha: expectedSha,
    target_key: targetKey,
    environment_key: "production_hostinger_autodeploy",
    operation_key: "database.rebuild_empty",
    action: "apply_migration",
    inspection_run_id: inspectionRunId,
  });
}

function validateResolvedProof(proof, request) {
  if (
    !proof
    || typeof proof !== "object"
    || Array.isArray(proof)
    || proof.source !== "durable_full_inspection"
    || proof.expected_sha !== request.expected_sha
    || proof.target_key !== request.target_key
    || !INSPECTION_RUN.test(txt(proof.inspection_run_id, 128))
    || !Array.isArray(proof.selected_roles)
    || proof.selected_roles.length === 0
    || !SHA256.test(txt(proof.inspection_evidence_hash, 64).toLowerCase())
    || !SHA256.test(txt(proof.composite_target_fingerprint, 64).toLowerCase())
    || !SHA256.test(txt(proof.selection_hash, 64).toLowerCase())
    || proof.database_mutation_performed !== false
    || proof.secrets_included !== false
  ) {
    fail(
      "RECOVERY_PRODUCTION_ROLE_SELECTION_PROOF_INVALID",
      "Resolved Production role-selection evidence is not the canonical durable full-inspection proof.",
    );
  }
  return Object.freeze(structuredClone(proof));
}

export function createProductionRecoveryRoleSelectionProofResolver({
  resolver = resolveDurableRoleSelectionProof,
  resolverDependencies = {},
} = {}) {
  if (typeof resolver !== "function") {
    fail(
      "RECOVERY_PRODUCTION_ROLE_SELECTION_RESOLVER_UNAVAILABLE",
      "Canonical durable role-selection proof resolver is unavailable.",
    );
  }
  return async function productionRecoveryRoleSelectionProofResolver(input = {}) {
    const request = canonicalProofRequest(input);
    const proof = await resolver(request, resolverDependencies);
    return validateResolvedProof(proof, request);
  };
}

export function createProductionRecoveryDurableEvidenceAdapters({
  recoveryStore,
  roleSelectionResolver = resolveDurableRoleSelectionProof,
  roleSelectionResolverDependencies = {},
} = {}) {
  return Object.freeze({
    contract: PRODUCTION_RECOVERY_DURABLE_EVIDENCE_ADAPTERS_CONTRACT,
    phase: "mvp",
    production_live_enabled: false,
    activation_eligible: false,
    partialReceiptStore: createProductionRecoveryPartialReceiptStore({ recoveryStore }),
    proofResolver: createProductionRecoveryRoleSelectionProofResolver({
      resolver: roleSelectionResolver,
      resolverDependencies: roleSelectionResolverDependencies,
    }),
    deferred_components: Object.freeze([
      "mutationExecutor",
      "hostLocalMutationExecutor",
      "readbackVerifier",
      "migrationLedger",
    ]),
    database_connection_performed_during_construction: false,
    provider_accessed_during_construction: false,
    workflow_dispatch_performed_during_construction: false,
    production_mutation_performed_during_construction: false,
    secrets_included: false,
  });
}

export const _testingProductionRecoveryDurableEvidenceAdapters = Object.freeze({
  normalizePartialReceipt,
  partialReceiptRecord,
  canonicalProofRequest,
  validateResolvedProof,
});
