import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildHostingerStorageDedicatedWorkerCertification } from './hostingerStorageDedicatedWorkerCertification.js';
import { buildHostingerStorageFixedDispatchCertification } from './hostingerStorageFixedDispatchCertification.js';
import {
  HOSTINGER_STORAGE_SEPARATE_MOUNT_AUTHORIZATION_VERSION,
  buildHostingerStorageSeparateMountAuthorization,
  verifyHostingerStorageSeparateMountAuthorization,
} from './hostingerStorageSeparateMountAuthorization.js';

const D = Object.freeze({ source:'1'.repeat(64), image:'2'.repeat(64), provenance:'3'.repeat(64), resolution:'4'.repeat(64), policy:'5'.repeat(64), tools:'6'.repeat(64), program:'7'.repeat(64), host:'8'.repeat(64), dispatcher:'9'.repeat(64), auth:'a'.repeat(64), args:'b'.repeat(64), root:'c'.repeat(64), confirm:'d'.repeat(64), credential:'e'.repeat(64), plan:'f'.repeat(64), database:'0'.repeat(64), schema:'a1'.repeat(32), approval:'b1'.repeat(32), capability:'c1'.repeat(32), mountPolicy:'d1'.repeat(32), rollback:'e1'.repeat(32) });
const NOW = Date.parse('2026-08-02T06:30:00.000Z');
const stable=(v)=>Array.isArray(v)?v.map(stable):(!v||typeof v!=='object'?v:Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])));
const digest=(v)=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');

function workerPacket(overrides={}) {
  const worker = { worker_id:'worker-hostinger-storage-01', worker_kind:'dedicated_provider_worker', execution_domain:'hostinger_storage', principal_id:'principal-provider-worker-01', release_id:'worker-release-2026.08.02.1', image_digest:D.image, artifact_provenance_digest:D.provenance, dedicated:true, public_runtime:false, ephemeral_execution:true, secrets_included:false, ...(overrides.worker||{}) };
  const evidence = { contract:'spec014.hostinger-storage-dedicated-worker-evidence.v1', observed_at:'2026-08-02T06:00:00.000Z', expires_at:'2026-08-02T07:00:00.000Z', source_commit:D.source, target_id:'target-hostinger-primary', worker,
    adapter:{adapter_key:'hostinger_ssh_storage_v1',operation_key:'apply_exact_plan',reviewed_program_key:'hostinger-storage-cleanup.sh',reviewed_program_digest:D.program,structured_arguments_only:true,free_form_command_allowed:false,free_form_root_allowed:false,wildcard_allowed:false,secrets_included:false},
    toolchain:{resolution_fingerprint:D.resolution,policy_fingerprint:D.policy,selected_tools_digest:D.tools,binaries_verified:true,unapproved_binary_allowed:false,secrets_included:false},
    host_key:{revision:'host-key-revision-17',algorithm:'ssh-ed25519',fingerprint_digest:D.host,pinned:true,verification_required:true,mismatch_fails_closed:true,secrets_included:false},
    isolation:{public_runtime_dispatch_allowed:false,direct_http_dispatch_allowed:false,authority_resolution_allowed:false,approval_resolution_allowed:false,plan_mutation_allowed:false,credential_reference_resolution:'worker_only',credential_values_in_evidence:false,provider_egress_scope:'hostinger_target_only',inbound_network_listener:false,shell_input_allowed:false,filesystem_input_from_request_allowed:false,secrets_included:false},
    repository_only:true,worker_process_started:false,provider_calls:0,credential_resolutions:0,runtime_mounts:0,secrets_included:false };
  const expected={target_id:'target-hostinger-primary',source_commit:D.source,worker_id:'worker-hostinger-storage-01',worker_principal_id:'principal-provider-worker-01',worker_release_id:'worker-release-2026.08.02.1',worker_image_digest:D.image,artifact_provenance_digest:D.provenance,toolchain_resolution_fingerprint:D.resolution,toolchain_policy_fingerprint:D.policy,selected_tools_digest:D.tools,reviewed_program_digest:D.program,host_key_revision:'host-key-revision-17',host_key_algorithm:'ssh-ed25519',host_key_fingerprint_digest:D.host};
  return buildHostingerStorageDedicatedWorkerCertification({evidence:{...evidence,...overrides,worker},expected,now:NOW});
}

