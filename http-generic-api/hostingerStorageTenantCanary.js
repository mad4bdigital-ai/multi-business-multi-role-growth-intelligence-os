import {
  createMemoryHostingerStorageTenantCanaryAuthorityStore as createV2AuthorityStore,
} from './hostingerStorageTenantCanaryV2.js';

export {
  HOSTINGER_STORAGE_TENANT_CANARY_VERSION,
  createMemoryHostingerStorageTenantCanaryEnablementRegistry,
  executeHostingerStorageTenantCanary,
} from './hostingerStorageTenantCanaryV2.js';

export function createMemoryHostingerStorageTenantCanaryAuthorityStore() {
  const store = createV2AuthorityStore();
  return Object.freeze({
    ...store,
    updateAllowlist(input = {}) {
      const current = store.readAllowlist(input.allowlist_id);
      return store.updateAllowlist({
        ...input,
        expected_generation: input.expected_generation ?? current?.authority_generation,
      });
    },
    updateApproval(input = {}) {
      const current = store.readApproval(input.approval_id);
      return store.updateApproval({
        ...input,
        expected_generation: input.expected_generation ?? current?.authority_generation,
      });
    },
  });
}
