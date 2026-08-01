import {
  HOSTINGER_STORAGE_TENANT_CANARY_VERSION,
  createMemoryHostingerStorageTenantCanaryAuthorityStore as createBaseAuthorityStore,
  createMemoryHostingerStorageTenantCanaryEnablementRegistry,
  executeHostingerStorageTenantCanary as executeBaseTenantCanary,
} from './hostingerStorageTenantCanaryBase.js';

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

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function token(value) {
  return String(value ?? '').trim();
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
      const id = token(input.allowlist_id);
      const current = base.readAllowlist(id);
      const nextRevision = token(input.record?.revision);
      const history = allowlistRevisionHistory.get(id) || new Set(current ? [current.revision] : []);
      if (current && nextRevision !== current.revision && history.has(nextRevision)) {
        throw fail(409, 'STORAGE_TENANT_CANARY_ALLOWLIST_TOKEN_REUSED', 'Allowlist revisions are monotonic and may never be reused.', {
          allowlist_id: id,
          current_revision: current.revision,
          rejected_revision: nextRevision,
        });
      }
      const result = base.updateAllowlist(input);
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
      const id = token(input.approval_id);
      const current = base.readApproval(id);
      const nextEvidence = token(input.record?.evidence_digest).toLowerCase();
      const history = approvalEvidenceHistory.get(id) || new Set(current ? [current.evidence_digest] : []);
      if (current && nextEvidence !== current.evidence_digest && history.has(nextEvidence)) {
        throw fail(409, 'STORAGE_TENANT_CANARY_APPROVAL_TOKEN_REUSED', 'Approval evidence tokens are monotonic and may never be reused.', {
          approval_id: id,
          current_evidence_digest: current.evidence_digest,
          rejected_evidence_digest: nextEvidence,
        });
      }
      const result = base.updateApproval(input);
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

function requireCompleteRepository(repository) {
  const missing = REQUIRED_REPOSITORY_METHODS.filter((method) => typeof repository?.[method] !== 'function');
  if (!repository || repository.production_ready === true || missing.length) {
    throw fail(409, 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID', 'Tenant canary requires the complete non-production governed repository contract.', {
      required_methods: REQUIRED_REPOSITORY_METHODS,
      missing_methods: missing,
    });
  }
}

function requireCanonicalAdapter(adapter) {
  if (!adapter
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
    throw fail(409, 'STORAGE_TENANT_CANARY_EXECUTOR_ADAPTER_INVALID', 'Tenant canary requires the canonical frozen in-memory synthetic adapter identity and contract.', {
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
  requireCompleteRepository(options.repository);
  requireCanonicalAdapter(options.adapter);
  revalidatePlanAuthority({ repository: options.repository, protocol: options.protocol });
  return executeBaseTenantCanary(options);
}
