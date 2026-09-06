import { Router } from "express";
import {
  attestationMatches,
  buildRecoveryAuthorityReadiness,
  evaluateStagingRecoveryCertification,
  RECOVERY_STAGING_CERTIFICATION_CONTRACT,
} from "../recoveryActivationReadiness.js";
import { resolveRuntimeEnvironment } from "../runtimeEnvironmentResolver.js";
import { resolveActivationGatewayHostProfile } from "../activationGatewayHostProfile.js";
import { resolveTrustedRequestHost } from "../trustedRequestHost.js";
import { evaluateExternalStagingEvidence } from "../recoveryReadinessEvidence.js";
import { createStagingBootstrapExecutionAuthority } from "../stagingBootstrapExecutionAuthority.js";
import { createStagingAccessRepairTicketAuthority } from "../stagingAccessRepairTicketAuthority.js";

export const STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT = "mad4b.staging-recovery-admin-surface.v1";
export const STAGING_RECOVERY_ADMIN_SERVER_URI = "https://activation-dev.mad4b.com";
export const STAGING_RECOVERY_ADMIN_HOST = "activation-dev.mad4b.com";

const STAGING_ENVIRONMENT_KEYS = new Set(["staging", "staging_local_windows_docker"]);
const STAGING_RECOVERY_ADVERTISED_PATHS = Object.freeze([
  "/admin/recovery/staging/contract",
  "/admin/recovery/staging/readiness",
  "/admin/recovery/staging/certification",
]);
const STAGING_RECOVERY_INTERNAL_EXECUTION_PATHS = Object.freeze([
  "/admin/recovery/staging/bootstrap-ticket/verify",
  "/admin/recovery/staging/bootstrap-ticket/finalize",
  "/admin/recovery/staging/bootstrap-partial-receipt",
]);
const STAGING_RECOVERY_PATHS = Object.freeze([...STAGING_RECOVERY_ADVERTISED_PATHS, ...STAGING_RECOVERY_INTERNAL_EXECUTION_PATHS]);
const BOOTSTRAP_BINDING_KEYS = Object.freeze(["execution_ticket_id", "execution_ticket_hash", "expected_sha", "target_key", "target_fingerprint", "operation", "plan_hash", "idempotency_key", "role_selection_hash", "grant_binding_hash"]);
const BOOTSTRAP_EXECUTION_START_KEYS = Object.freeze(["authority_action", ...BOOTSTRAP_BINDING_KEYS, "reservation_receipt"]);
const ACCESS_REPAIR_PREPARE_KEYS = Object.freeze(["authority_action", "expected_sha", "target_key", "target_fingerprint", "grant_binding_hash", "idempotency_key"]);
const ACCESS_REPAIR_APPROVE_KEYS = Object.freeze(["authority_action", "plan_id", "plan_hash", "step_id", "idempotency_key", "approval_confirmation"]);
const SENSITIVE_KEY_RE = /(password|secret|credential|authorization|private[_-]?key|connection[_-]?string|database[_-]?name|db[_-]?(?:user|password)|hostname|username|raw[_-]?sql|command)/iu;
const LEGACY_READBACK_ASSERTION_KEYS = Object.freeze(["readback_ready", "same_cycle", "database_mutation_performed", "readback_evidence_hash"]);

function isObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isStagingEnvironment(env = process.env) { const resolved = resolveRuntimeEnvironment(env); return resolved.ok && resolved.environment_key === "staging"; }
function requestId(req) { return String(req?.headers?.["x-request-id"] || req?.headers?.["cf-ray"] || "").split(",")[0].trim().slice(0, 128) || null; }
function errorResponse(res, req, status, code, message) {
  const id = requestId(req);
  return res.status(status).json({ ok: false, contract: STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT, error: { code, message, requestId: id, request_id: id }, environment: "staging", production_authority: false, database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false });
}
function publicAttestation(attestation) {
  if (!isObject(attestation)) return null;
  const environment = typeof attestation.environment === "string" && attestation.environment.trim() ? attestation.environment.trim() : null;
  return { repository: attestation.repository || null, branch: attestation.branch || null, sha: attestation.sha || attestation.commit_sha || null, environment, environment_match: environment === "staging" && attestation.environment_match !== false, repository_match: attestation.repository_match === true, branch_match: attestation.branch_match === true, sha_match: attestation.sha_match === true, manifest_bound: attestation.manifest_bound === true, read_only: attestation.read_only === true, secrets_included: false };
}
function hasSensitiveReceiptKey(value, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (Array.isArray(value)) return value.some((item) => hasSensitiveReceiptKey(item, depth + 1));
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, child]) => SENSITIVE_KEY_RE.test(key) || hasSensitiveReceiptKey(child, depth + 1));
}
function exactKeys(input, allowed, message) {
  if (!isObject(input)) throw Object.assign(new Error(message), { code: "RECOVERY_STAGING_BOOTSTRAP_REQUEST_INVALID", status: 400 });
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length || hasSensitiveReceiptKey(input)) throw Object.assign(new Error("Staging bootstrap ticket request contains fields outside the fixed contract."), { code: "RECOVERY_STAGING_BOOTSTRAP_FIELD_FORBIDDEN", status: 400, details: { fields: unexpected, secrets_included: false } });
  return input;
}
function exactBootstrapBinding(input = {}) {
  exactKeys(input, BOOTSTRAP_BINDING_KEYS, "Staging bootstrap ticket request must be an object.");
  return { ticket_id: input.execution_ticket_id, ticket_hash: input.execution_ticket_hash, expected: { production_sha: input.expected_sha, target_key: input.target_key, target_fingerprint: input.target_fingerprint, operation: input.operation, plan_hash: input.plan_hash, idempotency_key: input.idempotency_key, role_selection_hash: input.role_selection_hash || null, grant_binding_hash: input.grant_binding_hash || null } };
}
function exactBootstrapExecutionStart(input = {}) {
  exactKeys(input, BOOTSTRAP_EXECUTION_START_KEYS, "Staging bootstrap execution-start request must be an object.");
  if (input.authority_action !== "mark_executing") throw Object.assign(new Error("Unknown Staging ticket authority action."), { code: "RECOVERY_STAGING_BOOTSTRAP_ACTION_INVALID", status: 400 });
  if (!isObject(input.reservation_receipt) || hasSensitiveReceiptKey(input.reservation_receipt)) throw Object.assign(new Error("A valid server-signed reservation receipt is required before execution can start."), { code: "RECOVERY_STAGING_BOOTSTRAP_FIELD_FORBIDDEN", status: 400 });
  const body = { ...input };
  const reservationReceipt = body.reservation_receipt;
  delete body.authority_action;
  delete body.reservation_receipt;
  return { ...exactBootstrapBinding(body), reservation_receipt: reservationReceipt };
}
function exactAccessRepairPrepare(input = {}) {
  exactKeys(input, ACCESS_REPAIR_PREPARE_KEYS, "Staging access-repair preparation request must be an object.");
  if (input.authority_action !== "prepare_access_repair") throw Object.assign(new Error("Unknown Staging ticket authority action."), { code: "RECOVERY_STAGING_BOOTSTRAP_ACTION_INVALID", status: 400 });
  return { expected_sha: input.expected_sha, target_key: input.target_key || "staging-runtime", target_fingerprint: input.target_fingerprint, grant_binding_hash: input.grant_binding_hash, idempotency_key: input.idempotency_key };
}
function exactAccessRepairApprove(input = {}) {
  exactKeys(input, ACCESS_REPAIR_APPROVE_KEYS, "Staging access-repair approval request must be an object.");
  if (input.authority_action !== "approve_access_repair") throw Object.assign(new Error("Unknown Staging ticket authority action."), { code: "RECOVERY_STAGING_BOOTSTRAP_ACTION_INVALID", status: 400 });
  return { plan_id: input.plan_id, plan_hash: input.plan_hash, step_id: input.step_id, idempotency_key: input.idempotency_key, approval_confirmation: input.approval_confirmation };
}
function legacyReadbackAssertions(input = {}) { return LEGACY_READBACK_ASSERTION_KEYS.filter((key) => Object.hasOwn(input, key)); }

