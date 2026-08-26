import crypto from "node:crypto";

export const RECOVERY_EXECUTION_TICKET_CONTRACT = "mad4b.recovery-execution-ticket.v1";
const SHA256_RE = /^[0-9a-f]{64}$/iu;
const SHA_RE = /^[0-9a-f]{40}$/iu;
const ID_RE = /^(?:plan|step|run|finding|ticket):[A-Za-z0-9._:-]{8,160}$/u;
const ROLE_RE = /^(?:runtime|governance|runtime_persistence|composite|unknown)$/u;
const ROLE_KEYS = Object.freeze(["runtime", "governance", "runtime_persistence"]);

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requireSha(value, name, pattern = SHA256_RE) {
  const normalized = text(value, 128).toLowerCase();
  if (!pattern.test(normalized)) throw new Error(`${name} must be a full SHA value.`);
  return normalized;
}

function requireId(value, name) {
  const normalized = text(value, 160);
  if (!ID_RE.test(normalized)) throw new Error(`${name} is not a bounded Recovery identifier.`);
  return normalized;
}

function normalizeRoles(value, targetRole = "composite") {
  const roles = Array.isArray(value) && value.length ? value : [targetRole || "composite"];
  const normalized = [...new Set(roles.map((role) => text(role, 64).toLowerCase()))].sort();
  if (normalized.length === 0 || normalized.some((role) => !ROLE_RE.test(role))) throw new Error("selected_roles must contain registered roles.");
  return normalized;
}

function normalizeFingerprints(value, roles, required = true) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const roleKeys = roles.filter((role) => ROLE_KEYS.includes(role));
  const entries = roleKeys.map((role) => [role, source[role] ? requireSha(source[role], `role_object_count_fingerprints.${role}`) : null]);
  if (required && entries.some(([, fingerprint]) => !fingerprint)) throw new Error("Every selected rebuild role requires an object-count fingerprint.");
  return Object.fromEntries(entries.filter(([, fingerprint]) => fingerprint));
}

function normalizeTargetFingerprints(value, composite) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const entries = Object.entries(source).filter(([role]) => role !== "composite").map(([role, fingerprint]) => {
    if (!ROLE_KEYS.includes(role)) throw new Error("target_fingerprints contains an unregistered role.");
    return [role, requireSha(fingerprint, `target_fingerprints.${role}`)];
  });
  return { composite: requireSha(source.composite || composite, "target_fingerprints.composite"), ...Object.fromEntries(entries) };
}

export function buildExecutionTicketPayload(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Execution ticket payload must be an object.");
  const targetRole = text(input.target_role || "composite", 64).toLowerCase();
  if (!ROLE_RE.test(targetRole)) throw new Error("target_role is not registered.");
  const roleSelectionRequired = input.role_selection_required === true;
  const roles = normalizeRoles(input.selected_roles, roleSelectionRequired ? targetRole : "composite");
  const payload = {
    contract: RECOVERY_EXECUTION_TICKET_CONTRACT,
    inspection_run_id: input.inspection_run_id ? requireId(input.inspection_run_id, "inspection_run_id") : null,
    inspection_evidence_hash: input.inspection_evidence_hash ? requireSha(input.inspection_evidence_hash, "inspection_evidence_hash") : null,
    finding_ids: [...new Set((Array.isArray(input.finding_ids) ? input.finding_ids : []).map((id) => requireId(id, "finding_id")))].sort(),
    selected_roles: roles,
    role_selection_required: roleSelectionRequired,
    role_object_count_fingerprints: normalizeFingerprints(input.role_object_count_fingerprints, roles, roleSelectionRequired),
    role_selection_hash: input.role_selection_hash ? requireSha(input.role_selection_hash, "role_selection_hash") : null,
    target_fingerprints: normalizeTargetFingerprints(input.target_fingerprints, input.composite_target_fingerprint),
    production_sha: requireSha(input.production_sha || input.expected_sha, "production_sha", SHA_RE),
    target_key: text(input.target_key, 128),
    plan_hash: requireSha(input.plan_hash, "plan_hash"),
    step_hash: requireSha(input.step_hash, "step_hash"),
    step_id: requireId(input.step_id, "step_id"),
    target_role: targetRole,
    idempotency_key: text(input.idempotency_key, 160),
    expires_at: new Date(input.expires_at || 0).toISOString(),
    nonce: text(input.nonce, 160),
  };
  if (!payload.target_key) throw new Error("target_key is required.");
  if (!payload.finding_ids.length) throw new Error("finding_ids must not be empty.");
  if (roleSelectionRequired && (!payload.inspection_run_id || !payload.inspection_evidence_hash || !payload.role_selection_hash)) throw new Error("Role-selective tickets require durable inspection references and a canonical role-selection proof hash.");
  if (!payload.idempotency_key) throw new Error("idempotency_key is required.");
  if (!payload.nonce) throw new Error("nonce is required.");
  if (!Number.isFinite(Date.parse(payload.expires_at)) || Date.parse(payload.expires_at) <= Date.now()) throw new Error("expires_at must be in the future.");
  return payload;
}

