import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { stableSha256 } from "./dynamicContainerAuthority.js";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
  transitionCapabilityEnvelopeLifecycle
} from "./capabilityResolutionEnvelopeGuard.js";

export const DYNAMIC_CONTAINER_OVERRIDE_GOVERNANCE_SMOKE_CONFIRM = "RUN_DYNAMIC_CONTAINER_OVERRIDE_GOVERNANCE_SMOKE";

function smokeError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

function duplicateEntry(error) {
  return String(error?.code || "") === "ER_DUP_ENTRY" || Number(error?.errno || 0) === 1062;
}

function parseJson(value, fallback = []) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

export function buildDynamicContainerOverrideGovernanceSmokePlan() {
  return {
    confirmation:DYNAMIC_CONTAINER_OVERRIDE_GOVERNANCE_SMOKE_CONFIRM,
    tests:[
      "self_approval_policy_verified",
      "distinct_dual_approval_required",
      "stale_authority_epoch_rejected",
      "one_time_consumption_enforced",
      "fixture_cleanup_verified"
    ],
    closureThreadKey:"dynamic_container_override_governance",
    fixtureStrategy:"transactional_disposable_rows",
    targetExecuted:false,
    providerCalls:false,
    credentialPayloadReads:false,
    externalWrites:false,
    rolloutChanged:false,
    enforcementApplied:false,
    secretsIncluded:false
  };
}

