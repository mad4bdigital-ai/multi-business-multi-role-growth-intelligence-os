import { redis as defaultRedis } from "./queue.js";
import { getOperationContract, normalizeOperationKey } from "./operationContractRegistry.js";

const DEFAULTS = Object.freeze({
  rate_window_ms: Math.max(1_000, Number(process.env.OPERATION_RATE_LIMIT_WINDOW_MS || 60_000)),
  rate_limit_read: Math.max(1, Number(process.env.OPERATION_RATE_LIMIT_READ || 120)),
  rate_limit_mutation: Math.max(1, Number(process.env.OPERATION_RATE_LIMIT_MUTATION || 30)),
  circuit_failure_threshold: Math.max(1, Number(process.env.OPERATION_CIRCUIT_FAILURE_THRESHOLD || 3)),
  circuit_cooldown_ms: Math.max(1_000, Number(process.env.OPERATION_CIRCUIT_COOLDOWN_MS || 30_000)),
  local_entry_limit: Math.max(100, Number(process.env.OPERATION_RESILIENCE_LOCAL_ENTRY_LIMIT || 5_000)),
});

const localRateWindows = new Map();
const localCircuits = new Map();

function compact(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function bodyOf(req = {}) {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  if (body.tool_args && typeof body.tool_args === "object" && !Array.isArray(body.tool_args)) return body.tool_args;
  if (body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)) return body.arguments;
  return body;
}

function principalIdentity(req = {}) {
  const auth = req.auth || {};
  const tenantId = compact(auth.tenant_id, 64);
  const userId = compact(auth.user_id || auth.admin_id, 64);
  if (auth.mode === "user_jwt" && tenantId && userId) return `tenant:${tenantId}:user:${userId}`;
  if (
    auth.is_admin === true
    || ["backend_api", "admin", "service", "service_account"].includes(
      compact(auth.mode || auth.caller_type, 64).toLowerCase(),
    )
  ) {
    return `admin:${userId || compact(auth.caller_type || auth.mode, 64) || "platform"}`;
  }
  return `anonymous:${compact(req.ip || req.socket?.remoteAddress || "unknown", 96)}`;
}

function operationIdentity(req = {}) {
  const body = bodyOf(req);
  const operationKey = normalizeOperationKey(body.operation_key || body.operation || body.intent);
  if (operationKey) return operationKey;
  const method = compact(req.method || "GET", 12).toUpperCase();
  const route = compact(req.originalUrl || req.baseUrl || req.path || "unknown", 300);
  return `route:${method}:${route}`;
}

function resolveExecutionClass(operationKey) {
  if (!operationKey || operationKey.startsWith("route:")) return "read_only";
  try {
    return getOperationContract(operationKey).execution_class || "read_only";
  } catch {
    return "read_only";
  }
}

function pruneMap(map, maxEntries) {
  while (map.size > maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function errorEnvelope(req, code, message, details = null) {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
      requestId: req?.headers?.["x-request-id"] || null,
    },
    secrets_included: false,
  };
}

function redisReady(client) {
  return Boolean(client && String(client.status || "").toLowerCase() === "ready");
}

function rateKey(principal, operationKey, bucket) {
  return `oprl:${encodeURIComponent(principal)}:${encodeURIComponent(operationKey)}:${bucket}`;
}

function circuitKey(operationKey) {
  return `opcb:${encodeURIComponent(operationKey)}`;
}

function consumeLocalRate({ key, limit, windowMs, now, maxEntries }) {
  const existing = localRateWindows.get(key);
  const row = !existing || existing.reset_at <= now
    ? { count: 0, reset_at: now + windowMs }
    : existing;
  row.count += 1;
  localRateWindows.delete(key);
  localRateWindows.set(key, row);
  pruneMap(localRateWindows, maxEntries);
  const retryAfterMs = Math.max(0, row.reset_at - now);
  return {
    allowed: row.count <= limit,
    count: row.count,
    limit,
    remaining: Math.max(0, limit - row.count),
    reset_at: row.reset_at,
    retry_after_seconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
    source: "local_memory",
  };
}

async function consumeRateLimit({
  principal,
  operationKey,
  limit,
  windowMs,
  now,
  redisClient = defaultRedis,
  maxEntries = DEFAULTS.local_entry_limit,
}) {
  const bucket = Math.floor(now / windowMs);
  const key = `${principal}:${operationKey}:${bucket}`;
  if (!redisReady(redisClient)) {
    return consumeLocalRate({ key, limit, windowMs, now, maxEntries });
  }

  try {
    const redisCounterKey = rateKey(principal, operationKey, bucket);
    const count = await redisClient.incr(redisCounterKey);
    if (count === 1) await redisClient.pexpire(redisCounterKey, windowMs + 1_000);
    const bucketEnd = (bucket + 1) * windowMs;
    return {
      allowed: count <= limit,
      count,
      limit,
      remaining: Math.max(0, limit - count),
      reset_at: bucketEnd,
      retry_after_seconds: Math.max(1, Math.ceil((bucketEnd - now) / 1_000)),
      source: "redis",
    };
  } catch {
    return consumeLocalRate({ key, limit, windowMs, now, maxEntries });
  }
}

