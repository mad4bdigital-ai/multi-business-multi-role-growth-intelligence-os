import {
  GrowthControlPlaneError,
  stableSha256,
  validateActivityPackManifest,
  validateSchemaDefinition
} from "./growthControlPlane.js";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,127}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const POSITIONS = new Set(["pre", "post"]);

function fail(code, message, field, issue, extra = {}) {
  throw new GrowthControlPlaneError(code, message, 422, [{ field, issue, ...extra }]);
}
function key(value, field) {
  const normalized = String(value ?? "").trim();
  if (!KEY_RE.test(normalized)) fail("GROWTH_CONTROL_WORKFLOW_COMPILE_INVALID", `${field} must be a canonical key.`, field, "invalid_canonical_key");
  return normalized;
}
function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
function list(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail("GROWTH_CONTROL_WORKFLOW_COMPILE_INVALID", `${field} must be an array.`, field, "invalid_type");
  const result = value.map((item, index) => key(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) fail("GROWTH_CONTROL_WORKFLOW_COMPILE_INVALID", `${field} contains duplicates.`, field, "duplicate_key");
  return result;
}
function schema(value, field) {
  if (value == null) return null;
  const normalized = copy(value);
  validateSchemaDefinition(normalized, field);
  return normalized;
}
function checkpoint(value, field, defaultKey) {
  if (value == null || value === false) return null;
  if (value === true) return { required: true, checkpointKey: defaultKey };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("GROWTH_CONTROL_WORKFLOW_CHECKPOINT_INVALID", `${field} must be a boolean or object.`, field, "invalid_type");
  return {
    required: value.required !== false,
    checkpointKey: key(value.checkpointKey ?? value.checkpoint_key ?? defaultKey, `${field}.checkpointKey`),
    policyKey: value.policyKey || value.policy_key ? key(value.policyKey ?? value.policy_key, `${field}.policyKey`) : null
  };
}
function node(value, field, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("GROWTH_CONTROL_WORKFLOW_NODE_INVALID", `${field} must be an object.`, field, "invalid_type");
  const localId = key(value.id ?? value.nodeId ?? value.node_id, `${field}.id`);
  const nodeId = prefix ? `${prefix}.${localId}` : localId;
  return {
    nodeId,
    capabilityKey: key(value.capability ?? value.capabilityKey ?? value.capability_key, `${field}.capability`),
    dependsOn: list(value.dependsOn ?? value.depends_on ?? [], `${field}.dependsOn`),
    executionClass: key(value.executionClass ?? value.execution_class ?? "internal", `${field}.executionClass`),
    adapterClasses: list(value.adapterClasses ?? value.adapter_classes ?? [value.executionClass ?? value.execution_class ?? "internal"], `${field}.adapterClasses`),
    inputSchema: schema(value.inputSchema ?? value.input_schema, `${field}.inputSchema`),
    outputSchema: schema(value.outputSchema ?? value.output_schema, `${field}.outputSchema`),
    join: value.join == null ? null : { strategy: key(value.join.strategy ?? "all", `${field}.join.strategy`), minimumCompleted: value.join.minimumCompleted ?? value.join.minimum_completed ?? null },
    approvalCheckpoint: checkpoint(value.approvalCheckpoint ?? value.approval_checkpoint ?? value.requiresApproval, `${field}.approvalCheckpoint`, `${nodeId}.approval`),
    verificationCheckpoint: checkpoint(value.verificationCheckpoint ?? value.verification_checkpoint ?? value.requiresVerification, `${field}.verificationCheckpoint`, `${nodeId}.verification`),
    compensationNodeId: value.compensationNodeId || value.compensation_node_id ? key(value.compensationNodeId ?? value.compensation_node_id, `${field}.compensationNodeId`) : null,
    mode: String(value.mode ?? "internal_draft")
  };
}
function version(value, field) {
  const normalized = Number(value ?? 1);
  if (!Number.isInteger(normalized) || normalized < 1) fail("GROWTH_CONTROL_WORKFLOW_COMPILE_INVALID", `${field} must be a positive integer.`, field, "invalid_positive_integer");
  return normalized;
}
function sensitive(value, field = "input") {
  if (!value || typeof value !== "object") return;
  for (const [name, child] of Object.entries(value)) {
    const normalized = name.toLowerCase();
    if (normalized.includes("secret") || normalized.includes("credential") || normalized === "token" || normalized.endsWith("_token") || normalized === "password" || normalized === "prompt_body" || normalized === "drive_id" || normalized === "file_path") {
      fail("GROWTH_CONTROL_WORKFLOW_COMPILE_SENSITIVE_INPUT", "Compiler input contains a forbidden sensitive field.", `${field}.${name}`, "forbidden_sensitive_field");
    }
    sensitive(child, `${field}.${name}`);
  }
}
function graph(nodes, field) {
  const byId = new Map();
  nodes.forEach((item) => {
    if (byId.has(item.nodeId)) fail("GROWTH_CONTROL_WORKFLOW_DAG_INVALID", "Node identifiers must be unique.", field, "duplicate_node", { value: item.nodeId });
    byId.set(item.nodeId, item);
  });
  nodes.forEach((item) => {
    item.dependsOn.forEach((dependency) => {
      if (dependency === item.nodeId) fail("GROWTH_CONTROL_WORKFLOW_DAG_INVALID", "Self dependencies are forbidden.", `${field}.${item.nodeId}.dependsOn`, "self_dependency");
      if (!byId.has(dependency)) fail("GROWTH_CONTROL_WORKFLOW_DAG_INVALID", "Unknown dependency.", `${field}.${item.nodeId}.dependsOn`, "unknown_dependency", { value: dependency });
    });
    if (item.join) {
      if (!["all", "any"].includes(item.join.strategy) || item.dependsOn.length < 2) fail("GROWTH_CONTROL_WORKFLOW_JOIN_INVALID", "Join nodes require strategy all/any and at least two dependencies.", `${field}.${item.nodeId}.join`, "invalid_join");
      if (item.join.minimumCompleted != null && (!Number.isInteger(Number(item.join.minimumCompleted)) || Number(item.join.minimumCompleted) < 1 || Number(item.join.minimumCompleted) > item.dependsOn.length)) fail("GROWTH_CONTROL_WORKFLOW_JOIN_INVALID", "minimumCompleted is out of range.", `${field}.${item.nodeId}.join.minimumCompleted`, "out_of_range");
    }
  });
  const indegree = new Map(nodes.map((item) => [item.nodeId, item.dependsOn.length]));
  const dependents = new Map(nodes.map((item) => [item.nodeId, []]));
  nodes.forEach((item) => item.dependsOn.forEach((dependency) => dependents.get(dependency).push(item.nodeId)));
  for (const values of dependents.values()) values.sort();
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const topologicalOrder = [];
  while (ready.length) {
    const current = ready.shift();
    topologicalOrder.push(current);
    for (const dependent of dependents.get(current)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) { ready.push(dependent); ready.sort(); }
    }
  }
  if (topologicalOrder.length !== nodes.length) fail("GROWTH_CONTROL_WORKFLOW_DAG_INVALID", "Workflow graph contains a cycle.", field, "cycle_detected");
  const edges = nodes.flatMap((item) => item.dependsOn.map((dependency) => ({ fromNodeId: dependency, toNodeId: item.nodeId }))).sort((a, b) => a.fromNodeId.localeCompare(b.fromNodeId) || a.toNodeId.localeCompare(b.toNodeId));
  const outgoing = new Set(edges.map((edge) => edge.fromNodeId));
  return { nodes: [...nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId)), edges, topologicalOrder, entryNodeIds: topologicalOrder.filter((id) => byId.get(id).dependsOn.length === 0), terminalNodeIds: topologicalOrder.filter((id) => !outgoing.has(id)) };
}
function extensionPoints(workflow) {
  const source = workflow.extensionPoints ?? workflow.extension_points ?? [];
  if (!Array.isArray(source)) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "extensionPoints must be an array.", "workflow.extensionPoints", "invalid_type");
  const seen = new Set();
  return source.map((item, index) => {
    const extensionPointKey = key(item.extensionPointKey ?? item.extension_point_key, `workflow.extensionPoints[${index}].extensionPointKey`);
    if (seen.has(extensionPointKey)) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "Duplicate extension point.", `workflow.extensionPoints[${index}]`, "duplicate_key");
    seen.add(extensionPointKey);
    const allowedPositions = list(item.allowedPositions ?? item.allowed_positions ?? ["pre", "post"], `workflow.extensionPoints[${index}].allowedPositions`);
    if (allowedPositions.some((position) => !POSITIONS.has(position))) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "Extension positions must be pre or post.", `workflow.extensionPoints[${index}].allowedPositions`, "unsupported");
    return { extensionPointKey, anchorNodeId: key(item.anchorNodeId ?? item.anchor_node_id, `workflow.extensionPoints[${index}].anchorNodeId`), allowedPositions };
  });
}
function normalizeExtensions(source, points) {
  if (!Array.isArray(source)) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "extensions must be an array.", "extensions", "invalid_type");
  const pointMap = new Map(points.map((point) => [point.extensionPointKey, point]));
  const seen = new Set();
  return source.map((item, index) => {
    const extensionKey = key(item.extensionKey, `extensions[${index}].extensionKey`);
    if (seen.has(extensionKey)) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "Duplicate extension key.", `extensions[${index}].extensionKey`, "duplicate_key");
    seen.add(extensionKey);
    const extensionPointKey = key(item.extensionPointKey, `extensions[${index}].extensionPointKey`);
    const point = pointMap.get(extensionPointKey);
    if (!point) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "Undeclared extension point.", `extensions[${index}].extensionPointKey`, "not_declared");
    const position = String(item.position ?? "").trim().toLowerCase();
    if (!point.allowedPositions.includes(position)) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "Extension position is not allowed.", `extensions[${index}].position`, "not_allowed");
    const order = item.order == null ? 0 : Number(item.order);
    if (!Number.isInteger(order) || order < 0) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "Extension order must be a non-negative integer.", `extensions[${index}].order`, "invalid_order");
    if (!Array.isArray(item.nodes) || item.nodes.length === 0) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "Extension nodes are required.", `extensions[${index}].nodes`, "required");
    const nodes = item.nodes.map((candidate, nodeIndex) => node(candidate, `extensions[${index}].nodes[${nodeIndex}]`, extensionKey));
    if (nodes.some((candidate) => candidate.dependsOn.length)) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "Extension dependencies are compiler-managed.", `extensions[${index}].nodes`, "dependencies_forbidden");
    return { extensionKey, extensionPointKey, position, order, nodes };
  }).sort((a, b) => a.extensionPointKey.localeCompare(b.extensionPointKey) || a.position.localeCompare(b.position) || a.order - b.order || a.extensionKey.localeCompare(b.extensionKey));
}
function compose(base, points, extensions) {
  const nodes = base.map((item) => ({ ...item, dependsOn: [...item.dependsOn] }));
  const byId = new Map(nodes.map((item) => [item.nodeId, item]));
  points.forEach((point) => {
    const anchor = byId.get(point.anchorNodeId);
    if (!anchor) fail("GROWTH_CONTROL_WORKFLOW_EXTENSION_INVALID", "Extension anchor does not exist.", `extensionPoints.${point.extensionPointKey}`, "anchor_not_found");
    ["pre", "post"].forEach((position) => {
      const selected = extensions.filter((item) => item.extensionPointKey === point.extensionPointKey && item.position === position);
      if (!selected.length) return;
      const sequence = selected.flatMap((item) => item.nodes.map((candidate) => ({ ...candidate, dependsOn: [] })));
      sequence.forEach((candidate) => {
        if (byId.has(candidate.nodeId)) fail("GROWTH_CONTROL_WORKFLOW_DAG_INVALID", "Composed node identifiers must be unique.", "extensions.nodes", "duplicate_node", { value: candidate.nodeId });
        byId.set(candidate.nodeId, candidate); nodes.push(candidate);
      });
      sequence.forEach((candidate, index) => { if (index > 0) candidate.dependsOn = [sequence[index - 1].nodeId]; });
      if (position === "pre") {
        sequence[0].dependsOn = [...anchor.dependsOn];
        anchor.dependsOn = [sequence.at(-1).nodeId];
      } else {
        const directDependents = nodes.filter((candidate) => candidate.nodeId !== anchor.nodeId && !sequence.some((extensionNode) => extensionNode.nodeId === candidate.nodeId) && candidate.dependsOn.includes(anchor.nodeId));
        sequence[0].dependsOn = [anchor.nodeId];
        directDependents.forEach((candidate) => { candidate.dependsOn = candidate.dependsOn.map((dependency) => dependency === anchor.nodeId ? sequence.at(-1).nodeId : dependency); });
      }
    });
  });
  return nodes;
}
function generation(value) {
  if (value == null || value.generated !== true) return { generated: false, validationStatus: "not_applicable", validationSha256: null, generatedBy: null };
  const validationStatus = String(value.validationStatus ?? value.validation_status ?? "").toLowerCase();
  const validationSha256 = String(value.validationSha256 ?? value.validation_sha256 ?? "").toLowerCase();
  if (validationStatus !== "validated" || !SHA_RE.test(validationSha256)) fail("GROWTH_CONTROL_WORKFLOW_GENERATION_INVALID", "Generated workflows require validated SHA-256 evidence.", "generation", "validation_evidence_required");
  return { generated: true, validationStatus, validationSha256, generatedBy: key(value.generatedBy ?? value.generated_by, "generation.generatedBy") };
}
export function compileImmutableWorkflowPlan({ manifest, workflowKey, extensions = [], generation: generationInput = null, compilerVersion = "spec-006-workflow-compiler-v1", settingsSnapshotHash = null } = {}) {
  sensitive({ extensions, generation: generationInput });
  const validated = validateActivityPackManifest(manifest);
  if (validated.secretsIncluded) fail("GROWTH_CONTROL_WORKFLOW_COMPILE_SENSITIVE_INPUT", "Activity Pack contains secrets.", "manifest", "secrets_included");
  const source = copy(manifest);
  const selectedKey = key(workflowKey, "workflowKey");
  const workflow = source.workflows?.find((item) => item.workflowKey === selectedKey);
  if (!workflow) fail("GROWTH_CONTROL_WORKFLOW_NOT_FOUND", "Workflow is not declared by the Activity Pack.", "workflowKey", "not_found");
  const declared = new Set((source.capabilities ?? []).map((item) => item.capabilityKey ?? item));
  const baseNodes = (workflow.nodes ?? []).map((item, index) => node(item, `workflow.nodes[${index}]`));
  if (!baseNodes.length) fail("GROWTH_CONTROL_WORKFLOW_DAG_INVALID", "Workflow nodes are required.", "workflow.nodes", "required");
  const points = extensionPoints(workflow);
  const normalizedExtensions = normalizeExtensions(extensions, points);
  const composed = compose(baseNodes, points, normalizedExtensions);
  const compensationNodes = (workflow.compensationNodes ?? workflow.compensation_nodes ?? []).map((item, index) => node(item, `workflow.compensationNodes[${index}]`));
  [...composed, ...compensationNodes].forEach((item) => { if (!declared.has(item.capabilityKey)) fail("GROWTH_CONTROL_WORKFLOW_CAPABILITY_INVALID", "Node capability is not declared.", `nodes.${item.nodeId}.capabilityKey`, "not_declared", { value: item.capabilityKey }); });
  const normalizedDag = graph(composed, "normalizedDag");
  const compensationGraph = compensationNodes.length ? graph(compensationNodes, "compensationGraph") : { nodes: [], edges: [], topologicalOrder: [], entryNodeIds: [], terminalNodeIds: [] };
  const compensationIds = new Set(compensationNodes.map((item) => item.nodeId));
  compensationGraph.triggers = composed.filter((item) => item.compensationNodeId).map((item) => {
    if (!compensationIds.has(item.compensationNodeId)) fail("GROWTH_CONTROL_WORKFLOW_COMPENSATION_INVALID", "Unknown compensation node.", `nodes.${item.nodeId}.compensationNodeId`, "not_found");
    return { sourceNodeId: item.nodeId, compensationNodeId: item.compensationNodeId };
  }).sort((a, b) => a.sourceNodeId.localeCompare(b.sourceNodeId));
  const snapshotHash = settingsSnapshotHash == null ? null : String(settingsSnapshotHash).toLowerCase();
  if (snapshotHash != null && !SHA_RE.test(snapshotHash)) fail("GROWTH_CONTROL_WORKFLOW_COMPILE_INVALID", "settingsSnapshotHash must be SHA-256.", "settingsSnapshotHash", "invalid_sha256");
  const allNodes = [...composed, ...compensationNodes];
  const withoutHash = {
    contractVersion: "spec-006-workflow-compiled-plan-v1",
    compilerVersion: key(compilerVersion, "compilerVersion"),
    workflowIdentity: { workflowKey: selectedKey, workflowVersion: version(workflow.version, "workflow.version"), activityPackKey: key(source.identity?.activityPackKey, "manifest.identity.activityPackKey"), activityPackVersion: version(source.identity?.version, "manifest.identity.version"), manifestChecksumSha256: validated.checksumSha256 },
    normalizedDag,
    extensionComposition: { extensionPoints: points, extensions: normalizedExtensions.map((item) => ({ extensionKey: item.extensionKey, extensionPointKey: item.extensionPointKey, position: item.position, order: item.order, nodeIds: item.nodes.map((candidate) => candidate.nodeId) })) },
    requiredCapabilities: [...new Set(allNodes.map((item) => item.capabilityKey))].sort(),
    candidateAdapterClasses: [...new Set(allNodes.flatMap((item) => item.adapterClasses))].sort(),
    approvalCheckpoints: composed.filter((item) => item.approvalCheckpoint?.required).map((item) => ({ nodeId: item.nodeId, ...item.approvalCheckpoint })),
    verificationCheckpoints: composed.filter((item) => item.verificationCheckpoint?.required).map((item) => ({ nodeId: item.nodeId, ...item.verificationCheckpoint })),
    compensationGraph,
    generation: generation(generationInput),
    settingsSnapshotHash: snapshotHash,
    immutable: true,
    providerCalls: false,
    providerDispatchAllowed: false,
    providerApplyAllowed: false,
    externalWrites: false,
    secretsIncluded: false
  };
  return freeze({ ...withoutHash, canonicalHashSha256: stableSha256(withoutHash) });
}
