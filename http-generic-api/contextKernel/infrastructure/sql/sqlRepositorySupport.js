function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

export function cleanRequired(value, fieldName) {
  return requireNonEmptyString(value, fieldName);
}

export function cleanOptional(value) {
  if (value == null || value === "") return null;
  return String(value).trim() || null;
}

export function parseJsonValue(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toBoolean(value) {
  return value === true || value === 1 || String(value || "").trim().toLowerCase() === "true";
}

export function clampLimit(value, { defaultValue = 100, maximum = 500 } = {}) {
  const parsed = Number.parseInt(String(value ?? defaultValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(parsed, maximum);
}

export function createSqlExecutor({ pool = null, resolvePool = null, adapterName = "Context kernel" } = {}) {
  if (!pool && typeof resolvePool !== "function") {
    throw new TypeError(`${adapterName} repository requires a SQL pool or lazy resolvePool function.`);
  }

  async function activeExecutor() {
    const executor = pool || await resolvePool();
    if (!executor || (typeof executor.execute !== "function" && typeof executor.query !== "function")) {
      throw new TypeError(`${adapterName} repository pool resolver returned an invalid SQL executor.`);
    }
    return executor;
  }

  async function execute(sql, params = []) {
    const executor = await activeExecutor();
    const method = typeof executor.execute === "function" ? executor.execute : executor.query;
    const result = await method.call(executor, sql, params);
    if (!Array.isArray(result)) return [];
    return Array.isArray(result[0]) ? result[0] : [];
  }

  return Object.freeze({ execute });
}

export function requireUniqueRow(rows, {
  code,
  entityName,
  details = {},
} = {}) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  if (normalizedRows.length > 1) {
    const error = new Error(`${entityName || "Context record"} is ambiguous.`);
    error.code = code || "context_record_ambiguous";
    error.status = 409;
    error.details = {
      ...details,
      candidate_count: normalizedRows.length,
    };
    throw error;
  }
  return normalizedRows[0] || null;
}

export function unsupportedRepositoryWrite(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 501;
  error.details = { ...details };
  return error;
}

export function freezeRecord(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) freezeRecord(child);
  return Object.freeze(value);
}

export function freezeRecords(rows) {
  return Object.freeze((Array.isArray(rows) ? rows : []).map((row) => freezeRecord(row)));
}

export const _testingSqlRepositorySupport = Object.freeze({
  requireNonEmptyString,
});
