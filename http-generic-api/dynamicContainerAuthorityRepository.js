import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { buildContainerClosureRows, stableSha256 } from "./dynamicContainerAuthority.js";

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function normalizeRowJson(row, fields = []) {
  const copy = { ...row };
  for (const field of fields) copy[field] = parseJson(copy[field], field.endsWith("_json") ? {} : null);
  return copy;
}

async function queryRows(executor, sql, params = []) {
  const [rows] = await executor.query(sql, params);
  return rows;
}

export async function readContainerAuthorityEpoch(tenantId, executor = getPool()) {
  const rows = await queryRows(executor,
    "SELECT tenant_id, authority_epoch, last_mutation_type, last_mutation_ref, updated_at FROM container_authority_epochs WHERE tenant_id=? LIMIT 1",
    [tenantId]
  );
  return rows[0] || { tenant_id: tenantId, authority_epoch: 0, last_mutation_type: null, last_mutation_ref: null, updated_at: null };
}

export async function loadContainerAuthorityState({ tenantId, targetContainerId, principal }, executor = getPool()) {
  const principalType = String(principal?.type || "");
  const principalId = String(principal?.id || "");
  const [containers, containerTypes, relationships, relationshipTypes, classificationTypes, classifications, roleAssignments, roleTemplates, rolePermissions, dimensions, bindings, epochRows] = await Promise.all([
    queryRows(executor, "SELECT * FROM containers WHERE tenant_id=? AND status='active'", [tenantId]),
    queryRows(executor, "SELECT * FROM container_type_registry WHERE status='active'"),
    queryRows(executor, `SELECT * FROM container_relationships
      WHERE tenant_id=? AND status='active'
        AND (valid_from IS NULL OR valid_from<=UTC_TIMESTAMP())
        AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP())`, [tenantId]),
    queryRows(executor, "SELECT * FROM container_relationship_type_registry WHERE status='active'"),
    queryRows(executor, "SELECT * FROM container_classification_type_registry WHERE status='active'"),
    queryRows(executor, `SELECT * FROM container_classifications
      WHERE tenant_id=? AND status='active'
        AND (valid_from IS NULL OR valid_from<=UTC_TIMESTAMP())
        AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP())`, [tenantId]),
    queryRows(executor, `SELECT * FROM container_role_assignments
      WHERE tenant_id=? AND principal_type=? AND principal_id=? AND status='active'
        AND (valid_from IS NULL OR valid_from<=UTC_TIMESTAMP())
        AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP())`, [tenantId, principalType, principalId]),
    queryRows(executor, "SELECT * FROM container_role_template_registry WHERE status='active'"),
    queryRows(executor, "SELECT * FROM container_role_template_permissions WHERE status='active'"),
    queryRows(executor, "SELECT * FROM container_resource_dimension_registry WHERE status='active'"),
    queryRows(executor, `SELECT * FROM container_resource_bindings
      WHERE tenant_id=? AND status='active'
        AND (valid_from IS NULL OR valid_from<=UTC_TIMESTAMP())
        AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP())`, [tenantId]),
    queryRows(executor, "SELECT * FROM container_authority_epochs WHERE tenant_id=? LIMIT 1", [tenantId])
  ]);
  const target = containers.find(row => String(row.container_id) === String(targetContainerId)) || null;
  return {
    tenantId,
    target,
    containers: containers.map(row => normalizeRowJson(row, ["metadata_json"])),
    containerTypes: containerTypes.map(row => normalizeRowJson(row, ["allowed_parent_types_json", "allowed_child_types_json", "metadata_json"])),
    relationships: relationships.map(row => normalizeRowJson(row, ["conditions_json", "metadata_json"])),
    relationshipTypes: relationshipTypes.map(row => normalizeRowJson(row, ["metadata_json"])),
    classificationTypes: classificationTypes.map(row => normalizeRowJson(row, ["value_schema_json", "eligible_container_types_json", "affected_dimensions_json", "metadata_json"])),
    classifications: classifications.map(row => normalizeRowJson(row, ["value_json", "metadata_json"])),
    roleAssignments: roleAssignments.map(row => normalizeRowJson(row, ["inline_permissions_json", "metadata_json"])),
    roleTemplates: roleTemplates.map(row => normalizeRowJson(row, ["composition_json", "eligible_container_types_json", "metadata_json"])),
    rolePermissions: rolePermissions.map(row => normalizeRowJson(row, ["operation_patterns_json", "conditions_json"])),
    dimensions: dimensions.map(row => normalizeRowJson(row, ["resource_key_schema_json", "metadata_json"])),
    bindings: bindings.map(row => normalizeRowJson(row, ["operation_patterns_json", "capability_keys_json", "conditions_json", "metadata_json"])),
    authorityEpoch: Number(epochRows[0]?.authority_epoch || 0)
  };
}

