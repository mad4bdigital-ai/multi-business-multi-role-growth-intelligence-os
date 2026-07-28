import {
  createAuthenticatedPrincipal,
  createEffectiveSubject,
  deepFreeze,
} from "../domain/index.js";

const BRAND_RESOURCE_KEYS = new Set([
  "brand",
  "brands",
  "brand_core",
  "brand_cores",
  "brand-core",
  "brand-cores",
]);

function cleanString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizedResourceKey(value) {
  return cleanString(value)?.toLowerCase() || null;
}

function routeKeyFor({ resourceType, resourceRef }) {
  if (resourceRef) return "tenant_resource_get";
  if (resourceType) return "tenant_resource_list";
  return "tenant_resource_catalog";
}

function operationIntentFor(routeKey) {
  switch (routeKey) {
    case "tenant_resource_get":
      return "resource_item_read";
    case "tenant_resource_list":
      return "resource_collection_read";
    default:
      return "resource_catalog_read";
  }
}

function nowMilliseconds(clock) {
  const value = clock();
  if (value instanceof Date) return value.getTime();
  if (Number.isFinite(Number(value))) return Number(value);
  throw new TypeError("clock must return a Date or finite timestamp.");
}

function selectedCandidateFrom(result) {
  return result?.selectedCandidate || result?.context?.selectedCandidate || null;
}

function candidateCountFrom(result) {
  if (Array.isArray(result?.candidates)) return result.candidates.length;
  if (Array.isArray(result?.authorizedCandidates)) return result.authorizedCandidates.length;
  return 0;
}

function safeReasonCodes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim()))].sort();
}

function comparisonOutcome(result, evidence) {
  if (!result || typeof result !== "object") return "invalid_shadow_result";
  if (result.status !== "resolved") return cleanString(result.status) || "unresolved";
  if (!evidence.resourceRef) return "observed";
  const selected = selectedCandidateFrom(result);
  const matched = selected?.stableRef === evidence.resourceRef || selected?.resourceRef === evidence.resourceRef;
  return matched ? "matched" : "mismatched";
}

function baseTelemetry(evidence, legacyStatusCode, durationMs) {
  return {
    eventType: "context_kernel_resource_shadow",
    shadowMode: true,
    routeKey: evidence.routeKey,
    operationIntent: evidence.operationIntent,
    tenantRef: evidence.pathTenantRef,
    resourceType: evidence.resourceType,
    resourceRef: evidence.resourceRef,
    brandScoped: evidence.brandScoped,
    legacyStatusCode: Number.isInteger(legacyStatusCode) ? legacyStatusCode : null,
    durationMs: Math.max(0, Math.round(durationMs)),
    providerDispatchPerformed: false,
    legacyResponseModified: false,
    secretsIncluded: false,
  };
}

async function emitSafely(emitTelemetry, event) {
  try {
    await emitTelemetry(deepFreeze(event));
  } catch {
    // Shadow telemetry must never affect the completed legacy request.
  }
}

export function buildResourceApiShadowEvidence(req = {}) {
  const userRef = cleanString(req.auth?.user_id);
  const authTenantRef = cleanString(req.auth?.tenant_id);
  const pathTenantRef = cleanString(req.params?.tenant_id);
  const rawResourceType = normalizedResourceKey(req.params?.resourceKey);
  const resourceRef = cleanString(req.params?.resourceId);
  const brandScoped = BRAND_RESOURCE_KEYS.has(rawResourceType);
  const resourceType = brandScoped ? "brand" : rawResourceType;
  const routeKey = routeKeyFor({ resourceType, resourceRef });
  const operationIntent = operationIntentFor(routeKey);
  const crossTenantMismatch = Boolean(authTenantRef && pathTenantRef && authTenantRef !== pathTenantRef);
  const contextComplete = Boolean(userRef && pathTenantRef);

  let resolutionInput = null;
  if (contextComplete && !crossTenantMismatch) {
    resolutionInput = {
      principal: createAuthenticatedPrincipal({
        principalType: "tenant_user",
        principalRef: userRef,
        authorizedTenantRefs: authTenantRef ? [authTenantRef] : [],
      }),
      effectiveSubject: createEffectiveSubject({
        subjectType: "tenant_user",
        subjectRef: userRef,
        tenantRef: pathTenantRef,
      }),
      tenantRef: pathTenantRef,
      userRef,
      resourceType,
      resourceRef,
      explicitRef: resourceRef,
      operationIntent,
      operationKind: "read",
      riskClass: "read",
      allowLowRiskFallback: false,
      candidateLimit: 25,
    };
  }

  return deepFreeze({
    userRef,
    authTenantRef,
    pathTenantRef,
    resourceType,
    resourceRef,
    brandScoped,
    routeKey,
    operationIntent,
    crossTenantMismatch,
    contextComplete,
    resolutionInput,
  });
}

export function createResourceApiContextShadowMiddleware({
  enabled = false,
  resolutionService = null,
  emitTelemetry = null,
  clock = () => Date.now(),
  schedule = (task) => queueMicrotask(() => {
    void task();
  }),
} = {}) {
  if (enabled !== true) {
    return function disabledContextKernelResourceShadow(_req, _res, next) {
      return next();
    };
  }
  if (!resolutionService || typeof resolutionService.resolve !== "function") {
    throw new TypeError("resolutionService.resolve must be a function when shadow mode is enabled.");
  }
  if (typeof emitTelemetry !== "function") {
    throw new TypeError("emitTelemetry must be a function when shadow mode is enabled.");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");
  if (typeof schedule !== "function") throw new TypeError("schedule must be a function.");

  return function contextKernelResourceShadow(req, res, next) {
    const evidence = buildResourceApiShadowEvidence(req);
    const startedAt = nowMilliseconds(clock);

    if (!res || typeof res.once !== "function") return next();

    res.once("finish", () => {
      schedule(async () => {
        const durationMs = nowMilliseconds(clock) - startedAt;
        const common = baseTelemetry(evidence, res.statusCode, durationMs);

        if (!evidence.contextComplete) {
          await emitSafely(emitTelemetry, {
            ...common,
            outcome: "principal_context_incomplete",
            kernelStatus: null,
            reasonCodes: ["principal_context_incomplete"],
            candidateCount: 0,
            selectedStableRef: null,
          });
          return;
        }

        if (evidence.crossTenantMismatch) {
          await emitSafely(emitTelemetry, {
            ...common,
            outcome: "cross_tenant_rejected",
            kernelStatus: "blocked",
            reasonCodes: ["cross_tenant_scope_mismatch"],
            candidateCount: 0,
            selectedStableRef: null,
          });
          return;
        }

        try {
          const result = await resolutionService.resolve(evidence.resolutionInput);
          const selected = selectedCandidateFrom(result);
          await emitSafely(emitTelemetry, {
            ...common,
            outcome: comparisonOutcome(result, evidence),
            kernelStatus: cleanString(result?.status),
            reasonCodes: safeReasonCodes(result?.reasonCodes),
            candidateCount: candidateCountFrom(result),
            selectedStableRef: cleanString(selected?.stableRef),
          });
        } catch (error) {
          await emitSafely(emitTelemetry, {
            ...common,
            outcome: "shadow_resolution_error",
            kernelStatus: null,
            reasonCodes: [cleanString(error?.code) || "shadow_resolution_failed"],
            candidateCount: 0,
            selectedStableRef: null,
          });
        }
      });
    });

    return next();
  };
}

export const _testingResourceApiShadow = Object.freeze({
  BRAND_RESOURCE_KEYS,
  comparisonOutcome,
  operationIntentFor,
  routeKeyFor,
  safeReasonCodes,
});
