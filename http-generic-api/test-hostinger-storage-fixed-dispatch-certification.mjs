import assert from 'node:assert/strict';
import { buildHostingerStorageDedicatedWorkerCertification } from './hostingerStorageDedicatedWorkerCertification.js';
import {
  HOSTINGER_STORAGE_FIXED_DISPATCH_CERTIFICATION_VERSION,
  buildHostingerStorageFixedDispatchCertification,
  verifyHostingerStorageFixedDispatchCertification,
} from './hostingerStorageFixedDispatchCertification.js';

const D = Object.freeze({
  source: '1'.repeat(64), image: '2'.repeat(64), provenance: '3'.repeat(64), resolution: '4'.repeat(64), policy: '5'.repeat(64),
  tools: '6'.repeat(64), program: '7'.repeat(64), host: '8'.repeat(64), dispatcher: '9'.repeat(64), auth: 'a'.repeat(64),
  args: 'b'.repeat(64), root: 'c'.repeat(64), confirm: 'd'.repeat(64), credential: 'e'.repeat(64), plan: 'f'.repeat(64),
});
const NOW = Date.parse('2026-08-02T06:10:00.000Z');

function workerEvidence(overrides = {}) {
  const base = {
    contract: 'spec014.hostinger-storage-dedicated-worker-evidence.v1', observed_at: '2026-08-02T05:55:00.000Z', expires_at: '2026-08-02T07:00:00.000Z',
    source_commit: D.source, target_id: 'target-hostinger-primary',
    worker: { worker_id: 'worker-hostinger-storage-01', worker_kind: 'dedicated_provider_worker', execution_domain: 'hostinger_storage', principal_id: 'principal-provider-worker-01', release_id: 'worker-release-2026.08.02.1', image_digest: D.image, artifact_provenance_digest: D.provenance, dedicated: true, public_runtime: false, ephemeral_execution: true, secrets_included: false },
    adapter: { adapter_key: 'hostinger_ssh_storage_v1', operation_key: 'apply_exact_plan', reviewed_program_key: 'hostinger-storage-cleanup.sh', reviewed_program_digest: D.program, structured_arguments_only: true, free_form_command_allowed: false, free_form_root_allowed: false, wildcard_allowed: false, secrets_included: false },
    toolchain: { resolution_fingerprint: D.resolution, policy_fingerprint: D.policy, selected_tools_digest: D.tools, binaries_verified: true, unapproved_binary_allowed: false, secrets_included: false },
    host_key: { revision: 'host-key-revision-17', algorithm: 'ssh-ed25519', fingerprint_digest: D.host, pinned: true, verification_required: true, mismatch_fails_closed: true, secrets_included: false },
    isolation: { public_runtime_dispatch_allowed: false, direct_http_dispatch_allowed: false, authority_resolution_allowed: false, approval_resolution_allowed: false, plan_mutation_allowed: false, credential_reference_resolution: 'worker_only', credential_values_in_evidence: false, provider_egress_scope: 'hostinger_target_only', inbound_network_listener: false, shell_input_allowed: false, filesystem_input_from_request_allowed: false, secrets_included: false },
    repository_only: true, worker_process_started: false, provider_calls: 0, credential_resolutions: 0, runtime_mounts: 0, secrets_included: false,
  };
  return { ...base, ...overrides, worker: { ...base.worker, ...(overrides.worker || {}) }, adapter: { ...base.adapter, ...(overrides.adapter || {}) }, toolchain: { ...base.toolchain, ...(overrides.toolchain || {}) }, host_key: { ...base.host_key, ...(overrides.host_key || {}) }, isolation: { ...base.isolation, ...(overrides.isolation || {}) } };
}

function workerExpected() {
  return { target_id: 'target-hostinger-primary', source_commit: D.source, worker_id: 'worker-hostinger-storage-01', worker_principal_id: 'principal-provider-worker-01', worker_release_id: 'worker-release-2026.08.02.1', worker_image_digest: D.image, artifact_provenance_digest: D.provenance, toolchain_resolution_fingerprint: D.resolution, toolchain_policy_fingerprint: D.policy, selected_tools_digest: D.tools, reviewed_program_digest: D.program, host_key_revision: 'host-key-revision-17', host_key_algorithm: 'ssh-ed25519', host_key_fingerprint_digest: D.host };
}

