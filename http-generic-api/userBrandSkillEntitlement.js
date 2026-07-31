import { assertRequestedResourceBelongsToBrand } from "./brandSkillResourceBinding.js";
import {
  requiredResourcePermissionForBrandSkillOperation,
  requiredResourcePermissionForBrandSkillOperations,
  resourcePermissionCoversBrandSkillOperations,
  resourcePermissionRank,
} from "./brandSkillResourcePermission.js";

const EFFECT_CONTROL_KEYS = Object.freeze([
  "operation",
  "operation_intent",
  "action",
  "action_key",
  "status",
  "publish_status",
  "mode",
  "command",
  "intent",
]);

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedSet(value) {
  return new Set(parseArray(value).map((item) => normalize(item)).filter(Boolean));
}

function operationAllowed(value, operation) {
  const allowed = normalizedSet(value);
  return allowed.has("*") || allowed.has(normalize(operation));
}

function inferOperationFromSignal(signal = "") {
  const normalized = normalize(signal);
  const rules = [
    [/(?:^|[\s._-])(delete|remove|revoke)(?:$|[\s._-])/, "delete"],
    [/(?:^|[\s._-])(deploy|restart|apply|execute|run|migrate|rollback|install|uninstall|start|stop|approve)(?:$|[\s._-])/, "execute"],
    [/(?:^|[\s._-])(publish|send)(?:$|[\s._-])/, "publish"],
    [/(?:^|[\s._-])(dispatch|trigger)(?:$|[\s._-])/, "dispatch"],
    [/(?:^|[\s._-])(create|insert|add)(?:$|[\s._-])/, "create"],
    [/(?:^|[\s._-])(update|edit|patch|write|sync)(?:$|[\s._-])/, "update"],
  ];
  for (const [pattern, operation] of rules) {
    if (pattern.test(normalized)) return operation;
  }
  return null;
}

function strongerOperation(currentOperation, candidateOperation) {
  if (!currentOperation) return candidateOperation || null;
  if (!candidateOperation || candidateOperation === currentOperation) return currentOperation;
  if (currentOperation === "*" || candidateOperation === "*") return "*";
  const currentPermission = requiredResourcePermissionForBrandSkillOperation(currentOperation);
  const candidatePermission = requiredResourcePermissionForBrandSkillOperation(candidateOperation);
  const currentRank = resourcePermissionRank(currentPermission);
  const candidateRank = resourcePermissionRank(candidatePermission);
  if (candidateRank > currentRank) return candidateOperation;
  if (candidateRank < currentRank) return currentOperation;
  return "*";
}

function inferEffectControlOperation(args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  let inferred = null;
  for (const key of EFFECT_CONTROL_KEYS) {
    const value = args[key];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    inferred = strongerOperation(inferred, inferOperationFromSignal(`${key} ${String(value)}`));
  }
  return inferred;
}

function elevateOperationByEffectControl(structuralOperation, controlOperation) {
  if (!structuralOperation || !controlOperation) return structuralOperation || null;
  const structuralPermission = requiredResourcePermissionForBrandSkillOperation(structuralOperation);
  const controlPermission = requiredResourcePermissionForBrandSkillOperation(controlOperation);
  return resourcePermissionRank(controlPermission) > resourcePermissionRank(structuralPermission)
    ? controlOperation
    : structuralOperation;
}

function isConsequentialAction(toolName = "", args = {}, action = null) {
  const capabilityClass = normalize(action?.runtime_capability_class);
  if (["mcp_connector", "http_transport_executor", "system_control", "data_write"].includes(capabilityClass)) {
    return true;
  }
  const argumentKeys = Object.keys(args && typeof args === "object" && !Array.isArray(args) ? args : {});
  return Boolean(inferOperationFromSignal(`${toolName} ${action?.action_key || ""} ${argumentKeys.join("_")}`));
}

export function inferBrandSkillOperation(toolName = "", args = {}, action = null, context = {}) {
  const explicit = normalize(context.operation_intent || context.operation || "");
  const structural = inferOperationFromSignal(
    `${toolName} ${action?.action_key || ""} ${Object.keys(args || {}).join("_")}`
  );
  const inferred = elevateOperationByEffectControl(structural, inferEffectControlOperation(args));
  if (inferred) {
    if (explicit && explicit !== inferred) return null;
    return inferred;
  }
  if (explicit && context.brand_skill_operation_intent_trusted === true) return explicit;
  return isConsequentialAction(toolName, args, action) ? null : explicit || "use";
}

