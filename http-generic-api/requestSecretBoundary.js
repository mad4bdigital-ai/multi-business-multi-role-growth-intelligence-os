export const SECRET_KEY_SUBSTRINGS = Object.freeze([
  "password", "passwd", "secret", "token", "credential", "private_key",
  "api_key", "apikey", "auth_key", "authkey", "cmskey", "appkey", "app_key",
  "client_secret", "access_token", "refresh_token", "encrypted",
]);

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function isSensitiveRequestKey(key) {
  const normalized = String(key || "").toLowerCase();
  return UNSAFE_OBJECT_KEYS.has(normalized)
    || SECRET_KEY_SUBSTRINGS.some((substring) => normalized.includes(substring));
}

function sanitizeNestedValue(value, path, dropped, ancestors) {
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) {
    dropped.push(path);
    return null;
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    const sanitized = value.map((item, index) => (
      sanitizeNestedValue(item, `${path}[${index}]`, dropped, ancestors)
    ));
    ancestors.delete(value);
    return sanitized;
  }

  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isSensitiveRequestKey(key)) {
      dropped.push(childPath);
      continue;
    }
    Object.defineProperty(sanitized, key, {
      value: sanitizeNestedValue(child, childPath, dropped, ancestors),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  ancestors.delete(value);
  return sanitized;
}

export function sanitizeMetadataPayload(rawBody, allowlist = null) {
  const source = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
    ? rawBody
    : {};
  const sanitized = {};
  const dropped = [];

  for (const [key, value] of Object.entries(source)) {
    if (key === "tenant_id" || key === "user_id" || isSensitiveRequestKey(key)) {
      dropped.push(key);
      continue;
    }
    if (allowlist && !allowlist.has(key)) {
      dropped.push(key);
      continue;
    }
    Object.defineProperty(sanitized, key, {
      value: sanitizeNestedValue(value, key, dropped, new WeakSet()),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return { sanitized, dropped: [...new Set(dropped)] };
}

export function findSensitiveRequestPaths(rawBody, { maxPaths = 32 } = {}) {
  if (!rawBody || typeof rawBody !== "object") return [];
  const found = [];
  const visited = new WeakSet();

  function visit(value, path = "") {
    if (!value || typeof value !== "object" || found.length >= maxPaths || visited.has(value)) return;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (found.length >= maxPaths) break;
      const childPath = path ? `${path}.${key}` : key;
      if (isSensitiveRequestKey(key)) {
        found.push(childPath);
        continue;
      }
      visit(child, childPath);
    }
  }

  visit(rawBody);
  return found;
}