function workerPacket(overrides = {}) {
  return buildHostingerStorageDedicatedWorkerCertification({ evidence: workerEvidence(overrides), expected: workerExpected(), now: NOW });
}

function expected(worker, overrides = {}) {
  return {
    source_commit: D.source, dispatcher_id: 'dispatcher-hostinger-storage-01', dispatcher_release_id: 'dispatcher-release-2026.08.02.1', dispatcher_artifact_digest: D.dispatcher,
    worker_certification_digest: worker.certification_digest, operation_id: 'operation-001', target_id: 'target-hostinger-primary', plan_id: 'plan-001', plan_hash: D.plan,
    execution_lease_id: 'lease-001', lease_generation: 3, authorization_bundle_hash: D.auth, arguments_schema_digest: D.args, storage_root_ref_digest: D.root,
    typed_confirmation_digest: D.confirm, credential_binding_digest: D.credential, host_key_revision: 'host-key-revision-17', host_key_fingerprint_digest: D.host,
    reviewed_program_digest: D.program, ...overrides,
  };
}

function evidence(overrides = {}) {
  const base = {
    contract: 'spec014.hostinger-storage-fixed-dispatch-evidence.v1', observed_at: '2026-08-02T06:00:00.000Z', expires_at: '2026-08-02T07:00:00.000Z', source_commit: D.source,
    dispatcher: { dispatcher_id: 'dispatcher-hostinger-storage-01', dispatcher_kind: 'fixed_internal_dispatcher', release_id: 'dispatcher-release-2026.08.02.1', artifact_digest: D.dispatcher, internal_only: true, public_http: false, public_runtime: false, default_off: true, queue_key: 'hostinger_storage_dispatch_v1', single_operation: true, secrets_included: false },
    invocation: { adapter_key: 'hostinger_ssh_storage_v1', operation_key: 'apply_exact_plan', provider_action: 'apply', fixed_script_ref: 'repo:http-generic-api/scripts/hostinger-storage-cleanup.sh', reviewed_program_digest: D.program, operation_id: 'operation-001', target_id: 'target-hostinger-primary', plan_id: 'plan-001', expected_plan_hash: D.plan, execution_lease_id: 'lease-001', lease_generation: 3, authorization_bundle_hash: D.auth, arguments_schema_digest: D.args, storage_root_ref_digest: D.root, typed_confirmation_digest: D.confirm, credential_binding_digest: D.credential, host_key_revision: 'host-key-revision-17', host_key_fingerprint_digest: D.host, structured_arguments_only: true, credential_reference_only: true, shell_command_present: false, wildcard_allowed: false, arbitrary_root_allowed: false, output_policy: 'bounded_redacted_json', secrets_included: false },
    boundary: { repository_only: true, dispatcher_created: false, dispatch_job_enqueued: false, worker_invoked: false, provider_calls: 0, credential_resolutions: 0, runtime_mounts: 0, secrets_included: false },
    secrets_included: false,
  };
  return { ...base, ...overrides, dispatcher: { ...base.dispatcher, ...(overrides.dispatcher || {}) }, invocation: { ...base.invocation, ...(overrides.invocation || {}) }, boundary: { ...base.boundary, ...(overrides.boundary || {}) } };
}

function build(evidenceOverrides = {}, expectedOverrides = {}, worker = workerPacket()) {
  return buildHostingerStorageFixedDispatchCertification({ worker_certification: worker, evidence: evidence(evidenceOverrides), expected: expected(worker, expectedOverrides), now: NOW });
}

function expectCode(fn, code) { assert.throws(fn, (error) => error?.code === code); }

const packet = build();
assert.equal(packet.version, HOSTINGER_STORAGE_FIXED_DISPATCH_CERTIFICATION_VERSION);
assert.equal(packet.ready_for_separate_mount_authorization, true);
assert.deepEqual(packet.blockers, []);
assert.equal(packet.dispatcher_created, false);
assert.equal(packet.dispatch_job_enqueued, false);
assert.equal(packet.worker_invoked, false);
assert.equal(packet.provider_calls, 0);
assert.equal(packet.provider_dispatch_allowed, false);
assert.equal(packet.production_ready, false);
assert.equal(Object.isFrozen(packet), true);

