import {
  HOSTINGER_STORAGE_SYNTHETIC_EXECUTOR_VERSION,
  executeHostingerStorageSyntheticPlan as executeBaseSyntheticPlan,
  reconcileHostingerStorageSyntheticOutcome as reconcileBaseSyntheticOutcome,
} from './hostingerStorageSyntheticExecutorBase.js';
import { isCanonicalHostingerStorageSyntheticAdapter } from './hostingerStorageSyntheticAdapter.js';

export { HOSTINGER_STORAGE_SYNTHETIC_EXECUTOR_VERSION };

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { adapter_provenance: 'factory_owned_required', secrets_included: false };
  return error;
}

function requireFactoryOwnedAdapter(adapter) {
  if (!isCanonicalHostingerStorageSyntheticAdapter(adapter)) {
    throw fail(
      409,
      'STORAGE_SYNTHETIC_EXECUTOR_ADAPTER_INVALID',
      'Synthetic execution requires an adapter created by the canonical in-memory factory.',
    );
  }
}

export function executeHostingerStorageSyntheticPlan(options = {}) {
  requireFactoryOwnedAdapter(options.adapter);
  return executeBaseSyntheticPlan(options);
}

export function reconcileHostingerStorageSyntheticOutcome(options = {}) {
  requireFactoryOwnedAdapter(options.adapter);
  return reconcileBaseSyntheticOutcome(options);
}
