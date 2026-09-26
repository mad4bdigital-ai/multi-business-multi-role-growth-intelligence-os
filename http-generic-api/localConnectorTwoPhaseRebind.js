import { createHash, randomUUID } from "node:crypto";
import { assertRecoveryData, projectRecoveryReceipt } from "./recoveryProofBoundary.js";

export const LOCAL_CONNECTOR_TWO_PHASE_REBIND_CONTRACT = "mad4b.local-connector-two-phase-rebind.v1";

const SAFE_REF_RE = /^[A-Za-z0-9._:-]{8,240}$/u;

const PHASE_RECEIPT_FIELDS = Object.freeze({
  bound_context: Object.freeze([
    "device_id",
    "user_ref",
    "tenant_ref",
    "old_credential_ref",
    "device_authentication_verified",
    "fresh_user_authorization_verified",
    "status",
    "request_id",
    "secrets_included",
  ]),
  prepare: Object.freeze([
    "pending_credential_ref",
    "old_credential_active",
    "old_credential_revoked",
    "credential_version",
    "issued_at",
    "expires_at",
    "status",
    "request_id",
    "secrets_included",
  ]),
  install: Object.freeze([
    "local_atomic_install_verified",
    "old_credential_revoked",
    "device_id",
    "credential_version",
    "installed_at",
    "status",
    "request_id",
    "secrets_included",
  ]),
  probe: Object.freeze([
    "authenticated",
    "http_status",
    "old_credential_revoked",
    "probe_status",
    "credential_version",
    "request_id",
    "status",
    "secrets_included",
  ]),
  commit: Object.freeze([
    "new_credential_active",
    "old_credential_revoked",
    "commit_readback_verified",
    "credential_version",
    "committed_at",
    "request_id",
    "status",
    "secrets_included",
  ]),
});

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function fail(code, message, status = 409, details = {}) {
  throw Object.assign(new Error(message), {
    code,
    status,
    details: { ...details, secrets_included: false },
  });
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    fail("LOCAL_CONNECTOR_REBIND_ADAPTER_MISSING", `Two-phase rebind requires ${name}.`, 503);
  }
  return value;
}

function assertSafeReceipt(receipt, phase) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("LOCAL_CONNECTOR_REBIND_RECEIPT_INVALID", `${phase} did not return a receipt.`, 502);
  }
  if (receipt.secrets_included !== false) {
    fail("LOCAL_CONNECTOR_REBIND_RECEIPT_SECRET_BOUNDARY_INVALID", `${phase} did not prove secrets_included=false.`, 502);
  }
  try {
    assertRecoveryData(receipt);
  } catch (error) {
    fail(
      "LOCAL_CONNECTOR_REBIND_SECRET_MATERIAL_FORBIDDEN",
      "Credential material may not cross the rebind coordinator.",
      500,
      { phase, error_code: String(error?.code || "recovery_proof_boundary") },
    );
  }
  const allowed = PHASE_RECEIPT_FIELDS[phase];
  if (!allowed) {
    fail("LOCAL_CONNECTOR_REBIND_RECEIPT_PHASE_UNKNOWN", "Receipt phase is not registered.", 500, { phase });
  }
  try {
    return projectRecoveryReceipt(
      receipt,
      allowed,
      "LOCAL_CONNECTOR_REBIND_RECEIPT_FIELD_FORBIDDEN",
    );
  } catch (error) {
    fail(
      error?.code || "LOCAL_CONNECTOR_REBIND_RECEIPT_FIELD_FORBIDDEN",
      "Receipt contains fields outside the registered phase schema.",
      502,
      { phase },
    );
  }
}

function opaqueRef(value, field) {
  const normalized = text(value, 240);
  if (!SAFE_REF_RE.test(normalized)) fail("LOCAL_CONNECTOR_REBIND_REFERENCE_INVALID", `${field} is invalid.`, 502, { field });
  return normalized;
}

