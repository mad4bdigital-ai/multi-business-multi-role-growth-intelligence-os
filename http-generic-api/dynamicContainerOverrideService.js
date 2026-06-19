import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { resolveOverridePolicy, stableSha256, validateNoSecretMetadata } from "./dynamicContainerAuthority.js";
import {
  addContainerOverrideApproval,
  consumeContainerOverride,
  createContainerOverrideRequestRecord,
  readContainerAuthorityEpoch,
  readContainerResolution,
  readIdempotentResult,
  storeIdempotentResult
} from "./dynamicContainerAuthorityRepository.js";

function overrideError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

function requireExactValue(value, field, maxLength = 512) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "*" || normalized.endsWith(".*") || normalized.length > maxLength) {
    throw overrideError(422,"override_scope_mismatch",`${field} must be an exact non-wildcard value.`);
  }
  return normalized;
}

async function readCapabilityEnvelope(envelopeId) {
  const [rows] = await getPool().query(
    `SELECT envelope_id,tenant_id,user_id,workspace_id,brand_key,capability_key,operation_intent,risk_class,
            authority_status,decision,envelope_status,dispatch_allowed,apply_allowed,approval_required,
            audit_required,readback_required,blocking_gap_count,envelope_sha256,expires_at,secrets_included
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id=? LIMIT 1`,
    [envelopeId]
  );
  return rows[0] || null;
}

export async function requestContainerOverride(input, { idempotencyKey, requesterPrincipal } = {}) {
  const secretCheck = validateNoSecretMetadata(input);
  if (!secretCheck.ok) throw overrideError(422,"container_secret_field_forbidden","Secret-like fields are forbidden in override requests.",secretCheck.violations);
  const key = String(idempotencyKey || "").trim();
  if (key.length < 8 || key.length > 128) throw overrideError(400,"idempotency_key_invalid","Idempotency-Key must contain 8 to 128 characters.");
  const principal = {
    type:String(requesterPrincipal?.type || input.requesterPrincipal?.type || "service").trim().toLowerCase(),
    id:String(requesterPrincipal?.id || input.requesterPrincipal?.id || "").trim()
  };
  if (!new Set(["user","agent","service","group"]).has(principal.type) || !principal.id) throw overrideError(400,"principal_invalid","Valid requester principal required.");
  const originalResolutionId = requireExactValue(input.originalResolutionId,"originalResolutionId",36);
  const capabilityEnvelopeId = requireExactValue(input.capabilityEnvelopeId,"capabilityEnvelopeId",36);
  const original = await readContainerResolution(originalResolutionId);
  if (!original) throw overrideError(404,"container_resolution_not_found","Original container resolution was not found.");
  if (original.decision === "allow") throw overrideError(409,"override_required","An override cannot be requested for an already allowed resolution.");
  if (String(original.principal.id) !== principal.id && principal.type !== "service") throw overrideError(403,"override_scope_mismatch","Requester principal does not own the original resolution.");
  const envelope = await readCapabilityEnvelope(capabilityEnvelopeId);
  if (!envelope) throw overrideError(404,"capability_envelope_not_found","Capability envelope was not found.");
  if (String(envelope.tenant_id || "") !== String(original.tenantId)) throw overrideError(403,"override_scope_mismatch","Capability envelope tenant does not match the resolution tenant.");
  if (!new Set(["ready_for_dispatch","ready_requires_approval"]).has(String(envelope.envelope_status)) || envelope.authority_status !== "passed" || Number(envelope.blocking_gap_count || 0) > 0) {
    throw overrideError(409,"override_required","Capability envelope is not ready for override governance.");
  }
  if (new Date(envelope.expires_at).getTime() <= Date.now()) throw overrideError(409,"override_expired","Capability envelope expired.");
  const currentEpoch = await readContainerAuthorityEpoch(original.tenantId);
  if (Number(currentEpoch.authority_epoch) !== Number(original.authorityEpoch)) throw overrideError(409,"override_snapshot_stale","Original resolution authority epoch is stale.");

  const targetContainerId = requireExactValue(input.targetContainerId,"targetContainerId",36);
  const dimensionKey = requireExactValue(input.dimension || input.dimensionKey,"dimension",191);
  const resourceType = requireExactValue(input.resourceType,"resourceType",128);
  const resourceRef = requireExactValue(input.resourceRef,"resourceRef",512);
  const operationKey = requireExactValue(input.operation,"operation",191);
  if (targetContainerId !== String(original.targetContainerId)) throw overrideError(422,"override_scope_mismatch","Target container does not match the original resolution.");
  const originalRequest = (original.requestContext?.dimensionRequests || []).find(request =>
    String(request.dimension) === dimensionKey
      && String(request.resourceType) === resourceType
      && String(request.resourceRef) === resourceRef
      && String(request.operation) === operationKey
  );
  if (!originalRequest) throw overrideError(422,"override_scope_mismatch","Override dimension, resource, or operation is outside the original resolution.");
  if (envelope.operation_intent && String(envelope.operation_intent) !== operationKey && String(envelope.capability_key) !== String(originalRequest.capabilityKey || "")) {
    throw overrideError(422,"override_scope_mismatch","Capability envelope operation/capability does not match the requested override.");
  }
  const reason = String(input.reason || "").trim();
  if (reason.length < 20 || reason.length > 1000) throw overrideError(400,"override_reason_invalid","Override reason must contain 20 to 1000 characters.");
  const policy = resolveOverridePolicy(input.riskClass || envelope.risk_class || "standard",input.requestedTtlMinutes);
  const overrideId = input.overrideId || randomUUID();
  const expiresAt = new Date(Date.now()+policy.ttlMinutes*60*1000).toISOString().slice(0,19).replace("T"," ");
  const payload = {
    overrideId,capabilityEnvelopeId,originalResolutionId,originalResolutionSha256:original.resolutionSha256,
    authorityEpoch:original.authorityEpoch,registrySnapshotHash:original.registrySnapshotHash,tenantId:original.tenantId,
    requesterPrincipalType:principal.type,requesterPrincipalId:principal.id,targetContainerId,containerPathHash:original.containerPathHash,
    dimensionKey,resourceType,resourceRef,operationKey,riskClass:policy.riskClass,reason,
    requiredApprovalCount:policy.requiredApprovalCount,status:"ready_requires_approval",expiresAt
  };
  const requestSha256 = stableSha256(payload);
  const scopeKey = `container-override:${original.tenantId}:${principal.id}`;
  const replay = await readIdempotentResult(scopeKey,key);
  if (replay) {
    if (replay.request_sha256 !== requestSha256) throw overrideError(409,"idempotency_key_conflict","Idempotency key was used for a different override request.");
    return { ...replay.response,idempotentReplay:true };
  }
  payload.overrideSha256 = stableSha256({ ...payload,capabilityEnvelopeSha256:envelope.envelope_sha256 });
  await createContainerOverrideRequestRecord(payload);
  const response = {
    ok:true,overrideId,capabilityEnvelopeId,status:payload.status,requiredApprovalCount:policy.requiredApprovalCount,
    approvalCount:0,maximumTtlMinutes:policy.maximumTtlMinutes,expiresAt,riskClass:policy.riskClass,
    targetExecuted:false,providerCallMade:false,credentialPayloadRead:false,secretsIncluded:false
  };
  await storeIdempotentResult({ scopeKey,idempotencyKey:key,requestSha256,resultType:"override",resultId:overrideId,response,ttlMinutes:policy.maximumTtlMinutes });
  return response;
}

