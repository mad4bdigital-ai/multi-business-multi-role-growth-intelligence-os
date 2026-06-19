import { randomUUID } from "node:crypto";
import {
  detectContainmentCycle,
  stableSha256,
  validateContainerRelationship,
  validateDelegationAgainstResolution,
  validateNoSecretMetadata
} from "./dynamicContainerAuthority.js";
import {
  loadContainerAuthorityState,
  readContainerResolution,
  readIdempotentResult,
  storeIdempotentResult,
  withContainerAuthorityMutation
} from "./dynamicContainerAuthorityRepository.js";
import { invalidateContainerAuthorityCache } from "./dynamicContainerAuthorityResolver.js";

function serviceError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

function parseEpochTag(ifMatch) {
  if (!ifMatch) return null;
  const match = String(ifMatch).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function requireIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 128) throw serviceError(400,"idempotency_key_invalid","Idempotency-Key must contain 8 to 128 characters.");
  return key;
}

async function returnIdempotentOrConflict(scopeKey, idempotencyKey, requestSha256) {
  const existing = await readIdempotentResult(scopeKey,idempotencyKey);
  if (!existing) return null;
  if (existing.request_sha256 !== requestSha256) throw serviceError(409,"idempotency_key_conflict","Idempotency key was already used with a different request.");
  return existing.response;
}

function assertNoSecret(value) {
  const result = validateNoSecretMetadata(value);
  if (!result.ok) throw serviceError(422,"container_secret_field_forbidden","Secret-like fields are forbidden in container authority metadata.",result.violations);
}

function assertEpoch(expectedEpoch, actualEpoch) {
  if (expectedEpoch !== null && Number(expectedEpoch) !== Number(actualEpoch)) {
    throw serviceError(409,"container_authority_epoch_changed","Authority epoch changed before mutation.",[{ expected:expectedEpoch,actual:actualEpoch }]);
  }
}

export async function createContainerRelationship(input, { idempotencyKey, ifMatch, actorId = "platform_admin" } = {}) {
  assertNoSecret(input);
  const key = requireIdempotencyKey(idempotencyKey);
  const relationshipId = input.relationshipId || randomUUID();
  const request = {
    relationship_id:relationshipId,
    tenant_id:String(input.tenantId || ""),
    from_container_id:String(input.fromContainerId || ""),
    to_container_id:String(input.toContainerId || ""),
    relationship_type_key:String(input.relationshipType || ""),
    priority:Number(input.priority || 0),
    conditions_json:input.conditions || {},
    valid_from:input.validFrom || null,
    valid_until:input.validUntil || null,
    status:"active",
    version:1,
    created_by:actorId,
    approved_by:input.approvedBy || null,
    metadata_json:input.metadata || {}
  };
  if (!request.tenant_id || !request.from_container_id || !request.to_container_id || !request.relationship_type_key) {
    throw serviceError(400,"container_relationship_invalid","tenantId, fromContainerId, toContainerId, and relationshipType are required.");
  }
  const scopeKey = `container-relationship:${request.tenant_id}`;
  const requestSha256 = stableSha256(request);
  const replay = await returnIdempotentOrConflict(scopeKey,key,requestSha256);
  if (replay) return { ...replay,idempotentReplay:true };
  const expectedEpoch = parseEpochTag(ifMatch);
  const mutation = await withContainerAuthorityMutation({
    tenantId:request.tenant_id,mutationType:"container_relationship_create",mutationRef:relationshipId,affectedContainerId:request.to_container_id,rebuildClosure:true,
    work:async (connection,currentEpoch) => {
      assertEpoch(expectedEpoch,currentEpoch);
      const state = await loadContainerAuthorityState({ tenantId:request.tenant_id,targetContainerId:request.to_container_id,principal:{ type:"service",id:"container-mutation" } },connection);
      const validation = validateContainerRelationship({
        relationship:request,relationships:state.relationships,containers:state.containers,containerTypes:state.containerTypes,relationshipTypes:state.relationshipTypes
      });
      if (!validation.ok) throw serviceError(422,validation.errors[0]?.code || "container_relationship_not_allowed","Container relationship validation failed.",validation.errors);
      if (validation.relationshipType?.contributes_to_ancestry || validation.relationshipType?.relationship_class === "containment") {
        const cycle = detectContainmentCycle({ relationships:state.relationships,proposedRelationship:request,relationshipTypes:state.relationshipTypes });
        if (cycle.blocked) throw serviceError(409,cycle.code || "container_cycle_detected","Containment relationship would create an invalid graph.",[cycle]);
      }
      await connection.query(
        `INSERT INTO container_relationships
          (relationship_id,tenant_id,from_container_id,to_container_id,relationship_type_key,priority,conditions_json,valid_from,valid_until,status,version,created_by,approved_by,metadata_json)
         VALUES (?,?,?,?,?,?,?,?,?,'active',1,?,?,?)`,
        [relationshipId,request.tenant_id,request.from_container_id,request.to_container_id,request.relationship_type_key,request.priority,JSON.stringify(request.conditions_json),request.valid_from,request.valid_until,actorId,request.approved_by,JSON.stringify(request.metadata_json)]
      );
      return { relationshipId,tenantId:request.tenant_id,fromContainerId:request.from_container_id,toContainerId:request.to_container_id,relationshipType:request.relationship_type_key,status:"active" };
    }
  });
  invalidateContainerAuthorityCache(request.tenant_id);
  const response = { ok:true,...mutation.result,authorityEpoch:mutation.authorityEpoch,closureRows:mutation.closure?.rowCount || 0,secretsIncluded:false };
  await storeIdempotentResult({ scopeKey,idempotencyKey:key,requestSha256,resultType:"relationship",resultId:relationshipId,response });
  return response;
}

