import { getGovernanceDbPrivilegeReadinessSnapshot } from "./governanceDbPrivilegeReadinessRuntime.js";
import { readMcpCatalogSchemaReadinessSafe } from "./mcpCatalogSchemaGuard.js";
import { runRuntimePersistenceOperationalReadiness } from "./scripts/runtime-persistence-operational-readiness.mjs";
import { buildProductionAuthorityActivationReadiness } from "./recoveryActivationReadiness.js";
import { resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";

export const PRODUCTION_ACTIVATION_READINESS_CONTRACT =
  "mad4b.production-activation-readiness.v1";

export const PRODUCTION_ACTIVATION_READINESS_DIMENSIONS = Object.freeze([
  "mcp_catalog_schema",
  "governance_db_privilege",
  "runtime_persistence",
]);

const MUTATION_EVIDENCE_FIELDS = Object.freeze([
  "sql_mutation_performed",
  "migration_apply_performed",
  "provider_mutation_performed",
  "deployment_performed",
]);

function boundedCode(error, fallback) {
  return String(error?.code || error?.errno || fallback).slice(0, 128) || fallback;
}

function mutationAttestation(name, result = {}) {
  const fields = Object.fromEntries(MUTATION_EVIDENCE_FIELDS.map((field) => [field, result[field] ?? null]));
  const complete = result.read_only_probe === true
    && MUTATION_EVIDENCE_FIELDS.every((field) => result[field] === false)
    && result.secrets_included === false;
  return {
    dimension: name,
    complete,
    read_only_probe: result.read_only_probe === true,
    ...fields,
    secrets_included: result.secrets_included ?? null,
  };
}

async function readDimension(name, reader) {
  try {
    const result = await reader();
    return result && typeof result === "object"
      ? result
      : {
          ok: false,
          status: "blocked",
          reason: `${name}_readiness_invalid_result`,
          read_only_probe: false,
          sql_mutation_performed: null,
          migration_apply_performed: null,
          provider_mutation_performed: null,
          deployment_performed: null,
          secrets_included: false,
        };
  } catch (error) {
    return {
      ok: false,
      status: "blocked",
      reason: `${name}_readiness_probe_failed`,
      code: boundedCode(error, `${name}_readiness_probe_failed`),
      database_connection_performed: null,
      sql_readback_performed: null,
      read_only_probe: false,
      sql_mutation_performed: null,
      migration_apply_performed: null,
      provider_mutation_performed: null,
      deployment_performed: null,
      secrets_included: false,
    };
  }
}

function productionCandidateEvaluationComposition(composition, env = process.env) {
  const factory = composition?.productionRecoveryCompositionFactory;
  const candidate = factory?.activation_candidate;
  const runtime = resolveRuntimeEnvironmentStrict(env);
  const eligibleRuntime = runtime.ok === true
    && runtime.environment_key === "production"
    && runtime.runtime_class === "hostinger_autodeploy"
    && runtime.runtime_class_explicit === true;
  const candidateRequested = eligibleRuntime
    && factory?.mode === "production_live"
    && factory?.activation_requested === true
    && candidate?.requested_mode === "production_live"
    && candidate?.configured === true
    && candidate?.mutation_authority_exposed === false
    && candidate?.live_activation === false
    && candidate?.secrets_included === false;

  if (!candidateRequested) {
    return {
      requested: false,
      composition,
      candidate: null,
      runtime,
    };
  }

  // Evaluation-only view: no adapter objects are copied into this object. It lets
  // the existing certification evaluator reason about the validated candidate
  // graph while the route composition itself remains fail_closed.
  const evaluationComposition = Object.freeze({
    contract: candidate.graph_contract,
    mode: "production_live",
    configured: true,
    live_activation: true,
    component_status: candidate.component_status,
    productionRecoveryCompositionFactory: Object.freeze({
      authority_readiness: factory.authority_readiness,
    }),
    test_only: false,
    mock: false,
    in_memory: false,
  });
  return {
    requested: true,
    composition: evaluationComposition,
    candidate,
    runtime,
  };
}

export async function runProductionActivationReadiness({
  mcpCatalogReader = readMcpCatalogSchemaReadinessSafe,
  governanceDbReader = getGovernanceDbPrivilegeReadinessSnapshot,
  runtimePersistenceReader = runRuntimePersistenceOperationalReadiness,
  recoveryComposition = null,
  stagingCertification = null,
  deploymentAttestation = null,
  candidateSha = null,
  candidateTargetFingerprint = null,
  promotionArtifactParity = null,
  unresolvedRecoveryIncidents = [],
  adapterProvenance = null,
  productionLiveRequested = false,
  productionLiveEnabled = false,
  env = process.env,
} = {}) {
  const [mcpCatalogSchema, governanceDbPrivilege, runtimePersistence] = await Promise.all([
    readDimension("mcp_catalog_schema", mcpCatalogReader),
    readDimension("governance_db_privilege", governanceDbReader),
    readDimension("runtime_persistence", runtimePersistenceReader),
  ]);

  const dimensions = {
    mcp_catalog_schema: mcpCatalogSchema,
    governance_db_privilege: governanceDbPrivilege,
    runtime_persistence: runtimePersistence,
  };
  const dimensionEntries = Object.entries(dimensions);
  const mutationAttestations = Object.fromEntries(
    dimensionEntries.map(([name, result]) => [name, mutationAttestation(name, result)]),
  );
  const mutationAttestationComplete = Object.values(mutationAttestations)
    .every((attestation) => attestation.complete === true);

  const checks = {
    mcp_catalog_schema_ready: mcpCatalogSchema.ok === true,
    governance_db_privilege_ready: governanceDbPrivilege.ready === true,
    runtime_persistence_ready: runtimePersistence.ok === true,
    mutation_attestation_complete: mutationAttestationComplete,
  };
  const ready = Object.values(checks).every(Boolean);

  const candidateEvaluation = productionCandidateEvaluationComposition(recoveryComposition, env);
  const effectiveProductionLiveRequested = productionLiveRequested === true || candidateEvaluation.requested === true;
  const productionAuthorityReadiness = buildProductionAuthorityActivationReadiness({
    productionLiveRequested: effectiveProductionLiveRequested,
    productionLiveEnabled,
    composition: candidateEvaluation.composition,
    stagingCertification,
    deploymentAttestation,
    candidateSha,
    candidateTargetFingerprint,
    promotionArtifactParity,
    unresolvedRecoveryIncidents,
    adapterProvenance,
  });

  const aggregateBoolean = (field) => dimensionEntries.some(([, result]) => result[field] === true);

  return {
    contract: PRODUCTION_ACTIVATION_READINESS_CONTRACT,
    status: ready ? "ready" : "blocked",
    ok: ready,
    ready,
    dimensions,
    checks,
    mutation_attestation: {
      complete: mutationAttestationComplete,
      dimensions: mutationAttestations,
      unknown_dimensions: Object.entries(mutationAttestations)
        .filter(([, attestation]) => attestation.complete !== true)
        .map(([name]) => name),
    },
    hard_activation_blocked_until_ready: !ready,
    production_authority_readiness: productionAuthorityReadiness,
    production_live: productionAuthorityReadiness.production_live,
    activation_eligible: productionAuthorityReadiness.activation_eligible,
    activation_candidate: {
      requested: candidateEvaluation.requested,
      graph_validated: candidateEvaluation.candidate?.configured === true,
      mutation_authority_exposed: candidateEvaluation.candidate?.mutation_authority_exposed === true,
      runtime_class: candidateEvaluation.runtime?.runtime_class || null,
      live_activation: false,
      secrets_included: false,
    },
    read_only_probe: mutationAttestationComplete,
    database_connection_performed: aggregateBoolean("database_connection_performed"),
    sql_readback_performed: aggregateBoolean("sql_readback_performed"),
    sql_mutation_performed: aggregateBoolean("sql_mutation_performed"),
    database_mutation_performed: false,
    migration_apply_performed: aggregateBoolean("migration_apply_performed"),
    provider_mutation_performed: aggregateBoolean("provider_mutation_performed"),
    production_mutation_performed: false,
    deployment_performed: aggregateBoolean("deployment_performed"),
    secrets_included: aggregateBoolean("secrets_included"),
  };
}

export const _testingProductionActivationReadiness = Object.freeze({
  productionCandidateEvaluationComposition,
});