function dispatchPacket(overrides={}) {
  const worker=workerPacket(overrides.workerEvidence||{});
  const expected={source_commit:D.source,dispatcher_id:'dispatcher-hostinger-storage-01',dispatcher_release_id:'dispatcher-release-2026.08.02.1',dispatcher_artifact_digest:D.dispatcher,worker_certification_digest:worker.certification_digest,operation_id:'operation-001',target_id:'target-hostinger-primary',plan_id:'plan-001',plan_hash:D.plan,execution_lease_id:'lease-001',lease_generation:3,authorization_bundle_hash:D.auth,arguments_schema_digest:D.args,storage_root_ref_digest:D.root,typed_confirmation_digest:D.confirm,credential_binding_digest:D.credential,host_key_revision:'host-key-revision-17',host_key_fingerprint_digest:D.host,reviewed_program_digest:D.program};
  const base={contract:'spec014.hostinger-storage-fixed-dispatch-evidence.v1',observed_at:'2026-08-02T06:05:00.000Z',expires_at:'2026-08-02T07:00:00.000Z',source_commit:D.source,
    dispatcher:{dispatcher_id:'dispatcher-hostinger-storage-01',dispatcher_kind:'fixed_internal_dispatcher',release_id:'dispatcher-release-2026.08.02.1',artifact_digest:D.dispatcher,internal_only:true,public_http:false,public_runtime:false,default_off:true,queue_key:'hostinger_storage_dispatch_v1',single_operation:true,secrets_included:false},
    invocation:{adapter_key:'hostinger_ssh_storage_v1',operation_key:'apply_exact_plan',provider_action:'apply',fixed_script_ref:'repo:http-generic-api/scripts/hostinger-storage-cleanup.sh',reviewed_program_digest:D.program,operation_id:'operation-001',target_id:'target-hostinger-primary',plan_id:'plan-001',expected_plan_hash:D.plan,execution_lease_id:'lease-001',lease_generation:3,authorization_bundle_hash:D.auth,arguments_schema_digest:D.args,storage_root_ref_digest:D.root,typed_confirmation_digest:D.confirm,credential_binding_digest:D.credential,host_key_revision:'host-key-revision-17',host_key_fingerprint_digest:D.host,structured_arguments_only:true,credential_reference_only:true,shell_command_present:false,wildcard_allowed:false,arbitrary_root_allowed:false,output_policy:'bounded_redacted_json',secrets_included:false},
    boundary:{repository_only:true,dispatcher_created:false,dispatch_job_enqueued:false,worker_invoked:false,provider_calls:0,credential_resolutions:0,runtime_mounts:0,secrets_included:false},secrets_included:false};
  const evidence={...base,...(overrides.evidence||{}),dispatcher:{...base.dispatcher,...(overrides.evidence?.dispatcher||{})},invocation:{...base.invocation,...(overrides.evidence?.invocation||{})},boundary:{...base.boundary,...(overrides.evidence?.boundary||{})}};
  return buildHostingerStorageFixedDispatchCertification({worker_certification:worker,evidence,expected:{...expected,...(overrides.expected||{})},now:overrides.now ?? NOW});
}

function bridgePacket({ready=true}={}) {
  const capabilities={canonical_repository_facade_ready:true,plan_item_parent_registration_ready:true,run_parent_creation_ready:true,journal_translation_ready:true,reconciliation_translation_ready:true,durable_authority_store_ready:true,durable_enablement_registry_ready:true,tenant_safe_projection_ready:true,worker_certification_ready:true,fixed_dispatch_ready:true,crash_safe_restart_reconciliation_ready:true};
  if(!ready) capabilities.worker_certification_ready=false;
  const blockers=ready?[]:['DEDICATED_WORKER_CERTIFICATION_MISSING'];
  const core={contract:'spec014.hostinger-storage-durable-tenant-runtime-bridge-readiness.v1',version:'spec014-hostinger-storage-durable-tenant-runtime-bridge-readiness-v1',
    composition:{composition_key:'hostinger_storage_verified_sql_runtime_composition_v1',composition_version:'v1',schema_verification_digest:D.schema,database_fingerprint:D.database,source_commit:D.source,deployed_runtime_sha:D.source,readback_cycle_id:'readback-cycle-001',secrets_included:false},
    evidence:{contract:'spec014.hostinger-storage-durable-tenant-runtime-bridge-evidence.v1',observed_at:'2026-08-02T05:50:00.000Z',expires_at:'2026-08-02T07:00:00.000Z',capabilities,secrets_included:false},blockers,ready_for_separate_mount_authorization:ready,
    bridge_created:false,authorization_created:false,dependency_injected:false,runtime_mounted:false,route_mounted:false,worker_mounted:false,database_writes_performed_by_evaluator:0,provider_dispatch_allowed:false,production_ready:false,secrets_included:false};
  return {...core,readiness_digest:digest(core)};
}

