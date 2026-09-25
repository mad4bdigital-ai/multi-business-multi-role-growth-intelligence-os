import {
  inspectProductionDatabase,
  readProductionIdentity,
} from "./recoveryKernel.js";
import { PRODUCTION_RECOVERY_BACKUP_EVIDENCE_CONTRACT } from "./productionRecoveryClosure.js";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const PRODUCTION_ORIGIN = "https://auth.mad4b.com";

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(code, message, status = 502, details = {}) {
  throw Object.assign(new Error(message), {
    code,
    status,
    details: { ...details, secrets_included: false },
  });
}

function bound(ctx, payload = {}) {
  return Object.freeze({
    ok: payload.ok !== false,
    status: payload.status || (payload.ok === false ? "blocked" : "pass"),
    expected_sha: ctx.expected_sha,
    run_id: ctx.run_id,
    plan_hash: ctx.plan_hash,
    step_id: ctx.step_id,
    idempotency_key: ctx.idempotency_key,
    mutation_performed: false,
    readback_verified: payload.readback_verified !== false,
    secrets_included: false,
    ...payload,
    expected_sha: ctx.expected_sha,
    run_id: ctx.run_id,
    plan_hash: ctx.plan_hash,
    step_id: ctx.step_id,
    idempotency_key: ctx.idempotency_key,
    mutation_performed: false,
    secrets_included: false,
  });
}

function blocked(ctx, errorCode, nextSafeAction, extra = {}) {
  return bound(ctx, {
    ok: false,
    status: "blocked",
    error_code: errorCode,
    next_safe_action: nextSafeAction,
    readback_verified: false,
    ...extra,
  });
}

function normalizeSha(value) {
  const sha = text(value, 64).toLowerCase();
  return SHA40_RE.test(sha) ? sha : null;
}

