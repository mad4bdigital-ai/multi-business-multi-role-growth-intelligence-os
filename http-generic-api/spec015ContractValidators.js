import { createHash } from "node:crypto";

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const TENANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization|credential|access[_-]?token|refresh[_-]?token)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /^Bearer\s+\S+/i,
  /^gh[pousr]_[A-Za-z0-9_\-]+$/,
  /^-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const errors = (items) => items.map((item) => ({ code: item.code, path: item.path, message: item.message }));
const issue = (code, path, message) => ({ code, path, message });

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

export function stableSpec015Json(value) {
  return JSON.stringify(stable(value ?? null));
}

export function spec015DeterministicHash(value) {
  return createHash("sha256").update(stableSpec015Json(value), "utf8").digest("hex");
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key || "")) && String(key) !== "credential_ref";
}

function findSecretPayload(value, path = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => findSecretPayload(child, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value.trim()))) {
      found.push(issue("secret_value_detected", path, "Credential-like value is not allowed in a Spec 015 binding."));
    }
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (isSecretKey(key)) {
      found.push(issue("secret_key_detected", childPath, "Secret-bearing fields are not allowed in a Spec 015 binding."));
    }
    if (key === "credential_ref" && typeof child !== "string") {
      found.push(issue("credential_ref_invalid", childPath, "credential_ref must be a non-secret string reference."));
    }
    findSecretPayload(child, childPath, found);
  }
  return found;
}

export function validatePackageComponentIdentity(input = {}) {
  const found = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: [issue("identity_not_object", "$", "Package/component identity must be an object.")] };
  }
  for (const [key, label] of [["package_key", "package"], ["component_key", "component"]]) {
    if (!KEY_PATTERN.test(String(input[key] || ""))) {
      found.push(issue("invalid_identity_key", `$.${key}`, `${label}_key must use the canonical lowercase key format.`));
    }
  }
  if (!VERSION_PATTERN.test(String(input.version || ""))) {
    found.push(issue("invalid_version", "$.version", "version must be a stable semantic version."));
  }
  if (input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision < 1)) {
    found.push(issue("invalid_revision", "$.revision", "revision must be a positive integer when present."));
  }
  found.push(...findSecretPayload(input));
  return { valid: found.length === 0, errors: errors(found) };
}

function detectCycles(nodes) {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  function visit(key, trail = []) {
    if (visiting.has(key)) {
      cycles.push([...trail.slice(trail.indexOf(key)), key]);
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    const node = byKey.get(key);
    for (const dependency of node?.dependencies || []) {
      if (byKey.has(dependency)) visit(dependency, [...trail, key]);
    }
    visiting.delete(key);
    visited.add(key);
  }
  for (const node of nodes) visit(node.key, []);
  return cycles;
}

export function validateDependencyGraph(nodes = []) {
  const found = [];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { valid: false, errors: [issue("dependency_graph_empty", "$", "Dependency graph must contain at least one node.")] };
  }
  const keys = new Set();
  for (const [index, node] of nodes.entries()) {
    const path = `$[${index}]`;
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      found.push(issue("graph_node_not_object", path, "Dependency graph nodes must be objects."));
      continue;
    }
    if (!KEY_PATTERN.test(String(node.key || ""))) found.push(issue("graph_node_key_invalid", `${path}.key`, "Graph node key is invalid."));
    if (keys.has(node.key)) found.push(issue("graph_duplicate_node", `${path}.key`, `Duplicate graph node: ${node.key}.`));
    keys.add(node.key);
    if (!Array.isArray(node.dependencies) || node.dependencies.some((dep) => !KEY_PATTERN.test(String(dep)))) {
      found.push(issue("graph_dependencies_invalid", `${path}.dependencies`, "dependencies must be an array of canonical keys."));
    }
  }
  for (const [index, node] of nodes.entries()) {
    for (const dependency of node?.dependencies || []) {
      if (!keys.has(dependency)) found.push(issue("graph_missing_dependency", `$[${index}].dependencies`, `Missing dependency: ${dependency}.`));
    }
  }
  for (const cycle of detectCycles(nodes)) found.push(issue("graph_cycle", "$", `Dependency cycle detected: ${cycle.join(" -> ")}.`));
  found.push(...findSecretPayload(nodes));
  const canonicalOrder = [...nodes].map((node) => node.key).sort();
  return { valid: found.length === 0, errors: errors(found), canonical_order: canonicalOrder };
}

