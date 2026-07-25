import { randomUUID } from "node:crypto";
import { getOperationContract, normalizeOperationKey } from "./operationContractRegistry.js";

const FALLBACK_BUDGET = Object.freeze({
  max_elapsed_ms: 15000,
  max_response_chars: 30000,
});

const TRANSIENT_STATUS_METADATA = Object.freeze({
  502: Object.freeze({
    code: "OPERATION_BAD_GATEWAY",
    message: "The upstream operation returned an invalid gateway response.",
  }),
  503: Object.freeze({
    code: "OPERATION_DEPENDENCY_UNAVAILABLE",
    message: "A governed operation dependency is temporarily unavailable.",
  }),
  504: Object.freeze({
    code: "OPERATION_GATEWAY_TIMEOUT",
    message: "The upstream operation exceeded its gateway timeout.",
  }),
  522: Object.freeze({
    code: "OPERATION_UPSTREAM_CONNECTION_TIMEOUT",
    message: "The upstream operation connection timed out.",
  }),
  524: Object.freeze({
    code: "OPERATION_UPSTREAM_RESPONSE_TIMEOUT",
    message: "The upstream operation did not respond before the timeout.",
  }),
});

const TRANSIENT_STATUS_CODES = new Set(
  Object.keys(TRANSIENT_STATUS_METADATA).map((status) => Number(status)),
);

const TRANSPORT_TIMEOUT_CODES = new Set([
  "ABORT_ERR",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const TRANSPORT_CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
]);

function compact(value, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function bodyOf(req = {}) {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  if (body.tool_args && typeof body.tool_args === "object" && !Array.isArray(body.tool_args)) return body.tool_args;
  if (body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)) return body.arguments;
  return body;
}

function resolveBudget(req = {}) {
  const body = bodyOf(req);
  const operationKey = normalizeOperationKey(body.operation_key || body.operation || body.intent);
  if (!operationKey) {
    return { ...FALLBACK_BUDGET, operation_key: null, enforce_budget: false };
  }
  try {
    const contract = getOperationContract(operationKey);
    return {
      ...FALLBACK_BUDGET,
      ...contract.budget,
      operation_key: contract.operation_key,
      enforce_budget: true,
    };
  } catch {
    return { ...FALLBACK_BUDGET, operation_key: compact(operationKey, 128) || null, enforce_budget: false };
  }
}

function requestIdOf(req = {}, createRequestId = randomUUID) {
  const existing = compact(
    req?.headers?.["x-request-id"]
    || req?.headers?.["x-correlation-id"]
    || req?.requestId
    || req?.id
    || req?.operationRequestId,
    191,
  );
  if (existing) {
    req.operationRequestId = existing;
    return existing;
  }

  const generated = `req_${compact(createRequestId(), 128)}`;
  req.operationRequestId = generated;
  return generated;
}

function withRetryableDetails(details, retryable) {
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return {
      ...details,
      retryable: typeof details.retryable === "boolean" ? details.retryable : retryable,
    };
  }
  if (Array.isArray(details)) return details;
  return {
    context: details == null ? null : compact(details, 500),
    retryable,
  };
}

function errorEnvelope(
  req,
  code,
  message,
  details = null,
  retryable = false,
  createRequestId = randomUUID,
) {
  return {
    ok: false,
    error: {
      code,
      message,
      details: withRetryableDetails(details, retryable),
      requestId: requestIdOf(req, createRequestId),
      retryable,
    },
    secrets_included: false,
  };
}

function isStructuredError(payload) {
  return Boolean(
    payload
    && typeof payload === "object"
    && payload.error
    && typeof payload.error.code === "string"
    && typeof payload.error.message === "string",
  );
}

function normalizeStructuredTransientError(payload, requestId) {
  const currentRetryable = payload?.error?.retryable;
  return {
    ...payload,
    ok: false,
    error: {
      ...payload.error,
      details: withRetryableDetails(payload.error.details, true),
      requestId: compact(payload.error.requestId, 191) || requestId,
      retryable: typeof currentRetryable === "boolean" ? currentRetryable : true,
    },
    secrets_included: false,
  };
}

function transientStatusMetadata(statusCode) {
  return TRANSIENT_STATUS_METADATA[Number(statusCode)] || TRANSIENT_STATUS_METADATA[503];
}

function resolveTransientErrorStatus(error = {}) {
  const explicitStatus = Number(
    error?.statusCode
    ?? error?.status
    ?? error?.response?.status,
  );
  if (TRANSIENT_STATUS_CODES.has(explicitStatus)) return explicitStatus;

  const code = compact(error?.code, 64).toUpperCase();
  const name = compact(error?.name, 64).toUpperCase();
  if (TRANSPORT_TIMEOUT_CODES.has(code) || name === "ABORTERROR") return 504;
  if (TRANSPORT_CONNECTION_CODES.has(code)) return 503;
  return null;
}