async function fetchJsonFixed(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      fail("PLATFORM_RECOVERY_PARITY_REDIRECT_FORBIDDEN", "Production parity readback may not follow redirects.", 502, { url });
    }
    if (response.status !== 200) {
      fail("PLATFORM_RECOVERY_PARITY_HTTP_FAILED", "Production parity endpoint did not return HTTP 200.", 502, {
        url,
        http_status: response.status,
      });
    }
    let body;
    try {
      body = await response.json();
    } catch {
      fail("PLATFORM_RECOVERY_PARITY_JSON_INVALID", "Production parity endpoint did not return valid JSON.", 502, { url });
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export function createProductionDeploymentParityReader({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
} = {}) {
  if (typeof fetchImpl !== "function") {
    fail("PLATFORM_RECOVERY_PARITY_FETCH_UNAVAILABLE", "A server-owned fetch implementation is required.", 503);
  }

  return async function readProductionDeploymentParity(expectedSha) {
    const expected = normalizeSha(expectedSha);
    if (!expected) fail("PLATFORM_RECOVERY_SHA_INVALID", "Expected SHA is invalid.", 400);

    const [version, deployment] = await Promise.all([
      fetchJsonFixed(fetchImpl, `${PRODUCTION_ORIGIN}/version`, timeoutMs),
      fetchJsonFixed(fetchImpl, `${PRODUCTION_ORIGIN}/deployment-info`, timeoutMs),
    ]);

    const versionSha = normalizeSha(version?.deployment?.deployed_commit_sha);
    const deploymentSha = normalizeSha(deployment?.commit_sha);
    const deploymentBranch = text(deployment?.branch, 128);

    const versionReadback = versionSha === expected;
    const deploymentInfoReadback = deploymentSha === expected && deploymentBranch === "Production";
    return Object.freeze({
      ok: versionReadback && deploymentInfoReadback,
      exact_sha_parity: versionReadback && deploymentInfoReadback,
      version_readback: versionReadback,
      deployment_info_readback: deploymentInfoReadback,
      version_sha: versionSha,
      deployment_sha: deploymentSha,
      deployment_branch: deploymentBranch || null,
      fixed_origin: PRODUCTION_ORIGIN,
      caller_origin_allowed: false,
      read_only_probe: true,
      provider_mutation_performed: false,
      deployment_performed: false,
      secrets_included: false,
    });
  };
}

export function normalizeFullInspectionForConvergence(result = {}) {
  const inspection = result?.inspection && typeof result.inspection === "object"
    ? result.inspection
    : {};
  const classifications = inspection.role_database_object_classifications || {};
  const counts = inspection.role_database_object_counts || {};
  const rawChecks = inspection.checks && typeof inspection.checks === "object" ? inspection.checks : {};
  const readiness = (key) => {
    if (!Object.prototype.hasOwnProperty.call(rawChecks, key)) return null;
    if (rawChecks[key] === true) return true;
    if (rawChecks[key] === false) return false;
    return null;
  };
  const checks = Object.freeze({
    governance_db_privilege_ready: readiness("governance_db_privilege_ready"),
    mcp_catalog_schema_ready: readiness("mcp_catalog_schema_ready"),
    runtime_persistence_ready: readiness("runtime_persistence_ready"),
  });
  const roles = {};

  for (const role of ["runtime", "governance", "runtime_persistence"]) {
    const classification = text(classifications?.[role], 64);
    const total = Number(counts?.[role]?.total);
    const zeroObject = classification === "zero_objects" && total === 0;
    roles[role] = Object.freeze({
      zero_object: zeroObject,
      classification: classification || null,
      object_count_total: Number.isFinite(total) ? total : null,
      object_count_fingerprint: inspection.role_database_object_count_fingerprints?.[role] || null,
    });
  }

  return Object.freeze({
    durable: result?.durability?.inspection_durable === true,
    inspection_run_id: result?.inspection_run_id || result?.run_id || null,
    inspection_evidence_hash: result?.inspection_evidence_hash || null,
    target_fingerprint: text(
      result?.target_fingerprint
        || result?.trust?.target_fingerprints?.composite
        || inspection?.target_fingerprint,
      256,
    ) || null,
    checks,
    roles: Object.freeze(roles),
  });
}

function requireReader(reader, ctx, code, nextSafeAction) {
  if (typeof reader !== "function") return blocked(ctx, code, nextSafeAction);
  return null;
}

export function createPlatformRecoveryConvergenceReadExecutors({
  env = process.env,
  repoRoot,
  recoveryStore,
  hostLocalInspectionExecutor,
  deploymentParityReader = createProductionDeploymentParityReader(),
  backupEvidenceReader = null,
  governanceBaselineReadinessReader = null,
  runtimePersistenceBaselineReadinessReader = null,
  canonicalGrantsReadinessReader = null,
  bootstrapLedgerReadinessReader = null,
  mcpCatalogReadinessReader = null,
  adminToolsReadbackReader = null,
  deviceToolsReadbackReader = null,
  productionActivationReadinessReader = null,
  connectorAuthProbeReader = null,
  localManagerRateLimitRecoveryReader = null,
} = {}) {
  const executors = {};

  executors.production_identity = async (ctx) => {
    const identity = readProductionIdentity({ env, expectedSha: ctx.expected_sha });
    const publicParity = await deploymentParityReader(ctx.expected_sha);
    if (identity.parity !== true || publicParity.exact_sha_parity !== true) {
      return blocked(ctx, "platform_recovery_production_identity_mismatch", "restore_exact_production_sha_parity", {
        exact_sha_parity: false,
        version_readback: publicParity.version_readback === true,
        deployment_info_readback: publicParity.deployment_info_readback === true,
      });
    }
    return bound(ctx, {
      status: "pass",
      exact_sha_parity: true,
      version_readback: true,
      deployment_info_readback: true,
      identity_source: identity.identity_source || null,
      public_origin: PRODUCTION_ORIGIN,
      readback_verified: true,
    });
  };

  executors.database_full_inspection = async (ctx) => {
    if (typeof hostLocalInspectionExecutor !== "function") {
      return blocked(ctx, "platform_recovery_full_inspection_executor_unavailable", "configure_host_local_full_inspection");
    }
    const result = await inspectProductionDatabase(
      { expected_sha: ctx.expected_sha, target_key: "production-runtime" },
      { env, repoRoot, hostLocalExecutor: hostLocalInspectionExecutor, recoveryStore },
    );
    const normalized = normalizeFullInspectionForConvergence(result);
    if (!result?.ok || normalized.durable !== true) {
      return blocked(ctx, "platform_recovery_full_inspection_not_durable", "restore_durable_full_inspection_authority", normalized);
    }
    return bound(ctx, {
      status: "pass",
      ...normalized,
      readback_verified: true,
    });
  };

  executors.backup_evidence = async (ctx) => {
    const missing = requireReader(
      backupEvidenceReader,
      ctx,
      "platform_recovery_backup_evidence_authority_unavailable",
      "capture_and_verify_all_role_backup_evidence",
    );
    if (missing) return missing;

    const inspection = Array.isArray(ctx.prior_steps)
      ? ctx.prior_steps.find((entry) => entry?.key === "database_full_inspection")?.result
      : null;
    const targetFingerprint = text(inspection?.target_fingerprint, 256) || null;
    if (!targetFingerprint) {
      return blocked(ctx, "platform_recovery_backup_target_fingerprint_unavailable", "rerun_durable_full_inspection_before_backup");
    }

    const result = await backupEvidenceReader({
      expected_sha: ctx.expected_sha,
      target_key: "production-runtime",
      run_id: ctx.run_id,
      cycle_id: ctx.run_id,
      target_fingerprint: targetFingerprint,
    });
    const roles = Array.isArray(result?.roles) ? result.roles.map((role) => text(role, 64)) : [];
    const evidenceSha = text(result?.evidence_sha256 || result?.backup_evidence_sha256, 128).toLowerCase();
    const manifestHash = text(result?.artifact_manifest_hash, 128).toLowerCase();
    const evidenceExpectedSha = normalizeSha(result?.expected_sha || result?.source_sha);
    const createdAt = text(result?.created_at, 80);
    const createdAtMs = Date.parse(createdAt);
    const nowMs = Date.now();
    const fresh = Number.isFinite(createdAtMs)
      && createdAtMs <= nowMs + 60_000
      && nowMs - createdAtMs <= 24 * 60 * 60 * 1000;
    const exactCycle = text(result?.cycle_id, 192) === ctx.run_id;
    const exactTarget = text(result?.target_fingerprint, 256) === targetFingerprint;
    const ready = result?.contract === PRODUCTION_RECOVERY_BACKUP_EVIDENCE_CONTRACT
      && result?.backup_verified === true
      && result?.verified === true
      && result?.durable === true
      && result?.storage_readback_verified === true
      && result?.restore_test_verified === true
      && evidenceExpectedSha === ctx.expected_sha
      && /^[0-9a-f]{64}$/u.test(evidenceSha)
      && /^[0-9a-f]{64}$/u.test(manifestHash)
      && exactCycle
      && exactTarget
      && fresh
      && ["runtime", "governance", "runtime_persistence"].every((role) => roles.includes(role))
      && result?.secrets_included === false;
    if (!ready) {
      return blocked(ctx, "platform_recovery_backup_evidence_not_ready", "capture_and_verify_all_role_backup_evidence", {
        backup_verified: false,
        durable: result?.durable === true,
        exact_sha_bound: evidenceExpectedSha === ctx.expected_sha,
        exact_cycle_bound: exactCycle,
        exact_target_bound: exactTarget,
        evidence_hash_valid: /^[0-9a-f]{64}$/u.test(evidenceSha),
        artifact_manifest_hash_valid: /^[0-9a-f]{64}$/u.test(manifestHash),
        storage_readback_verified: result?.storage_readback_verified === true,
        restore_test_verified: result?.restore_test_verified === true,
        fresh,
        roles,
      });
    }
    return bound(ctx, {
      status: "pass",
      contract: PRODUCTION_RECOVERY_BACKUP_EVIDENCE_CONTRACT,
      backup_verified: true,
      verified: true,
      durable: true,
      exact_sha_bound: true,
      exact_cycle_bound: true,
      exact_target_bound: true,
      expected_sha: ctx.expected_sha,
      roles,
      evidence_sha256: evidenceSha,
      evidence_ref: result.evidence_ref || result.backup_evidence_ref || null,
      created_at: createdAt,
      storage_readback_verified: true,
      restore_test_verified: true,
      artifact_manifest_hash: manifestHash,
      target_fingerprint: targetFingerprint,
      cycle_id: ctx.run_id,
      readback_verified: true,
    });
  };

  const roleBaseline = (role, reader) => async (ctx) => {
    const missing = requireReader(
      reader,
      ctx,
      `platform_recovery_${role}_baseline_readback_unavailable`,
      `configure_${role}_baseline_readback`,
    );
    if (missing) return missing;
    const result = await reader({ expected_sha: ctx.expected_sha, target_key: "production-runtime", role });
    const ready = result?.baseline_ready === true || result?.ready === true;
    if (ready) {
      return bound(ctx, { status: "pass", baseline_ready: true, readback_verified: true });
    }

    if (role === "runtime_persistence") {
      const inspection = Array.isArray(ctx.prior_steps)
        ? ctx.prior_steps.find((entry) => entry?.key === "database_full_inspection")?.result
        : null;
      const roleEvidence = inspection?.roles?.runtime_persistence || {};
      const readiness = inspection?.checks?.runtime_persistence_ready;

      if (
        roleEvidence.classification === "nonempty_objects"
        && Number.isInteger(Number(roleEvidence.object_count_total))
        && Number(roleEvidence.object_count_total) > 0
        && roleEvidence.zero_object === false
        && readiness === false
      ) {
        return blocked(
          ctx,
          "platform_recovery_runtime_persistence_partial_schema_drift_requires_remediation_plan",
          "create_recovery_kernel_remediation_plan_for_runtime_persistence_schema_repair",
          {
            registered_capability: "runtime_persistence.schema.repair",
            direct_migration_first_forbidden: true,
          },
        );
      }

      if (readiness === null || readiness === undefined) {
        return blocked(
          ctx,
          "platform_recovery_runtime_persistence_readiness_evidence_unavailable",
          "rerun_full_inspection_with_runtime_persistence_readiness",
        );
      }
    }

    return blocked(ctx, `platform_recovery_${role}_baseline_not_ready`, `repair_${role}_baseline_and_resume`);
  };

  executors.governance_baseline_verify = roleBaseline("governance", governanceBaselineReadinessReader);
  executors.runtime_persistence_baseline_verify = roleBaseline("runtime_persistence", runtimePersistenceBaselineReadinessReader);

  executors.canonical_grants_verify = async (ctx) => {
    const missing = requireReader(canonicalGrantsReadinessReader, ctx, "platform_recovery_grants_readback_unavailable", "configure_canonical_grants_readback");
    if (missing) return missing;
    const result = await canonicalGrantsReadinessReader({ expected_sha: ctx.expected_sha, target_key: "production-runtime" });
    return result?.grants_ready === true || result?.ready === true
      ? bound(ctx, { status: "pass", grants_ready: true, readback_verified: true })
      : blocked(ctx, "platform_recovery_grants_not_ready", "repair_canonical_grants_and_resume");
  };

  executors.bootstrap_ledger_verify = async (ctx) => {
    const missing = requireReader(bootstrapLedgerReadinessReader, ctx, "platform_recovery_bootstrap_ledger_readback_unavailable", "configure_bootstrap_ledger_readback");
    if (missing) return missing;
    const result = await bootstrapLedgerReadinessReader({ expected_sha: ctx.expected_sha, target_key: "production-runtime" });
    return result?.bootstrap_ledger_ready === true || result?.ready === true
      ? bound(ctx, { status: "pass", bootstrap_ledger_ready: true, readback_verified: true })
      : blocked(ctx, "platform_recovery_bootstrap_ledger_not_ready", "repair_bootstrap_ledger_and_resume");
  };

  executors.mcp_catalog_verify = async (ctx) => {
    const missing = requireReader(mcpCatalogReadinessReader, ctx, "platform_recovery_mcp_catalog_readback_unavailable", "configure_mcp_catalog_readback");
    if (missing) return missing;
    const result = await mcpCatalogReadinessReader({ expected_sha: ctx.expected_sha, target_key: "production-runtime" });
    const ready = result?.mcp_catalog_level_ready === true || result?.ready === true;
    return ready
      ? bound(ctx, { status: "pass", mcp_catalog_level_ready: true, readback_verified: true })
      : blocked(ctx, "platform_recovery_mcp_catalog_not_ready", "apply_registered_mcp_catalog_repair_and_resume");
  };

  executors.admin_tools_functional_readback = async (ctx) => {
    const missing = requireReader(adminToolsReadbackReader, ctx, "platform_recovery_admin_tools_reader_unavailable", "configure_admin_tools_functional_readback");
    if (missing) return missing;
    const result = await adminToolsReadbackReader({ expected_sha: ctx.expected_sha });
    const ready = result?.listAdminTools === true && result?.repo_inspect === true && result?.schema_contract_not_ready !== true;
    return ready
      ? bound(ctx, { status: "pass", listAdminTools: true, repo_inspect: true, schema_contract_not_ready: false, readback_verified: true })
      : blocked(ctx, "platform_recovery_admin_tools_not_ready", "repair_admin_catalog_and_resume", {
          listAdminTools: result?.listAdminTools === true,
          repo_inspect: result?.repo_inspect === true,
          schema_contract_not_ready: result?.schema_contract_not_ready === true,
        });
  };

  executors.device_tools_functional_readback = async (ctx) => {
    const missing = requireReader(deviceToolsReadbackReader, ctx, "platform_recovery_device_tools_reader_unavailable", "configure_device_tools_functional_readback");
    if (missing) return missing;
    const result = await deviceToolsReadbackReader({ expected_sha: ctx.expected_sha });
    const ready = result?.listDeviceTools === true && result?.schema_contract_not_ready !== true;
    return ready
      ? bound(ctx, { status: "pass", listDeviceTools: true, schema_contract_not_ready: false, readback_verified: true })
      : blocked(ctx, "platform_recovery_device_tools_not_ready", "repair_device_catalog_and_resume", {
          listDeviceTools: result?.listDeviceTools === true,
          schema_contract_not_ready: result?.schema_contract_not_ready === true,
        });
  };

  executors.production_activation_readiness = async (ctx) => {
    const missing = requireReader(productionActivationReadinessReader, ctx, "platform_recovery_activation_reader_unavailable", "configure_production_activation_readiness");
    if (missing) return missing;
    const result = await productionActivationReadinessReader();
    return result?.ready === true && result?.read_only_probe === true && result?.secrets_included === false
      ? bound(ctx, { status: "pass", ready: true, readback_verified: true })
      : blocked(ctx, "platform_recovery_activation_not_ready", "resolve_production_activation_readiness_and_resume");
  };

  executors.connector_auth_probe = async (ctx) => {
    const missing = requireReader(connectorAuthProbeReader, ctx, "platform_recovery_connector_probe_unavailable", "configure_bound_connector_auth_probe");
    if (missing) return missing;
    const result = await connectorAuthProbeReader({ expected_sha: ctx.expected_sha });
    const httpStatus = Number(result?.authenticated_operation_http_status || result?.http_status || 0);
    if (result?.auth_ready === true && httpStatus === 200) {
      return bound(ctx, { status: "pass", auth_ready: true, authenticated_operation_http_status: 200, failure_kind: null, request_id: result?.request_id || null });
    }
    let failureKind = text(result?.failure_kind, 96);
    if (!failureKind && httpStatus === 401) failureKind = "credential_invalid";
    if (!failureKind && httpStatus === 429) failureKind = "rate_limited";
    return bound(ctx, {
      status: "pass",
      auth_ready: false,
      authenticated_operation_http_status: httpStatus || null,
      failure_kind: failureKind || "connector_auth_not_ready",
      request_id: result?.request_id || null,
      retry_after_seconds: result?.retry_after_seconds ?? null,
      readback_verified: true,
    });
  };

  executors.local_manager_rate_limit_recovery = async (ctx) => {
    const missing = requireReader(localManagerRateLimitRecoveryReader, ctx, "platform_recovery_rate_limit_reader_unavailable", "configure_rate_limit_recovery_readback");
    if (missing) return missing;
    const result = await localManagerRateLimitRecoveryReader({ expected_sha: ctx.expected_sha, prior_steps: ctx.prior_steps });
    const contractReady = result?.http_status_checked_before_json === true
      && result?.retry_after_respected === true
      && result?.backoff_persisted === true
      && result?.rate_limit_source_attributed === true;
    if (!contractReady) {
      return blocked(ctx, "platform_recovery_rate_limit_recovery_not_ready", "repair_rate_limit_recovery_contract", {
        request_id: result?.request_id || null,
      });
    }
    const postFailureKind = text(result?.post_recovery_auth_failure_kind, 96) || null;
    if (["rate_limited", "edge_rate_limited", "proxy_rate_limited"].includes(postFailureKind)) {
      return bound(ctx, {
        ok: false,
        status: "degraded",
        error_code: "platform_recovery_external_rate_limit_still_active",
        next_safe_action: "resume_same_run_after_retry_after",
        http_status_checked_before_json: true,
        retry_after_respected: true,
        backoff_persisted: true,
        rate_limit_source_attributed: true,
        post_recovery_auth_failure_kind: postFailureKind,
        retry_after_seconds: result?.retry_after_seconds ?? null,
        request_id: result?.request_id || null,
        readback_verified: true,
      });
    }
    return bound(ctx, {
      status: "pass",
      http_status_checked_before_json: true,
      retry_after_respected: true,
      backoff_persisted: true,
      rate_limit_source_attributed: true,
      post_recovery_auth_failure_kind: postFailureKind,
      readback_verified: true,
    });
  };

  executors.connector_auth_verify = async (ctx) => {
    const result = await executors.connector_auth_probe(ctx);
    if (result?.auth_ready === true && Number(result?.authenticated_operation_http_status) === 200) {
      return result;
    }
    return blocked(ctx, "platform_recovery_connector_auth_not_ready", "resolve_connector_authentication_and_resume", {
      authenticated_operation_http_status: result?.authenticated_operation_http_status ?? null,
      auth_ready: false,
      failure_kind: result?.failure_kind || "connector_auth_not_ready",
      request_id: result?.request_id || null,
      retry_after_seconds: result?.retry_after_seconds ?? null,
    });
  };

  executors.deployment_parity = async (ctx) => {
    const parity = await deploymentParityReader(ctx.expected_sha);
    return parity.exact_sha_parity === true
      ? bound(ctx, { status: "pass", exact_sha_parity: true, version_readback: true, deployment_info_readback: true, readback_verified: true })
      : blocked(ctx, "platform_recovery_deployment_parity_failed", "restore_exact_production_sha_parity", {
          exact_sha_parity: false,
        });
  };

  return Object.freeze(executors);
}
