import assert from 'node:assert/strict';
import {
  HOSTINGER_STORAGE_DEDICATED_WORKER_CERTIFICATION_VERSION,
  buildHostingerStorageDedicatedWorkerCertification,
  verifyHostingerStorageDedicatedWorkerCertification,
} from './hostingerStorageDedicatedWorkerCertification.js';

const H = Object.freeze({
  source: '1'.repeat(64),
  image: '2'.repeat(64),
  provenance: '3'.repeat(64),
  resolution: '4'.repeat(64),
  policy: '5'.repeat(64),
  tools: '6'.repeat(64),
  program: '7'.repeat(64),
  host: '8'.repeat(64),
});
const NOW = Date.parse('2026-08-02T05:00:00.000Z');

function expected(overrides = {}) {
  return {
    target_id: 'target-hostinger-primary',
    source_commit: H.source,
    worker_id: 'worker-hostinger-storage-01',
    worker_principal_id: 'principal-provider-worker-01',
    worker_release_id: 'worker-release-2026.08.02.1',
    worker_image_digest: H.image,
    artifact_provenance_digest: H.provenance,
    toolchain_resolution_fingerprint: H.resolution,
    toolchain_policy_fingerprint: H.policy,
    selected_tools_digest: H.tools,
    reviewed_program_digest: H.program,
    host_key_revision: 'host-key-revision-17',
    host_key_algorithm: 'ssh-ed25519',
    host_key_fingerprint_digest: H.host,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  const base = {
    contract: 'spec014.hostinger-storage-dedicated-worker-evidence.v1',
    observed_at: '2026-08-02T04:55:00.000Z',
    expires_at: '2026-08-02T05:55:00.000Z',
    source_commit: H.source,
    target_id: 'target-hostinger-primary',
    worker: {
      worker_id: 'worker-hostinger-storage-01',
      worker_kind: 'dedicated_provider_worker',
      execution_domain: 'hostinger_storage',
      principal_id: 'principal-provider-worker-01',
      release_id: 'worker-release-2026.08.02.1',
      image_digest: H.image,
      artifact_provenance_digest: H.provenance,
      dedicated: true,
      public_runtime: false,
      ephemeral_execution: true,
      secrets_included: false,
    },
    adapter: {
      adapter_key: 'hostinger_ssh_storage_v1',
      operation_key: 'apply_exact_plan',
      reviewed_program_key: 'hostinger-storage-cleanup.sh',
      reviewed_program_digest: H.program,
      structured_arguments_only: true,
      free_form_command_allowed: false,
      free_form_root_allowed: false,
      wildcard_allowed: false,
      secrets_included: false,
    },
    toolchain: {
      resolution_fingerprint: H.resolution,
      policy_fingerprint: H.policy,
      selected_tools_digest: H.tools,
      binaries_verified: true,
      unapproved_binary_allowed: false,
      secrets_included: false,
    },
    host_key: {
      revision: 'host-key-revision-17',
      algorithm: 'ssh-ed25519',
      fingerprint_digest: H.host,
      pinned: true,
      verification_required: true,
      mismatch_fails_closed: true,
      secrets_included: false,
    },
    isolation: {
      public_runtime_dispatch_allowed: false,
      direct_http_dispatch_allowed: false,
      authority_resolution_allowed: false,
      approval_resolution_allowed: false,
      plan_mutation_allowed: false,
      credential_reference_resolution: 'worker_only',
      credential_values_in_evidence: false,
      provider_egress_scope: 'hostinger_target_only',
      inbound_network_listener: false,
      shell_input_allowed: false,
      filesystem_input_from_request_allowed: false,
      secrets_included: false,
    },
    repository_only: true,
    worker_process_started: false,
    provider_calls: 0,
    credential_resolutions: 0,
    runtime_mounts: 0,
    secrets_included: false,
  };
  return {
    ...base,
    ...overrides,
    worker: { ...base.worker, ...(overrides.worker || {}) },
    adapter: { ...base.adapter, ...(overrides.adapter || {}) },
    toolchain: { ...base.toolchain, ...(overrides.toolchain || {}) },
    host_key: { ...base.host_key, ...(overrides.host_key || {}) },
    isolation: { ...base.isolation, ...(overrides.isolation || {}) },
  };
}

function build(evidenceOverrides = {}, expectedOverrides = {}) {
  return buildHostingerStorageDedicatedWorkerCertification({
    evidence: evidence(evidenceOverrides),
    expected: expected(expectedOverrides),
    now: NOW,
  });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

const packet = build();
assert.equal(packet.version, HOSTINGER_STORAGE_DEDICATED_WORKER_CERTIFICATION_VERSION);
assert.equal(packet.ready_for_fixed_dispatch_certification, true);
assert.deepEqual(packet.blockers, []);
assert.equal(packet.worker_created, false);
assert.equal(packet.worker_process_started, false);
assert.equal(packet.worker_mounted, false);
assert.equal(packet.route_mounted, false);
assert.equal(packet.provider_calls, 0);
assert.equal(packet.provider_dispatch_allowed, false);
assert.equal(packet.production_ready, false);
assert.equal(packet.secrets_included, false);
assert.equal(Object.isFrozen(packet), true);
assert.equal(Object.isFrozen(packet.evidence), true);
assert.equal(Object.isFrozen(packet.evidence.isolation), true);

const verified = verifyHostingerStorageDedicatedWorkerCertification({
  packet,
  expected_digest: packet.certification_digest,
});
assert.equal(verified.valid, true);
assert.equal(verified.ready_for_fixed_dispatch_certification, true);
assert.equal(verified.provider_dispatch_allowed, false);

const publicRuntime = build({ worker: { public_runtime: true } });
assert.equal(publicRuntime.ready_for_fixed_dispatch_certification, false);
assert(publicRuntime.blockers.includes('STORAGE_PUBLIC_RUNTIME_WORKER_FORBIDDEN'));

const directHttp = build({ isolation: { direct_http_dispatch_allowed: true } });
assert(directHttp.blockers.includes('STORAGE_DIRECT_HTTP_DISPATCH_FORBIDDEN'));

const shellInput = build({ adapter: { free_form_command_allowed: true }, isolation: { shell_input_allowed: true } });
assert(shellInput.blockers.includes('STORAGE_FREE_FORM_INPUT_FORBIDDEN'));
assert(shellInput.blockers.includes('STORAGE_WORKER_REQUEST_INPUT_FORBIDDEN'));

const unpinnedHost = build({ host_key: { pinned: false, mismatch_fails_closed: false } });
assert(unpinnedHost.blockers.includes('STORAGE_SSH_HOST_KEY_POLICY_INVALID'));

const wrongTarget = build({}, { target_id: 'target-hostinger-secondary' });
assert(wrongTarget.blockers.includes('STORAGE_WORKER_TARGET_MISMATCH'));

const driftedToolchain = build({ toolchain: { selected_tools_digest: '9'.repeat(64) } });
assert(driftedToolchain.blockers.includes('STORAGE_WORKER_SELECTED_TOOLS_MISMATCH'));

const credentialLeak = build({ isolation: { credential_values_in_evidence: true } });
assert(credentialLeak.blockers.includes('STORAGE_WORKER_CREDENTIAL_BOUNDARY_INVALID'));

const startedWorker = build({ worker_process_started: true, provider_calls: 1, credential_resolutions: 1, runtime_mounts: 1 });
assert(startedWorker.blockers.includes('STORAGE_WORKER_CERT_REPOSITORY_ONLY_BOUNDARY_INVALID'));

expectCode(() => buildHostingerStorageDedicatedWorkerCertification({
  evidence: evidence({ access_token: 'forbidden' }),
  expected: expected(),
  now: NOW,
}), 'STORAGE_WORKER_CERT_SECRET_OR_UNSAFE_FIELD_REJECTED');

expectCode(() => buildHostingerStorageDedicatedWorkerCertification({
  evidence: evidence({ observed_at: '2026-08-02T05:01:00.000Z' }),
  expected: expected(),
  now: NOW,
}), 'STORAGE_WORKER_CERT_FRESHNESS_INVALID');

expectCode(() => buildHostingerStorageDedicatedWorkerCertification({
  evidence: evidence({ expires_at: '2026-08-04T05:00:00.000Z' }),
  expected: expected(),
  now: NOW,
}), 'STORAGE_WORKER_CERT_LIFETIME_EXCEEDED');

const tampered = structuredClone(packet);
tampered.evidence.worker.public_runtime = true;
expectCode(() => verifyHostingerStorageDedicatedWorkerCertification({ packet: tampered }), 'STORAGE_WORKER_CERT_PACKET_TAMPERED');

const blockedVerified = verifyHostingerStorageDedicatedWorkerCertification({ packet: publicRuntime });
assert.equal(blockedVerified.valid, false);
assert.equal(blockedVerified.ready_for_fixed_dispatch_certification, false);
assert.equal(blockedVerified.provider_dispatch_allowed, false);

console.log(JSON.stringify({
  ok: true,
  version: HOSTINGER_STORAGE_DEDICATED_WORKER_CERTIFICATION_VERSION,
  ready_packet_verified: verified.valid,
  blocked_packet_verified_as_not_ready: blockedVerified.valid === false,
  regressions: 12,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