function readLocalCircuit(key) {
  return localCircuits.get(key) || { failures: 0, open_until: 0, half_open_in_flight: false };
}

function checkLocalCircuit({ key, now, cooldownMs, maxEntries }) {
  const state = readLocalCircuit(key);
  if (state.open_until > now) {
    return {
      allowed: false,
      state: "open",
      retry_after_seconds: Math.max(1, Math.ceil((state.open_until - now) / 1_000)),
      source: "local_memory",
    };
  }

  if (state.open_until > 0 && state.open_until <= now) {
    if (state.half_open_in_flight) {
      return {
        allowed: false,
        state: "half_open",
        retry_after_seconds: Math.max(1, Math.ceil(cooldownMs / 1_000)),
        source: "local_memory",
      };
    }
    const next = { ...state, half_open_in_flight: true };
    localCircuits.delete(key);
    localCircuits.set(key, next);
    pruneMap(localCircuits, maxEntries);
    return {
      allowed: true,
      state: "half_open_probe",
      retry_after_seconds: 0,
      source: "local_memory",
    };
  }

  return {
    allowed: true,
    state: "closed",
    retry_after_seconds: 0,
    source: "local_memory",
  };
}

function recordLocalCircuit({ key, statusCode, threshold, cooldownMs, now, maxEntries }) {
  if (statusCode < 500) {
    localCircuits.delete(key);
    return { state: "closed", failures: 0, source: "local_memory" };
  }

  const current = readLocalCircuit(key);
  const failures = Number(current.failures || 0) + 1;
  const next = {
    failures,
    open_until: failures >= threshold ? now + cooldownMs : 0,
    half_open_in_flight: false,
  };
  localCircuits.delete(key);
  localCircuits.set(key, next);
  pruneMap(localCircuits, maxEntries);
  return {
    state: next.open_until > now ? "open" : "closed",
    failures,
    open_until: next.open_until,
    source: "local_memory",
  };
}

async function checkCircuit({
  operationKey,
  now,
  cooldownMs,
  redisClient = defaultRedis,
  maxEntries = DEFAULTS.local_entry_limit,
}) {
  const key = operationKey;
  if (!redisReady(redisClient)) {
    return checkLocalCircuit({ key, now, cooldownMs, maxEntries });
  }

  try {
    const redisKey = circuitKey(operationKey);
    const state = await redisClient.hgetall(redisKey);
    const openUntil = Number(state?.open_until || 0);
    if (openUntil > now) {
      return {
        allowed: false,
        state: "open",
        retry_after_seconds: Math.max(1, Math.ceil((openUntil - now) / 1_000)),
        source: "redis",
      };
    }

    if (openUntil > 0 && openUntil <= now) {
      const probeKey = `${redisKey}:probe`;
      const acquired = await redisClient.set(probeKey, "1", "PX", cooldownMs, "NX");
      if (!acquired) {
        return {
          allowed: false,
          state: "half_open",
          retry_after_seconds: Math.max(1, Math.ceil(cooldownMs / 1_000)),
          source: "redis",
        };
      }
      return {
        allowed: true,
        state: "half_open_probe",
        retry_after_seconds: 0,
        source: "redis",
      };
    }

    return {
      allowed: true,
      state: "closed",
      retry_after_seconds: 0,
      source: "redis",
    };
  } catch {
    return checkLocalCircuit({ key, now, cooldownMs, maxEntries });
  }
}

async function recordCircuitOutcome({
  operationKey,
  statusCode,
  threshold,
  cooldownMs,
  now,
  redisClient = defaultRedis,
  maxEntries = DEFAULTS.local_entry_limit,
}) {
  const key = operationKey;
  if (!redisReady(redisClient)) {
    return recordLocalCircuit({ key, statusCode, threshold, cooldownMs, now, maxEntries });
  }

  try {
    const redisKey = circuitKey(operationKey);
    if (statusCode < 500) {
      await redisClient.del(redisKey, `${redisKey}:probe`);
      return { state: "closed", failures: 0, source: "redis" };
    }

    const failures = await redisClient.hincrby(redisKey, "failures", 1);
    const multi = redisClient.multi();
    multi.hset(redisKey, "updated_at", String(now));
    multi.pexpire(redisKey, Math.max(cooldownMs * 3, 60_000));
    if (failures >= threshold) {
      multi.hset(redisKey, "open_until", String(now + cooldownMs));
      multi.del(`${redisKey}:probe`);
    }
    await multi.exec();
    return {
      state: failures >= threshold ? "open" : "closed",
      failures,
      open_until: failures >= threshold ? now + cooldownMs : 0,
      source: "redis",
    };
  } catch {
    return recordLocalCircuit({ key, statusCode, threshold, cooldownMs, now, maxEntries });
  }
}