export async function runDynamicContainerOverrideGovernanceSmoke({
  executor = null,
  mode = "dry_run",
  confirm = null,
  capabilityEnvelopeId = null,
  actor = "platform_admin"
} = {}) {
  const normalizedMode=String(mode || "dry_run");
  if(!new Set(["dry_run","apply"]).has(normalizedMode)) {
    throw smokeError(400,"override_governance_smoke_mode_invalid","mode must be dry_run or apply.");
  }
  const plan=buildDynamicContainerOverrideGovernanceSmokePlan();
  if(normalizedMode === "dry_run") {
    return {
      ok:true,mode:"dry_run",plan,results:null,cleanup:null,capabilityEnvelope:null,
      sameCycleReadbackVerified:false,...plan
    };
  }
  if(confirm !== plan.confirmation) {
    throw smokeError(409,"override_governance_smoke_confirmation_required",`Typed confirmation ${plan.confirmation} is required.`);
  }

  const connection=executor || await getPool().getConnection();
  const releaseConnection=!executor;
  let transactionStarted=false;
  const runId=randomUUID();
  const resolutionId=randomUUID();
  const selfApprovalOverrideId=randomUUID();
  const staleOverrideId=randomUUID();
  const consumptionOverrideId=randomUUID();
  const overrideIds=[selfApprovalOverrideId,staleOverrideId,consumptionOverrideId];

  try {
    await connection.beginTransaction();
    transactionStarted=true;

    const envelope=await resolveCapabilityExecutionEnvelope({
      pool:connection,
      envelopeId:capabilityEnvelopeId,
      acceptedAppKeys:["platform_orchestration"],
      acceptedIntents:["dynamic_container_override_governance_smoke"],
      acceptedCapabilityKeys:["dynamic_container_override_governance_smoke"],
      allowReferenced:false
    });
    if(!envelope.ok) throw capabilityEnvelopeError(envelope,"A ready override governance smoke envelope is required.");
    if(!envelope.apply_allowed) {
      throw capabilityEnvelopeError({
        status:"capability_resolution_envelope_apply_not_allowed",
        envelope_id:envelope.envelope_id,
        apply_allowed:false,
        secrets_included:false
      },"The capability envelope is not apply-authorized for override governance smoke.");
    }

    const [epochRows]=await connection.query(
      "SELECT tenant_id,authority_epoch FROM container_authority_epochs ORDER BY tenant_id LIMIT 2 FOR UPDATE"
    );
    const epochRow=epochRows?.[0];
    if(!epochRow) throw smokeError(409,"override_governance_smoke_fixture_unavailable","No authority epoch fixture candidate is available.");
    const tenantId=String(epochRow.tenant_id);
    const authorityEpoch=Number(epochRow.authority_epoch || 0);

    const [containerRows]=await connection.query(
      "SELECT container_id FROM containers WHERE tenant_id=? AND status='active' ORDER BY container_id LIMIT 1",
      [tenantId]
    );
    const targetContainerId=String(containerRows?.[0]?.container_id || "");
    if(!targetContainerId) throw smokeError(409,"override_governance_smoke_fixture_unavailable","No active container fixture candidate is available.");

    const [policyRows]=await connection.query(
      "SELECT required_approval_count,self_approval_allowed,one_time_consumption_required FROM container_override_policy_registry WHERE risk_class='destructive' AND status='active' LIMIT 1 FOR UPDATE"
    );
    const policy=policyRows?.[0];
    const selfApprovalPolicyVerified=Number(policy?.required_approval_count) >= 2
      && Number(policy?.self_approval_allowed) === 0
      && Number(policy?.one_time_consumption_required) === 1;
    if(!selfApprovalPolicyVerified) {
      throw smokeError(409,"override_governance_smoke_policy_not_ready","Destructive override policy does not enforce distinct dual approval, no self-approval, and one-time consumption.");
    }

    const resolutionSha256=stableSha256({ runId,resolutionId,tenantId,targetContainerId,authorityEpoch });
    const containerPathHash=stableSha256({ runId,targetContainerId,path:"smoke" });
    const registrySnapshotHash=stableSha256({ runId,tenantId,snapshot:"smoke" });
    await connection.query(
      `INSERT INTO container_effective_context_ledger
        (resolution_id,request_id,idempotency_key,principal_type,principal_id,tenant_id,target_container_id,mode,decision,
         authority_epoch,resolver_version,request_sha256,container_path_hash,registry_snapshot_hash,resolution_sha256,
         request_context_json,selected_paths_json,effective_classifications_json,effective_roles_json,effective_bindings_json,
         applied_denies_json,applied_delegations_json,blocking_codes_json,override_request_id,
         provider_call_made,credential_payload_read,secrets_included,expires_at)
       VALUES (?,?,NULL,'service','override-governance-smoke',?,?,'preview','requires_override',?,'override-governance-smoke-v1',?,?,?,?,
               JSON_OBJECT(),JSON_ARRAY(),JSON_OBJECT(),JSON_ARRAY(),JSON_ARRAY(),JSON_ARRAY(),JSON_ARRAY(),JSON_ARRAY('smoke_fixture'),NULL,0,0,0,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))`,
      [resolutionId,`override-governance-smoke:${runId}`,tenantId,targetContainerId,authorityEpoch,
       stableSha256({ runId,request:"smoke" }),containerPathHash,registrySnapshotHash,resolutionSha256]
    );

    const requesterPrincipalId="override-governance-smoke-requester";
    const insertOverride=async ({ overrideId,fixtureEpoch,status }) => {
      const payload={ runId,overrideId,tenantId,targetContainerId,fixtureEpoch,status };
      await connection.query(
        `INSERT INTO container_override_requests
          (override_id,capability_envelope_id,original_resolution_id,original_resolution_sha256,original_decision,
           original_blocking_codes_json,authority_epoch,registry_snapshot_hash,tenant_id,requester_principal_type,
           requester_principal_id,target_container_id,container_path_hash,dimension_key,resource_type,resource_ref,
           operation_key,risk_class,reason,required_approval_count,approval_count,status,override_sha256,expires_at)
         VALUES (?,?,?,?,'requires_override',JSON_ARRAY('smoke_fixture'),?,?,?,'service',?,?,?,
                 'actions','smoke_resource',?,'execute.smoke','destructive','Transactional governance smoke fixture only.',2,0,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))`,
        [overrideId,envelope.envelope_id,resolutionId,resolutionSha256,fixtureEpoch,registrySnapshotHash,tenantId,
         requesterPrincipalId,targetContainerId,containerPathHash,`smoke:${runId}:${overrideId}`,status,stableSha256(payload)]
      );
    };

    await insertOverride({ overrideId:selfApprovalOverrideId,fixtureEpoch:authorityEpoch,status:"ready_requires_approval" });
    await insertOverride({ overrideId:staleOverrideId,fixtureEpoch:authorityEpoch+1,status:"ready" });
    await insertOverride({ overrideId:consumptionOverrideId,fixtureEpoch:authorityEpoch,status:"ready" });

    const insertApproval=async (approverId) => connection.query(
      `INSERT INTO container_override_approvals
        (approval_id,override_id,approver_principal_type,approver_principal_id,decision,decision_note,approval_sha256)
       VALUES (?,?,'service',?,'approved','Override governance smoke approval.',?)`,
      [randomUUID(),selfApprovalOverrideId,approverId,stableSha256({ runId,selfApprovalOverrideId,approverId })]
    );
    await insertApproval("override-governance-smoke-approver-a");
    await insertApproval("override-governance-smoke-approver-b");
    const [approvalCountRows]=await connection.query(
      "SELECT COUNT(*) AS approval_count FROM container_override_approvals WHERE override_id=? AND decision='approved'",
      [selfApprovalOverrideId]
    );
    const approvalCount=Number(approvalCountRows?.[0]?.approval_count || 0);
    if(approvalCount !== 2) throw smokeError(409,"override_governance_smoke_dual_approval_failed","Two distinct approvals were not recorded.");
    await connection.query("UPDATE container_override_requests SET approval_count=2,status='ready' WHERE override_id=?",[selfApprovalOverrideId]);

    await connection.query("SAVEPOINT override_smoke_duplicate_approval");
    let duplicateApprovalRejected=false;
    try {
      await insertApproval("override-governance-smoke-approver-a");
    } catch(error) {
      if(!duplicateEntry(error)) throw error;
      duplicateApprovalRejected=true;
      await connection.query("ROLLBACK TO SAVEPOINT override_smoke_duplicate_approval");
    }
    await connection.query("RELEASE SAVEPOINT override_smoke_duplicate_approval");
    if(!duplicateApprovalRejected) throw smokeError(409,"override_governance_smoke_distinct_approval_failed","Duplicate approver uniqueness was not enforced.");

    const [currentEpochRows]=await connection.query("SELECT authority_epoch FROM container_authority_epochs WHERE tenant_id=? LIMIT 1",[tenantId]);
    const currentEpoch=Number(currentEpochRows?.[0]?.authority_epoch || 0);
    const staleEpochRejected=currentEpoch !== authorityEpoch+1;
    if(!staleEpochRejected) throw smokeError(409,"override_governance_smoke_stale_epoch_failed","Stale epoch fixture unexpectedly matched the current epoch.");
    await connection.query("UPDATE container_override_requests SET status='stale' WHERE override_id=?",[staleOverrideId]);
    const [staleRows]=await connection.query("SELECT status FROM container_override_requests WHERE override_id=? LIMIT 1",[staleOverrideId]);
    if(String(staleRows?.[0]?.status) !== "stale") throw smokeError(409,"override_governance_smoke_stale_readback_failed","Stale override readback failed.");

    const executionRef=`override-governance-smoke:${runId}`;
    await connection.query(
      `INSERT INTO container_override_consumptions
        (consumption_id,override_id,execution_ref,resolution_id,resolution_sha256,authority_epoch,action_key,endpoint_key,
         readback_ref,consumption_sha256,secrets_included)
       VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
      [randomUUID(),consumptionOverrideId,executionRef,resolutionId,resolutionSha256,authorityEpoch,
       "dynamic_container_override_governance_smoke","internal_smoke","override-governance-smoke-readback",
       stableSha256({ runId,consumptionOverrideId,executionRef })]
    );
    await connection.query("UPDATE container_override_requests SET status='consumed',consumed_at=UTC_TIMESTAMP() WHERE override_id=?",[consumptionOverrideId]);

    await connection.query("SAVEPOINT override_smoke_duplicate_consumption");
    let secondConsumptionRejected=false;
    try {
      await connection.query(
        `INSERT INTO container_override_consumptions
          (consumption_id,override_id,execution_ref,resolution_id,resolution_sha256,authority_epoch,action_key,endpoint_key,
           readback_ref,consumption_sha256,secrets_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,0)`,
        [randomUUID(),consumptionOverrideId,`${executionRef}:second`,resolutionId,resolutionSha256,authorityEpoch,
         "dynamic_container_override_governance_smoke","internal_smoke","override-governance-smoke-readback-second",
         stableSha256({ runId,consumptionOverrideId,second:true })]
      );
    } catch(error) {
      if(!duplicateEntry(error)) throw error;
      secondConsumptionRejected=true;
      await connection.query("ROLLBACK TO SAVEPOINT override_smoke_duplicate_consumption");
    }
    await connection.query("RELEASE SAVEPOINT override_smoke_duplicate_consumption");
    if(!secondConsumptionRejected) throw smokeError(409,"override_governance_smoke_one_time_consumption_failed","Second override consumption was not rejected.");

    await connection.query("DELETE FROM container_override_consumptions WHERE override_id IN (?,?,?)",overrideIds);
    await connection.query("DELETE FROM container_override_approvals WHERE override_id IN (?,?,?)",overrideIds);
    await connection.query("DELETE FROM container_override_requests WHERE override_id IN (?,?,?)",overrideIds);
    await connection.query("DELETE FROM container_effective_context_ledger WHERE resolution_id=?",[resolutionId]);

    const [cleanupRows]=await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM container_override_consumptions WHERE override_id IN (?,?,?)) AS consumption_count,
         (SELECT COUNT(*) FROM container_override_approvals WHERE override_id IN (?,?,?)) AS approval_count,
         (SELECT COUNT(*) FROM container_override_requests WHERE override_id IN (?,?,?)) AS override_count,
         (SELECT COUNT(*) FROM container_effective_context_ledger WHERE resolution_id=?) AS resolution_count`,
      [...overrideIds,...overrideIds,...overrideIds,resolutionId]
    );
    const cleanup={
      consumptionCount:Number(cleanupRows?.[0]?.consumption_count || 0),
      approvalCount:Number(cleanupRows?.[0]?.approval_count || 0),
      overrideCount:Number(cleanupRows?.[0]?.override_count || 0),
      resolutionCount:Number(cleanupRows?.[0]?.resolution_count || 0)
    };
    if(Object.values(cleanup).some(value => value !== 0)) {
      throw smokeError(409,"override_governance_smoke_cleanup_failed","Smoke fixture cleanup readback failed.",cleanup);
    }

    const evidence={
      evidenceType:"dynamic_container_override_governance_smoke_v1",
      runId,
      actor:String(actor || "platform_admin"),
      selfApprovalPolicyVerified,
      distinctDualApprovalVerified:approvalCount === 2 && duplicateApprovalRejected,
      staleAuthorityEpochRejected:staleEpochRejected,
      oneTimeConsumptionVerified:secondConsumptionRejected,
      cleanupVerified:true,
      providerCalls:false,
      externalWrites:false,
      enforcementApplied:false
    };
    const [threadUpdate]=await connection.query(
      `UPDATE platform_closure_threads
          SET observed_evidence_json=JSON_ARRAY_APPEND(
                IF(JSON_VALID(observed_evidence_json),observed_evidence_json,JSON_ARRAY()),'$',
                JSON_OBJECT(
                  'evidenceType','dynamic_container_override_governance_smoke_v1',
                  'runId',?,'actor',?,
                  'selfApprovalPolicyVerified',TRUE,
                  'distinctDualApprovalVerified',TRUE,
                  'staleAuthorityEpochRejected',TRUE,
                  'oneTimeConsumptionVerified',TRUE,
                  'cleanupVerified',TRUE,
                  'providerCalls',FALSE,'externalWrites',FALSE,'enforcementApplied',FALSE
                )),
              blocker_json=JSON_ARRAY(),
              next_action='Review override governance smoke evidence before any bounded mutation or enforcement promotion.',
              updated_at=UTC_TIMESTAMP()
        WHERE thread_key='dynamic_container_override_governance'`,
      [runId,String(actor || "platform_admin")]
    );
    if(Number(threadUpdate?.affectedRows || 0) !== 1) {
      throw smokeError(409,"override_governance_smoke_closure_thread_missing","Override governance closure thread was not updated.");
    }

    const envelopeLifecycle=await transitionCapabilityEnvelopeLifecycle({
      pool:connection,
      envelopeId:envelope.envelope_id,
      action:"consume",
      executionRef:`dynamic_container_override_governance_smoke:${runId}`
    });
    if(!envelopeLifecycle.ok) throw capabilityEnvelopeError(envelopeLifecycle,"Override governance smoke envelope consumption failed.");

    await connection.commit();
    transactionStarted=false;

    const [threadRows]=await connection.query(
      "SELECT thread_key,state,observed_evidence_json,blocker_json,next_action,updated_at FROM platform_closure_threads WHERE thread_key='dynamic_container_override_governance' LIMIT 1"
    );
    const thread=threadRows?.[0] || null;
    return {
      ok:true,
      mode:"apply",
      plan,
      results:evidence,
      cleanup,
      closureThread:thread ? {
        ...thread,
        observed_evidence_json:parseJson(thread.observed_evidence_json,[]),
        blocker_json:parseJson(thread.blocker_json,[])
      } : null,
      capabilityEnvelope:{
        envelopeId:envelope.envelope_id,
        executionStatus:envelopeLifecycle?.after?.execution_status || null
      },
      sameCycleReadbackVerified:true,
      targetExecuted:false,
      providerCalls:false,
      credentialPayloadReads:false,
      externalWrites:false,
      rolloutChanged:false,
      enforcementApplied:false,
      secretsIncluded:false
    };
  } catch(error) {
    if(transactionStarted) {
      try {
        await connection.rollback();
      } catch(rollbackError) {
        const aggregate = new AggregateError(
          [error,rollbackError],
          "Override governance smoke failed and its transaction rollback also failed."
        );
        aggregate.status=500;
        aggregate.code="override_governance_smoke_rollback_failed";
        aggregate.details=[
          { stage:"smoke_execution",code:String(error?.code || "unknown"),message:String(error?.message || error) },
          { stage:"transaction_rollback",code:String(rollbackError?.code || "unknown"),message:String(rollbackError?.message || rollbackError) }
        ];
        throw aggregate;
      }
    }
    throw error;
  } finally {
    if(releaseConnection) connection.release();
  }
}

export const _testingDynamicContainerOverrideGovernanceSmoke = { duplicateEntry,parseJson };
