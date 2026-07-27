import { mapContextKernelError } from "./errorMapping.js";
import {
  projectContextPin,
  projectContextResolution,
  projectExecutionContext,
  projectExecutionValidation,
} from "./projections.js";
import {
  validateCandidatePageQuery,
  validateContextPinRequest,
  validateContextResolutionRequest,
  validateExecutionContextRequest,
  validateIdentifier,
  validateIdempotencyKey,
} from "./requestValidation.js";

const REQUIRED_OPERATIONS = Object.freeze([
  "createContextResolution",
  "getContextResolution",
  "createContextPin",
  "deleteContextPin",
  "createExecutionContext",
  "validateExecutionContext",
]);

function requireOperations(operations) {
  if (!operations || typeof operations !== "object") throw new TypeError("operations must be an object.");
  for (const name of REQUIRED_OPERATIONS) {
    if (typeof operations[name] !== "function") throw new TypeError(`operations.${name} must be a function.`);
  }
  return operations;
}

function headerValue(req, name) {
  if (typeof req.get === "function") return req.get(name);
  const headers = req.headers || {};
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function requestIdFrom(req) {
  return req.requestId || req.id || headerValue(req, "x-request-id") || null;
}

function defaultPrincipalContext(req) {
  return {
    principal: req.contextKernelPrincipal || null,
    effectiveSubject: req.contextKernelEffectiveSubject || null,
  };
}

function defaultViewMode(req) {
  return req.contextKernelViewMode || "tenant";
}

function validateViewMode(value) {
  if (!["admin", "tenant"].includes(value)) throw new TypeError("Resolved context-kernel view mode must be admin or tenant.");
  return value;
}

function sendNoContent(res) {
  if (typeof res.status === "function") res.status(204);
  if (typeof res.send === "function") return res.send();
  if (typeof res.end === "function") return res.end();
  return res;
}

export function createContextKernelController({
  operations,
  resolvePrincipalContext = defaultPrincipalContext,
  resolveViewMode = defaultViewMode,
}) {
  const api = requireOperations(operations);
  if (typeof resolvePrincipalContext !== "function") throw new TypeError("resolvePrincipalContext must be a function.");
  if (typeof resolveViewMode !== "function") throw new TypeError("resolveViewMode must be a function.");

  function handler(action) {
    return async function contextKernelHandler(req, res) {
      try {
        return await action(req, res);
      } catch (error) {
        const mapped = mapContextKernelError(error, { requestId: requestIdFrom(req) });
        return res.status(mapped.status).json(mapped.body);
      }
    };
  }

  const createContextResolution = handler(async (req, res) => {
    const input = validateContextResolutionRequest(req.body);
    const page = validateCandidatePageQuery(req.query || {});
    const result = await api.createContextResolution({
      input,
      page,
      idempotencyKey: validateIdempotencyKey(headerValue(req, "Idempotency-Key")),
      principalContext: resolvePrincipalContext(req),
    });
    return res.status(201).json(projectContextResolution(result, {
      viewMode: validateViewMode(resolveViewMode(req)),
      ...page,
    }));
  });

  const getContextResolution = handler(async (req, res) => {
    const resolutionId = validateIdentifier(req.params?.resolutionId, "resolutionId");
    const page = validateCandidatePageQuery(req.query || {});
    const result = await api.getContextResolution({
      resolutionId,
      page,
      principalContext: resolvePrincipalContext(req),
    });
    return res.status(200).json(projectContextResolution(result, {
      viewMode: validateViewMode(resolveViewMode(req)),
      ...page,
    }));
  });

  const createContextPin = handler(async (req, res) => {
    const input = validateContextPinRequest(req.body);
    const result = await api.createContextPin({
      input,
      idempotencyKey: validateIdempotencyKey(headerValue(req, "Idempotency-Key")),
      principalContext: resolvePrincipalContext(req),
    });
    return res.status(201).json(projectContextPin(result));
  });

  const deleteContextPin = handler(async (req, res) => {
    const pinId = validateIdentifier(req.params?.pinId, "pinId");
    await api.deleteContextPin({ pinId, principalContext: resolvePrincipalContext(req) });
    return sendNoContent(res);
  });

  const createExecutionContext = handler(async (req, res) => {
    const input = validateExecutionContextRequest(req.body);
    const result = await api.createExecutionContext({
      input,
      idempotencyKey: validateIdempotencyKey(headerValue(req, "Idempotency-Key")),
      principalContext: resolvePrincipalContext(req),
    });
    return res.status(201).json(projectExecutionContext(result, {
      viewMode: validateViewMode(resolveViewMode(req)),
    }));
  });

  const validateExecutionContext = handler(async (req, res) => {
    const contextId = validateIdentifier(req.params?.contextId, "contextId");
    const result = await api.validateExecutionContext({
      contextId,
      principalContext: resolvePrincipalContext(req),
    });
    return res.status(200).json(projectExecutionValidation(result));
  });

  return Object.freeze({
    createContextResolution,
    getContextResolution,
    createContextPin,
    deleteContextPin,
    createExecutionContext,
    validateExecutionContext,
  });
}
