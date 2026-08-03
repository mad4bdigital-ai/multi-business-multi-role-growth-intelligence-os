import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOSTINGER_STORAGE_TOOLCHAIN_VERSION,
  buildFixedStorageToolInvocation,
  buildStorageToolchainAttestationSubject,
  resolveHostingerStorageToolchain,
  validateHostingerStorageToolchainPolicy,
} from './hostingerStorageToolchain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(HERE, 'config/hostinger-storage-open-source-toolchain.json'), 'utf8'));
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected ${code}`);
}

function fullDiscovery() {
  return {
    openssh: { available: true, version: 'OpenSSH_9.8p1', binary_sha256: SHA_A, source: 'managed_worker' },
    posix_core: { available: true, version: 'coreutils 9.5', source: 'managed_worker' },
    ncdu: { available: true, version: 'ncdu 2.8', binary_sha256: SHA_B, source: 'verified_release' },
    fclones: { available: true, version: 'fclones 0.35.0', binary_sha256: SHA_C, source: 'verified_release' },
    restic: { available: true, version: 'restic 0.17.3', binary_sha256: SHA_A, source: 'verified_release' },
    rclone: { available: true, version: 'rclone v1.68.2', binary_sha256: SHA_B, source: 'verified_release' },
    opa: { available: true, version: 'Version: 1.2.0', binary_sha256: SHA_C, source: 'verified_release' },
    cosign: { available: true, version: 'GitVersion: v2.4.3', binary_sha256: SHA_A, source: 'verified_release' },
    opentelemetry: { available: true, version: '1.30.0', source: 'embedded_sdk' },
  };
}

{
  const result = validateHostingerStorageToolchainPolicy(policy);
  assert.equal(result.ok, true);
  assert.equal(result.tool_count, 9);
  assert.match(result.policy_fingerprint, /^[0-9a-f]{64}$/);
}

{
  const result = resolveHostingerStorageToolchain({
    policy,
    discovery: {
      posix_core: { available: true, version: 'coreutils 9.5', source: 'system' },
    },
    operation: 'scan',
    risk_profile: 'read_only',
    live: false,
    target: { target_id: 'target-1', resource_id: 'resource-1', ownership_scope: 'tenant' },
  });
  assert.equal(result.toolchain_version, HOSTINGER_STORAGE_TOOLCHAIN_VERSION);
  assert.equal(result.toolchain_ready, true);
  assert.equal(result.dispatch_allowed, false);
  assert.equal(result.selections.find((row) => row.capability === 'inventory')?.selected_tool_id, 'posix_core');
  assert(result.warnings.includes('STORAGE_TOOLCHAIN_OPTIONAL_CAPABILITY_UNAVAILABLE:policy_conformance'));
}

{
  const result = resolveHostingerStorageToolchain({
    policy,
    discovery: fullDiscovery(),
    operation: 'apply',
    risk_profile: 'platform_or_shared',
    pressure_state: 'normal',
    live: true,
    target: {
      target_id: 'hostinger-account-1',
      resource_id: 'storage-root-1',
      ownership_scope: 'shared',
      approval_complete: true,
      execution_lease_valid: true,
      impact_set_complete: true,
      restore_sample_verified: true,
      plan_hash: SHA_A,
      policy_revision: 'policy-r7',
      ownership_revision: 'ownership-r4',
    },
  });
  assert.equal(result.toolchain_ready, false);
  assert(result.blockers.includes('STORAGE_TOOLCHAIN_PROVIDER_DISPATCH_DEFAULT_OFF'));
  assert.equal(result.selections.find((row) => row.capability === 'transport')?.selected_tool_id, 'openssh');
  assert.equal(result.selections.find((row) => row.capability === 'checkpoint')?.selected_tool_id, 'restic');
  assert.equal(result.selections.find((row) => row.capability === 'replica_verification')?.selected_tool_id, 'rclone');
  assert.equal(result.selections.find((row) => row.capability === 'attestation')?.selected_tool_id, 'cosign');
  assert(result.phase_graph.some((row) => row.phase === 'recovery_checkpoint'));
  assert(result.phase_graph.some((row) => row.phase === 'outcome_reconciliation'));
}

{
  const result = resolveHostingerStorageToolchain({
    policy,
    discovery: fullDiscovery(),
    operation: 'scan',
    risk_profile: 'read_only',
    pressure_state: 'critical_inode',
    live: false,
    target: { target_id: 'target-2', target_file_creation_requested: false },
  });
  assert.equal(result.toolchain_ready, true);
  assert.equal(result.selections.find((row) => row.capability === 'inventory')?.selected_tool_id, 'ncdu');
  assert(result.warnings.includes('STORAGE_TOOLCHAIN_CRITICAL_INODE_STREAMING_ONLY'));
}

{
  const result = resolveHostingerStorageToolchain({
    policy,
    discovery: fullDiscovery(),
    operation: 'scan',
    risk_profile: 'read_only',
    pressure_state: 'critical_inode',
    target: { target_file_creation_requested: true },
  });
  assert(result.blockers.includes('STORAGE_TOOLCHAIN_CRITICAL_INODE_TARGET_ALLOCATION_FORBIDDEN'));
}

{
  const result = resolveHostingerStorageToolchain({
    policy,
    discovery: fullDiscovery(),
    operation: 'reserve-release',
    risk_profile: 'platform_or_shared',
    pressure_state: 'critical_inode',
  });
  assert.equal(result.generic_toolchain_bypassed, true);
  assert.equal(result.dedicated_exact_unlink_required, true);
  assert.equal(result.automatic_retry_allowed, false);
}

{
  const discovery = {
    ncdu: { available: true, version: 'ncdu 1.10', binary_sha256: SHA_A },
    posix_core: { available: false, version: '0.0.0' },
  };
  const result = resolveHostingerStorageToolchain({ policy, discovery, operation: 'scan' });
  assert(result.blockers.includes('STORAGE_TOOLCHAIN_CAPABILITY_MISSING:inventory'));
  const ncdu = result.selections.find((row) => row.capability === 'inventory')?.candidates.find((row) => row.tool_id === 'ncdu');
  assert(ncdu.reasons.includes('TOOL_VERSION_UNSUPPORTED'));
}

{
  const descriptor = buildFixedStorageToolInvocation({
    policy,
    tool_id: 'ncdu',
    action: 'export_inventory',
    context: {
      root_path: '/home/account/logs',
      allowed_roots: ['/home/account'],
    },
  });
  assert.equal(descriptor.shell, false);
  assert.equal(descriptor.user_supplied_argv, false);
  assert.equal(descriptor.expected_output, 'ncdu_json_export');
  assert.deepEqual(descriptor.argv, ['-0', '-x', '-o', '-', '/home/account/logs']);
}

{
  const descriptor = buildFixedStorageToolInvocation({
    policy,
    tool_id: 'openssh',
    action: 'fixed_exec',
    context: {
      operation_id: 'operation-123',
      host_alias: 'hostinger-prod-1',
      ssh_config_ref: '/runner/contracts/ssh_config',
      known_hosts_ref: '/runner/contracts/known_hosts',
      remote_program_ref: '/home/account/bin/hostinger-storage-cleanup.sh',
      stdin_contract_ref: 'evidence://operation-123/dispatch-contract',
    },
  });
  assert.equal(descriptor.shell, false);
  assert.equal(descriptor.stdin_mode, 'immutable_json_contract');
  assert(descriptor.argv.includes('StrictHostKeyChecking=yes'));
  assert(!descriptor.argv.some((item) => item.includes('StrictHostKeyChecking=no')));
  assert.equal(descriptor.mutates_target, false);
}

{
  const descriptor = buildFixedStorageToolInvocation({
    policy,
    tool_id: 'restic',
    action: 'backup_checkpoint',
    context: {
      operation_id: 'operation-456',
      root_path: '/home/account/releases/r1',
      allowed_roots: ['/home/account/releases'],
    },
  });
  assert.equal(descriptor.mutates_target, false);
  assert.equal(descriptor.mutates_external_repository, true);
  assert.deepEqual(descriptor.environment_reference_names, ['RESTIC_PASSWORD_COMMAND', 'RESTIC_REPOSITORY_FILE']);
  assert(!descriptor.argv.some((item) => /password|secret|token/i.test(item)));
}

{
  expectCode(() => buildFixedStorageToolInvocation({
    policy,
    tool_id: 'fclones',
    action: 'remove',
    context: { root_path: '/home/account', allowed_roots: ['/home/account'] },
  }), 'STORAGE_TOOLCHAIN_ACTION_NOT_ALLOWED');
}

{
  expectCode(() => buildFixedStorageToolInvocation({
    policy,
    tool_id: 'posix_core',
    action: 'inventory',
    context: { root_path: '/etc', allowed_roots: ['/home/account'] },
  }), 'STORAGE_TOOLCHAIN_PATH_OUTSIDE_BOUND_ROOT');
}

{
  expectCode(() => resolveHostingerStorageToolchain({
    policy,
    discovery: { restic: { available: true, version: '0.17.3', binary_sha256: SHA_A, password: 'forbidden' } },
    operation: 'scan',
  }), 'STORAGE_TOOLCHAIN_SECRET_FIELD_REJECTED');
}

{
  const resolution = resolveHostingerStorageToolchain({
    policy,
    discovery: fullDiscovery(),
    operation: 'plan',
    risk_profile: 'tenant_low',
    target: {
      target_id: 'target-3',
      tenant_id: 'tenant-3',
      workspace_id: 'workspace-3',
      resource_id: 'resource-3',
      ownership_scope: 'tenant',
      plan_hash: SHA_A,
    },
  });
  const attestation = buildStorageToolchainAttestationSubject({
    resolution,
    operation: { operation_id: 'operation-789', operation_key: 'hostinger_storage_plan' },
    plan: { plan_id: 'plan-789', plan_hash: SHA_A, policy_revision: 'policy-r8', ownership_revision: 'ownership-r5' },
  });
  assert.equal(attestation.signing_required, true);
  assert.equal(attestation.dispatch_authority_created, false);
  assert.match(attestation.subject_sha256, /^[0-9a-f]{64}$/);
  assert(attestation.subject.selected_tools.some((row) => row.tool_id === 'cosign'));
}

console.log(JSON.stringify({
  ok: true,
  suite: 'hostinger_storage_open_source_toolchain',
  policy_registry: policy.registry_key,
  toolchain_version: HOSTINGER_STORAGE_TOOLCHAIN_VERSION,
  secrets_included: false,
}));