function expected(bridge,dispatch,overrides={}) { return {authorization_id:'mount-auth-001',authorization_revision:'mount-auth-rev-001',mount_generation:1,issuer_principal_id:'platform-release-authority',source_commit:D.source,deployed_runtime_sha:D.source,database_fingerprint:D.database,schema_verification_digest:D.schema,readback_cycle_id:'readback-cycle-001',bridge_readiness_digest:bridge.readiness_digest,fixed_dispatch_certification_digest:dispatch.certification_digest,worker_certification_digest:dispatch.worker_certification.certification_digest,authorization_bundle_hash:D.auth,target_id:'target-hostinger-primary',operation_id:'operation-001',plan_id:'plan-001',plan_hash:D.plan,execution_lease_id:'lease-001',lease_generation:3,approval_set_hash:D.approval,capability_envelope_digest:D.capability,mount_policy_fingerprint:D.mountPolicy,rollback_plan_digest:D.rollback,...overrides}; }

function evidence(overrides={}) {
  const base={contract:'spec014.hostinger-storage-separate-mount-authorization-evidence.v1',observed_at:'2026-08-02T06:20:00.000Z',expires_at:'2026-08-02T07:00:00.000Z',
    authorization:{authorization_id:'mount-auth-001',authorization_revision:'mount-auth-rev-001',mount_generation:1,issuer_principal_id:'platform-release-authority',status:'approved',mode:'single_use_mount',one_shot:true,consumed:false,default_off:true,source_commit:D.source,deployed_runtime_sha:D.source,database_fingerprint:D.database,schema_verification_digest:D.schema,readback_cycle_id:'readback-cycle-001',bridge_readiness_digest:'0'.repeat(64),fixed_dispatch_certification_digest:'0'.repeat(64),worker_certification_digest:'0'.repeat(64),authorization_bundle_hash:D.auth,target_id:'target-hostinger-primary',operation_id:'operation-001',plan_id:'plan-001',plan_hash:D.plan,execution_lease_id:'lease-001',lease_generation:3,approval_set_hash:D.approval,capability_envelope_digest:D.capability,mount_policy_fingerprint:D.mountPolicy,rollback_plan_digest:D.rollback,secrets_included:false},
    route:{path:'/tenant/storage-operations/apply-plan',dependency_key:'tenantStorageRuntime',fail_closed_status:503,currently_unmounted:true,tenant_user_jwt_required:true,secrets_included:false},
    boundary:{repository_only:true,authorization_persisted:false,mount_performed:false,dependency_injected:false,runtime_mounted:false,route_mounted:false,worker_mounted:false,dispatch_job_enqueued:false,credential_resolutions:0,database_writes:0,provider_calls:0,secrets_included:false},secrets_included:false};
  return {...base,...overrides,authorization:{...base.authorization,...(overrides.authorization||{})},route:{...base.route,...(overrides.route||{})},boundary:{...base.boundary,...(overrides.boundary||{})}};
}

function build(evidenceOverrides={},expectedOverrides={},bridge=bridgePacket(),dispatch=dispatchPacket()) {
  const x=expected(bridge,dispatch,expectedOverrides); const e=evidence(evidenceOverrides);
  e.authorization.bridge_readiness_digest=x.bridge_readiness_digest;e.authorization.fixed_dispatch_certification_digest=x.fixed_dispatch_certification_digest;e.authorization.worker_certification_digest=x.worker_certification_digest;
  return buildHostingerStorageSeparateMountAuthorization({bridge_readiness:bridge,fixed_dispatch_certification:dispatch,evidence:e,expected:x,now:NOW});
}
const expectCode=(fn,code)=>assert.throws(fn,(error)=>error?.code===code);

const packet=build();
assert.equal(packet.version,HOSTINGER_STORAGE_SEPARATE_MOUNT_AUTHORIZATION_VERSION);
assert.equal(packet.ready_for_authorized_mount_execution,true);assert.deepEqual(packet.blockers,[]);assert.equal(packet.authorization_packet_created,true);assert.equal(packet.authorization_persisted,false);assert.equal(packet.mount_performed,false);assert.equal(packet.provider_calls,0);assert.equal(packet.provider_dispatch_allowed,false);assert.equal(packet.production_ready,false);
const verified=verifyHostingerStorageSeparateMountAuthorization({packet,expected_digest:packet.authorization_digest,now:NOW});assert.equal(verified.valid,true);assert.equal(verified.ready_for_authorized_mount_execution,true);

