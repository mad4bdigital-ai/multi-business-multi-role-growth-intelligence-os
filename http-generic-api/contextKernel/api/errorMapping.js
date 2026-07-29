import { ContextApplicationError, sanitizeApplicationValue } from "../application/index.js";
import { ContextApiValidationError, freezeApiValue } from "./apiSupport.js";

function normalizeStatus(value, fallback = 500) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback;
}

function normalizeDetails(value) {
  if (value == null) return undefined;
  const sanitized = sanitizeApplicationValue(value);
  if (Array.isArray(sanitized)) return sanitized.length > 0 ? sanitized : undefined;
  if (sanitized && typeof sanitized === "object" && Object.keys(sanitized).length > 0) return [sanitized];
  return undefined;
}

export function mapContextKernelError(error, { requestId = null } = {}) {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "An unexpected internal error occurred.";
  let details;

  if (error instanceof ContextApiValidationError) {
    status = 400;
    code = error.code;
    message = error.message;
    details = normalizeDetails(error.details);
  } else if (error instanceof ContextApplicationError) {
    status = normalizeStatus(error.status, 409);
    code = error.code || "CONTEXT_APPLICATION_ERROR";
    message = error.message || "The context operation could not be completed.";
    details = normalizeDetails(error.details);
  } else if (error instanceof TypeError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = error.message || "The request is invalid.";
  } else if (error && typeof error === "object" && Number.isInteger(error.status) && typeof error.code === "string") {
    status = normalizeStatus(error.status);
    code = error.code;
    message = typeof error.message === "string" && error.message.trim() !== ""
      ? error.message
      : "The context operation could not be completed.";
    details = normalizeDetails(error.details);
  }

  const body = {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(typeof requestId === "string" && requestId.trim() !== "" ? { requestId: requestId.trim() } : {}),
    },
  };
  return freezeApiValue({ status, body });
}