export async function persistContainerResolution(resolution, executor = getPool()) {
  await executor.query(
    `INSERT INTO container_effective_context_ledger
      (resolution_id,request_id,idempotency_key,principal_type,principal_id,tenant_id,target_container_id,mode,decision,
       authority_epoch,resolver_version,request_sha256,container_path_hash,registry_snapshot_hash,resolution_sha256,
       request_context_json,selected_paths_json,effective_classifications_json,effective_roles_json,effective_bindings_json,
       applied_denies_json,applied_delegations_json,blocking_codes_json,override_request_id,
       provider_call_made,credential_payload_read,secrets_included,expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?)`,
    [
      resolution.resolutionId,resolution.requestId || null,resolution.idempotencyKey || null,
      resolution.principal.type,resolution.principal.id,resolution.tenantId,resolution.targetContainerId,resolution.mode,resolution.decision,
      resolution.authorityEpoch,resolution.resolverVersion,resolution.requestSha256,resolution.containerPathHash,
      resolution.registrySnapshotHash,resolution.resolutionSha256,json(resolution.requestContext),json(resolution.containerPaths),
      json(resolution.effectiveClassifications),json(resolution.effectiveRoles),json(resolution.effectiveBindings),
      json(resolution.appliedDenies),json(resolution.appliedDelegations),json(resolution.blockingCodes),resolution.overrideRequestId || null,
      resolution.expiresAt || null
    ]
  );
  return resolution;
}

export async function readContainerResolution(resolutionId, { tenantId = null, principalId = null } = {}, executor = getPool()) {
  const params = [resolutionId];
  let where = "resolution_id=?";
  if (tenantId) { where += " AND tenant_id=?"; params.push(tenantId); }
  if (principalId) { where += " AND principal_id=?"; params.push(principalId); }
  const rows = await queryRows(executor, `SELECT * FROM container_effective_context_ledger WHERE ${where} LIMIT 1`, params);
  const row = rows[0];
  if (!row) return null;
  return {
    resolutionId: row.resolution_id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    principal: { type: row.principal_type, id: row.principal_id },
    tenantId: row.tenant_id,
    targetContainerId: row.target_container_id,
    mode: row.mode,
    decision: row.decision,
    authorityEpoch: Number(row.authority_epoch),
    resolverVersion: row.resolver_version,
    requestSha256: row.request_sha256,
    containerPathHash: row.container_path_hash,
    registrySnapshotHash: row.registry_snapshot_hash,
    resolutionSha256: row.resolution_sha256,
    requestContext: parseJson(row.request_context_json, {}),
    containerPaths: parseJson(row.selected_paths_json, []),
    effectiveClassifications: parseJson(row.effective_classifications_json, {}),
    effectiveRoles: parseJson(row.effective_roles_json, []),
    effectiveBindings: parseJson(row.effective_bindings_json, []),
    appliedDenies: parseJson(row.applied_denies_json, []),
    appliedDelegations: parseJson(row.applied_delegations_json, []),
    blockingCodes: parseJson(row.blocking_codes_json, []),
    overrideRequestId: row.override_request_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    providerCallMade: Boolean(row.provider_call_made),
    credentialPayloadRead: Boolean(row.credential_payload_read),
    secretsIncluded: Boolean(row.secrets_included)
  };
}

