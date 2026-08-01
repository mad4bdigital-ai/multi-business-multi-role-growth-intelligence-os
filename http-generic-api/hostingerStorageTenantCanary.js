import {
  HOSTINGER_STORAGE_TENANT_CANARY_VERSION,
  createMemoryHostingerStorageTenantCanaryAuthorityStore as createBaseAuthorityStore,
  createMemoryHostingerStorageTenantCanaryEnablementRegistry,
  executeHostingerStorageTenantCanary as executeBaseTenantCanary,
} from './hostingerStorageTenantCanaryBase.js';
import { createHostingerStorageSyntheticAdapter } from './hostingerStorageSyntheticAdapter.js';
import {
  createHostingerStorageControlPlaneRepository,
  createMemoryHostingerStoragePersistenceAdapter,
  isCanonicalHostingerStorageControlPlaneRepository,
} from './hostingerStorageControlPlaneRepository.js';

export {
  HOSTINGER_STORAGE_TENANT_CANARY_VERSION,
  createMemoryHostingerStorageTenantCanaryEnablementRegistry,
};

const REQUIRED_REPOSITORY_METHODS = Object.freeze([
  'readAggregate',
  'transitionOperation',
  'consumePlan',
  'appendJournalEvent',
  'recordReconciliation',
]);
const CANONICAL_ADAPTER_KEY = 'hostinger_storage_synthetic_memory_adapter_v1';
const CANONICAL_ADAPTER_VERSION = 'spec014-hostinger-storage-synthetic-adapter-v1';
const CANONICAL_REPOSITORY_VERSION = 'spec014-storage-control-plane-repository-v1';
const CANONICAL_REPOSITORY_ADAPTER_KEY = 'hostinger_storage_memory_test_adapter_v1';
const tenantCanaryAdapters = new WeakSet();
const tenantCanaryRepositories = new WeakSet();

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function boundedIdToken(value) {
  return String(value ?? '').trim().slice(0, 256);
}

function boundedHashToken(value) {
  return String(value ?? '').trim().slice(0, 64).toLowerCase();
}

function snapshotAuthorityRecord(record, tokenField, normalizeToken) {
  if (!record || typeof record !== 'object') {
    throw fail(400, 'STORAGE_TENANT_CANARY_AUTHORITY_TOKEN_INPUT_INVALID', 'Authority update record must be a plain data object.', { field: tokenField });
  }
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const tokenDescriptor = descriptors[tokenField];
  if (!tokenDescriptor || !Object.hasOwn(tokenDescriptor, 'value') || typeof tokenDescriptor.value !== 'string') {
    throw fail(400, 'STORAGE_TENANT_CANARY_AUTHORITY_TOKEN_INPUT_INVALID', 'Authority token must be an owned primitive string value.', { field: tokenField });
  }
  const snapshot = {};
  for (const [field, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value')) {
      throw fail(400, 'STORAGE_TENANT_CANARY_AUTHORITY_TOKEN_INPUT_INVALID', 'Authority update records must not contain accessor properties.', { field });
    }
    snapshot[field] = descriptor.value;
  }
  const normalizedToken = normalizeToken(tokenDescriptor.value);
  snapshot[tokenField] = normalizedToken;
  return { snapshot, normalizedToken };
}

export function createHostingerStorageTenantCanarySyntheticAdapter(options = {}) {
  const adapter = createHostingerStorageSyntheticAdapter(options);
  tenantCanaryAdapters.add(adapter);
  return adapter;
}

export function createHostingerStorageTenantCanaryControlPlaneRepository({ snapshot = null } = {}) {
  const persistence = createMemoryHostingerStoragePersistenceAdapter({ snapshot });
  const repository = createHostingerStorageControlPlaneRepository({ adapter: persistence });
  if (!isCanonicalHostingerStorageControlPlaneRepository(repository)) {
    throw fail(500, 'STORAGE_TENANT_CANARY_CONTROL_PLANE_FACTORY_INVALID', 'Tenant canary repository factory failed canonical Control Plane provenance verification.');
  }
  tenantCanaryRepositories.add(repository);
  return repository;
}