function denied(policy, reason, operation = null, extras = {}) {
  return {
    configured: true,
    granted: false,
    grant_id: null,
    operation,
    policy_id: policy?.policy_id || null,
    reason,
    ...extras,
  };
}

function resolveUniqueContextCandidate(rows = []) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length > 1) {
    return { candidate: null, ambiguous: true, candidate_count: candidates.length };
  }
  const [candidate = null] = candidates;
  return { candidate, ambiguous: false, candidate_count: candidate ? 1 : 0 };
}

async function resolveActiveMembership(pool, tenantId, userId) {
  const [rows] = await pool.query(
    `SELECT m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.tenant_id = ? AND m.user_id = ?
      LIMIT 2`,
    [tenantId, userId]
  );
  const resolution = resolveUniqueContextCandidate(rows);
  if (resolution.ambiguous) return resolution;
  const membership = resolution.candidate;
  if (!membership || normalize(membership.status) !== "active" || normalize(membership.tenant_status) !== "active") {
    return { candidate: null, ambiguous: false, candidate_count: membership ? 1 : 0 };
  }
  return resolution;
}

async function resolveBrandWorkspace(pool, tenantId, brandKey) {
  const [rows] = await pool.query(
    `SELECT workspace_id, workspace_key, linked_brand_key, bootstrap_status
       FROM workspace_registry
      WHERE tenant_id = ?
        AND workspace_type = 'brand'
        AND linked_brand_key = ?
      ORDER BY bootstrap_status = 'ready' DESC, updated_at DESC, workspace_id ASC
      LIMIT 2`,
    [tenantId, brandKey]
  );
  return resolveUniqueContextCandidate(rows);
}

async function resolveActiveResourceAuthority(pool, grant, { tenantId, userId, resourceType, resourceRef }) {
  if (!grant?.resource_grant_id) {
    return { candidate: null, ambiguous: false, candidate_count: 0 };
  }
  const [rows] = await pool.query(
    `SELECT grant_id, permission
       FROM workspace_resource_grants
      WHERE grant_id = ?
        AND tenant_id = ?
        AND grantee_user_id = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND resource_type = ?
        AND resource_ref = ?
      LIMIT 2`,
    [grant.resource_grant_id, tenantId, userId, resourceType, resourceRef]
  );
  return resolveUniqueContextCandidate(rows);
}

async function verifyCurrentResourceBrandBinding(pool, {
  tenantId,
  brandKey,
  resourceType,
  resourceRef,
}) {
  try {
    const workspaceResolution = resourceType === "workspace"
      ? await resolveBrandWorkspace(pool, tenantId, brandKey)
      : { candidate: null, ambiguous: false };
    if (workspaceResolution.ambiguous) {
      return {
        binding: null,
        reason: "user_brand_skill_workspace_ambiguous",
        candidate_count: workspaceResolution.candidate_count,
      };
    }
    const binding = await assertRequestedResourceBelongsToBrand(pool, {
      tenantId,
      brandKey,
      workspace: workspaceResolution.candidate,
      requestedResourceType: resourceType,
      requestedResourceRef: resourceRef,
    });
    return {
      binding: binding?.verified === true ? binding : null,
      reason: null,
      candidate_count: binding?.verified === true ? 1 : 0,
    };
  } catch (error) {
    if (error?.code === "BRAND_SKILL_RESOURCE_BINDING_AMBIGUOUS") {
      return {
        binding: null,
        reason: "user_brand_skill_resource_brand_binding_ambiguous",
        candidate_count: 2,
      };
    }
    return { binding: null, reason: null, candidate_count: 0 };
  }
}

