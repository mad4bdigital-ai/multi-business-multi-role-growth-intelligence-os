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

export const STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT = "mad4b.staging-recovery-admin-surface.v1";
export const STAGING_RECOVERY_ADMIN_SERVER_URI = "https://activation-dev.mad4b.com";
export const STAGING_RECOVERY_ADMIN_HOST = "activation-dev.mad4b.com";

const STAGING_ENVIRONMENT_KEYS = new Set(["staging", "staging_local_windows_docker"]);
const STAGING_RECOVERY_PATHS = Object.freeze([
  "/admin/recovery/staging/contract",
  "/admin/recovery/staging/readiness",
  "/admin/recovery/staging/certification",
]);

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStagingEnvironment(env = process.env) {
  const resolved = resolveRuntimeEnvironment(env);
  return resolved.ok && resolved.environment_key === "staging";
}

function requestId(req) {
  return String(req?.headers?.["x-request-id"] || req?.headers?.["cf-ray"] || "")
    .split(",")[0]
    .trim()
    .slice(0, 128) || null;
}

function errorResponse(res, req, status, code, message) {
  return res.status(status).json({
    ok: false,
    contract: STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT,
    error: { code, message, request_id: requestId(req) },
    environment: "staging",
    production_authority: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  });
}

function publicAttestation(attestation) {
  if (!isObject(attestation)) return null;
  const environment = typeof attestation.environment === "string" && attestation.environment.trim()
    ? attestation.environment.trim()
    : null;
  return {
    repository: attestation.repository || null,
    branch: attestation.branch || null,
    sha: attestation.sha || attestation.commit_sha || null,
    environment,
    environment_match: environment === "staging" && attestation.environment_match !== false,
    repository_match: attestation.repository_match === true,
    branch_match: attestation.branch_match === true,
    sha_match: attestation.sha_match === true,
    manifest_bound: attestation.manifest_bound === true,
    read_only: attestation.read_only === true,
    secrets_included: false,
  };
}

export function buildStagingRecoveryAdminContract() {
  return {
    contract: STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT,
    surface: "staging_recovery_admin",
    environment: "staging",
    server_uri: STAGING_RECOVERY_ADMIN_SERVER_URI,
    production_authority: false,
    authorization: {
      scope: "private_admin",
      server_managed: true,
      caller_credentials_accepted: false,
      gpt_credentials_accepted: false,
      local_connector_production_authority: false,
    },
    operation_policy: {
      advertised_methods: ["GET"],
      readiness_only: true,
      consequential_staging_execution: "separate_certification_workflow_required",
      production_live_enabled: false,
      production_target_allowed: false,
      mutation_allowed: false,
      raw_sql_allowed: false,
      caller_target_selection: false,
    },
    paths: [...STAGING_RECOVERY_PATHS],
    certification_contract: RECOVERY_STAGING_CERTIFICATION_CONTRACT,
    required_evidence: [
      "server_derived_deployment_attestation",
      "complete_staging_authority_graph",
      "exact_target_fingerprint",
      "durable_certification_record",
      "same_fence_readback_evidence",
      "unknown_outcome_reconciliation_evidence",
    ],
    forbidden_fallbacks: ["production_authority", "local_connector", "in_memory", "mock_adapter", "caller_generated_ticket"],
    database_mutation_performed: false,
    provider_accessed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  };
}

