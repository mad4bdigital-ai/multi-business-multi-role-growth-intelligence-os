function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function safeErrorCode(error) {
  const code = String(error?.code || "").trim();
  return /^[A-Z0-9_:-]{1,128}$/i.test(code) ? code : null;
}

export function inferBrandSkillOperation(toolName = "", args = {}, action = null, context = {}) {
  const explicit = normalize(context.operation_intent || context.operation || "");
  if (explicit) return explicit;

  const signals = [
    normalize(`${toolName} ${Object.keys(args || {}).join(" ")}`),
    normalize(action?.action_key || ""),
  ];
  for (const signal of signals) {
    if (/(delete|remove|revoke)/.test(signal)) return "delete";
    if (/(publish|send)/.test(signal)) return "publish";
    if (/(create|insert|add)/.test(signal)) return "create";
    if (/(update|edit|patch|write)/.test(signal)) return "update";
    if (/(dispatch|trigger)/.test(signal)) return "dispatch";
    if (/(deploy|restart|apply|execute|run)/.test(signal)) return "execute";
  }
  return "use";
}

async function resolveUserBrandSkillEntitlementInternal(pool, skill, context = {}, {
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
    `SELECT p.policy_id, p.activation_mode
       FROM brand_skill_policies p
       JOIN agent_skills s ON s.skill_id = p.skill_id AND s.status = 'active'
      WHERE p.tenant_id = ? AND p.brand_key = ? AND s.skill_key = ? AND p.status = 'active'
      LIMIT 1`,
    [tenantId, brandKey, skillKey],
  );
  const policy = policyRows[0] || null;
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
    return {
      configured: true,
      granted: false,
      grant_id: null,
      operation: null,
      policy_id: policy.policy_id,
      reason: "brand_skill_policy_disabled",
    };
  }
  if (!userId) {
    return {
      configured: true,
      granted: false,
      grant_id: null,
      operation: null,
      policy_id: policy.policy_id,
      reason: "user_brand_skill_grant_user_required",
    };
  }

  const operation = inferBrandSkillOperation(toolName, args, action, context);
  const resourceType = String(context.resource_type || "").trim();
  const resourceRef = String(context.resource_ref || context.target_ref || "").trim();
  const [grantRows] = await pool.query(
    `SELECT grant_id, resource_type, resource_ref
       FROM v_effective_user_brand_skill_grants
      WHERE tenant_id = ? AND user_id = ? AND brand_key = ? AND agent_id = ? AND skill_key = ?
        AND (JSON_CONTAINS(allowed_operations_json, JSON_QUOTE('*'))
             OR JSON_CONTAINS(allowed_operations_json, JSON_QUOTE(?)))
        AND (resource_type IS NULL OR (resource_type = ? AND resource_ref = ?))
      LIMIT 1`,
    [tenantId, userId, brandKey, agentId, skillKey, operation, resourceType, resourceRef],
  );
  const grant = grantRows[0] || null;
  return {
    configured: true,
    granted: Boolean(grant),
    grant_id: grant?.grant_id || null,
    operation,
    policy_id: policy.policy_id,
    reason: grant ? null : "user_brand_skill_grant_missing",
  };
}

export async function resolveUserBrandSkillEntitlement(pool, skill, context = {}, options = {}) {
  try {
    return await resolveUserBrandSkillEntitlementInternal(pool, skill, context, options);
  } catch (error) {
    return {
      configured: true,
      granted: false,
      grant_id: null,
      operation: inferBrandSkillOperation(options.toolName, options.args, options.action, context),
      reason: "user_brand_skill_grant_resolution_failed",
      resolution_error_code: safeErrorCode(error),
      secrets_included: false,
    };
  }
}