export function createMemoryHostingerStorageTenantCanaryAuthorityStore() {
  const base = createBaseAuthorityStore();
  const allowlistRevisionHistory = new Map();
  const approvalEvidenceHistory = new Map();

  function remember(history, id, value) {
    const values = history.get(id) || new Set();
    values.add(value);
    history.set(id, values);
  }

  return Object.freeze({
    adapter_key: base.adapter_key,
    synthetic_only: true,
    production_ready: false,
    registerAllowlist(record) {
      const result = base.registerAllowlist(record);
      remember(allowlistRevisionHistory, result.allowlist_id, result.revision);
      return result;
    },
    updateAllowlist(input = {}) {
      const id = boundedIdToken(input.allowlist_id);
      const expectedRevision = boundedIdToken(input.expected_revision);
      const { snapshot: record, normalizedToken: nextRevision } = snapshotAuthorityRecord(input.record, 'revision', boundedIdToken);
      const current = base.readAllowlist(id);
      const history = allowlistRevisionHistory.get(id) || new Set(current ? [current.revision] : []);
      if (current && nextRevision !== current.revision && history.has(nextRevision)) {
        throw fail(409, 'STORAGE_TENANT_CANARY_ALLOWLIST_TOKEN_REUSED', 'Allowlist revisions are monotonic and may never be reused.', {
          allowlist_id: id,
          current_revision: current.revision,
          rejected_revision: nextRevision,
        });
      }
      const result = base.updateAllowlist({ allowlist_id: id, expected_revision: expectedRevision, record });
      remember(allowlistRevisionHistory, result.allowlist_id, result.revision);
      return result;
    },
    readAllowlist(allowlistId) {
      return base.readAllowlist(allowlistId);
    },
    registerApproval(record) {
      const result = base.registerApproval(record);
      remember(approvalEvidenceHistory, result.approval_id, result.evidence_digest);
      return result;
    },
    updateApproval(input = {}) {
      const id = boundedIdToken(input.approval_id);
      const expectedEvidenceDigest = boundedHashToken(input.expected_evidence_digest);
      const { snapshot: record, normalizedToken: nextEvidence } = snapshotAuthorityRecord(input.record, 'evidence_digest', boundedHashToken);
      const current = base.readApproval(id);
      const history = approvalEvidenceHistory.get(id) || new Set(current ? [current.evidence_digest] : []);
      if (current && nextEvidence !== current.evidence_digest && history.has(nextEvidence)) {
        throw fail(409, 'STORAGE_TENANT_CANARY_APPROVAL_TOKEN_REUSED', 'Approval evidence tokens are monotonic and may never be reused.', {
          approval_id: id,
          current_evidence_digest: current.evidence_digest,
          rejected_evidence_digest: nextEvidence,
        });
      }
      const result = base.updateApproval({ approval_id: id, expected_evidence_digest: expectedEvidenceDigest, record });
      remember(approvalEvidenceHistory, result.approval_id, result.evidence_digest);
      return result;
    },
    readApproval(approvalId) {
      return base.readApproval(approvalId);
    },
    exportState() {
      return base.exportState();
    },
  });
}

function requireCanonicalRepository(repository) {
  const missing = REQUIRED_REPOSITORY_METHODS.filter((method) => typeof repository?.[method] !== 'function');
  if (!repository
    || !tenantCanaryRepositories.has(repository)
    || !isCanonicalHostingerStorageControlPlaneRepository(repository)
    || !Object.isFrozen(repository)
    || repository.repository_version !== CANONICAL_REPOSITORY_VERSION
    || repository.adapter_key !== CANONICAL_REPOSITORY_ADAPTER_KEY
    || repository.production_ready !== false
    || missing.length) {
    throw fail(409, 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID', 'Tenant canary requires a repository created by the Tenant-owned factory over the canonical Control Plane factory.', {
      repository_provenance: 'tenant_and_control_plane_factory_owned_required',
      expected_repository_version: CANONICAL_REPOSITORY_VERSION,
      expected_adapter_key: CANONICAL_REPOSITORY_ADAPTER_KEY,
      required_methods: REQUIRED_REPOSITORY_METHODS,
      missing_methods: missing,
    });
  }
}

function requireCanonicalAdapter(adapter) {
  if (!adapter
    || !tenantCanaryAdapters.has(adapter)
    || !Object.isFrozen(adapter)
    || adapter.adapter_key !== CANONICAL_ADAPTER_KEY
    || adapter.adapter_version !== CANONICAL_ADAPTER_VERSION
    || adapter.synthetic_only !== true
    || adapter.production_ready !== false
    || adapter.live_provider !== false
    || adapter.filesystem_access !== false
    || adapter.shell_access !== false
    || typeof adapter.mutateExact !== 'function'
    || typeof adapter.readbackItem !== 'function'
    || typeof adapter.readMutationReceipt !== 'function') {
    throw fail(409, 'STORAGE_TENANT_CANARY_EXECUTOR_ADAPTER_INVALID', 'Tenant canary requires an adapter created by the Tenant-owned synthetic adapter factory.', {
      expected_adapter_key: CANONICAL_ADAPTER_KEY,
      expected_adapter_version: CANONICAL_ADAPTER_VERSION,
    });
  }
}

function revalidatePlanAuthority({ repository, protocol }) {
  const aggregate = repository.readAggregate(protocol?.operation_id);
  if (!aggregate?.operation) {
    throw fail(404, 'STORAGE_TENANT_CANARY_OPERATION_NOT_FOUND', 'Canary operation aggregate was not found during authority preflight.');
  }
  const plan = Array.isArray(aggregate.plans)
    ? aggregate.plans.find((row) => row.plan_id === protocol?.plan_id)
    : null;
  if (!plan) {
    throw fail(409, 'STORAGE_TENANT_CANARY_EXECUTOR_PLAN_INVALID', 'Current immutable plan was not found during authority preflight.', {
      mismatches: ['missing'],
    });
  }
  const mismatches = [];
  for (const field of ['authority_context_hash', 'ownership_revision', 'policy_revision']) {
    if (plan[field] !== aggregate.operation[field]) mismatches.push(field);
  }
  if (mismatches.length) {
    throw fail(409, 'STORAGE_TENANT_CANARY_EXECUTOR_PLAN_INVALID', 'Immutable plan authority revisions differ from the current operation authority.', {
      mismatches: [...new Set(mismatches)].sort(),
    });
  }
}

export function executeHostingerStorageTenantCanary(options = {}) {
  requireCanonicalRepository(options.repository);
  requireCanonicalAdapter(options.adapter);
  revalidatePlanAuthority({ repository: options.repository, protocol: options.protocol });
  return executeBaseTenantCanary(options);
}