export async function buildStagingRecoveryAdminReadiness({
  recoveryComposition = null,
  stagingCertificationReader = null,
  deploymentAttestationReader = null,
  targetFingerprintReader = null,
  recoveryReadinessEvidenceReader = null,
  ingressBuildIdentity = null,
  expectedSha = null,
  expectedTargetFingerprint = null,
} = {}) {
  const snapshot = typeof recoveryReadinessEvidenceReader === "function" ? await recoveryReadinessEvidenceReader() : null;
  const authorityGraph = buildRecoveryAuthorityReadiness({
    composition: recoveryComposition,
    environmentKey: "staging",
    adapterProvenance: recoveryReadinessEvidenceReader ? snapshot?.adapterProvenance || {} : null,
  });
  let certification = snapshot?.stagingCertification || null;
  if (!recoveryReadinessEvidenceReader && typeof stagingCertificationReader === "function") {
    certification = await stagingCertificationReader();
  }
  let attestation = snapshot?.deploymentAttestation || null;
  if (!recoveryReadinessEvidenceReader && typeof deploymentAttestationReader === "function") {
    attestation = await deploymentAttestationReader();
  }
  let currentTargetFingerprint = snapshot?.candidateTargetFingerprint || expectedTargetFingerprint;
  if (!recoveryReadinessEvidenceReader && typeof targetFingerprintReader === "function") {
    currentTargetFingerprint = await targetFingerprintReader();
  }
  const currentSha = expectedSha || attestation?.sha || attestation?.commit_sha || null;
  const attestationValid = isObject(attestation)
    && attestation.environment === "staging"
    && attestationMatches({
      attestation,
      expectedSha: currentSha,
      expectedBranch: "main",
      expectedEnvironment: "staging",
      expectedTargetFingerprint: currentTargetFingerprint,
    });
  const certificationResult = evaluateStagingRecoveryCertification({
    certification,
    expectedSha: currentSha,
    expectedTargetFingerprint: currentTargetFingerprint,
    requireExpectedTargetFingerprint: true,
  });
  const externalEvidence = await evaluateExternalStagingEvidence(snapshot, ingressBuildIdentity);
  const ready = authorityGraph.ready === true
    && externalEvidence.ready
    && attestationValid
    && certificationResult.valid === true
    && certificationResult.evidence?.deployment_sha === attestation?.sha
    && certificationResult.evidence?.target_fingerprint === currentTargetFingerprint;
  return {
    contract: STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT,
    status: ready ? "ready" : "blocked",
    ready,
    environment: "staging",
    server_uri: STAGING_RECOVERY_ADMIN_SERVER_URI,
    authority_graph: authorityGraph,
    external_evidence: externalEvidence,
    certification: {
      contract: certificationResult.contract,
      status: certificationResult.status,
      valid: certificationResult.valid === true,
      certification_id: certificationResult.evidence?.certification_id || null,
      deployment_sha: certificationResult.evidence?.deployment_sha || null,
      target_fingerprint: certificationResult.evidence?.target_fingerprint || null,
      blocking_failures: [
        ...(certificationResult.blocking_failures || []),
        ...(!attestationValid ? ["deployment_attestation"] : []),
        ...(!currentTargetFingerprint ? ["target_fingerprint_binding"] : []),
      ],
      fingerprint: certificationResult.certification_fingerprint || null,
    },
    deployment_attestation: publicAttestation(attestation),
    production_live: {
      requested: false,
      eligible: false,
      enabled: false,
    },
    live_certification: {
      status: "not_run_by_readiness_surface",
      separate_workflow_required: true,
      consequential_provider_execution_performed: false,
    },
    database_mutation_performed: false,
    provider_accessed: false,
    provider_mutation_performed: false,
    production_mutation_performed: false,
    secrets_included: false,
  };
}

