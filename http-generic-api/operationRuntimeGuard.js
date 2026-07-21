import { getOperationContract, normalizeOperationKey } from "./operationContractRegistry.js";

const FALLBACK_BUDGET = Object.freeze({
  max_elapsed_ms: 15000,
  max_response_chars: 30000,
});

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
  if (!operationKey) return { ...FALLBACK_BUDGET, operation_key: null };
  try {
    const contract = getOperationContract(operationKey);
    return { ...FALLBACK_BUDGET, ...contract.budget, operation_key: contract.operation_key };
  } catch {
    return { ...FALLBACK_BUDGET, operation_key: compact(operationKey, 128) || null };
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

function isStructuredError(payload) {
  return Boolean(
    payload
    && typeof payload === "object"
    && payload.ok === false
    && payload.error
    && typeof payload.error.code === "string"
    && typeof payload.error.message === "string",
  );
}

export function createOperationRuntimeGuard({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  stringify = JSON.stringify,
  byteLength = (value) => Buffer.byteLength(value, "utf8"),
} = {}) {
  return function operationRuntimeGuard(req, res, next) {
    const budget = resolveBudget(req);
    const startedAt = Date.now();
    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimer(timer);
    };

    const sendGuardError = (code, message, details) => {
      if (settled || res.headersSent) return res;
      settled = true;
      cleanup();
      originalStatus(503);
      return originalJson(errorEnvelope(req, code, message, details));
    };

    const timer = setTimer(() => {
      sendGuardError(
        "OPERATION_TIMEOUT",
        "The operation exceeded its execution budget.",
        {
          operation_key: budget.operation_key,
          max_elapsed_ms: budget.max_elapsed_ms,
          retryable: true,
        },
      );
    }, budget.max_elapsed_ms);

    res.on?.("finish", cleanup);
    res.on?.("close", cleanup);

    res.json = function guardedJson(payload) {
      if (settled) return res;

      if (Number(res.statusCode) === 503 && !isStructuredError(payload)) {
        return sendGuardError(
          "OPERATION_DEPENDENCY_UNAVAILABLE",
          "A governed operation dependency is temporarily unavailable.",
          {
            operation_key: budget.operation_key,
            retryable: true,
          },
        );
      }

      let serialized;
      try {
        serialized = stringify(payload);
      } catch {
        return sendGuardError(
          "OPERATION_RESPONSE_SERIALIZATION_FAILED",
          "The operation response could not be serialized safely.",
          {
            operation_key: budget.operation_key,
            retryable: false,
          },
        );
      }

      const responseBytes = byteLength(serialized);
      if (responseBytes > budget.max_response_chars) {
        return sendGuardError(
          "OPERATION_RESPONSE_BUDGET_EXCEEDED",
          "The operation response exceeded its bounded response budget.",
          {
            operation_key: budget.operation_key,
            max_response_chars: budget.max_response_chars,
            actual_response_chars: responseBytes,
            guidance: "Retry with response_mode=summary or use a paginated detail endpoint.",
            retryable: false,
          },
        );
      }

      settled = true;
      cleanup();
      res.setHeader?.("x-operation-elapsed-ms", String(Math.max(0, Date.now() - startedAt)));
      res.setHeader?.("x-operation-response-bytes", String(responseBytes));
      return originalJson(payload);
    };

    return next();
  };
}

export const _testingOperationRuntimeGuard = {
  bodyOf,
  resolveBudget,
  errorEnvelope,
  isStructuredError,
};