export async function approveContainerOverride(overrideId, input, { approverPrincipal } = {}) {
  const secretCheck = validateNoSecretMetadata(input);
  if (!secretCheck.ok) throw overrideError(422,"container_secret_field_forbidden","Secret-like fields are forbidden in override approvals.",secretCheck.violations);
  const principal = {
    type:String(approverPrincipal?.type || input.approverPrincipal?.type || "service").trim().toLowerCase(),
    id:String(approverPrincipal?.id || input.approverPrincipal?.id || "").trim()
  };
  if (!new Set(["user","agent","service","group"]).has(principal.type) || !principal.id) throw overrideError(400,"principal_invalid","Valid approver principal required.");
  const decision = String(input.decision || "").trim().toLowerCase();
  const decisionNote = String(input.decisionNote || "").trim();
  if (!new Set(["approved","rejected"]).has(decision)) throw overrideError(400,"override_approval_invalid","decision must be approved or rejected.");
  if (decisionNote.length < 10 || decisionNote.length > 512) throw overrideError(400,"override_approval_invalid","decisionNote must contain 10 to 512 characters.");
  const result = await addContainerOverrideApproval({ overrideId,approverPrincipalType:principal.type,approverPrincipalId:principal.id,decision,decisionNote });
  return { ok:true,...result,targetExecuted:false,providerCallMade:false,credentialPayloadRead:false,secretsIncluded:false };
}

export async function readContainerOverride(overrideId) {
  const [rows] = await getPool().query(
    `SELECT r.*,v.readiness_code
       FROM container_override_requests r
       LEFT JOIN v_container_override_readiness v ON v.override_id=r.override_id
      WHERE r.override_id=? LIMIT 1`,
    [overrideId]
  );
  if (!rows[0]) return null;
  const [approvals] = await getPool().query(
    `SELECT approval_id,approver_principal_type,approver_principal_id,decision,decision_note,approval_sha256,created_at
       FROM container_override_approvals WHERE override_id=? ORDER BY created_at ASC`,
    [overrideId]
  );
  const row = rows[0];
  return {
    overrideId:row.override_id,capabilityEnvelopeId:row.capability_envelope_id,originalResolutionId:row.original_resolution_id,
    tenantId:row.tenant_id,targetContainerId:row.target_container_id,dimension:row.dimension_key,resourceType:row.resource_type,
    resourceRef:row.resource_ref,operation:row.operation_key,riskClass:row.risk_class,status:row.status,readinessCode:row.readiness_code,
    requiredApprovalCount:Number(row.required_approval_count),approvalCount:Number(row.approval_count),expiresAt:row.expires_at,consumedAt:row.consumed_at,
    approvals:approvals.map(approval => ({ approvalId:approval.approval_id,approverPrincipal:{ type:approval.approver_principal_type,id:approval.approver_principal_id },decision:approval.decision,decisionNote:approval.decision_note,approvalSha256:approval.approval_sha256,createdAt:approval.created_at })),
    targetExecuted:false,providerCallMade:false,credentialPayloadRead:false,secretsIncluded:false
  };
}

export { consumeContainerOverride };

export const _testingDynamicContainerOverrideService = { requireExactValue };