export function buildStagingRecoveryAdminContract() {
  return {
    contract: STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT,
    surface: "staging_recovery_admin",
    environment: "staging",
    server_uri: STAGING_RECOVERY_ADMIN_SERVER_URI,
    production_authority: false,
    authorization: { scope: "private_admin", server_managed: true, caller_credentials_accepted: false, gpt_credentials_accepted: false, local_connector_production_authority: false },
    operation_policy: {
      advertised_methods: ["GET"], readiness_only: true, internal_execution_authority_methods: ["POST"], consequential_staging_execution: "local_cli_requires_server_ticket_reservation_execution_start_and_same_cycle_readback", target_database_mutation_on_this_surface: false,
      bootstrap_ticket_authority_modes: ["verify_existing_ticket", "mark_executing", "prepare_access_repair", "approve_access_repair"], approval_to_ticket_flow: "fixed_staging_database_access_repair_plan_challenge_typed_approval_server_issued_ticket", caller_selected_operation_on_issuance: false,
      bootstrap_ticket_reservation: "server_managed_single_use_signed_receipt", bootstrap_execution_start: "server_signed_receipt_required_before_local_mutation", bootstrap_readback_attestation: "server_verified_and_signed_inside_finalization_transaction_after_execution_start", bootstrap_finalization: "signed_readback_receipt_required", caller_readback_booleans_or_hashes_authoritative: false,
      partial_receipt_persistence: "server_managed_durable", automatic_replay_after_unknown_outcome: false, production_live_enabled: false, production_target_allowed: false, mutation_allowed: false, raw_sql_allowed: false, caller_target_selection: false,
    },
    paths: [...STAGING_RECOVERY_ADVERTISED_PATHS], internal_execution_authority_paths: [...STAGING_RECOVERY_INTERNAL_EXECUTION_PATHS], certification_contract: RECOVERY_STAGING_CERTIFICATION_CONTRACT,
    required_evidence: ["server_derived_deployment_attestation", "complete_staging_authority_graph", "exact_target_fingerprint", "durable_certification_record", "plan_bound_access_repair_approval", "server_issued_access_repair_ticket", "signed_ticket_reservation_receipt", "signed_execution_start_receipt", "signed_same_cycle_readback_receipt", "unknown_outcome_reconciliation_evidence"],
    forbidden_fallbacks: ["production_authority", "local_connector", "in_memory", "mock_adapter", "caller_generated_ticket", "caller_selected_sql", "caller_selected_command", "caller_asserted_readback", "automatic_replay"],
    database_mutation_performed: false, provider_accessed: false, provider_mutation_performed: false, secrets_included: false,
  };
}

