import { validateEndpointRowConsistency } from "./registryExecutionEligibility.js";

function headerMap(headerRow = []) {
  const map = {};
  headerRow.forEach((value, index) => {
    const key = String(value || "").trim();
    if (key && !Object.prototype.hasOwnProperty.call(map, key)) {
      map[key] = index;
    }
  });
  return map;
}

function rowObjectFromHeader(header = [], row = []) {
  const map = headerMap(header);
  const out = {};
  for (const [key, index] of Object.entries(map)) {
    out[key] = row[index] ?? "";
  }
  return out;
}

function findAuditRange(alignmentAudit = {}, sheetName = "") {
  const prefix = `${sheetName}!`;
  const key = Object.keys(alignmentAudit).find(candidate => candidate.startsWith(prefix));
  return key ? alignmentAudit[key] : [];
}

export function detectRepurposedRegistryRows(endpointRows = []) {
  if (!Array.isArray(endpointRows) || endpointRows.length < 2) return [];
  const header = endpointRows[0] || [];
  return endpointRows
    .slice(1)
    .map((row, index) => {
      const rowObject = rowObjectFromHeader(header, row);
      const consistency = validateEndpointRowConsistency(rowObject, {
        parent_action_key: rowObject.parent_action_key,
        endpoint_key: rowObject.endpoint_key
      });
      return {
        rowNumber: index + 2,
        rowObject,
        consistency
      };
    })
    .filter(result => !result.consistency.valid);
}

export function validateRegistryAlignment(alignmentAudit = {}) {
  const mismatches = [];

  const workflows = alignmentAudit["Workflow Registry!A1:AZ20"] || [];
  const chains = alignmentAudit["Execution Chains Registry!A1:J20"] || [];
  const nodes = alignmentAudit["Knowledge Graph Node Registry!A1:J20"] || [];
  const relations = alignmentAudit["Relationship Graph Registry!A1:J20"] || [];
  const endpointRegistry = findAuditRange(alignmentAudit, "API Actions Endpoint Registry");

  const workflowKeys = new Set();
  const nodeIds = new Set();

  for (let i = 1; i < workflows.length; i++) {
    const row = workflows[i] || [];
    const workflowKey = String(row[24] || "").trim();
    if (workflowKey) workflowKeys.add(workflowKey);
  }

  for (let i = 1; i < nodes.length; i++) {
    const row = nodes[i] || [];
    const nodeId = String(row[0] || "").trim();
    if (nodeId) nodeIds.add(nodeId);
  }

  for (let i = 1; i < chains.length; i++) {
    const row = chains[i] || [];
    const chainId = String(row[0] || "").trim();
    const workflowId = String(row[5] || "").trim();
    if (workflowId && !workflowKeys.has(workflowId)) {
      mismatches.push({
        type: "missing_workflow_reference",
        source: "Execution Chains Registry",
        row_key: chainId,
        value: workflowId
      });
    }
  }

  for (let i = 1; i < relations.length; i++) {
    const row = relations[i] || [];
    const relationshipId = String(row[0] || "").trim();
    const fromNodeId = String(row[1] || "").trim();
    const toNodeId = String(row[3] || "").trim();

    if (fromNodeId && !nodeIds.has(fromNodeId)) {
      mismatches.push({
        type: "missing_from_node",
        source: "Relationship Graph Registry",
        row_key: relationshipId,
        value: fromNodeId
      });
    }

    if (toNodeId.startsWith("workflow.")) {
      const workflowSuffix = toNodeId.slice("workflow.".length);
      if (!workflowKeys.has(workflowSuffix)) {
        mismatches.push({
          type: "unresolved_workflow_node_target",
          source: "Relationship Graph Registry",
          row_key: relationshipId,
          value: toNodeId
        });
      }
    } else if (
      toNodeId &&
      !toNodeId.startsWith("route.") &&
      !toNodeId.startsWith("goal.") &&
      !nodeIds.has(toNodeId)
    ) {
      mismatches.push({
        type: "missing_to_node",
        source: "Relationship Graph Registry",
        row_key: relationshipId,
        value: toNodeId
      });
    }
  }

  for (const drift of detectRepurposedRegistryRows(endpointRegistry)) {
    mismatches.push({
      type: "endpoint_binding_mismatch",
      source: "API Actions Endpoint Registry",
      row_key: drift.rowObject.endpoint_id || drift.rowObject.endpoint_key || `row_${drift.rowNumber}`,
      value: `${drift.rowObject.parent_action_key || ""}/${drift.rowObject.endpoint_key || ""}`,
      mismatches: drift.consistency.mismatches
    });
  }

  return {
    valid: mismatches.length === 0,
    mismatch_count: mismatches.length,
    mismatches
  };
}