export function computeExecutionTicketHash(payload) {
  return sha256(buildExecutionTicketPayload(payload));
}

export function buildExecutionTicketId(ticketHash) {
  return `ticket:${requireSha(ticketHash, "ticket_hash").slice(0, 32)}`;
}

export async function issueExecutionTicket(input = {}, { signer, now = Date.now() } = {}) {
  if (!signer || typeof signer.sign !== "function") throw new Error("A governed execution-ticket signer is required.");
  const payload = buildExecutionTicketPayload(input);
  if (Date.parse(payload.expires_at) <= Number(now)) throw new Error("Execution ticket is already expired.");
  const ticketHash = computeExecutionTicketHash(payload);
  const signature = text(await signer.sign({ payload, ticket_hash: ticketHash }), 2048);
  if (!signature) throw new Error("Execution ticket signer returned an empty signature.");
  return { ...payload, ticket_id: buildExecutionTicketId(ticketHash), ticket_hash: ticketHash, signature, issued_at: new Date(now).toISOString(), single_use: true, content_not_included: true, secrets_included: false };
}

export async function verifyExecutionTicket(ticket = {}, { verifier, expected = {}, now = Date.now() } = {}) {
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) throw new Error("Execution ticket is required.");
  const payload = buildExecutionTicketPayload(ticket);
  const ticketHash = computeExecutionTicketHash(payload);
  if (text(ticket.ticket_hash, 128).toLowerCase() !== ticketHash) throw new Error("Execution ticket hash mismatch.");
  if (text(ticket.ticket_id, 160) !== buildExecutionTicketId(ticketHash)) throw new Error("Execution ticket ID mismatch.");
  if (Date.parse(payload.expires_at) <= Number(now)) throw new Error("Execution ticket has expired.");
  for (const [key, value] of Object.entries(expected)) {
    if (value === undefined || value === null) continue;
    if (key === "selected_roles") {
      if (JSON.stringify(normalizeRoles(value, payload.target_role)) !== JSON.stringify(payload.selected_roles)) throw new Error("Execution ticket role binding mismatch.");
    } else if (key === "target_fingerprints") {
      const expectedFingerprints = normalizeTargetFingerprints(value, payload.target_fingerprints.composite);
      if (JSON.stringify(expectedFingerprints) !== JSON.stringify(payload.target_fingerprints)) throw new Error("Execution ticket target fingerprint mismatch.");
    } else if (text(payload[key], 256) !== text(value, 256)) {
      throw new Error(`Execution ticket ${key} binding mismatch.`);
    }
  }
  if (!verifier || typeof verifier.verify !== "function") throw new Error("A governed execution-ticket verifier is required.");
  const verified = await verifier.verify({ ticket: { ...payload, ticket_hash: ticketHash, ticket_id: buildExecutionTicketId(ticketHash), signature: text(ticket.signature, 2048) }, ticket_hash: ticketHash });
  if (verified !== true) throw new Error("Execution ticket signature verification failed.");
  return { valid: true, ticket_id: buildExecutionTicketId(ticketHash), ticket_hash: ticketHash, payload, secrets_included: false };
}

export const _testingRecoveryExecutionTicket = Object.freeze({ sha256, normalizeRoles, normalizeFingerprints, normalizeTargetFingerprints });