export async function createContainerRoleAssignment(input, { idempotencyKey, ifMatch, actorId = "platform_admin" } = {}) {
  assertNoSecret(input);
  const key = requireIdempotencyKey(idempotencyKey);
  const assignmentId = input.assignmentId || randomUUID();
  const tenantId = String(input.tenantId || "");
  const principal = { type:String(input.principal?.type || ""),id:String(input.principal?.id || "") };
  const roleTemplateKey = input.roleTemplateKey ? String(input.roleTemplateKey) : null;
  const inlinePermissions = Array.isArray(input.inlinePermissions) ? input.inlinePermissions : null;
  if (!tenantId || !input.containerId || !principal.type || !principal.id || (!roleTemplateKey && !inlinePermissions) || (roleTemplateKey && inlinePermissions)) {
    throw serviceError(400,"container_role_assignment_invalid","Exactly one roleTemplateKey or inlinePermissions value is required with tenant, container, and principal context.");
  }
  const request = { assignmentId,tenantId,containerId:String(input.containerId),principal,roleTemplateKey,inlinePermissions,inheritanceMode:input.inheritanceMode || "local_only",validUntil:input.validUntil || null };
  const scopeKey = `container-role:${tenantId}`;
  const requestSha256 = stableSha256(request);
  const replay = await returnIdempotentOrConflict(scopeKey,key,requestSha256);
  if (replay) return { ...replay,idempotentReplay:true };
  const expectedEpoch = parseEpochTag(ifMatch);
  const mutation = await withContainerAuthorityMutation({
    tenantId,mutationType:"container_role_assignment_create",mutationRef:assignmentId,affectedContainerId:request.containerId,
    work:async (connection,currentEpoch) => {
      assertEpoch(expectedEpoch,currentEpoch);
      const [containers] = await connection.query("SELECT container_id FROM containers WHERE container_id=? AND tenant_id=? AND status='active' LIMIT 1",[request.containerId,tenantId]);
      if (!containers[0]) throw serviceError(404,"container_not_found","Role target container was not found.");
      if (roleTemplateKey) {
        const [templates] = await connection.query("SELECT role_template_key FROM container_role_template_registry WHERE role_template_key=? AND status='active' LIMIT 1",[roleTemplateKey]);
        if (!templates[0]) throw serviceError(422,"role_template_not_registered","Role template was not found or inactive.");
      }
      await connection.query(
        `INSERT INTO container_role_assignments
          (assignment_id,tenant_id,container_id,principal_type,principal_id,role_template_key,inline_permissions_json,inheritance_mode,valid_from,valid_until,status,version,issued_by,approved_by,metadata_json)
         VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),?,'active',1,?,?,?)`,
        [assignmentId,tenantId,request.containerId,principal.type,principal.id,roleTemplateKey,inlinePermissions ? JSON.stringify(inlinePermissions) : null,request.inheritanceMode,request.validUntil,actorId,input.approvedBy || null,JSON.stringify(input.metadata || {})]
      );
      return { assignmentId,tenantId,containerId:request.containerId,principal,roleTemplateKey,inheritanceMode:request.inheritanceMode,status:"active" };
    }
  });
  invalidateContainerAuthorityCache(tenantId);
  const response = { ok:true,...mutation.result,authorityEpoch:mutation.authorityEpoch,secretsIncluded:false };
  await storeIdempotentResult({ scopeKey,idempotencyKey:key,requestSha256,resultType:"role_assignment",resultId:assignmentId,response });
  return response;
}

