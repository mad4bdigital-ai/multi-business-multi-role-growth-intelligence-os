const DEFAULT_MAX_DEPTH = 12;
const SAFE_DECLARATION_KEY = 'secrets_included';
const AUTHORIZATION_ENVELOPE_KEY = 'authorization';

function normalizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  if (!normalized || normalized === SAFE_DECLARATION_KEY || normalized === AUTHORIZATION_ENVELOPE_KEY) return false;

  const components = normalized.split('_').filter(Boolean);
  const directSensitive = new Set([
    'secret',
    'secrets',
    'token',
    'tokens',
    'password',
    'passwd',
    'credential',
    'credentials',
    'cookie',
    'cookies',
    'session',
    'sessions',
    'path',
    'environment',
    'raw',
  ]);
  if (components.some((component) => directSensitive.has(component))) return true;

  if (normalized.includes('private_key') || normalized.includes('client_secret') || normalized.includes('api_key')) return true;
  if (components.includes('file') && components.includes('content')) return true;
  if (components.includes('authorization')) return true;
  if (components.includes('auth') && components.some((component) => ['header', 'value', 'token', 'credential', 'credentials', 'secret', 'raw'].includes(component))) return true;
  return false;
}

function defaultViolation({ reason, path, key }) {
  const error = new Error('Secret-free validation failed.');
  error.code = 'HOSTINGER_STORAGE_SECRET_FIELD_REJECTED';
  error.details = { reason, path, key: key || null, secrets_included: false };
  return error;
}

export function assertHostingerStorageSecretFree(value, {
  at = 'value',
  max_depth = DEFAULT_MAX_DEPTH,
  allow_authorization_envelope = true,
  on_violation = defaultViolation,
} = {}) {
  if (!Number.isInteger(max_depth) || max_depth < 1 || max_depth > 64) {
    throw new TypeError('max_depth must be an integer between 1 and 64.');
  }
  if (typeof allow_authorization_envelope !== 'boolean') {
    throw new TypeError('allow_authorization_envelope must be boolean.');
  }
  if (typeof on_violation !== 'function') throw new TypeError('on_violation must be a function.');

  const ancestors = new WeakSet();
  const reject = (reason, path, key = null) => {
    throw on_violation({ reason, path, key });
  };

  const visit = (current, path, depth) => {
    if (depth > max_depth) reject('max_depth_exceeded', path);
    if (current === null || current === undefined || typeof current !== 'object') return;

    if (ancestors.has(current)) reject('cyclic_object', path);
    ancestors.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      ancestors.delete(current);
      return;
    }

    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      const itemPath = `${path}.${key}`;
      if (!Object.hasOwn(descriptor, 'value')) reject('accessor_property_rejected', itemPath, key);
      const item = descriptor.value;
      const normalizedKey = normalizeKey(key);

      if (normalizedKey === SAFE_DECLARATION_KEY) {
        if (item !== false) reject('secret_declaration_must_be_false', itemPath, key);
        continue;
      }

      if (normalizedKey === AUTHORIZATION_ENVELOPE_KEY) {
        if (!allow_authorization_envelope) reject('authorization_envelope_not_allowed', itemPath, key);
        if (!isPlainObject(item)) reject('authorization_envelope_must_be_object', itemPath, key);
        visit(item, itemPath, depth + 1);
        continue;
      }

      if (isSensitiveKey(key)) reject('sensitive_key', itemPath, key);
      visit(item, itemPath, depth + 1);
    }

    ancestors.delete(current);
  };

  visit(value, at, 0);
  return true;
}

export const HOSTINGER_STORAGE_SECRET_FREE_CONTRACT = Object.freeze({
  contract: 'mad4b.hostinger-storage-secret-free.v1',
  max_depth: DEFAULT_MAX_DEPTH,
  authorization_envelope_allowance_is_explicit: true,
  authorization_envelope_requires_object: true,
  secret_declaration_requires_false: true,
  cyclic_objects_rejected: true,
  accessor_properties_rejected: true,
  secrets_included: false,
});
