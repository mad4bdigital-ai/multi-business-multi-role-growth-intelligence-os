import { createHash, randomUUID } from "node:crypto";

function elapsedMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function responseSha256(response) {
  return createHash("sha256").update(JSON.stringify(response ?? null)).digest("hex");
}

function readinessCode(response) {
  return response?.items?.[0]?.readiness_code
    || response?.items?.[0]?.readinessCode
    || null;
}

async function insertObservation(executor, observation) {
  await executor.query(
    `INSERT INTO container_canary_observations (
       observation_id,canary_key,capability_key,request_id,rollout_mode,
       outcome,http_status,readiness_code,duration_ms,response_sha256,error_code,
       provider_call_made,credential_payload_read,external_write_made,secrets_included
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      observation.observationId,
      observation.canaryKey,
      observation.capabilityKey,
      observation.requestId,
      observation.rolloutMode,
      observation.outcome,
      observation.httpStatus,
      observation.readinessCode,
      observation.durationMs,
      observation.responseSha256,
      observation.errorCode,
      0,
      0,
      0,
      0
    ]
  );
}

export async function executeObservedReadOnlyCanary({
  executor,
  canaryKey,
  capabilityKey,
  requestId,
  execute
} = {}) {
  if (!executor?.query || typeof execute !== "function") {
    throw Object.assign(new Error("A SQL executor and execute callback are required."),{
      code:"container_canary_runtime_executor_required",
      status:500
    });
  }

  const [canaryRows] = await executor.query(
    `SELECT canary_key,capability_key,rollout_mode,status
       FROM container_shadow_canary_registry
      WHERE canary_key=? AND capability_key=? AND status='active'
      LIMIT 1`,
    [canaryKey,capabilityKey]
  );
  const canary = canaryRows?.[0];
  if (!canary || String(canary.rollout_mode) !== "read_only_canary") {
    return {
      response:await execute(),
      observation:null,
      canaryApplied:false,
      secretsIncluded:false
    };
  }

  const startedAt = process.hrtime.bigint();
  let transactionStarted = false;
  try {
    if (executor.beginTransaction) {
      await executor.beginTransaction();
      transactionStarted = true;
    }
    const [lockedRows] = await executor.query(
      `SELECT canary_key,capability_key,rollout_mode,status
         FROM container_shadow_canary_registry
        WHERE canary_key=? AND capability_key=? AND status='active'
        LIMIT 1 FOR UPDATE`,
      [canaryKey,capabilityKey]
    );
    const locked = lockedRows?.[0];
    if (!locked || String(locked.rollout_mode) !== "read_only_canary") {
      const response = await execute();
      if (transactionStarted && executor.commit) await executor.commit();
      return { response,observation:null,canaryApplied:false,secretsIncluded:false };
    }

    const response = await execute();
    const observation = {
      observationId:randomUUID(),
      canaryKey:String(locked.canary_key),
      capabilityKey:String(locked.capability_key),
      requestId:String(requestId || randomUUID()),
      rolloutMode:"read_only_canary",
      outcome:"success",
      httpStatus:200,
      readinessCode:readinessCode(response),
      durationMs:Number(elapsedMilliseconds(startedAt).toFixed(3)),
      responseSha256:responseSha256(response),
      errorCode:null
    };
    await insertObservation(executor,observation);
    if (transactionStarted && executor.commit) await executor.commit();
    return {
      response,
      observation,
      canaryApplied:true,
      providerCalls:false,
      credentialPayloadReads:false,
      externalWrites:false,
      secretsIncluded:false
    };
  } catch (error) {
    if (transactionStarted && executor.rollback) await executor.rollback().catch(() => null);
    const observation = {
      observationId:randomUUID(),
      canaryKey:String(canary.canary_key),
      capabilityKey:String(canary.capability_key),
      requestId:String(requestId || randomUUID()),
      rolloutMode:"read_only_canary",
      outcome:"error",
      httpStatus:Number(error?.status || 500),
      readinessCode:null,
      durationMs:Number(elapsedMilliseconds(startedAt).toFixed(3)),
      responseSha256:null,
      errorCode:String(error?.code || "container_canary_runtime_error")
    };
    try { await insertObservation(executor,observation); } catch { /* preserve the original failure */ }
    throw error;
  }
}

export const _testingDynamicContainerCanaryRuntime = {
  elapsedMilliseconds,
  responseSha256,
  readinessCode
};