export async function createContainerResourceBinding(input, { idempotencyKey, ifMatch, actorId = "platform_admin" } = {}) {
  assertNoSecret(input);
  const key = requireIdempotencyKey(idempotencyKey);
  const bindingId = input.bindingId || randomUUID();
  const tenantId = String(input.tenantId || "");
  const effect = String(input.effect || "").toLowerCase();
  const operations = Array.isArray(input.operations) ? input.operations.map(String) : [];
  const request = {
    bindingId,tenantId,containerId:String(input.containerId || ""),dimension:String(input.dimension || ""),resourceType:String(input.resourceType || ""),resourceRef:String(input.resourceRef || ""),
    effect,permissionKey:input.permissionKey ? String(input.permissionKey) : null,operations,capabilityKeys:Array.isArray(input.capabilityKeys) ? input.capabilityKeys.map(String) : [],
    inheritanceMode:input.inheritanceMode || "local_only",conditions:input.conditions || {},validUntil:input.validUntil || null,
    delegatedByPrincipalType:input.delegatedByPrincipalType || null,delegatedByPrincipalId:input.delegatedByPrincipalId || null,delegatorResolutionId:input.delegatorResolutionId || null
  };
  if (!tenantId || !request.containerId || !request.dimension || !request.resourceType || !request.resourceRef || !new Set(["allow","deny","restrict","require","share","delegate"]).has(effect)) {
    throw serviceError(400,"container_resource_binding_invalid","Container, dimension, resource, and a supported effect are required.");
  }
  if (request.resourceRef === "*" || operations.includes("*")) throw serviceError(422,"container_resource_binding_invalid","Wildcard resources or operations are forbidden.");
  const scopeKey = `container-binding:${tenantId}`;
  const requestSha256 = stableSha256(request);
  const replay = await returnIdempotentOrConflict(scopeKey,key,requestSha256);
  if (replay) return { ...replay,idempotentReplay:true };
  let delegatorResolution = null;
  if (effect === "delegate") {
    if (!operations.length || operations.some(operation => operation.endsWith(".*")) || !request.delegatorResolutionId || !request.delegatedByPrincipalType || !request.delegatedByPrincipalId) {
      throw serviceError(422,"delegation_exceeds_delegator_authority","Delegation requires exact operations and delegator resolution identity.");
    }
    delegatorResolution = await readContainerResolution(request.delegatorResolutionId,{ tenantId,principalId:request.delegatedByPrincipalId });
    const delegationCheck = validateDelegationAgainstResolution({ delegation:{ dimension:request.dimension,resourceType:request.resourceType,resourceRef:request.resourceRef,operation:operations[0] },delegatorResolution });
    if (!delegationCheck.ok) throw serviceError(403,delegationCheck.code,"Delegation exceeds the delegator effective authority.");
  }
  const expectedEpoch = parseEpochTag(ifMatch);
  const mutation = await withContainerAuthorityMutation({
    tenantId,mutationType:"container_resource_binding_create",mutationRef:bindingId,affectedContainerId:request.containerId,
    work:async (connection,currentEpoch) => {
      assertEpoch(expectedEpoch,currentEpoch);
      const [containers] = await connection.query("SELECT container_id FROM containers WHERE container_id=? AND tenant_id=? AND status='active' LIMIT 1",[request.containerId,tenantId]);
      if (!containers[0]) throw serviceError(404,"container_not_found","Binding target container was not found.");
      const [dimensions] = await connection.query("SELECT dimension_key,supports_sharing,supports_delegation FROM container_resource_dimension_registry WHERE dimension_key=? AND status='active' LIMIT 1",[request.dimension]);
      if (!dimensions[0]) throw serviceError(422,"resource_dimension_not_registered","Resource dimension was not found or inactive.");
      if (effect === "share" && !dimensions[0].supports_sharing) throw serviceError(422,"container_relationship_not_allowed","Dimension does not support sharing.");
      if (effect === "delegate" && !dimensions[0].supports_delegation) throw serviceError(422,"container_relationship_not_allowed","Dimension does not support delegation.");
      await connection.query(
        `INSERT INTO container_resource_bindings
          (binding_id,tenant_id,container_id,dimension_key,resource_type,resource_ref,effect,permission_key,operation_patterns_json,capability_keys_json,inheritance_mode,merge_priority,conditions_json,valid_from,valid_until,status,version,source_table,source_pk,delegated_by_principal_type,delegated_by_principal_id,delegator_resolution_id,created_by,approved_by,metadata_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),?,'active',1,?,?,?,?,?,?,?,?)`,
        [bindingId,tenantId,request.containerId,request.dimension,request.resourceType,request.resourceRef,effect,request.permissionKey,JSON.stringify(operations),JSON.stringify(request.capabilityKeys),request.inheritanceMode,Number(input.mergePriority || 0),JSON.stringify(request.conditions),request.validUntil,
         input.sourceTable || null,input.sourcePk || null,request.delegatedByPrincipalType,request.delegatedByPrincipalId,request.delegatorResolutionId,actorId,input.approvedBy || null,JSON.stringify(input.metadata || {})]
      );
      return { bindingId,tenantId,containerId:request.containerId,dimension:request.dimension,resourceType:request.resourceType,resourceRef:request.resourceRef,effect,status:"active" };
    }
  });
  invalidateContainerAuthorityCache(tenantId);
  const response = { ok:true,...mutation.result,authorityEpoch:mutation.authorityEpoch,secretsIncluded:false };
  await storeIdempotentResult({ scopeKey,idempotencyKey:key,requestSha256,resultType:"resource_binding",resultId:bindingId,response });
  return response;
}

export const _testingDynamicContainerAuthorityMutationService = { parseEpochTag,requireIdempotencyKey,assertEpoch };