function resolvePolicy(req, overrides = {}) {
  const operationKey = operationIdentity(req);
  const executionClass = resolveExecutionClass(operationKey);
  const readLimit = Math.max(1, Number(overrides.rateLimitRead || DEFAULTS.rate_limit_read));
  const mutationLimit = Math.max(1, Number(overrides.rateLimitMutation || DEFAULTS.rate_limit_mutation));
  return {
    operation_key: operationKey,
    execution_class: executionClass,
    principal: principalIdentity(req),
    rate_limit: executionClass === "mutation" ? mutationLimit : readLimit,
    rate_window_ms: Math.max(1_000, Number(overrides.rateWindowMs || DEFAULTS.rate_window_ms)),
    circuit_failure_threshold: Math.max(
      1,
      Number(overrides.circuitFailureThreshold || DEFAULTS.circuit_failure_threshold),
    ),
    circuit_cooldown_ms: Math.max(
      1_000,
      Number(overrides.circuitCooldownMs || DEFAULTS.circuit_cooldown_ms),
    ),
    local_entry_limit: Math.max(100, Number(overrides.localEntryLimit || DEFAULTS.local_entry_limit)),
  };
}

export function createOperationResilienceController({
  redisClient = defaultRedis,
  now = () => Date.now(),
  rateLimitRead,
  rateLimitMutation,
  rateWindowMs,
  circuitFailureThreshold,
  circuitCooldownMs,
  localEntryLimit,
} = {}) {
  const overrides = {
    rateLimitRead,
    rateLimitMutation,
    rateWindowMs,
    circuitFailureThreshold,
    circuitCooldownMs,
    localEntryLimit,
  };

  return async function operationResilienceController(req, res, next) {
    const policy = resolvePolicy(req, overrides);
    const nowMs = Number(now());

    const rate = await consumeRateLimit({
      principal: policy.principal,
      operationKey: policy.operation_key,
      limit: policy.rate_limit,
      windowMs: policy.rate_window_ms,
      now: nowMs,
      redisClient,
      maxEntries: policy.local_entry_limit,
    });

    res.setHeader?.("x-rate-limit-limit", String(rate.limit));
    res.setHeader?.("x-rate-limit-remaining", String(rate.remaining));
    res.setHeader?.("x-rate-limit-reset", String(Math.ceil(rate.reset_at / 1_000)));
    res.setHeader?.("x-operation-resilience-store", rate.source);

    if (!rate.allowed) {
      res.setHeader?.("Retry-After", String(rate.retry_after_seconds));
      return res.status(429).json(errorEnvelope(
        req,
        "OPERATION_RATE_LIMITED",
        "The operation rate limit was exceeded.",
        {
          operation_key: policy.operation_key,
          limit: rate.limit,
          window_ms: policy.rate_window_ms,
          retry_after_seconds: rate.retry_after_seconds,
          retryable: true,
        },
      ));
    }

    const circuit = await checkCircuit({
      operationKey: policy.operation_key,
      now: nowMs,
      cooldownMs: policy.circuit_cooldown_ms,
      redisClient,
      maxEntries: policy.local_entry_limit,
    });

    res.setHeader?.("x-operation-circuit-state", circuit.state);
    if (!circuit.allowed) {
      res.setHeader?.("Retry-After", String(circuit.retry_after_seconds));
      return res.status(503).json(errorEnvelope(
        req,
        "OPERATION_CIRCUIT_OPEN",
        "The operation circuit breaker is open.",
        {
          operation_key: policy.operation_key,
          circuit_state: circuit.state,
          retry_after_seconds: circuit.retry_after_seconds,
          retryable: true,
        },
      ));
    }

    const originalJson = res.json.bind(res);
    let outcomeRecorded = false;
    const recordOutcome = () => {
      if (outcomeRecorded) return;
      outcomeRecorded = true;
      Promise.resolve(recordCircuitOutcome({
        operationKey: policy.operation_key,
        statusCode: Number(res.statusCode || 200),
        threshold: policy.circuit_failure_threshold,
        cooldownMs: policy.circuit_cooldown_ms,
        now: Number(now()),
        redisClient,
        maxEntries: policy.local_entry_limit,
      })).catch(() => {});
    };

    res.json = function resilientJson(payload) {
      recordOutcome();
      return originalJson(payload);
    };
    res.on?.("finish", recordOutcome);
    res.on?.("close", recordOutcome);

    return next();
  };
}

export function resetOperationResilienceState() {
  localRateWindows.clear();
  localCircuits.clear();
}

export const _testingOperationResilienceController = {
  DEFAULTS,
  bodyOf,
  principalIdentity,
  operationIdentity,
  resolveExecutionClass,
  resolvePolicy,
  consumeLocalRate,
  consumeRateLimit,
  checkLocalCircuit,
  recordLocalCircuit,
  checkCircuit,
  recordCircuitOutcome,
  errorEnvelope,
};