const verified = verifyHostingerStorageFixedDispatchCertification({ packet, expected_digest: packet.certification_digest });
assert.equal(verified.valid, true);
assert.equal(verified.ready_for_separate_mount_authorization, true);
assert.equal(verified.provider_dispatch_allowed, false);

const publicDispatcher = build({ dispatcher: { public_http: true, public_runtime: true } });
assert(publicDispatcher.blockers.includes('STORAGE_FIXED_DISPATCH_ISOLATION_INVALID'));

const enabledByDefault = build({ dispatcher: { default_off: false } });
assert(enabledByDefault.blockers.includes('STORAGE_FIXED_DISPATCH_POLICY_INVALID'));

const freeForm = build({ invocation: { shell_command_present: true, wildcard_allowed: true } });
assert(freeForm.blockers.includes('STORAGE_FIXED_DISPATCH_FREE_FORM_INPUT_FORBIDDEN'));

const targetDrift = build({ invocation: { target_id: 'target-hostinger-secondary' } });
assert(targetDrift.blockers.includes('STORAGE_FIXED_DISPATCH_OPERATION_BINDING_MISMATCH'));

const authDrift = build({ invocation: { authorization_bundle_hash: '0'.repeat(64) } });
assert(authDrift.blockers.includes('STORAGE_FIXED_DISPATCH_AUTHORIZATION_BINDING_MISMATCH'));

const leaseDrift = build({ invocation: { lease_generation: 4 } });
assert(leaseDrift.blockers.includes('STORAGE_FIXED_DISPATCH_LEASE_BINDING_MISMATCH'));

const credentialDrift = build({ invocation: { credential_binding_digest: '0'.repeat(64), credential_reference_only: false } });
assert(credentialDrift.blockers.includes('STORAGE_FIXED_DISPATCH_CREDENTIAL_BOUNDARY_INVALID'));

const hostKeyDrift = build({ invocation: { host_key_fingerprint_digest: '0'.repeat(64) } });
assert(hostKeyDrift.blockers.includes('STORAGE_FIXED_DISPATCH_HOST_KEY_BINDING_MISMATCH'));

const sideEffect = build({ boundary: { dispatcher_created: true, dispatch_job_enqueued: true, worker_invoked: true, provider_calls: 1, credential_resolutions: 1, runtime_mounts: 1 } });
assert(sideEffect.blockers.includes('STORAGE_FIXED_DISPATCH_REPOSITORY_ONLY_BOUNDARY_INVALID'));

const blockedWorker = workerPacket({ worker: { public_runtime: true } });
const workerBlockedPacket = build({}, {}, blockedWorker);
assert(workerBlockedPacket.blockers.includes('STORAGE_FIXED_DISPATCH_WORKER_CERTIFICATION_NOT_READY'));

expectCode(() => buildHostingerStorageFixedDispatchCertification({ worker_certification: workerPacket(), evidence: evidence({ access_token: 'forbidden' }), expected: expected(workerPacket()), now: NOW }), 'STORAGE_FIXED_DISPATCH_SECRET_OR_UNSAFE_FIELD_REJECTED');

const tamperedWorker = structuredClone(packet.worker_certification);
tamperedWorker.evidence.worker.public_runtime = true;
expectCode(() => buildHostingerStorageFixedDispatchCertification({ worker_certification: tamperedWorker, evidence: evidence(), expected: expected(packet.worker_certification), now: NOW }), 'STORAGE_FIXED_DISPATCH_WORKER_CERTIFICATION_TAMPERED');

const tamperedPacket = structuredClone(packet);
tamperedPacket.evidence.dispatcher.default_off = false;
expectCode(() => verifyHostingerStorageFixedDispatchCertification({ packet: tamperedPacket }), 'STORAGE_FIXED_DISPATCH_PACKET_TAMPERED');

console.log(JSON.stringify({ ok: true, version: HOSTINGER_STORAGE_FIXED_DISPATCH_CERTIFICATION_VERSION, ready_packet_verified: verified.valid, regressions: 13, dispatcher_created: false, dispatch_job_enqueued: false, worker_invoked: false, provider_dispatch_allowed: false, production_ready: false, secrets_included: false }, null, 2));
