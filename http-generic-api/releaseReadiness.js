import { runReleaseReadiness as runCoreReleaseReadiness } from "./releaseReadinessCore.js";
import {
  GOVERNANCE_DB_WRITE_AUTHORITY_DEGRADED,
  getGovernanceDbWriteReadiness,
} from "./governanceDbWriteReadiness.js";

export * from "./releaseReadinessCore.js";

function governanceDbWriteAuthorityCheck(readiness = {}) {
  const ready = readiness?.status === "ready";
  return {
    ...readiness,
    status: ready ? "pass" : "fail",
    runtime_classification: ready ? "active" : "degraded",
    reason_code: ready ? null : (readiness?.error_code || GOVERNANCE_DB_WRITE_AUTHORITY_DEGRADED),
    detail: ready
      ? "Governance DB writer authority is configured with the complete reviewed table-scoped privilege matrix."
      : "Governance DB writer authority is degraded; governed persistence must fail closed until the dedicated writer identity and exact table-scoped grants are ready.",
    executes_tools: false,
    provider_calls: false,
    mutations_executed: false,
    raw_grants_included: false,
    secrets_included: false,
  };
}

function appendGovernanceSummary(report, check) {
  const previous = report.summary;
  if (!previous || typeof previous !== "object") return;
  const passDelta = check.status === "pass" ? 1 : 0;
  const failDelta = check.status === "fail" ? 1 : 0;
  report.summary = {
    ...previous,
    total: Number(previous.total || 0) + 1,
    pass: Number(previous.pass || 0) + passDelta,
    fail: Number(previous.fail || 0) + failDelta,
    governance_db_write_authority_status: check.status,
    governance_db_write_authority_runtime_classification: check.runtime_classification,
    governance_db_write_authority_missing_count: check.missing_count ?? null,
    governance_db_write_authority_prohibited_grant_count: check.prohibited_grant_count ?? null,
    governance_db_write_authority_configured: check.configured === true,
    governance_db_write_authority_connection_ready: check.connection_ready === true,
    secrets_included: false,
  };
}

export async function runReleaseReadiness(options = {}) {
  const report = await runCoreReleaseReadiness(options);
  const readiness = await getGovernanceDbWriteReadiness();
  const check = governanceDbWriteAuthorityCheck(readiness);

  report.governance_db_write_authority = check;
  if (check.status === "fail") report.overall = "fail";
  appendGovernanceSummary(report, check);

  return report;
}

export const _testingGovernanceDbReleaseReadiness = Object.freeze({
  governanceDbWriteAuthorityCheck,
  appendGovernanceSummary,
});