export function validateCredentialFreeBindings(bindings = [], { tenantId } = {}) {
  const found = [];
  if (!Array.isArray(bindings)) return { valid: false, errors: [issue("bindings_not_array", "$", "Bindings must be an array.")] };
  for (const [index, binding] of bindings.entries()) {
    const path = `$[${index}]`;
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      found.push(issue("binding_not_object", path, "Binding must be an object."));
      continue;
    }
    found.push(...findSecretPayload(binding, path));
    if (!KEY_PATTERN.test(String(binding.binding_key || ""))) found.push(issue("binding_key_invalid", `${path}.binding_key`, "binding_key is invalid."));
    if (tenantId !== undefined && String(binding.tenant_id || "") !== String(tenantId)) {
      found.push(issue("cross_tenant_binding", `${path}.tenant_id`, "Binding crosses the requested tenant boundary."));
    }
    if (binding.scope_tenant_id !== undefined && String(binding.scope_tenant_id) !== String(binding.tenant_id)) {
      found.push(issue("scope_tenant_mismatch", `${path}.scope_tenant_id`, "scope_tenant_id must equal tenant_id."));
    }
  }
  return { valid: found.length === 0, errors: errors(found) };
}

export function validatePublicationPolicy(input = {}) {
  const allowedStates = new Set(["private", "tenant", "shared", "curated"]);
  const state = String(input.state || "");
  const found = [];
  if (!allowedStates.has(state)) found.push(issue("publication_state_invalid", "$.state", "Publication state is outside the bounded Spec 015 policy."));
  if (input.target_tenant_id !== undefined && !TENANT_PATTERN.test(String(input.target_tenant_id))) {
    found.push(issue("publication_tenant_invalid", "$.target_tenant_id", "target_tenant_id is invalid."));
  }
  if (["tenant", "curated"].includes(state) && !input.target_tenant_id) {
    found.push(issue("publication_target_required", "$.target_tenant_id", "Tenant-scoped publication requires target_tenant_id."));
  }
  found.push(...findSecretPayload(input));
  return { valid: found.length === 0, errors: errors(found) };
}

const LIFECYCLE_TRANSITIONS = Object.freeze({
  planned: new Set(["installing", "archived"]),
  installing: new Set(["configuration", "validation", "suspended"]),
  configuration: new Set(["validation", "suspended"]),
  validation: new Set(["ready", "configuration", "suspended"]),
  ready: new Set(["active", "configuration", "suspended"]),
  active: new Set(["suspended", "archive_requested", "uninstall_requested", "deprecated"]),
  suspended: new Set(["configuration", "validation", "ready", "archived"]),
  archive_requested: new Set(["archived", "active"]),
  uninstall_requested: new Set(["retired", "active"]),
  deprecated: new Set(["retired", "active"]),
  archived: new Set([]),
  retired: new Set([]),
});

export function validateReadinessPreview({ manifest = {}, expected_hash = "", observed_hash = "", conflicts = [], stale = false, ambiguity = false } = {}) {
  const found = [];
  const computedHash = spec015DeterministicHash(manifest);
  if (!/^[a-f0-9]{64}$/.test(String(expected_hash))) found.push(issue("expected_hash_invalid", "$.expected_hash", "expected_hash must be a SHA-256 hash."));
  if (expected_hash && expected_hash !== computedHash) found.push(issue("expected_hash_mismatch", "$.expected_hash", "expected_hash does not match the manifest."));
  if (observed_hash && observed_hash !== expected_hash) found.push(issue("observed_hash_stale", "$.observed_hash", "Observed hash differs from expected hash."));
  if (stale) found.push(issue("stale_evidence", "$.stale", "Readiness evidence is stale."));
  if (ambiguity) found.push(issue("readiness_ambiguity", "$.ambiguity", "Readiness is ambiguous."));
  if (Array.isArray(conflicts) && conflicts.length) found.push(issue("readiness_conflict", "$.conflicts", "Readiness contains unresolved conflicts."));
  return { valid: found.length === 0, ready: found.length === 0, errors: errors(found), computed_hash: computedHash, mutation_executed: false, provider_call_executed: false, database_mutation: false, secrets_included: false };
}

export function validateLifecycleTransition(from, to, { revocation = false } = {}) {
  const found = [];
  const source = String(from || "");
  const target = String(to || "");
  if (!Object.prototype.hasOwnProperty.call(LIFECYCLE_TRANSITIONS, source)) found.push(issue("lifecycle_source_invalid", "$.from", "Unknown lifecycle source state."));
  if (!Object.prototype.hasOwnProperty.call(LIFECYCLE_TRANSITIONS, target)) found.push(issue("lifecycle_target_invalid", "$.to", "Unknown lifecycle target state."));
  if (!found.length && !LIFECYCLE_TRANSITIONS[source].has(target)) found.push(issue("lifecycle_transition_invalid", "$", `Transition ${source} -> ${target} is not allowed.`));
  if (revocation && !["suspended", "uninstall_requested", "retired"].includes(target)) found.push(issue("revocation_target_invalid", "$.to", "Revocation must end in a bounded disable/uninstall/retired state."));
  return { valid: found.length === 0, errors: errors(found), mutation_executed: false, provider_call_executed: false, database_mutation: false, secrets_included: false };
}