export function createLocalConnectorTwoPhaseRebindExecutor({
  resolveBoundDeviceContext,
  preparePendingCredential,
  installPendingCredentialLocally,
  probePendingCredential,
  commitPendingCredential,
  cancelPendingCredential = null,
} = {}) {
  const resolveContext = requireFunction(resolveBoundDeviceContext, "resolveBoundDeviceContext");
  const prepare = requireFunction(preparePendingCredential, "preparePendingCredential");
  const install = requireFunction(installPendingCredentialLocally, "installPendingCredentialLocally");
  const probe = requireFunction(probePendingCredential, "probePendingCredential");
  const commit = requireFunction(commitPendingCredential, "commitPendingCredential");

  return async function executeLocalConnectorTwoPhaseRebind(stepContext = {}) {
    if (stepContext?.approval?.server_verified !== true || stepContext?.approval?.single_use !== true) {
      fail("LOCAL_CONNECTOR_REBIND_APPROVAL_REQUIRED", "Two-phase rebind requires the server-verified single-use recovery-step approval.", 403);
    }

    const bound = assertSafeReceipt(await resolveContext(Object.freeze({
      expected_sha: text(stepContext.expected_sha, 40).toLowerCase(),
      run_id: text(stepContext.run_id, 220),
      plan_hash: text(stepContext.plan_hash, 64).toLowerCase(),
      step_id: text(stepContext.step_id, 220),
      idempotency_key: text(stepContext.idempotency_key, 240),
      secrets_included: false,
    })), "bound_context");

    if (bound.device_authentication_verified !== true || bound.fresh_user_authorization_verified !== true) {
      fail("LOCAL_CONNECTOR_REBIND_FRESH_AUTH_REQUIRED", "Device authentication and fresh user authorization are required before credential preparation.", 403);
    }

    const deviceId = opaqueRef(bound.device_id, "device_id");
    const userRef = opaqueRef(bound.user_ref, "user_ref");
    const tenantRef = opaqueRef(bound.tenant_ref, "tenant_ref");
    const oldCredentialRef = opaqueRef(bound.old_credential_ref, "old_credential_ref");
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    let pendingRef = null;
    let installed = false;
    let probeVerified = false;
    let commitAttempted = false;
    let requestId = null;
    try {
      const prepared = assertSafeReceipt(await prepare(Object.freeze({
        device_id: deviceId,
        user_ref: userRef,
        tenant_ref: tenantRef,
        old_credential_ref: oldCredentialRef,
        nonce,
        expires_at: expiresAt,
        expected_sha: text(stepContext.expected_sha, 40).toLowerCase(),
        idempotency_key: text(stepContext.idempotency_key, 240),
        fresh_user_authorization_verified: true,
        device_authentication_verified: true,
        secrets_included: false,
      })), "prepare");
      pendingRef = opaqueRef(prepared.pending_credential_ref, "pending_credential_ref");
      if (prepared.old_credential_active !== true || prepared.old_credential_revoked === true) {
        fail("LOCAL_CONNECTOR_REBIND_PREPARE_ORDER_INVALID", "Old credential must remain active during pending credential preparation.", 502);
      }

      const installedReceipt = assertSafeReceipt(await install(Object.freeze({
        pending_credential_ref: pendingRef,
        device_id: deviceId,
        expected_sha: text(stepContext.expected_sha, 40).toLowerCase(),
        installer_mode: "fresh_device_authorized_app_managed",
        atomic_local_install_required: true,
        secrets_included: false,
      })), "install");
      if (installedReceipt.local_atomic_install_verified !== true || installedReceipt.old_credential_revoked === true) {
        fail("LOCAL_CONNECTOR_REBIND_LOCAL_INSTALL_UNVERIFIED", "Local Manager did not prove atomic installation while retaining the old credential.", 502);
      }
      installed = true;

      const probeReceipt = assertSafeReceipt(await probe(Object.freeze({
        pending_credential_ref: pendingRef,
        device_id: deviceId,
        expected_sha: text(stepContext.expected_sha, 40).toLowerCase(),
        authenticated_operation_required: true,
        secrets_included: false,
      })), "probe");
      requestId = text(probeReceipt.request_id, 160) || null;
      if (probeReceipt.authenticated !== true || Number(probeReceipt.http_status) !== 200 || probeReceipt.old_credential_revoked === true) {
        fail("LOCAL_CONNECTOR_REBIND_PROBE_FAILED", "New credential did not pass an authenticated operation while the old credential remained valid.", 409, { request_id: requestId });
      }
      probeVerified = true;

      const probeEvidence = {
        pending_credential_ref: pendingRef,
        device_id: deviceId,
        request_id: requestId,
        authenticated: true,
        http_status: 200,
        expected_sha: text(stepContext.expected_sha, 40).toLowerCase(),
        secrets_included: false,
      };
      commitAttempted = true;
      const committed = assertSafeReceipt(await commit(Object.freeze({
        pending_credential_ref: pendingRef,
        old_credential_ref: oldCredentialRef,
        device_id: deviceId,
        probe_evidence_hash: digest(probeEvidence),
        expected_sha: text(stepContext.expected_sha, 40).toLowerCase(),
        idempotency_key: text(stepContext.idempotency_key, 240),
        secrets_included: false,
      })), "commit");
      if (committed.new_credential_active !== true || committed.old_credential_revoked !== true || committed.commit_readback_verified !== true) {
        fail("LOCAL_CONNECTOR_REBIND_COMMIT_UNVERIFIED", "Credential cutover did not prove new-active and old-revoked postconditions.", 502);
      }

      return Object.freeze({
        ok: true,
        contract: LOCAL_CONNECTOR_TWO_PHASE_REBIND_CONTRACT,
        status: "pass",
        pending_credential_ref: pendingRef,
        fresh_device_authorization_verified: true,
        pending_credential_created: true,
        local_atomic_install_verified: installed,
        new_credential_probe_verified: probeVerified,
        old_credential_revoked_after_probe: true,
        old_credential_revoked_before_probe: false,
        credential_material_returned_to_orchestrator: false,
        request_id: requestId,
        authority_verified: true,
        readback_verified: true,
        mutation_performed: true,
        secrets_included: false,
      });
    } catch (error) {
      if (pendingRef && !probeVerified && typeof cancelPendingCredential === "function") {
        await cancelPendingCredential(Object.freeze({
          pending_credential_ref: pendingRef,
          device_id: deviceId,
          reason: "pre_commit_rebind_failure",
          retain_old_credential: true,
          secrets_included: false,
        })).catch(() => {});
      }
      if (error?.unknown_outcome === true) throw error;
      if (commitAttempted && error?.mutation_performed !== false) {
        error.unknown_outcome = true;
        error.reconciliation_required = true;
        error.automatic_retry_allowed = false;
        error.commit_attempted = true;
        error.request_id = requestId;
        error.mutation_performed = error?.code === "LOCAL_CONNECTOR_REBIND_COMMIT_UNVERIFIED"
          ? true
          : null;
      }
      throw error;
    }
  };
}
