import {
  HOSTINGER_STORAGE_TENANT_CANARY_POLICY_VERSION,
  buildHostingerStorageTenantCanaryAuthorization,
  verifyHostingerStorageTenantCanaryAuthorization as verifyBaseHostingerStorageTenantCanaryAuthorization,
} from './hostingerStorageTenantCanaryPolicyBase.js';

export {
  HOSTINGER_STORAGE_TENANT_CANARY_POLICY_VERSION,
  buildHostingerStorageTenantCanaryAuthorization,
};

function unique(values = []) {
  return Object.freeze([...new Set(values.filter(Boolean))].sort());
}

export function verifyHostingerStorageTenantCanaryAuthorization({
  authorization,
  expected_digest,
  now_epoch = Math.floor(Date.now() / 1000),
} = {}) {
  const base = verifyBaseHostingerStorageTenantCanaryAuthorization({
    authorization,
    expected_digest,
    now_epoch,
  });
  const now = Number(now_epoch);
  const blockers = [...(base.blockers || [])];
  if (Number(authorization?.evaluated_at_epoch) > now) {
    blockers.push('STORAGE_TENANT_CANARY_EVALUATION_NOT_STARTED');
  }
  if (Number(authorization?.allowlist?.valid_from_epoch) > now) {
    blockers.push('STORAGE_TENANT_CANARY_ALLOWLIST_NOT_STARTED');
  }
  if (Number(authorization?.workspace_owner_approval?.approved_at_epoch) > now) {
    blockers.push('STORAGE_TENANT_CANARY_APPROVAL_NOT_STARTED');
  }
  if (Number(authorization?.manual_enablement?.enabled_at_epoch) > now) {
    blockers.push('STORAGE_TENANT_CANARY_ENABLEMENT_NOT_STARTED');
  }
  const normalizedBlockers = unique(blockers);
  return Object.freeze({
    ...base,
    valid: normalizedBlockers.length === 0,
    blockers: normalizedBlockers,
    dispatch_allowed: false,
    live_provider_allowed: false,
    secrets_included: false,
  });
}
