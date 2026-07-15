import assert from "node:assert/strict";
import { executeObservedReadOnlyCanary } from "./dynamicContainerCanaryRuntime.js";

const CANARY_KEY="container_authority_rollout_readiness_v1";
const CAPABILITY_KEY="getContainerAuthorityRolloutReadiness";
const response={ ok:true,items:[{ readiness_code:"ready_for_review" }],secretsIncluded:false };

function executorFor({ initialMode="shadow",lockedMode=initialMode,insertFailure=false } = {}) {
  const calls=[];
  const observations=[];
  return {
    calls,
    observations,
    beginTransaction:async () => calls.push("begin"),
    commit:async () => calls.push("commit"),
    rollback:async () => calls.push("rollback"),
    query:async (sql,params=[]) => {
      calls.push(sql);
      if(sql.includes("FROM container_shadow_canary_registry") && sql.includes("LIMIT 1 FOR UPDATE")) {
        return [[{ canary_key:CANARY_KEY,capability_key:CAPABILITY_KEY,rollout_mode:lockedMode,status:"active" }]];
      }
      if(sql.includes("FROM container_shadow_canary_registry")) {
        return [[{ canary_key:CANARY_KEY,capability_key:CAPABILITY_KEY,rollout_mode:initialMode,status:"active" }]];
      }
      if(sql.startsWith("INSERT INTO container_canary_observations")) {
        if(insertFailure) throw Object.assign(new Error("observation insert failed"),{ code:"observation_insert_failed" });
        observations.push({
          observationId:params[0],canaryKey:params[1],capabilityKey:params[2],requestId:params[3],
          rolloutMode:params[4],outcome:params[5],httpStatus:params[6],readinessCode:params[7],
          durationMs:params[8],responseSha256:params[9],errorCode:params[10]
        });
        return [{ affectedRows:1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

const shadowExecutor=executorFor({ initialMode:"shadow" });
let shadowExecuteCount=0;
const shadowResult=await executeObservedReadOnlyCanary({
  executor:shadowExecutor,
  canaryKey:CANARY_KEY,
  capabilityKey:CAPABILITY_KEY,
  requestId:"request-shadow",
  execute:async () => { shadowExecuteCount += 1; return response; }
});
assert.equal(shadowExecuteCount,1);
assert.equal(shadowResult.canaryApplied,false);
assert.equal(shadowResult.observation,null);
assert.equal(shadowExecutor.observations.length,0);
assert(!shadowExecutor.calls.includes("begin"));

const successExecutor=executorFor({ initialMode:"read_only_canary" });
const successResult=await executeObservedReadOnlyCanary({
  executor:successExecutor,
  canaryKey:CANARY_KEY,
  capabilityKey:CAPABILITY_KEY,
  requestId:"request-success",
  execute:async () => response
});
assert.equal(successResult.canaryApplied,true);
assert.equal(successResult.observation.outcome,"success");
assert.equal(successResult.observation.readinessCode,"ready_for_review");
assert.match(successResult.observation.responseSha256,/^[a-f0-9]{64}$/);
assert.equal(successResult.providerCalls,false);
assert.equal(successResult.credentialPayloadReads,false);
assert.equal(successResult.externalWrites,false);
assert.equal(successExecutor.observations.length,1);
assert.equal(successExecutor.observations[0].requestId,"request-success");
assert.equal(successExecutor.observations[0].outcome,"success");
assert.deepEqual(successExecutor.calls.filter(value => ["begin","commit","rollback"].includes(value)),["begin","commit"]);

const modeChangedExecutor=executorFor({ initialMode:"read_only_canary",lockedMode:"shadow" });
const modeChangedResult=await executeObservedReadOnlyCanary({
  executor:modeChangedExecutor,
  canaryKey:CANARY_KEY,
  capabilityKey:CAPABILITY_KEY,
  requestId:"request-mode-changed",
  execute:async () => response
});
assert.equal(modeChangedResult.canaryApplied,false);
assert.equal(modeChangedExecutor.observations.length,0);
assert.deepEqual(modeChangedExecutor.calls.filter(value => ["begin","commit","rollback"].includes(value)),["begin","commit"]);

const errorExecutor=executorFor({ initialMode:"read_only_canary" });
await assert.rejects(
  executeObservedReadOnlyCanary({
    executor:errorExecutor,
    canaryKey:CANARY_KEY,
    capabilityKey:CAPABILITY_KEY,
    requestId:"request-error",
    execute:async () => { throw Object.assign(new Error("readiness failed"),{ code:"readiness_failed",status:503 }); }
  }),
  error => error.code === "readiness_failed" && error.status === 503
);
assert.equal(errorExecutor.observations.length,1);
assert.equal(errorExecutor.observations[0].outcome,"error");
assert.equal(errorExecutor.observations[0].httpStatus,503);
assert.equal(errorExecutor.observations[0].errorCode,"readiness_failed");
assert.deepEqual(errorExecutor.calls.filter(value => ["begin","commit","rollback"].includes(value)),["begin","rollback"]);

const insertFailureExecutor=executorFor({ initialMode:"read_only_canary",insertFailure:true });
await assert.rejects(
  executeObservedReadOnlyCanary({
    executor:insertFailureExecutor,
    canaryKey:CANARY_KEY,
    capabilityKey:CAPABILITY_KEY,
    requestId:"request-insert-failure",
    execute:async () => response
  }),
  error => error.code === "observation_insert_failed"
);
assert.deepEqual(insertFailureExecutor.calls.filter(value => ["begin","commit","rollback"].includes(value)),["begin","rollback"]);

console.log("dynamic container runtime canary observation contracts passed");