export async function resolveUserBrandSkillEntitlement(pool, skill, context = {}, {
  toolName = "",
  args = {},
  action = null,
} = {}) {
  const explicitEnforcement = context.enforce_brand_skill_entitlement === true;
  const tenantId = String(context.tenant_id || "").trim();
  const brandKey = String(context.brand_key || context.target_key || "").trim();
  const userId = String(context.user_id || context.subject_user_id || "").trim();
  const agentId = String(context.agent_id || "").trim();
  const skillKey = String(skill?.matched_skill_key || "").trim();

  if (!skill?.required || !skill?.granted || !skillKey) {
    return { configured: false, granted: true, grant_id: null, operation: null, reason: null };
  }
  if (!tenantId || !brandKey || !agentId) {
    return {
      configured: explicitEnforcement,
      granted: !explicitEnforcement,
      grant_id: null,
      operation: null,
      reason: explicitEnforcement ? "user_brand_skill_scope_required" : null,
    };
  }

  const [policyRows] = await pool.query(
    `SELECT p.policy_id, p.activation_mode, p.allowed_roles_json,
            p.allowed_agent_ids_json, p.allowed_operations_json,
            p.requires_resource_binding
       FROM brand_skill_policies p
       JOIN agent_skills s ON s.skill_id = p.skill_id AND s.status = 'active'
      WHERE p.tenant_id = ? AND p.brand_key = ? AND s.skill_key = ? AND p.status = 'active'
      LIMIT 2`,
    [tenantId, brandKey, skillKey]
  );
  const policyResolution = resolveUniqueContextCandidate(policyRows);
  if (policyResolution.ambiguous) {
    return {
      configured: true,
      granted: false,
      grant_id: null,
      operation: null,
      policy_id: null,
      reason: "brand_skill_policy_ambiguous",
      candidate_count: policyResolution.candidate_count,
    };
  }
  const policy = policyResolution.candidate;
  if (!policy) {
    return {
      configured: explicitEnforcement,
      granted: !explicitEnforcement,
      grant_id: null,
      operation: null,
      reason: explicitEnforcement ? "brand_skill_policy_required" : null,
    };
  }
  if (normalize(policy.activation_mode) === "disabled") {
    return denied(policy, "brand_skill_policy_disabled");
  }
  if (!userId) {
    return denied(policy, "user_brand_skill_grant_user_required");
  }

  const membershipResolution = await resolveActiveMembership(pool, tenantId, userId);
  if (membershipResolution.ambiguous) {
    return denied(policy, "user_brand_skill_membership_ambiguous", null, {
      candidate_count: membershipResolution.candidate_count,
    });
  }
  const membership = membershipResolution.candidate;
  if (!membership) {
    return denied(policy, "user_brand_skill_membership_inactive");
  }
  const allowedRoles = normalizedSet(policy.allowed_roles_json);
  if (allowedRoles.size && !allowedRoles.has(normalize(membership.role))) {
    return denied(policy, "user_brand_skill_role_no_longer_allowed", null, {
      membership_role: membership.role || null,
    });
  }
  const allowedAgents = new Set(parseArray(policy.allowed_agent_ids_json).map((item) => String(item || "").trim()).filter(Boolean));
  if (allowedAgents.size && !allowedAgents.has(agentId)) {
    return denied(policy, "user_brand_skill_agent_no_longer_allowed", null, {
      membership_role: membership.role || null,
    });
  }

  const operation = inferBrandSkillOperation(toolName, args, action, context);
  if (!operation) {
    return denied(policy, "brand_skill_operation_unresolved", null, {
      membership_role: membership.role || null,
    });
  }
  if (!operationAllowed(policy.allowed_operations_json, operation)) {
    return denied(policy, "brand_skill_operation_no_longer_allowed", operation, {
      membership_role: membership.role || null,
    });
  }

  const requestedResourceType = String(context.resource_type || "").trim();
  const requestedResourceRef = String(context.resource_ref || context.target_ref || "").trim();
  const requiresResourceBinding = Number(policy.requires_resource_binding || 0) === 1;
  if (requiresResourceBinding && (!requestedResourceType || !requestedResourceRef)) {
    return denied(policy, "user_brand_skill_resource_scope_required", operation, {
      membership_role: membership.role || null,
    });
  }

  let resourceBrandBinding = null;
  let canonicalResourceType = requestedResourceType;
  let canonicalResourceRef = requestedResourceRef;
  if (requiresResourceBinding) {
    const bindingResolution = await verifyCurrentResourceBrandBinding(pool, {
      tenantId,
      brandKey,
      resourceType: requestedResourceType,
      resourceRef: requestedResourceRef,
    });
    if (bindingResolution.reason) {
      return denied(policy, bindingResolution.reason, operation, {
        membership_role: membership.role || null,
        candidate_count: bindingResolution.candidate_count,
      });
    }
    resourceBrandBinding = bindingResolution.binding;
    if (!resourceBrandBinding) {
      return denied(policy, "user_brand_skill_resource_brand_binding_inactive", operation, {
        membership_role: membership.role || null,
      });
    }
    canonicalResourceType = resourceBrandBinding.resource_type;
    canonicalResourceRef = resourceBrandBinding.resource_ref;
  }

  const [grantRows] = await pool.query(
    `SELECT grant_id, resource_grant_id, resource_type, resource_ref
       FROM v_effective_user_brand_skill_grants
      WHERE tenant_id = ? AND user_id = ? AND brand_key = ? AND agent_id = ? AND skill_key = ?
        AND policy_id = ?
        AND (JSON_CONTAINS(allowed_operations_json, JSON_QUOTE('*'))
             OR JSON_CONTAINS(allowed_operations_json, JSON_QUOTE(?)))
        AND (
          (? = 1 AND resource_type = ? AND resource_ref = ?)
          OR
          (? = 0 AND (resource_type IS NULL OR (resource_type = ? AND resource_ref = ?)))
        )
      LIMIT 2`,
    [
      tenantId,
      userId,
      brandKey,
      agentId,
      skillKey,
      policy.policy_id,
      operation,
      requiresResourceBinding ? 1 : 0,
      canonicalResourceType,
      canonicalResourceRef,
      requiresResourceBinding ? 1 : 0,
      canonicalResourceType,
      canonicalResourceRef,
    ]
  );
  const grantResolution = resolveUniqueContextCandidate(grantRows);
  if (grantResolution.ambiguous) {
    return denied(policy, "user_brand_skill_grant_ambiguous", operation, {
      membership_role: membership.role || null,
      candidate_count: grantResolution.candidate_count,
    });
  }
  const grant = grantResolution.candidate;
  if (!grant) {
    return denied(policy, "user_brand_skill_grant_missing", operation, {
      membership_role: membership.role || null,
    });
  }

  let resourceAuthority = null;
  let requiredResourcePermission = null;
  if (requiresResourceBinding) {
    const authorityResolution = await resolveActiveResourceAuthority(pool, grant, {
      tenantId,
      userId,
      resourceType: canonicalResourceType,
      resourceRef: canonicalResourceRef,
    });
    if (authorityResolution.ambiguous) {
      return denied(policy, "user_brand_skill_resource_authority_ambiguous", operation, {
        membership_role: membership.role || null,
        candidate_count: authorityResolution.candidate_count,
      });
    }
    resourceAuthority = authorityResolution.candidate;
    if (!resourceAuthority) {
      return denied(policy, "user_brand_skill_resource_authority_inactive", operation, {
        membership_role: membership.role || null,
      });
    }
    requiredResourcePermission = requiredResourcePermissionForBrandSkillOperations([operation]);
    if (!resourcePermissionCoversBrandSkillOperations(resourceAuthority.permission, [operation])) {
      return denied(policy, "user_brand_skill_resource_permission_insufficient", operation, {
        membership_role: membership.role || null,
        current_resource_permission: resourceAuthority.permission || null,
        required_resource_permission: requiredResourcePermission,
      });
    }
  }

  return {
    configured: true,
    granted: true,
    grant_id: grant.grant_id,
    operation,
    policy_id: policy.policy_id,
    membership_role: membership.role || null,
    resource_authority_valid: requiresResourceBinding ? true : null,
    resource_brand_binding_valid: requiresResourceBinding ? true : null,
    resource_grant_id: resourceAuthority?.grant_id || grant.resource_grant_id || null,
    resource_type: canonicalResourceType || null,
    resource_ref: canonicalResourceRef || null,
    resource_permission: resourceAuthority?.permission || null,
    required_resource_permission: requiredResourcePermission,
    resource_binding_source: resourceBrandBinding?.binding_source || null,
    reason: null,
  };
}
