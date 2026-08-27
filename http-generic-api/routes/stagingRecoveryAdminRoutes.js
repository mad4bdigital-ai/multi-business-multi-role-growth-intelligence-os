import { Router } from "express";
import {
  buildRecoveryAuthorityReadiness,
  evaluateStagingRecoveryCertification,
  RECOVERY_STAGING_CERTIFICATION_CONTRACT,
} from "../recoveryActivationReadiness.js";

export const STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT = "mad4b.staging-recovery-admin-surface.v1";
export const STAGING_RECOVERY_ADMIN_SERVER_URI = "https://activation-dev.mad4b.com";

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
  return STAGING_ENVIRONMENT_KEYS.has(String(
    env.NODE_ENV || env.REMOTE_MCP_ENVIRONMENT || env.DEPLOYMENT_ENVIRONMENT || "",
  ).trim().toLowerCase());
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
  return {
    repository: attestation.repository || null,
    branch: attestation.branch || null,
    sha: attestation.sha || attestation.commit_sha || null,
    environment: attestation.environment || "staging",
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
  expectedSha = null,
  expectedTargetFingerprint = null,
} = {}) {
  const authorityGraph = buildRecoveryAuthorityReadiness({
    composition: recoveryComposition,
    environmentKey: "staging",
  });
  let certification = null;
  if (typeof stagingCertificationReader === "function") {
    certification = await stagingCertificationReader();
  }
  let attestation = null;
  if (typeof deploymentAttestationReader === "function") {
    attestation = await deploymentAttestationReader();
  }
  const certificationResult = certification?.contract === RECOVERY_STAGING_CERTIFICATION_CONTRACT
    && Object.hasOwn(certification, "valid")
    ? certification
    : evaluateStagingRecoveryCertification({
      certification,
      expectedSha: expectedSha || attestation?.sha || attestation?.commit_sha || null,
      expectedTargetFingerprint,
    });
  const ready = authorityGraph.ready === true && certificationResult.valid === true;
  return {
    contract: STAGING_RECOVERY_ADMIN_SURFACE_CONTRACT,
    status: ready ? "ready" : "blocked",
    ready,
    environment: "staging",
    server_uri: STAGING_RECOVERY_ADMIN_SERVER_URI,
    authority_graph: authorityGraph,
    certification: {
      contract: certificationResult.contract,
      status: certificationResult.status,
      valid: certificationResult.valid === true,
      certification_id: certificationResult.evidence?.certification_id || null,
      deployment_sha: certificationResult.evidence?.deployment_sha || null,
      target_fingerprint: certificationResult.evidence?.target_fingerprint || null,
      blocking_failures: certificationResult.blocking_failures || [],
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
} = {}) {
  const router = Router();
  const staging = isStagingEnvironment(env);
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter((guard) => typeof guard === "function");

  router.use((req, res, next) => {
    // Scope the environment isolation guard to this surface's exact paths.
    // A router-level deny-all would intercept unrelated public health routes
    // such as /version when the application is running outside Staging.
    if (!STAGING_RECOVERY_PATHS.includes(String(req?.path || ""))) return next();
    if (!staging) return errorResponse(res, req, 404, "RECOVERY_STAGING_SURFACE_UNAVAILABLE", "The Staging Recovery surface is not available outside a declared Staging runtime.");
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
  isStagingEnvironment,
  publicAttestation,
});