assert(build({route:{currently_unmounted:false}}).blockers.includes('STORAGE_MOUNT_AUTH_ROUTE_BOUNDARY_INVALID'));
assert(build({authorization:{consumed:true}}).blockers.includes('STORAGE_MOUNT_AUTH_POLICY_INVALID'));
assert(build({authorization:{deployed_runtime_sha:'2'.repeat(64)}},{deployed_runtime_sha:'2'.repeat(64)}).blockers.includes('STORAGE_MOUNT_AUTH_RUNTIME_PARITY_REQUIRED'));
assert(build({authorization:{approval_set_hash:'0'.repeat(64)}}).blockers.includes('STORAGE_MOUNT_AUTH_APPROVAL_SET_HASH_MISMATCH'));
assert(build({boundary:{mount_performed:true,dependency_injected:true,runtime_mounted:true}}).blockers.includes('STORAGE_MOUNT_AUTH_REPOSITORY_ONLY_BOUNDARY_INVALID'));
assert(build({}, {}, bridgePacket({ready:false})).blockers.includes('STORAGE_MOUNT_AUTH_BRIDGE_NOT_READY'));
const blockedDispatch=dispatchPacket({evidence:{dispatcher:{public_http:true}}});assert(build({}, {}, bridgePacket(),blockedDispatch).blockers.includes('STORAGE_MOUNT_AUTH_FIXED_DISPATCH_NOT_READY'));
assert(build({}, {target_id:'target-hostinger-secondary'}).blockers.includes('STORAGE_MOUNT_AUTH_DISPATCH_BINDING_MISMATCH'));
assert(build({authorization:{authorization_bundle_hash:'0'.repeat(64)}}).blockers.includes('STORAGE_MOUNT_AUTH_AUTHORIZATION_BUNDLE_HASH_MISMATCH'));
assert(build({expires_at:'2026-08-02T07:10:00.000Z'}).blockers.includes('STORAGE_MOUNT_AUTH_OUTLIVES_PREREQUISITE'));
const expiredDispatch=dispatchPacket({evidence:{expires_at:'2026-08-02T06:25:00.000Z'},now:Date.parse('2026-08-02T06:20:00.000Z')});assert(build({}, {}, bridgePacket(),expiredDispatch).blockers.includes('STORAGE_MOUNT_AUTH_PREREQUISITE_EXPIRED'));

expectCode(()=>buildHostingerStorageSeparateMountAuthorization({bridge_readiness:bridgePacket(),fixed_dispatch_certification:dispatchPacket(),evidence:evidence({access_token:'forbidden'}),expected:expected(bridgePacket(),dispatchPacket()),now:NOW}),'STORAGE_MOUNT_AUTH_SECRET_OR_UNSAFE_FIELD_REJECTED');
const badBridge=bridgePacket();badBridge.composition.source_commit='2'.repeat(64);expectCode(()=>buildHostingerStorageSeparateMountAuthorization({bridge_readiness:badBridge,fixed_dispatch_certification:dispatchPacket(),evidence:evidence(),expected:expected(badBridge,dispatchPacket()),now:NOW}),'STORAGE_MOUNT_AUTH_BRIDGE_READINESS_TAMPERED');
const badDispatch=structuredClone(packet.fixed_dispatch_certification);badDispatch.evidence.dispatcher.default_off=false;expectCode(()=>buildHostingerStorageSeparateMountAuthorization({bridge_readiness:bridgePacket(),fixed_dispatch_certification:badDispatch,evidence:evidence(),expected:expected(bridgePacket(),badDispatch),now:NOW}),'STORAGE_MOUNT_AUTH_FIXED_DISPATCH_TAMPERED');
const tampered=structuredClone(packet);tampered.evidence.authorization.consumed=true;expectCode(()=>verifyHostingerStorageSeparateMountAuthorization({packet:tampered,now:NOW}),'STORAGE_MOUNT_AUTH_PACKET_TAMPERED');

console.log(JSON.stringify({ok:true,version:HOSTINGER_STORAGE_SEPARATE_MOUNT_AUTHORIZATION_VERSION,ready_packet_verified:verified.valid,regressions:15,authorization_persisted:false,mount_performed:false,provider_dispatch_allowed:false,production_ready:false,secrets_included:false},null,2));