export function createOperationRuntimeGuard({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  stringify = JSON.stringify,
  byteLength = (value) => Buffer.byteLength(value, "utf8"),
  createRequestId = randomUUID,
} = {}) {
  return function operationRuntimeGuard(req, res, next) {
    const budget = resolveBudget(req);
    const enforceBudget = budget.enforce_budget === true;
    const startedAt = Date.now();
    const requestId = requestIdOf(req, createRequestId);
    const originalJson = res.json.bind(res);
    const originalSend = typeof res.send === "function" ? res.send.bind(res) : originalJson;
    const originalStatus = res.status.bind(res);
    let bypassGuard = false;
    let settled = false;

    res.setHeader?.("x-request-id", requestId);

    const cleanup = () => {
      if (timer) clearTimer(timer);
    };

    const invokeOriginal = (sender, payload) => {
      bypassGuard = true;
      try {
        return sender(payload);
      } finally {
        bypassGuard = false;
      }
    };

    const sendGuardError = (statusCode, code, message, details, retryable) => {
      if (settled || res.headersSent) return res;
      settled = true;
      cleanup();
      originalStatus(statusCode);
      return invokeOriginal(
        originalJson,
        errorEnvelope(req, code, message, details, retryable, createRequestId),
      );
    };

    const serializeForBudget = (payload) => {
      if (typeof payload === "string") return payload;
      if (Buffer.isBuffer(payload)) return payload;
      return stringify(payload);
    };

    const settleAndSend = (payload, sender) => {
      if (!enforceBudget) {
        settled = true;
        cleanup();
        return invokeOriginal(sender, payload);
      }

      let serialized;
      try {
        serialized = serializeForBudget(payload);
      } catch {
        return sendGuardError(
          503,
          "OPERATION_RESPONSE_SERIALIZATION_FAILED",
          "The operation response could not be serialized safely.",
          { operation_key: budget.operation_key },
          false,
        );
      }

      const responseBytes = byteLength(serialized);
      if (responseBytes > budget.max_response_chars) {
        return sendGuardError(
          503,
          "OPERATION_RESPONSE_BUDGET_EXCEEDED",
          "The operation response exceeded its bounded response budget.",
          {
            operation_key: budget.operation_key,
            max_response_chars: budget.max_response_chars,
            actual_response_chars: responseBytes,
            guidance: "Retry with response_mode=summary or use a paginated detail endpoint.",
          },
          false,
        );
      }

      settled = true;
      cleanup();
      res.setHeader?.("x-operation-elapsed-ms", String(Math.max(0, Date.now() - startedAt)));
      res.setHeader?.("x-operation-response-bytes", String(responseBytes));
      return invokeOriginal(sender, payload);
    };

    const guardPayload = (payload, sender) => {
      if (bypassGuard) return sender(payload);
      if (settled) return res;

      const statusCode = Number(res.statusCode);
      if (TRANSIENT_STATUS_CODES.has(statusCode)) {
        if (isStructuredError(payload)) {
          return settleAndSend(
            normalizeStructuredTransientError(payload, requestId),
            originalJson,
          );
        }

        const metadata = transientStatusMetadata(statusCode);
        return sendGuardError(
          statusCode,
          metadata.code,
          metadata.message,
          {
            operation_key: budget.operation_key,
            upstream_status: statusCode,
          },
          true,
        );
      }

      return settleAndSend(payload, sender);
    };

    const timer = enforceBudget
      ? setTimer(() => {
        sendGuardError(
          503,
          "OPERATION_TIMEOUT",
          "The operation exceeded its execution budget.",
          {
            operation_key: budget.operation_key,
            max_elapsed_ms: budget.max_elapsed_ms,
          },
          true,
        );
      }, budget.max_elapsed_ms)
      : null;

    res.on?.("finish", cleanup);
    res.on?.("close", cleanup);

    res.json = function guardedJson(payload) {
      return guardPayload(payload, originalJson);
    };

    res.send = function guardedSend(payload) {
      return guardPayload(payload, originalSend);
    };

    return next();
  };
}

export function createOperationRuntimeErrorHandler({
  createRequestId = randomUUID,
  logger = console,
} = {}) {
  return function operationRuntimeErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    const statusCode = resolveTransientErrorStatus(error);
    if (!statusCode) return next(error);

    const requestId = requestIdOf(req, createRequestId);
    const metadata = transientStatusMetadata(statusCode);
    const transportCode = compact(error?.code || error?.name, 64) || null;

    logger.warn?.("[operation-runtime] transient transport error normalized.", {
      statusCode,
      transportCode,
      requestId,
    });

    res.setHeader?.("x-request-id", requestId);
    return res.status(statusCode).json(
      errorEnvelope(
        req,
        metadata.code,
        metadata.message,
        {
          operation_key: resolveBudget(req).operation_key,
          transport_code: transportCode,
        },
        true,
        createRequestId,
      ),
    );
  };
}

export const _testingOperationRuntimeGuard = {
  bodyOf,
  resolveBudget,
  requestIdOf,
  errorEnvelope,
  isStructuredError,
  normalizeStructuredTransientError,
  resolveTransientErrorStatus,
  transientStatusMetadata,
};