export async function buildStagingRecoveryAdminReadiness({ recoveryComposition = null, stagingCertificationReader = null, deploymentAttestationReader = null, targetFingerprintReader = null, recoveryReadinessEvidenceReader = null, ingressBuildIdentity = null, expectedSha = null, expectedTargetFingerprint = null } = {}) {
  const snapshot = typeof recoveryReadinessEvidenceReader === "function" ? await recoveryReadinessEvidenceReader() : null;
  const authorityGraph = buildRecoveryAuthorityReadiness({ composition: recoveryComposition, environmentKey: "staging", adapterProvenance: recoveryReadinessEvidenceReader ? snapshot?.adapterProvenance || {} : null });
  let certification = snapshot?.stagingCertification || null;
  if (!recoveryReadinessEvidenceReader && typeof stagingCertificationReader === "function") certification = await stagingCertificationReader();
  let attestation = snapshot?.deploymentAttestation || null;
  if (!recoveryReadinessEvidenceReader && typeof deploymentAttestationReader === "function") attestation = await deploymentAttestationReader();
  let currentTargetFingerprint = snapshot?.candidateTargetFingerprint || expectedTargetFingerprint;
  if (!recoveryReadinessEvidenceReader && typeof targetFingerprintReader === "function") currentTargetFingerprint = await targetFingerprintReader();
  const currentSha = expectedSha || attestation?.sha || attestation?.commit_sha || null;
  const attestationValid = isObject(attestation) && attestation.environment === "staging" && attestationMatches({ attestation, expectedSha: currentSha, expectedBranch: "main", expectedEnvironment: "staging", expectedTargetFingerprint: currentTargetFingerprint });
  const certificationResult = evaluateStagingRecoveryCertification({ certification, expectedSha: currentSha, expectedTargetFingerprint: currentTargetFingerprint, requireExpectedTargetFingerprint: true });
  const externalEvidence = await evaluateExternalStagingEvidence(snapshot, ingressBuildIdentity);
  const ready = authorityGraph.ready === true && externalEvidence.ready && attestationValid && certificationResult.valid === true && certificationResult.evidence?.deployment_sha === attestation?.sha && certificationResult.evidence?.target_fingerprint === currentTargetFingerprint;
  return {
    contract: STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT, status: ready ? "ready" : "blocked", ready, environment: "staging", server_uri: STAGING_RECOVERY_ADMIN_SERVER_URI, authority_graph: authorityGraph, external_evidence: externalEvidence,
    certification: { contract: certificationResult.contract, status: certificationResult.status, valid: certificationResult.valid === true, certification_id: certificationResult.evidence?.certification_id || null, deployment_sha: certificationResult.evidence?.deployment_sha || null, target_fingerprint: certificationResult.evidence?.target_fingerprint || null, blocking_failures: [...(certificationResult.blocking_failures || []), ...(!attestationValid ? ["deployment_attestation"] : []), ...(!currentTargetFingerprint ? ["target_fingerprint_binding"] : [])], fingerprint: certificationResult.certification_fingerprint || null },
    deployment_attestation: publicAttestation(attestation), production_live: { requested: false, eligible: false, enabled: false }, live_certification: { status: "not_run_by_readiness_surface", separate_workflow_required: true, consequential_provider_execution_performed: false }, database_mutation_performed: false, provider_accessed: false, provider_mutation_performed: false, production_mutation_performed: false, secrets_included: false,
  };
}