export function buildStagingRecoveryAdminRoutes({
  env = process.env,
  requireBackendApiKey,
  requireAdminPrincipal,
  recoveryComposition = null,
  stagingCertificationReader = null,
  deploymentAttestationReader = null,
  targetFingerprintReader = null,
  recoveryReadinessEvidenceReader = null,
  trustedHostResolver = resolveTrustedRequestHost,
} = {}) {
  const router = Router({ caseSensitive: true, strict: true });
  const hostProfile = resolveActivationGatewayHostProfile(env);
  const staging = isStagingEnvironment(env) && hostProfile.ok && hostProfile.profile?.gateway_key === "activation_gateway_staging";
  const missingGuards = [
    ["requireBackendApiKey", requireBackendApiKey],
    ["requireAdminPrincipal", requireAdminPrincipal],
  ].filter(([, guard]) => typeof guard !== "function").map(([name]) => name);
  if (missingGuards.length) {
    const error = new Error(`Staging Recovery requires all server-managed guards: ${missingGuards.join(", ")}`);
    error.code = "RECOVERY_STAGING_GUARD_MISSING";
    error.missing_guards = missingGuards;
    throw error;
  }
  const guards = [requireBackendApiKey, requireAdminPrincipal];

  router.use((req, res, next) => {
    // Scope the environment isolation guard to this surface's exact paths.
    // A router-level deny-all would intercept unrelated public health routes
    // such as /version when the application is running outside Staging.
    if (!STAGING_RECOVERY_PATHS.includes(String(req?.path || ""))) return next();
    if (!staging) return errorResponse(res, req, 404, "RECOVERY_STAGING_SURFACE_UNAVAILABLE", "The Staging Recovery surface is not available outside a declared Staging runtime.");
    const requestHost = typeof trustedHostResolver === "function" ? trustedHostResolver(req, env) : "";
    const gatewayIdentity = req?.activationHostGateway;
    const gatewayIdentityValid = gatewayIdentity?.via_trusted_gateway === true
      && gatewayIdentity.ingress_signature_verified === true
      && gatewayIdentity.ingress_replay_protection === "durable_atomic_claim"
      && gatewayIdentity.gateway_key === "activation_gateway_staging"
      && gatewayIdentity.environment === "staging"
      && gatewayIdentity.public_host === STAGING_RECOVERY_ADMIN_HOST;
    if (requestHost !== STAGING_RECOVERY_ADMIN_HOST || !gatewayIdentityValid) {
      return errorResponse(res, req, 404, "RECOVERY_STAGING_HOST_UNAVAILABLE", "The Staging Recovery surface is available only through the dedicated Activation Gateway host.");
    }
    return next();
  });

  router.get("/admin/recovery/staging/contract", ...guards, (_req, res) => {
    res.status(200).json({ ok: true, ...buildStagingRecoveryAdminContract() });
  });

  router.get("/admin/recovery/staging/readiness", ...guards, async (req, res) => {
    try {
      const result = await buildStagingRecoveryAdminReadiness({
        recoveryComposition,
        stagingCertificationReader,
        deploymentAttestationReader,
        targetFingerprintReader,
        recoveryReadinessEvidenceReader,
        ingressBuildIdentity: req.activationHostGateway?.ingress_build_identity,
      });
      return res.status(200).json({ ok: result.ready, ...result });
    } catch (error) {
      return errorResponse(res, req, Number(error?.status || 503), error?.code || "RECOVERY_STAGING_READINESS_FAILED", "Staging Recovery readiness is unavailable; no mutation was attempted.");
    }
  });

  router.get("/admin/recovery/staging/certification", ...guards, async (req, res) => {
    try {
      const result = await buildStagingRecoveryAdminReadiness({
        recoveryComposition,
        stagingCertificationReader,
        deploymentAttestationReader,
        targetFingerprintReader,
        recoveryReadinessEvidenceReader,
        ingressBuildIdentity: req.activationHostGateway?.ingress_build_identity,
      });
      return res.status(200).json({
        ok: result.certification.valid,
        contract: STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT,
        environment: "staging",
        certification: result.certification,
        live_certification: result.live_certification,
        production_live: result.production_live,
        database_mutation_performed: false,
        provider_mutation_performed: false,
        secrets_included: false,
      });
    } catch (error) {
      return errorResponse(res, req, Number(error?.status || 503), error?.code || "RECOVERY_STAGING_CERTIFICATION_STATUS_FAILED", "Staging Recovery certification status is unavailable; no mutation was attempted.");
    }
  });

  return router;
}

export const _testingStagingRecoveryAdminRoutes = Object.freeze({
  STAGING_ENVIRONMENT_KEYS,
  STAGING_RECOVERY_PATHS,
  STAGING_RECOVERY_ADMIN_HOST,
  isStagingEnvironment,
  publicAttestation,
});