export async function persistShadowComparison(comparison, executor = getPool()) {
  const comparisonId = comparison.comparisonId || randomUUID();
  await executor.query(
    `INSERT INTO container_shadow_comparisons
      (comparison_id,resolution_id,tenant_id,target_container_id,capability_key,legacy_decision,container_decision,
       comparison_status,mismatch_codes_json,legacy_evidence_ref,latency_ms,secrets_included)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
    [comparisonId,comparison.resolutionId,comparison.tenantId,comparison.targetContainerId,comparison.capabilityKey || null,
     comparison.legacyDecision || "unknown",comparison.containerDecision,comparison.comparisonStatus,
     json(comparison.mismatchCodes || []),comparison.legacyEvidenceRef || null,comparison.latencyMs ?? null]
  );
  return { ...comparison, comparisonId, secretsIncluded: false };
}

export async function readContainerRolloutPolicy(policyKey = "dynamic_container_authority_v1", executor = getPool()) {
  const rows = await queryRows(executor, "SELECT * FROM container_rollout_policy_registry WHERE policy_key=? AND status='active' LIMIT 1", [policyKey]);
  return rows[0] ? normalizeRowJson(rows[0], ["metadata_json"]) : null;
}

export async function recordContainerPerformanceSample(sample, executor = getPool()) {
  const sampleId = sample.sampleId || randomUUID();
  await executor.query(
    `INSERT INTO container_resolution_performance_samples
      (sample_id,resolution_id,tenant_id,mode,container_count,relationship_count,path_count,candidate_binding_count,duration_ms,within_budget,metadata_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [sampleId,sample.resolutionId || null,sample.tenantId || null,sample.mode || "synthetic",
     Number(sample.containerCount || 0),Number(sample.relationshipCount || 0),Number(sample.pathCount || 0),
     Number(sample.candidateBindingCount || 0),Number(sample.durationMs || 0),sample.withinBudget ? 1 : 0,json(sample.metadata || {})]
  );
  return { ...sample, sampleId };
}

export async function readIdempotentResult(scopeKey, idempotencyKey, executor = getPool()) {
  const rows = await queryRows(executor,
    "SELECT request_sha256,result_type,result_id,response_json,expires_at FROM container_authority_idempotency WHERE scope_key=? AND idempotency_key=? AND expires_at>UTC_TIMESTAMP() LIMIT 1",
    [scopeKey,idempotencyKey]
  );
  if (!rows[0]) return null;
  return { ...rows[0], response: parseJson(rows[0].response_json, {}) };
}

export async function storeIdempotentResult({ scopeKey, idempotencyKey, requestSha256, resultType, resultId, response, ttlMinutes = 60 }, executor = getPool()) {
  await executor.query(
    `INSERT INTO container_authority_idempotency
      (scope_key,idempotency_key,request_sha256,result_type,result_id,response_json,expires_at)
     VALUES (?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))
     ON DUPLICATE KEY UPDATE request_sha256=VALUES(request_sha256),result_type=VALUES(result_type),result_id=VALUES(result_id),response_json=VALUES(response_json),expires_at=VALUES(expires_at)`,
    [scopeKey,idempotencyKey,requestSha256,resultType,resultId,json(response),Math.max(1,Math.min(1440,Number(ttlMinutes || 60)))]
  );
}

async function lockAuthorityEpoch(connection, tenantId) {
  await connection.query(
    "INSERT INTO container_authority_epochs (tenant_id,authority_epoch,last_mutation_type,last_mutation_ref) VALUES (?,0,'initialize',NULL) ON DUPLICATE KEY UPDATE tenant_id=VALUES(tenant_id)",
    [tenantId]
  );
  const rows = await queryRows(connection, "SELECT authority_epoch FROM container_authority_epochs WHERE tenant_id=? FOR UPDATE", [tenantId]);
  return Number(rows[0]?.authority_epoch || 0);
}

async function advanceAuthorityEpoch(connection, { tenantId, currentEpoch, mutationType, mutationRef, affectedContainerId }) {
  const nextEpoch = currentEpoch + 1;
  await connection.query(
    "UPDATE container_authority_epochs SET authority_epoch=?,last_mutation_type=?,last_mutation_ref=?,updated_at=UTC_TIMESTAMP() WHERE tenant_id=?",
    [nextEpoch,mutationType,mutationRef || null,tenantId]
  );
  const event = {
    tenantId,authorityEpoch:nextEpoch,mutationType,mutationRef:mutationRef || null,affectedContainerId:affectedContainerId || null
  };
  await connection.query(
    `INSERT INTO container_cache_invalidation_events
      (event_id,tenant_id,authority_epoch,mutation_type,mutation_ref,affected_container_id,event_sha256)
     VALUES (?,?,?,?,?,?,?)`,
    [randomUUID(),tenantId,nextEpoch,mutationType,mutationRef || null,affectedContainerId || null,stableSha256(event)]
  );
  return nextEpoch;
}

export async function rebuildContainerClosure(connection, tenantId, authorityEpoch) {
  const state = await loadContainerAuthorityState({ tenantId, targetContainerId: "", principal: { type: "service", id: "closure-rebuild" } }, connection);
  const closure = buildContainerClosureRows({
    tenantId,
    containers: state.containers,
    relationships: state.relationships,
    relationshipTypes: state.relationshipTypes,
    authorityEpoch
  });
  if (!closure.ok) {
    const error = new Error("Container closure rebuild failed.");
    error.code = closure.code || "container_resolution_limit_exceeded";
    error.status = 409;
    error.details = closure;
    throw error;
  }
  await connection.query("DELETE FROM container_closure WHERE tenant_id=?", [tenantId]);
  for (const row of closure.rows) {
    await connection.query(
      `INSERT INTO container_closure
        (tenant_id,ancestor_container_id,descendant_container_id,shortest_depth,longest_depth,path_count,path_hash,authority_epoch,computed_at)
       VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
      [row.tenant_id,row.ancestor_container_id,row.descendant_container_id,row.shortest_depth,row.longest_depth,row.path_count,row.path_hash,row.authority_epoch]
    );
  }
  return { rowCount: closure.rows.length };
}

export async function withContainerAuthorityMutation({ tenantId, mutationType, mutationRef = null, affectedContainerId = null, rebuildClosure = false, work }) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const currentEpoch = await lockAuthorityEpoch(connection, tenantId);
    const result = await work(connection, currentEpoch);
    const nextEpoch = await advanceAuthorityEpoch(connection, { tenantId,currentEpoch,mutationType,mutationRef,affectedContainerId });
    const closure = rebuildClosure ? await rebuildContainerClosure(connection, tenantId, nextEpoch) : null;
    await connection.commit();
    return { result, previousAuthorityEpoch: currentEpoch, authorityEpoch: nextEpoch, closure };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createContainerOverrideRequestRecord(record, executor = getPool()) {
  await executor.query(
    `INSERT INTO container_override_requests
      (override_id,capability_envelope_id,original_resolution_id,original_resolution_sha256,original_decision,original_blocking_codes_json,authority_epoch,registry_snapshot_hash,
       tenant_id,requester_principal_type,requester_principal_id,target_container_id,container_path_hash,dimension_key,
       resource_type,resource_ref,operation_key,risk_class,reason,required_approval_count,approval_count,status,
       override_sha256,expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
    [record.overrideId,record.capabilityEnvelopeId || null,record.originalResolutionId,record.originalResolutionSha256,
     record.originalDecision,JSON.stringify(record.originalBlockingCodes || []),record.authorityEpoch,record.registrySnapshotHash,record.tenantId,record.requesterPrincipalType,record.requesterPrincipalId,
     record.targetContainerId,record.containerPathHash,record.dimensionKey,record.resourceType,record.resourceRef,
     record.operationKey,record.riskClass,record.reason,record.requiredApprovalCount,record.status,record.overrideSha256,record.expiresAt]
  );
  return record;
}

export async function readContainerOverrideForUpdate(connection, overrideId) {
  const rows = await queryRows(connection, "SELECT * FROM container_override_requests WHERE override_id=? LIMIT 1 FOR UPDATE", [overrideId]);
  return rows[0] || null;
}

export async function addContainerOverrideApproval({ overrideId, approverPrincipalType, approverPrincipalId, decision, decisionNote }) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const override = await readContainerOverrideForUpdate(connection, overrideId);
    if (!override) throw Object.assign(new Error("Container override was not found."), { status: 404, code: "container_override_not_found" });
    if (["consumed","rejected","revoked"].includes(override.status)) {
      throw Object.assign(new Error("Container override is not approvable."), { status: 409, code: override.status === "consumed" ? "override_already_consumed" : "override_scope_mismatch" });
    }
    if (new Date(override.expires_at).getTime() <= Date.now()) {
      await connection.query("UPDATE container_override_requests SET status='expired' WHERE override_id=?", [overrideId]);
      throw Object.assign(new Error("Container override expired."), { status: 409, code: "override_expired" });
    }
    const policyRows = await queryRows(connection,
      "SELECT self_approval_allowed FROM container_override_policy_registry WHERE risk_class=? AND status='active' LIMIT 1",
      [override.risk_class]
    );
    const selfApprovalAllowed = Number(policyRows[0]?.self_approval_allowed || 0) === 1;
    const samePrincipal = String(override.requester_principal_type) === String(approverPrincipalType)
      && String(override.requester_principal_id) === String(approverPrincipalId);
    if (samePrincipal && !selfApprovalAllowed) {
      throw Object.assign(new Error("Override requester cannot approve this risk class."), { status:403,code:"override_second_approver_required" });
    }
    const approvalId = randomUUID();
    const approvalSha256 = stableSha256({ overrideId,approverPrincipalType,approverPrincipalId,decision,decisionNote });
    await connection.query(
      `INSERT INTO container_override_approvals
        (approval_id,override_id,approver_principal_type,approver_principal_id,decision,decision_note,approval_sha256)
       VALUES (?,?,?,?,?,?,?)`,
      [approvalId,overrideId,approverPrincipalType,approverPrincipalId,decision,decisionNote,approvalSha256]
    );
    const countRows = await queryRows(connection,
      "SELECT SUM(decision='approved') AS approved_count,SUM(decision='rejected') AS rejected_count FROM container_override_approvals WHERE override_id=?",
      [overrideId]
    );
    const approvalCount = Number(countRows[0]?.approved_count || 0);
    const rejectedCount = Number(countRows[0]?.rejected_count || 0);
    const status = rejectedCount > 0 ? "rejected" : approvalCount >= Number(override.required_approval_count) ? "ready" : "ready_requires_approval";
    await connection.query("UPDATE container_override_requests SET approval_count=?,status=?,updated_at=UTC_TIMESTAMP() WHERE override_id=?", [approvalCount,status,overrideId]);
    await connection.commit();
    return { approvalId,overrideId,decision,status,approvalCount,requiredApprovalCount:Number(override.required_approval_count),secretsIncluded:false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function consumeContainerOverride({
  overrideId,executionRef,resolution,targetContainerId,dimensionKey,resourceType,resourceRef,operationKey,
  actionKey,endpointKey,bindingRef = null,readbackRef
}) {
  const connection = await getPool().getConnection();
  try {
    if (!executionRef || !readbackRef || !actionKey || !endpointKey) {
      throw Object.assign(new Error("Execution, action, endpoint, and same-cycle readback references are required."), { status:422, code:"override_scope_mismatch" });
    }
    await connection.beginTransaction();
    const override = await readContainerOverrideForUpdate(connection,overrideId);
    if (!override) throw Object.assign(new Error("Container override was not found."), { status:404,code:"container_override_not_found" });
    const envelopeRows = await queryRows(connection,
      `SELECT tenant_id,authority_status,envelope_status,dispatch_allowed,apply_allowed,blocking_gap_count,expires_at
         FROM capability_resolution_envelope_ledger WHERE envelope_id=? LIMIT 1 FOR UPDATE`,
      [override.capability_envelope_id]
    );
    const envelope = envelopeRows[0];
    if (!envelope
      || String(envelope.tenant_id || "") !== String(override.tenant_id)
      || envelope.authority_status !== "passed"
      || envelope.envelope_status !== "ready_for_dispatch"
      || Number(envelope.dispatch_allowed || 0) !== 1
      || Number(envelope.apply_allowed || 0) !== 1
      || Number(envelope.blocking_gap_count || 0) > 0) {
      throw Object.assign(new Error("Capability envelope is not ready for override consumption."), { status:409,code:"override_required" });
    }
    if (new Date(envelope.expires_at).getTime() <= Date.now()) {
      throw Object.assign(new Error("Capability envelope expired."), { status:409,code:"override_expired" });
    }
    if (override.status === "consumed") throw Object.assign(new Error("Container override already consumed."), { status:409,code:"override_already_consumed" });
    if (override.status !== "ready") throw Object.assign(new Error("Container override is not ready."), { status:409, code:"override_required" });
    if (new Date(override.expires_at).getTime() <= Date.now()) throw Object.assign(new Error("Container override expired."), { status:409, code:"override_expired" });
    const [epochRows] = await connection.query("SELECT authority_epoch FROM container_authority_epochs WHERE tenant_id=? LIMIT 1", [override.tenant_id]);
    const currentEpoch = Number(epochRows[0]?.authority_epoch || 0);
    const scopeMatches =
      String(override.target_container_id) === String(targetContainerId || resolution?.targetContainerId || "")
      && String(override.dimension_key) === String(dimensionKey || "")
      && String(override.resource_type) === String(resourceType || "")
      && String(override.resource_ref) === String(resourceRef || "")
      && String(override.operation_key) === String(operationKey || "")
      && String(override.container_path_hash) === String(resolution?.containerPathHash || "");
    if (!scopeMatches) throw Object.assign(new Error("Container override scope does not match the execution."), { status:409, code:"override_scope_mismatch" });
    if (currentEpoch !== Number(override.authority_epoch) || Number(override.authority_epoch) !== Number(resolution?.authorityEpoch) || String(override.original_resolution_sha256) !== String(resolution?.resolutionSha256)) {
      await connection.query("UPDATE container_override_requests SET status='stale' WHERE override_id=?", [overrideId]);
      throw Object.assign(new Error("Container override snapshot is stale."), { status:409, code:"override_snapshot_stale" });
    }
    const consumptionId = randomUUID();
    const payload = {
      overrideId,executionRef,resolutionId:resolution.resolutionId,resolutionSha256:resolution.resolutionSha256,
      authorityEpoch:resolution.authorityEpoch,targetContainerId,dimensionKey,resourceType,resourceRef,operationKey,
      actionKey,endpointKey,bindingRef,readbackRef
    };
    await connection.query(
      `INSERT INTO container_override_consumptions
        (consumption_id,override_id,execution_ref,resolution_id,resolution_sha256,authority_epoch,action_key,endpoint_key,binding_ref,readback_ref,consumption_sha256,secrets_included)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
      [consumptionId,overrideId,executionRef,resolution.resolutionId,resolution.resolutionSha256,resolution.authorityEpoch,actionKey,endpointKey,bindingRef,readbackRef,stableSha256(payload)]
    );
    await connection.query("UPDATE container_override_requests SET status='consumed',consumed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE override_id=?", [overrideId]);
    await connection.commit();
    return { ...payload,consumptionId,status:"consumed",secretsIncluded:false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const _testingDynamicContainerAuthorityRepository = { parseJson, normalizeRowJson };
