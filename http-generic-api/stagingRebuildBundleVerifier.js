import { verifyExecutionTicket } from "./recoveryExecutionTicket.js";
import { validateRoleBundleBinding } from "./recoveryExecutionBinding.js";
import { stagingRecoveryAuthorityInternals } from "./stagingRecoveryAuthorityBinding.js";

export const STAGING_REBUILD_BUNDLE_VERIFIER_CONTRACT = "mad4b.staging-rebuild-bundle-verifier.v1";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TICKET_ID = /^ticket:[A-Za-z0-9._:-]{8,160}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const ROLES = new Set(["runtime", "governance", "runtime_persistence"]);

function fail(code, message, details = {}, status = 409) {
  throw Object.assign(new Error(message), { code, status, details: { ...details, database_mutation_performed: false, secrets_included: false } });
}

function text(value, max = 512) { return String(value ?? "").trim().slice(0, max); }
function sha(value, field, pattern = SHA256) {
  const normalized = text(value, 128).toLowerCase();
  if (!pattern.test(normalized)) fail("RECOVERY_TICKET_BINDING_MISMATCH", `${field} is invalid.`, { field }, 400);
  return normalized;
}

function resolveGraph(env, adapters, authorityGraph) {
  if (authorityGraph && typeof authorityGraph === "object") return authorityGraph;
  stagingRecoveryAuthorityInternals.runtime({ environment: "staging", runtime_class: "local_windows_docker", requested_mode: "injected_non_live", production_live: false }, env);
  const roots = stagingRecoveryAuthorityInternals.roots(env);
  const base = stagingRecoveryAuthorityInternals.adapters(roots.readiness, env).adapters;
  return { ...base, ...Object.fromEntries(Object.entries(adapters || {}).filter(([, value]) => value !== undefined && value !== null)) };
}

function normalizeRoles(value) {
  const roles = Array.isArray(value) ? [...new Set(value.map((role) => text(role, 64)))] : [];
  if (!roles.length || roles.some((role) => !ROLES.has(role))) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Selected rebuild roles are invalid.", {}, 400);
  return roles.sort();
}

function normalizeBindings(value, roles) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(roles.map((role) => {
    const binding = source[role];
    if (!binding) fail("RECOVERY_ROLE_BUNDLE_BINDING_MISSING", "Every selected role requires a locally computed schema-bundle binding.", { role }, 400);
    const validation = validateRoleBundleBinding(binding, {
      role,
      bundleManifestSha256: binding.bundle_manifest_sha256,
      roleBundleSha256: binding.role_bundle_sha256,
      statementCount: binding.statement_count,
      statementFingerprints: binding.statement_fingerprints,
    });
    if (!validation.ok) fail("RECOVERY_ROLE_BUNDLE_BINDING_INVALID", "Local schema-bundle binding is malformed.", { role, problems: validation.problems }, 400);
    return [role, validation.binding];
  }));
}

export function createStagingRebuildBundleVerifier({ env = process.env, adapters = null, authorityGraph = null } = {}) {
  const graph = resolveGraph(env, adapters, authorityGraph);
  const store = graph.recoveryStore;
  const verifier = graph.executionTicketVerifier;
  if (!store?.getExecutionTicket || !verifier?.verify) fail("RECOVERY_STAGING_BOOTSTRAP_VERIFIER_UNAVAILABLE", "Durable execution-ticket verification authority is unavailable.", {}, 503);
  return Object.freeze({
    contract: STAGING_REBUILD_BUNDLE_VERIFIER_CONTRACT,
    production_authority: false,
    async verify(input = {}) {
      const ticketId = text(input.execution_ticket_id, 180);
      const ticketHash = sha(input.execution_ticket_hash, "execution_ticket_hash");
      if (!TICKET_ID.test(ticketId)) fail("RECOVERY_TICKET_BINDING_MISMATCH", "execution_ticket_id is invalid.", {}, 400);
      const expectedSha = sha(input.expected_sha, "expected_sha", SHA40);
      const targetKey = text(input.target_key, 128);
      const targetFingerprint = sha(input.target_fingerprint, "target_fingerprint");
      const authorityPlanHash = sha(input.authority_plan_hash, "authority_plan_hash");
      const roleSelectionHash = sha(input.role_selection_hash, "role_selection_hash");
      const idempotencyKey = text(input.idempotency_key, 160);
      if (targetKey !== "staging-runtime" || !SAFE_ID.test(idempotencyKey)) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Staging rebuild binding target or idempotency key is invalid.", {}, 400);
      const selectedRoles = normalizeRoles(input.selected_roles);
      const roleBundleBindings = normalizeBindings(input.role_bundle_bindings, selectedRoles);
      const ticket = await store.getExecutionTicket(ticketId);
      if (!ticket || text(ticket.ticket_hash, 128).toLowerCase() !== ticketHash) fail("RECOVERY_TICKET_BINDING_MISMATCH", "Server-issued rebuild ticket is absent or hash-mismatched.", {}, ticket ? 409 : 404);
      try {
        await verifyExecutionTicket(ticket, {
          verifier,
          expected: {
            production_sha: expectedSha,
            target_key: targetKey,
            target_fingerprint: targetFingerprint,
            operation: "database.rebuild_empty",
            plan_hash: authorityPlanHash,
            idempotency_key: idempotencyKey,
            role_selection_hash: roleSelectionHash,
            selected_roles: selectedRoles,
            role_bundle_bindings: roleBundleBindings,
          },
        });
      } catch (error) {
        fail("RECOVERY_ROLE_BUNDLE_BINDING_MISMATCH", "Local generated role schema bundles do not match the server-issued rebuild ticket.", { binding_failure: text(error?.message, 240) }, 409);
      }
      return {
        ok: true,
        contract: STAGING_REBUILD_BUNDLE_VERIFIER_CONTRACT,
        status: "ticket_role_bundle_bindings_verified",
        execution_ticket_id: ticketId,
        selected_roles: selectedRoles,
        authority_plan_hash: authorityPlanHash,
        role_selection_hash: roleSelectionHash,
        database_connection_performed: false,
        database_mutation_performed: false,
        production_authority: false,
        secrets_included: false,
      };
    },
  });
}
