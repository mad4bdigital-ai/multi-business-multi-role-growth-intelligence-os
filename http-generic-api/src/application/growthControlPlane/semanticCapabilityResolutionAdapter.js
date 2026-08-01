import {
  GrowthControlPlaneError,
  stableSha256
} from "../../domain/growthControlPlane/growthControlPlane.js";

export const GROWTH_CONTROL_SEMANTIC_CAPABILITY_READY_STATUSES = Object.freeze([
  "shadow_ready",
  "canary_ready",
  "ready"
]);

const CAPABILITY_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_CAPABILITIES_PER_PREVIEW = 100;
const INPUT_FIELDS = new Set([
  "capabilityKeys",
  "workspaceId",
  "workspaceKey",
  "resourceRef",
  "connectionId"
]);

function integrationError(code, message, status, details = []) {
  return new GrowthControlPlaneError(code, message, status, details);
}

function requiredText(value, field, maxLength = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_INPUT_INVALID",
      `${field} is required and must be at most ${maxLength} characters.`,
      422,
      [{ field, issue: "required_or_too_long" }]
    );
  }
  return normalized;
}

function optionalText(value, field, maxLength = 255) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_INPUT_INVALID",
      `${field} must be at most ${maxLength} characters.`,
      422,
      [{ field, issue: "invalid_or_too_long" }]
    );
  }
  return normalized;
}

function normalizeCapabilityKeys(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_CAPABILITIES_PER_PREVIEW) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_KEYS_INVALID",
      `capabilityKeys must contain from 1 to ${MAX_CAPABILITIES_PER_PREVIEW} entries.`,
      422,
      [{ field: "capabilityKeys", issue: "invalid_count" }]
    );
  }

  const normalized = values.map((value, index) => {
    const key = requiredText(value, `capabilityKeys[${index}]`);
    if (!CAPABILITY_KEY_PATTERN.test(key)) {
      throw integrationError(
        "GROWTH_CONTROL_SEMANTIC_CAPABILITY_KEYS_INVALID",
        "capabilityKeys must contain canonical semantic capability keys.",
        422,
        [{ field: `capabilityKeys[${index}]`, issue: "invalid_canonical_key" }]
      );
    }
    return key;
  });

  const duplicates = [...new Set(
    normalized.filter((value, index) => normalized.indexOf(value) !== index)
  )];
  if (duplicates.length > 0) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_KEYS_INVALID",
      "capabilityKeys must not contain duplicates.",
      422,
      duplicates.map((value) => ({ field: "capabilityKeys", issue: "duplicate", value }))
    );
  }
  return Object.freeze(normalized);
}

function normalizePrincipal(context = {}) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_PRINCIPAL_INVALID",
      "An authenticated tenant and user context is required.",
      422,
      [{ field: "context", issue: "required" }]
    );
  }
  return Object.freeze({
    tenantId: requiredText(context.tenantId ?? context.tenant_id, "tenantId", 64),
    userId: requiredText(context.userId ?? context.user_id, "userId", 64),
    isAdmin: context.isAdmin === true || context.is_admin === true
  });
}

function normalizeInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_INPUT_INVALID",
      "Semantic capability preview input must be an object.",
      422,
      [{ field: "input", issue: "invalid_type" }]
    );
  }
  const unknownFields = Object.keys(input).filter((field) => !INPUT_FIELDS.has(field));
  if (unknownFields.length > 0) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_INPUT_INVALID",
      "Semantic capability preview input contains unsupported fields.",
      422,
      unknownFields.map((field) => ({ field, issue: "unsupported" }))
    );
  }
  return Object.freeze({
    capabilityKeys: normalizeCapabilityKeys(input.capabilityKeys),
    workspaceId: optionalText(input.workspaceId, "workspaceId", 64),
    workspaceKey: optionalText(input.workspaceKey, "workspaceKey", 191),
    resourceRef: optionalText(input.resourceRef, "resourceRef", 255),
    connectionId: optionalText(input.connectionId, "connectionId", 64)
  });
}

function normalizedStatus(value, fallback = "blocked") {
  return String(value ?? "").trim().toLowerCase() || fallback;
}

function allowlistedChecks(checks = {}) {
  const source = checks && typeof checks === "object" && !Array.isArray(checks) ? checks : {};
  return Object.freeze({
    workspaceReady: source.workspace_ready === true,
    membershipReady: source.membership_ready === true,
    connectionReady: source.connection_ready === true,
    connectionAmbiguous: source.connection_ambiguous === true,
    actionGrantReady: source.action_grant_ready === true,
    resourceAuthorityReady: source.resource_authority_ready === true,
    canonicalEndpointReady: source.canonical_endpoint_ready === true,
    runtimeCertificationReady: source.runtime_certification_ready === true,
    exportReady: source.export_ready === true,
    shadowMode: source.shadow_mode === true
  });
}