export function buildStagingRecoveryAdminRoutes({ env = process.env, requireBackendApiKey, requireAdminPrincipal, recoveryComposition = null, stagingCertificationReader = null, deploymentAttestationReader = null, targetFingerprintReader = null, recoveryReadinessEvidenceReader = null, trustedHostResolver = resolveTrustedRequestHost, stagingBootstrapExecutionAuthorityFactory = createStagingBootstrapExecutionAuthority, stagingAccessRepairTicketAuthorityFactory = createStagingAccessRepairTicketAuthority } = {}) {
  const router = Router({ caseSensitive: true, strict: true });
  const hostProfile = resolveActivationGatewayHostProfile(env);
  const staging = isStagingEnvironment(env) && hostProfile.ok && hostProfile.profile?.gateway_key === "activation_gateway_staging";
  const missingGuards = [["requireBackendApiKey", requireBackendApiKey], ["requireAdminPrincipal", requireAdminPrincipal]].filter(([, guard]) => typeof guard !== "function").map(([name]) => name);
  if (missingGuards.length) throw Object.assign(new Error(`Staging Recovery requires all server-managed guards: ${missingGuards.join(", ")}`), { code: "RECOVERY_STAGING_GUARD_MISSING", missing_guards: missingGuards });
  const guards = [requireBackendApiKey, requireAdminPrincipal];

  router.use((req, res, next) => {
    if (!STAGING_RECOVERY_PATHS.includes(String(req?.path || ""))) return next();
    if (!staging) return errorResponse(res, req, 404, "RECOVERY_STAGING_SURFACE_UNAVAILABLE", "The Staging Recovery surface is not available outside a declared Staging runtime.");
    const requestHost = typeof trustedHostResolver === "function" ? trustedHostResolver(req, env) : "";
    const gatewayIdentity = req?.activationHostGateway;
    const gatewayIdentityValid = gatewayIdentity?.via_trusted_gateway === true && gatewayIdentity.ingress_signature_verified === true && gatewayIdentity.ingress_replay_protection === "durable_atomic_claim" && gatewayIdentity.gateway_key === "activation_gateway_staging" && gatewayIdentity.environment === "staging" && gatewayIdentity.public_host === STAGING_RECOVERY_ADMIN_HOST;
    if (requestHost !== STAGING_RECOVERY_ADMIN_HOST || !gatewayIdentityValid) return errorResponse(res, req, 404, "RECOVERY_STAGING_HOST_UNAVAILABLE", "The Staging Recovery surface is available only through the dedicated Activation Gateway host.");
    return next();
  });

  router.get("/admin/recovery/staging/contract", ...guards, (_req, res) => res.status(200).json({ ok: true, ...buildStagingRecoveryAdminContract() }));
  router.get("/admin/recovery/staging/readiness", ...guards, async (req, res) => {
    try { const result = await buildStagingRecoveryAdminReadiness({ recoveryComposition, stagingCertificationReader, deploymentAttestationReader, targetFingerprintReader, recoveryReadinessEvidenceReader, ingressBuildIdentity: req.activationHostGateway?.ingress_build_identity }); return res.status(200).json({ ok: result.ready, ...result }); }
    catch (error) { return errorResponse(res, req, Number(error?.status || 503), error?.code || "RECOVERY_STAGING_READINESS_FAILED", "Staging Recovery readiness is unavailable; no mutation was attempted."); }
  });
  router.get("/admin/recovery/staging/certification", ...guards, async (req, res) => {
    try { const result = await buildStagingRecoveryAdminReadiness({ recoveryComposition, stagingCertificationReader, deploymentAttestationReader, targetFingerprintReader, recoveryReadinessEvidenceReader, ingressBuildIdentity: req.activationHostGateway?.ingress_build_identity }); return res.status(200).json({ ok: result.certification.valid, contract: STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT, environment: "staging", certification: result.certification, live_certification: result.live_certification, production_live: result.production_live, database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false }); }
    catch (error) { return errorResponse(res, req, Number(error?.status || 503), error?.code || "RECOVERY_STAGING_CERTIFICATION_STATUS_FAILED", "Staging Recovery certification status is unavailable; no mutation was attempted."); }
  });

  router.post("/admin/recovery/staging/bootstrap-ticket/verify", ...guards, async (req, res) => {
    try {
      const authorityAction = String(req.body?.authority_action || "verify_existing_ticket").trim();
      if (authorityAction === "prepare_access_repair") { const authority = stagingAccessRepairTicketAuthorityFactory({ env }); const result = await authority.prepare(exactAccessRepairPrepare(req.body || {})); return res.status(201).json({ ...result, environment: "staging", production_authority: false, secrets_included: false }); }
      if (authorityAction === "approve_access_repair") { const authority = stagingAccessRepairTicketAuthorityFactory({ env }); const result = await authority.approveAndIssue(exactAccessRepairApprove(req.body || {})); return res.status(201).json({ ...result, environment: "staging", production_authority: false, secrets_included: false }); }
      if (authorityAction === "mark_executing") { const authority = stagingBootstrapExecutionAuthorityFactory({ env }); const result = await authority.markExecutingForBootstrap(exactBootstrapExecutionStart(req.body || {})); return res.status(result.executing === true ? 200 : 409).json({ ok: result.executing === true, ...result, environment: "staging", production_authority: false, database_mutation_performed: false, secrets_included: false }); }
      if (authorityAction !== "verify_existing_ticket") return errorResponse(res, req, 400, "RECOVERY_STAGING_BOOTSTRAP_ACTION_INVALID", "Unknown Staging ticket authority action.");
      const body = { ...(req.body || {}) }; delete body.authority_action;
      const authority = stagingBootstrapExecutionAuthorityFactory({ env });
      const result = await authority.verifyForBootstrap(exactBootstrapBinding(body));
      return res.status(result.valid === true ? 200 : 409).json({ ok: result.valid === true, ...result, environment: "staging", production_authority: false, database_mutation_performed: false, secrets_included: false });
    } catch (error) { return errorResponse(res, req, Number(error?.status || 503), error?.code || "RECOVERY_STAGING_BOOTSTRAP_TICKET_VERIFY_FAILED", "Staging bootstrap ticket authority failed closed; no database operation was attempted."); }
  });

  router.post("/admin/recovery/staging/bootstrap-ticket/finalize", ...guards, async (req, res) => {
    try {
      const input = isObject(req.body) ? { ...req.body } : {};
      const legacy = legacyReadbackAssertions(input);
      if (legacy.length) return errorResponse(res, req, 409, "RECOVERY_READBACK_UNVERIFIED", "Caller readback booleans or hashes cannot finalize a reserved ticket.");
      let readbackReceipt = input.readback_receipt; const reservationReceipt = input.reservation_receipt; const executionReceipt = input.execution_receipt; const readbackEvidence = input.readback_evidence;
      delete input.readback_receipt; delete input.reservation_receipt; delete input.execution_receipt; delete input.readback_evidence;
      const binding = exactBootstrapBinding(input); const authority = stagingBootstrapExecutionAuthorityFactory({ env });
      if (!readbackReceipt) { if (!isObject(reservationReceipt) || !isObject(executionReceipt) || !isObject(readbackEvidence) || hasSensitiveReceiptKey(reservationReceipt) || hasSensitiveReceiptKey(executionReceipt) || hasSensitiveReceiptKey(readbackEvidence)) return errorResponse(res, req, 409, "RECOVERY_READBACK_UNVERIFIED", "Finalization requires signed reservation and execution-start receipts plus canonical, non-sensitive same-cycle readback evidence."); const attested = await authority.attestReadbackForBootstrap({ ...binding, reservation_receipt: reservationReceipt, execution_receipt: executionReceipt, evidence: readbackEvidence }); if (attested?.verified !== true || !isObject(attested.readback_receipt)) return errorResponse(res, req, 409, "RECOVERY_READBACK_UNVERIFIED", "Server readback attestation failed closed."); readbackReceipt = attested.readback_receipt; }
      if (!isObject(readbackReceipt) || hasSensitiveReceiptKey(readbackReceipt)) return errorResponse(res, req, 409, "RECOVERY_READBACK_UNVERIFIED", "A valid server-signed readback receipt is required before finalization.");
      const result = await authority.finalizeForBootstrap({ ...binding, readback_receipt: readbackReceipt });
      return res.status(200).json({ ok: result.finalized === true, ...result, environment: "staging", production_authority: false, secrets_included: false });
    } catch (error) { return errorResponse(res, req, Number(error?.status || 503), error?.code || "RECOVERY_RECONCILIATION_REQUIRED", "Staging bootstrap ticket finalization failed closed; reconciliation is required."); }
  });

  router.post("/admin/recovery/staging/bootstrap-partial-receipt", ...guards, async (req, res) => {
    try { const receipt = req.body?.receipt; if (!isObject(receipt) || hasSensitiveReceiptKey(receipt)) return errorResponse(res, req, 400, "RECOVERY_STAGING_PARTIAL_RECEIPT_INVALID", "Partial mutation evidence is invalid or contains forbidden sensitive fields."); const authority = stagingBootstrapExecutionAuthorityFactory({ env }); const result = await authority.partialReceiptStore.putImmutablePartialRebuildReceipt(receipt); return res.status(202).json({ ok: true, persisted: result?.persisted === true, durable: result?.durable === true, evidence_hash: result?.evidence_hash || null, environment: "staging", production_authority: false, database_mutation_performed: false, reconciliation_required: true, automatic_rerun_allowed: false, secrets_included: false }); }
    catch (error) { return errorResponse(res, req, Number(error?.status || 503), error?.code || "RECOVERY_STAGING_PARTIAL_RECEIPT_FAILED", "Partial mutation evidence could not be persisted; automatic replay remains forbidden."); }
  });
  return router;
}

export const _testingStagingRecoveryAdminRoutes = Object.freeze({ STAGING_ENVIRONMENT_KEYS, STAGING_RECOVERY_PATHS, STAGING_RECOVERY_ADVERTISED_PATHS, STAGING_RECOVERY_INTERNAL_EXECUTION_PATHS, STAGING_RECOVERY_ADMIN_HOST, BOOTSTRAP_BINDING_KEYS, BOOTSTRAP_EXECUTION_START_KEYS, ACCESS_REPAIR_PREPARE_KEYS, ACCESS_REPAIR_APPROVE_KEYS, LEGACY_READBACK_ASSERTION_KEYS, isStagingEnvironment, publicAttestation, exactBootstrapBinding, exactBootstrapExecutionStart, exactAccessRepairPrepare, exactAccessRepairApprove, hasSensitiveReceiptKey, legacyReadbackAssertions });
