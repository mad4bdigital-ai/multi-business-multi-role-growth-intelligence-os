import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { executeObservedReadOnlyCanary } from "./dynamicContainerCanaryRuntime.js";

const DEFAULT_CANARY_KEY = "container_authority_rollout_readiness_v1";
const DEFAULT_CAPABILITY_KEY = "getContainerAuthorityRolloutReadiness";

function samplerError(code,message,details=[]) {
  const error=new Error(message);
  error.code=code;
  error.status=code === "dynamic_container_canary_probe_unavailable" ? 409 : code === "dynamic_container_canary_probe_readback_failed" ? 500 : 422;
  error.details=details;
  return error;
}

async function readProbeEvidence(executor, runId) {
  const prefix=`dynamic-container-canary-probe-sampler:${runId}:%`;
  const [[row]]=await executor.query(
    `SELECT
       COUNT(*) AS observation_count,
       SUM(outcome='success') AS success_count,
       SUM(outcome='error') AS failure_count,
       ROUND(AVG(duration_ms),3) AS average_latency_ms,
       MAX(duration_ms) AS maximum_latency_ms,
       ROUND(100.0 * SUM(
         provider_call_made=0
         AND credential_payload_read=0
         AND external_write_made=0
         AND secrets_included=0
       ) / NULLIF(COUNT(*),0),4) AS audit_coverage_percent,
       SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(readiness_code,'') ORDER BY created_at DESC SEPARATOR ','),',',1) AS last_readiness_code
     FROM container_canary_observations
     WHERE request_id LIKE ?`,
    [prefix]
  );
  return {
    observationCount:Number(row?.observation_count || 0),
    successCount:Number(row?.success_count || 0),
    failureCount:Number(row?.failure_count || 0),
    averageLatencyMs:Number(row?.average_latency_ms || 0),
    maximumLatencyMs:Number(row?.maximum_latency_ms || 0),
    auditCoveragePercent:Number(row?.audit_coverage_percent || 0),
    lastReadinessCode:row?.last_readiness_code || null
  };
}

export async function runDynamicContainerCanaryProbeSampler(input={},dependencies={}) {
  const sampleCount=Number(input.sampleCount ?? input.sample_count ?? 100);
  if(!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 100) {
    throw samplerError(
      "dynamic_container_canary_probe_sample_count_invalid",
      "sampleCount must be an integer between 1 and 100.",
      [{ field:"sampleCount",issue:"out_of_range" }]
    );
  }
  const canaryKey=String(input.targetCanaryKey || input.target_canary_key || DEFAULT_CANARY_KEY);
  if(canaryKey !== DEFAULT_CANARY_KEY) {
    throw samplerError(
      "dynamic_container_canary_probe_target_invalid",
      "Only the rollout-readiness read-only canary is supported by this sampler.",
      [{ field:"targetCanaryKey",issue:"unsupported_value" }]
    );
  }

  const executor=dependencies.executor || dependencies.pool || getPool();
  const executeObserved=dependencies.executeObserved || executeObservedReadOnlyCanary;
  const readEvidence=dependencies.readEvidence || readProbeEvidence;
  const runId=dependencies.runId || randomUUID();
  const failures=[];
  let completedCount=0;

  for(let index=0; index<sampleCount; index += 1) {
    const requestId=`dynamic-container-canary-probe-sampler:${runId}:${index + 1}`;
    try {
      const result=await executeObserved({
        executor,
        canaryKey,
        capabilityKey:DEFAULT_CAPABILITY_KEY,
        requestId,
        execute:async () => {
          const [rows]=await executor.query("SELECT * FROM v_container_rollout_readiness ORDER BY policy_key");
          return { ok:true,items:rows,secretsIncluded:false };
        }
      });
      if(!result?.canaryApplied || !result?.observation || result.observation.outcome !== "success") {
        throw samplerError(
          "dynamic_container_canary_probe_unavailable",
          "The target canary is not active in read_only_canary mode."
        );
      }
      completedCount += 1;
    } catch(error) {
      failures.push({
        sampleIndex:index + 1,
        code:String(error?.code || "dynamic_container_canary_probe_failed")
      });
    }
  }

  const evidence=await readEvidence(executor,runId);
  const readbackOk=failures.length === 0
    && completedCount === sampleCount
    && evidence.observationCount === sampleCount
    && evidence.successCount === sampleCount
    && evidence.failureCount === 0
    && evidence.auditCoveragePercent === 100;
  if(!readbackOk) {
    throw samplerError(
      "dynamic_container_canary_probe_readback_failed",
      "Canary probe sampler completed without matching same-cycle observation evidence.",
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
    targetCanaryKey:canaryKey,
    capabilityKey:DEFAULT_CAPABILITY_KEY,
    requestedSampleCount:sampleCount,
    completedSampleCount:completedCount,
    evidence,
    providerCalls:false,
    credentialPayloadReads:false,
    externalWrites:false,
    enforcementApplied:false,
    secretsIncluded:false
  };
}

export const _testingDynamicContainerCanaryProbeSampler={ readProbeEvidence };