function normalizeResolverDecision(capabilityKey, result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_CONTRACT_INVALID",
      "Semantic capability resolver returned an invalid result.",
      502,
      [{ field: "resolverResult", issue: "invalid_type", capabilityKey }]
    );
  }
  if (result.secrets_included !== false) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_CONTRACT_INVALID",
      "Semantic capability resolver did not prove secret-free output.",
      502,
      [{ field: "resolverResult.secrets_included", issue: "must_be_false", capabilityKey }]
    );
  }

  if (result.ok !== true) {
    const blocked = {
      capabilityKey,
      status: normalizedStatus(result.status),
      ready: false,
      mode: "blocked",
      blocker: Object.freeze({
        code: String(result.error?.code || "SEMANTIC_CAPABILITY_BLOCKED"),
        message: String(result.error?.message || "Semantic capability resolution was blocked.")
      }),
      selection: null,
      checks: allowlistedChecks(),
      obligations: Object.freeze([]),
      sourceManifestHash: null,
      providerDispatchAllowed: false,
      providerApplyAllowed: false,
      externalWrites: false,
      secretsIncluded: false
    };
    return Object.freeze({ ...blocked, decisionSha256: stableSha256(blocked) });
  }

  const resolvedCapabilityKey = String(result.capability?.capability_key || "").trim();
  if (resolvedCapabilityKey !== capabilityKey) {
    throw integrationError(
      "GROWTH_CONTROL_SEMANTIC_CAPABILITY_CONTRACT_INVALID",
      "Semantic capability resolver returned a different capability key.",
      502,
      [{
        field: "resolverResult.capability.capability_key",
        issue: "mismatch",
        expected: capabilityKey,
        observed: resolvedCapabilityKey || null
      }]
    );
  }

  const status = normalizedStatus(result.status);
  const ready = result.ready === true
    && GROWTH_CONTROL_SEMANTIC_CAPABILITY_READY_STATUSES.includes(status);
  const obligations = Object.freeze(
    Array.isArray(result.obligations?.obligations)
      ? result.obligations.obligations.map(String).slice(0, 100)
      : []
  );
  const sourceManifestHash = /^[a-f0-9]{64}$/.test(String(result.manifest_hash || ""))
    ? String(result.manifest_hash)
    : null;

  const decision = {
    capabilityKey,
    status,
    ready,
    mode: String(result.mode || "effective"),
    blocker: ready ? null : Object.freeze({
      code: `RESOLVE_BLOCKER:${status}`,
      message: "The semantic capability is not ready for Growth Control Plane composition."
    }),
    selection: Object.freeze({
      appKey: result.binding?.app_key || null,
      parentActionKey: result.binding?.parent_action_key || null,
      configuredEndpointKey: result.binding?.configured_endpoint_key || null,
      canonicalEndpointKey: result.endpoint?.endpoint_key || null,
      adapterKey: result.binding?.adapter_key || null,
      policyKey: result.binding?.policy_key || null,
      rolloutMode: result.binding?.rollout_mode || null,
      projectionToolName: result.projection?.tool_name || null
    }),
    checks: allowlistedChecks(result.checks),
    obligations,
    sourceManifestHash,
    providerDispatchAllowed: false,
    providerApplyAllowed: false,
    externalWrites: false,
    secretsIncluded: false
  };
  return Object.freeze({ ...decision, decisionSha256: stableSha256(decision) });
}

export function createGrowthControlSemanticCapabilityAdapter({ resolveCapability } = {}) {
  if (typeof resolveCapability !== "function") {
    throw new TypeError("resolveCapability must be a function.");
  }

  async function previewSemanticCapabilities(input = {}, context = {}) {
    const normalizedInput = normalizeInput(input);
    const principal = normalizePrincipal(context);
    const resolverContext = Object.freeze({
      auth: Object.freeze({
        tenant_id: principal.tenantId,
        user_id: principal.userId,
        is_admin: principal.isAdmin
      })
    });

    const items = [];
    for (const capabilityKey of normalizedInput.capabilityKeys) {
      let result;
      try {
        result = await resolveCapability({
          capability_key: capabilityKey,
          workspace_id: normalizedInput.workspaceId || undefined,
          workspace_key: normalizedInput.workspaceKey || undefined,
          resource_ref: normalizedInput.resourceRef || undefined,
          connection_id: normalizedInput.connectionId || undefined,
          include_candidates: false
        }, resolverContext);
      } catch (error) {
        throw integrationError(
          "GROWTH_CONTROL_SEMANTIC_CAPABILITY_RESOLUTION_FAILED",
          "Semantic capability resolution failed.",
          503,
          [{
            field: "capabilityKeys",
            issue: "resolver_failed",
            capabilityKey,
            causeCode: error?.code || null
          }]
        );
      }
      items.push(normalizeResolverDecision(capabilityKey, result));
    }

    const readyCount = items.filter((item) => item.ready).length;
    const blockedCount = items.length - readyCount;
    const status = blockedCount === 0 ? "ready" : readyCount === 0 ? "blocked" : "partial";
    const evidence = {
      principal: { tenantId: principal.tenantId, userId: principal.userId },
      workspaceId: normalizedInput.workspaceId,
      workspaceKey: normalizedInput.workspaceKey,
      resourceRef: normalizedInput.resourceRef,
      capabilityDecisions: items.map((item) => ({
        capabilityKey: item.capabilityKey,
        status: item.status,
        ready: item.ready,
        decisionSha256: item.decisionSha256
      }))
    };

    return Object.freeze({
      resolver: "tenant_effective_capability_resolver_v1",
      integration: "growth_control_plane_semantic_capability_adapter_v1",
      status,
      ready: blockedCount === 0,
      items: Object.freeze(items),
      summary: Object.freeze({
        requestedCount: items.length,
        readyCount,
        blockedCount,
        shadowReadyCount: items.filter((item) => item.status === "shadow_ready").length,
        canaryReadyCount: items.filter((item) => item.status === "canary_ready").length
      }),
      evidenceSha256: stableSha256(evidence),
      providerCalls: false,
      providerDispatchAllowed: false,
      providerApplyAllowed: false,
      externalWrites: false,
      secretsIncluded: false
    });
  }

  return Object.freeze({ previewSemanticCapabilities });
}

export const _testingGrowthControlSemanticCapabilityAdapter = Object.freeze({
  normalizeCapabilityKeys,
  normalizePrincipal,
  normalizeInput,
  allowlistedChecks,
  normalizeResolverDecision
});
