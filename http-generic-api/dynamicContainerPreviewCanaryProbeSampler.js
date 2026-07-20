import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { executeObservedReadOnlyCanary } from "./dynamicContainerCanaryRuntime.js";
import { resolveContainerContextWithExecutor } from "./dynamicContainerResolverExecutor.js";

const CANARY_KEY = "container_authority_preview_resolution_v1";
const CAPABILITY_KEY = "createContainerContextResolution";

function samplerError(code,message,details=[]) {
  const error=new Error(message);
  error.code=code;
  error.status=code === "dynamic_container_preview_canary_unavailable" ? 409
    : code === "dynamic_container_preview_canary_readback_failed" ? 500
      : 422;
  error.details=details;
  return error;
}

async function loadEligibleCases(executor) {
  const [rows]=await executor.query(
    `SELECT DISTINCT
       b.binding_id,b.tenant_id,b.container_id,b.dimension_key,b.resource_type,b.resource_ref,
       b.permission_key,a.principal_type,a.principal_id
     FROM container_resource_bindings b
     JOIN containers target
       ON target.container_id=b.container_id
      AND target.tenant_id=b.tenant_id
      AND target.status='active'
     JOIN container_role_assignments a
       ON a.tenant_id=b.tenant_id
      AND a.status='active'
      AND a.principal_type IN ('user','service','agent')
      AND (a.valid_from IS NULL OR a.valid_from<=UTC_TIMESTAMP())
      AND (a.valid_until IS NULL OR a.valid_until>UTC_TIMESTAMP())
     JOIN containers assignment_container
       ON assignment_container.container_id=a.container_id
      AND assignment_container.tenant_id=a.tenant_id
      AND assignment_container.status='active'
     LEFT JOIN container_role_template_registry role_template
       ON role_template.role_template_key=a.role_template_key
      AND role_template.status='active'
     WHERE b.status='active'
       AND (b.valid_from IS NULL OR b.valid_from<=UTC_TIMESTAMP())
       AND (b.valid_until IS NULL OR b.valid_until>UTC_TIMESTAMP())
       AND b.permission_key IS NOT NULL
       AND b.permission_key<>''
       AND b.permission_key<>'*'
       AND (
         a.role_template_key IS NULL
         OR role_template.role_template_key IS NOT NULL
       )
     ORDER BY b.tenant_id,b.binding_id,a.principal_type,a.principal_id
     LIMIT 500`
  );
  return rows.map(row => ({
    bindingId:String(row.binding_id),
    tenantId:String(row.tenant_id),
    targetContainerId:String(row.container_id),
    principal:{ type:String(row.principal_type),id:String(row.principal_id) },
    dimensionRequest:{
      dimension:String(row.dimension_key),
      resourceType:String(row.resource_type),
      resourceRef:String(row.resource_ref),
      operation:String(row.permission_key),
      capabilityKey:CAPABILITY_KEY
    }
  }));
}

async function readProbeEvidence(executor,runId) {
  const prefix=`dynamic-container-preview-canary-probe:${runId}:%`;
  const [[row]]=await executor.query(
    `SELECT
       COUNT(o.observation_id) AS observation_count,
       SUM(o.outcome='success') AS success_count,
       SUM(o.outcome='error') AS failure_count,
       COUNT(l.resolution_id) AS resolution_count,
       SUM(l.decision='allow') AS allow_count,
       SUM(l.decision='deny') AS deny_count,
       SUM(l.decision='restrict') AS restrict_count,
       SUM(l.decision='ambiguous') AS ambiguous_count,
       ROUND(AVG(o.duration_ms),3) AS average_latency_ms,
       MAX(o.duration_ms) AS maximum_latency_ms,
       ROUND(100.0 * SUM(
         o.provider_call_made=0
         AND o.credential_payload_read=0
         AND o.external_write_made=0
         AND o.secrets_included=0
       ) / NULLIF(COUNT(o.observation_id),0),4) AS audit_coverage_percent
     FROM container_canary_observations o
     LEFT JOIN container_effective_context_ledger l
       ON l.request_id=o.request_id
      AND l.mode='preview'
     WHERE o.request_id LIKE ?`,
    [prefix]
  );
  return {
    observationCount:Number(row?.observation_count || 0),
    successCount:Number(row?.success_count || 0),
    failureCount:Number(row?.failure_count || 0),
    resolutionCount:Number(row?.resolution_count || 0),
    allowCount:Number(row?.allow_count || 0),
    denyCount:Number(row?.deny_count || 0),
    restrictCount:Number(row?.restrict_count || 0),
    ambiguousCount:Number(row?.ambiguous_count || 0),
    averageLatencyMs:Number(row?.average_latency_ms || 0),
    maximumLatencyMs:Number(row?.maximum_latency_ms || 0),
    auditCoveragePercent:Number(row?.audit_coverage_percent || 0)
  };
}

