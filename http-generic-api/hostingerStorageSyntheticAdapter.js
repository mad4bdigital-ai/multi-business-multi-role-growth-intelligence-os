import {
  HOSTINGER_STORAGE_SYNTHETIC_ADAPTER_VERSION,
  createHostingerStorageSyntheticAdapter as createBaseHostingerStorageSyntheticAdapter,
} from './hostingerStorageSyntheticAdapterBase.js';

const canonicalAdapters = new WeakSet();

export { HOSTINGER_STORAGE_SYNTHETIC_ADAPTER_VERSION };

export function createHostingerStorageSyntheticAdapter(options = {}) {
  const adapter = createBaseHostingerStorageSyntheticAdapter(options);
  canonicalAdapters.add(adapter);
  return adapter;
}

export function isCanonicalHostingerStorageSyntheticAdapter(adapter) {
  return Boolean(
    adapter
    && canonicalAdapters.has(adapter)
    && adapter.adapter_key === 'hostinger_storage_synthetic_memory_adapter_v1'
    && adapter.adapter_version === HOSTINGER_STORAGE_SYNTHETIC_ADAPTER_VERSION
    && adapter.synthetic_only === true
    && adapter.production_ready === false
    && adapter.live_provider === false
    && adapter.filesystem_access === false
    && adapter.shell_access === false
  );
}
