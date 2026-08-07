function bindingAuthorityError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function requireExactlyOne(rows, resourceType) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw bindingAuthorityError(404, "container_binding_resource_not_found", `${resourceType} resource was not found.`);
  }
  if (rows.length !== 1) {
    throw bindingAuthorityError(409, "container_binding_resource_ambiguous", `${resourceType} resource reference did not resolve uniquely.`);
  }
  return rows[0];
}

function activeValue(value) {
  return new Set(["active", "enabled", "true", "1", "yes"]).has(String(value ?? "").trim().toLowerCase());
}

export async function resolveCanonicalContainerBindingResource(connection, {
  dimension,
  resourceType,
  resourceRef,
}) {
  if (!connection || typeof connection.query !== "function") {
    throw bindingAuthorityError(500, "container_binding_resource_authority_unavailable", "Container binding resource authority connection is unavailable.");
  }

  const normalizedDimension = String(dimension || "").trim();
  const normalizedType = String(resourceType || "").trim();
  const normalizedRef = String(resourceRef || "").trim();

  if (normalizedDimension === "agents" && normalizedType === "agent") {
    const [rows] = await connection.query(
      "SELECT agent_id, status FROM agents WHERE agent_id=? LIMIT 2 FOR UPDATE",
      [normalizedRef]
    );
    const agent = requireExactlyOne(rows, "agent");
    if (String(agent.status || "").toLowerCase() !== "active") {
      throw bindingAuthorityError(409, "container_binding_resource_inactive", "Only active canonical agents can receive container bindings.");
    }
    return {
      resourceRef: String(agent.agent_id),
      sourceTable: "agents",
      sourcePk: String(agent.agent_id),
      authoritySource: "agents",
    };
  }

  if (normalizedDimension === "workflows" && normalizedType === "workflow") {
    const [rows] = await connection.query(
      `SELECT workflow_id, workflow_key, status, active
         FROM workflows
        WHERE workflow_id=? OR workflow_key=?
        LIMIT 3 FOR UPDATE`,
      [normalizedRef, normalizedRef]
    );
    const workflow = requireExactlyOne(rows, "workflow");
    if (!activeValue(workflow.active) && !activeValue(workflow.status)) {
      throw bindingAuthorityError(409, "container_binding_resource_inactive", "Only active canonical workflows can receive container bindings.");
    }
    return {
      resourceRef: String(workflow.workflow_key || workflow.workflow_id),
      sourceTable: "workflows",
      sourcePk: String(workflow.workflow_id),
      authoritySource: "workflows",
    };
  }

  return null;
}

export const _testingDynamicContainerBindingResourceAuthority = {
  activeValue,
};