export async function runDynamicContainerPreviewCanaryProbeSampler(input={},dependencies={}) {
  const sampleCount=Number(input.sampleCount ?? input.sample_count ?? 100);
  if(!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 100) {
    throw samplerError(
      "dynamic_container_preview_canary_sample_count_invalid",
      "sampleCount must be an integer between 1 and 100.",
      [{ field:"sampleCount",issue:"out_of_range" }]
    );
  }
  const executor=dependencies.executor || dependencies.pool || getPool();
  const loadCases=dependencies.loadCases || loadEligibleCases;
  const executeObserved=dependencies.executeObserved || executeObservedReadOnlyCanary;
  const resolvePreview=dependencies.resolvePreview || resolveContainerContextWithExecutor;
  const readEvidence=dependencies.readEvidence || readProbeEvidence;
  const runId=dependencies.runId || randomUUID();
  const cases=await loadCases(executor);
  if(!cases.length) {
    throw samplerError(
      "dynamic_container_preview_canary_cases_unavailable",
      "No active container bindings and principals are available for preview canary probes."
    );
  }

  const failures=[];
  let completedCount=0;
  for(let index=0; index<sampleCount; index += 1) {
    const candidate=cases[index % cases.length];
    const requestId=`dynamic-container-preview-canary-probe:${runId}:${index + 1}`;
    try {
      const result=await executeObserved({
        executor,
        canaryKey:CANARY_KEY,
        capabilityKey:CAPABILITY_KEY,
        requestId,
        execute:() => resolvePreview({
          principal:candidate.principal,
          tenantId:candidate.tenantId,
          targetContainerId:candidate.targetContainerId,
          dimensionRequests:[candidate.dimensionRequest],
          mode:"preview",
          legacyDecision:"unknown",
          legacyEvidenceRef:`dynamic-container-preview-canary-probe:${runId}:${candidate.bindingId}`,
          requestId,
          idempotencyKey:`preview-canary-${runId}-${index + 1}`
        },executor)
      });
      if(!result?.canaryApplied || !result?.observation || result.observation.outcome !== "success") {
        throw samplerError(
          "dynamic_container_preview_canary_unavailable",
          "The preview resolution canary is not active in read_only_canary mode."
        );
      }
      completedCount += 1;
    } catch(error) {
      failures.push({
        sampleIndex:index + 1,
        code:String(error?.code || "dynamic_container_preview_canary_probe_failed")
      });
    }
  }

  const evidence=await readEvidence(executor,runId);
  const readbackOk=failures.length === 0
    && completedCount === sampleCount
    && evidence.observationCount === sampleCount
    && evidence.successCount === sampleCount
    && evidence.failureCount === 0
    && evidence.resolutionCount === sampleCount
    && evidence.auditCoveragePercent === 100;
  if(!readbackOk) {
    throw samplerError(
      "dynamic_container_preview_canary_readback_failed",
      "Preview canary probes completed without matching same-cycle observation and resolution evidence.",
      [{
        runId,
        requestedSampleCount:sampleCount,
        completedCount,
        failureCount:failures.length,
        evidence,
        failures
      }]
    );
  }

  return {
    ok:true,
    runId,
    targetCanaryKey:CANARY_KEY,
    capabilityKey:CAPABILITY_KEY,
    requestedSampleCount:sampleCount,
    completedSampleCount:completedCount,
    distinctCaseCount:cases.length,
    evidence,
    providerCalls:false,
    credentialPayloadReads:false,
    externalWrites:false,
    enforcementApplied:false,
    secretsIncluded:false
  };
}

export const _testingDynamicContainerPreviewCanaryProbeSampler={
  loadEligibleCases,
  readProbeEvidence
};