export function validateDraftAiSafety(input = {}) {
  const found = [];
  if (input.mode !== "draft") found.push(issue("ai_mode_not_draft", "$.mode", "AI authoring must remain draft-only."));
  if (!input.proposal || typeof input.proposal !== "object" || Array.isArray(input.proposal)) found.push(issue("ai_proposal_not_structured", "$.proposal", "AI output must be a structured object."));
  if (!Number.isInteger(input.budget_tokens) || input.budget_tokens < 1 || input.budget_tokens > 10000) found.push(issue("ai_budget_invalid", "$.budget_tokens", "budget_tokens must be between 1 and 10000."));
  if (input.execute === true || input.apply === true || input.mutation === true || input.write === true) found.push(issue("ai_authority_invention", "$", "AI output cannot authorize execution or mutation."));
  if (input.safety?.prompt_injection_detected === true) found.push(issue("ai_prompt_injection", "$.safety.prompt_injection_detected", "Prompt injection must block the draft."));
  if (input.safety?.sensitivity === "high" && input.safety?.human_review_required !== true) found.push(issue("ai_human_review_missing", "$.safety.human_review_required", "High-sensitivity drafts require human review."));
  found.push(...findSecretPayload(input));
  return { valid: found.length === 0, errors: errors(found), draft_only: true, mutation_executed: false, provider_call_executed: false, database_mutation: false, secrets_included: false };
}

export function validateOwnershipManifest(entries = [], { tenantId } = {}) {
  const found = [];
  const allowedOwners = new Set(["platform", "agency", "client", "tenant", "brand"]);
  const seen = new Set();
  if (!Array.isArray(entries)) return { valid: false, errors: [issue("ownership_not_array", "$", "Ownership manifest must be an array.")] };
  for (const [index, entry] of entries.entries()) {
    const path = `$[${index}]`;
    const key = String(entry?.artifact_key || "");
    if (!KEY_PATTERN.test(key)) found.push(issue("ownership_artifact_invalid", `${path}.artifact_key`, "artifact_key is invalid."));
    if (seen.has(key)) found.push(issue("ownership_duplicate_artifact", `${path}.artifact_key`, "artifact_key must be unique."));
    seen.add(key);
    if (!allowedOwners.has(String(entry?.owner_type || ""))) found.push(issue("ownership_type_invalid", `${path}.owner_type`, "owner_type is outside the bounded ownership model."));
    if (tenantId !== undefined && String(entry?.tenant_id || "") !== String(tenantId)) found.push(issue("ownership_cross_tenant", `${path}.tenant_id`, "Ownership entry crosses tenant boundary."));
    if (entry?.delegation_status === "revoked" && entry?.external_delivery_allowed === true) found.push(issue("revoked_delegation_delivery", `${path}.external_delivery_allowed`, "Revoked delegation cannot retain external delivery authority."));
    found.push(...findSecretPayload(entry, path));
  }
  return { valid: found.length === 0, errors: errors(found), mutation_executed: false, provider_call_executed: false, database_mutation: false, secrets_included: false };
}

export function validateCandidateConvergence({ head_sha = "", canonical_paths = false, duplicate_identity_count = 0, stale_artifact_count = 0, spec016_exposure_verified = false } = {}) {
  const found = [];
  if (!/^[a-f0-9]{40}$/i.test(String(head_sha))) found.push(issue("candidate_head_invalid", "$.head_sha", "Candidate head_sha must be a full commit SHA."));
  if (canonical_paths !== true) found.push(issue("canonical_paths_unverified", "$.canonical_paths", "Canonical paths are not verified."));
  if (Number(duplicate_identity_count) !== 0) found.push(issue("duplicate_identity_detected", "$.duplicate_identity_count", "Duplicate identity count must be zero."));
  if (Number(stale_artifact_count) !== 0) found.push(issue("stale_artifact_detected", "$.stale_artifact_count", "Stale artifact count must be zero."));
  if (spec016_exposure_verified !== true) found.push(issue("spec016_exposure_unverified", "$.spec016_exposure_verified", "Spec 016 exposure is not verified."));
  return { valid: found.length === 0, converged: found.length === 0, errors: errors(found), mutation_executed: false, provider_call_executed: false, database_mutation: false, secrets_included: false };
}

export function validateSpec015Manifest(manifest = {}) {
  const identity = validatePackageComponentIdentity(manifest.identity || {});
  const graph = validateDependencyGraph(manifest.dependencies || []);
  const bindings = validateCredentialFreeBindings(manifest.bindings || [], { tenantId: manifest.tenant_id });
  const publication = validatePublicationPolicy(manifest.publication || {});
  const allErrors = [...identity.errors, ...graph.errors, ...bindings.errors, ...publication.errors];
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    deterministic_hash: spec015DeterministicHash(manifest),
    mutation_executed: false,
    provider_call_executed: false,
    database_mutation: false,
    secrets_included: false,
  };
}
