import { randomUUID } from "node:crypto";
import {
  CONNECTOR_INVENTORY_CAPABILITY_KEY,
  EffectiveAuthorityError,
  assertNoSecretEvidence,
  buildConnectorReadinessItem,
  buildEffectiveAuthorityManifest,
  normalizeSemanticCapability,
} from "../../domain/effectiveAuthority/effectiveAuthority.js";
import { evaluateConnectorProjectionConsistency } from "../../domain/effectiveAuthority/effectiveAuthorityEvidence.js";

const SYNTHETIC_PRINCIPAL = Object.freeze({
  principalType: "system_reconciler",
  principalId: "ueacp_shadow_reconciler",
});

function normalizeRunLimit(value, fallback = 50, maximum = 200) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(`Reconciliation limit must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

function normalizeObservationLimit(value, fallback = 200, maximum = 1000) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(
      `Reconciliation observation limit must be an integer between 1 and ${maximum}.`
    );
  }
  return parsed;
}

async function observeConnectorProjection({ authorityRepository, scope, limit }) {
  const resourceIds = new Set();
  let afterSystemId = null;
  let scannedCount = 0;

  while (true) {
    const remaining = limit - scannedCount;
    if (remaining < 1) {
      throw new EffectiveAuthorityError(
        "AUTHORITY_OBSERVATION_LIMIT_EXCEEDED",
        "Observed Connector Inventory exceeded the bounded reconciliation limit.",
        503,
        { limit }
      );
    }

    const page = await authorityRepository.listConnectorInventory({
      scope,
      limit: Math.min(100, remaining),
      afterSystemId,
    });
    if (!page || !Array.isArray(page.rows)) {
      throw new EffectiveAuthorityError(
        "AUTHORITY_OBSERVATION_PAGE_INVALID",
        "Observed Connector Inventory returned an invalid page.",
        503
      );
    }

    for (const row of page.rows) {
      scannedCount += 1;
      const item = buildConnectorReadinessItem(row);
      if (!item.systemId) {
        throw new EffectiveAuthorityError(
          "AUTHORITY_OBSERVED_RESOURCE_ID_MISSING",
          "Observed Connector Inventory item is missing systemId.",
          503
        );
      }
      resourceIds.add(item.systemId);
    }

    if (page.hasMore !== true) {
      return Object.freeze({
        observedCount: resourceIds.size,
        scannedCount,
      });
    }

    const nextSystemId = String(page.nextSystemId || "").trim();
    if (!nextSystemId || nextSystemId === afterSystemId) {
      throw new EffectiveAuthorityError(
        "AUTHORITY_OBSERVATION_CURSOR_INVALID",
        "Observed Connector Inventory returned an invalid continuation cursor.",
        503
      );
    }
    if (scannedCount >= limit) {
      throw new EffectiveAuthorityError(
        "AUTHORITY_OBSERVATION_LIMIT_EXCEEDED",
        "Observed Connector Inventory exceeded the bounded reconciliation limit.",
        503,
        { limit }
      );
    }
    afterSystemId = nextSystemId;
  }
}

function safeErrorCode(error) {
  const code = String(error?.code || "AUTHORITY_RECONCILIATION_SCOPE_FAILED").trim();
  return /^[A-Z0-9_]{1,191}$/.test(code)
    ? code
    : "AUTHORITY_RECONCILIATION_SCOPE_FAILED";
}

function asDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid timestamp.`);
  return date;
}

function freezeResult(value) {
  assertNoSecretEvidence(value);
  return Object.freeze({
    ...value,
    synthetic_principal: Object.freeze({ ...value.synthetic_principal }),
    summary: Object.freeze({ ...value.summary }),
    items: Object.freeze(value.items.map((item) => Object.freeze(item))),
    page: Object.freeze({ ...value.page }),
  });
}

export function createEffectiveAuthorityReconciler({
  scopeRepository,
  authorityRepository,
  evidenceService = null,
  now = () => new Date(),
  decisionIdFactory = () => randomUUID(),
} = {}) {
  if (!scopeRepository || typeof scopeRepository.listScopes !== "function") {
    throw new TypeError("Effective authority reconciler requires scopeRepository.listScopes().");
  }
  if (
    !authorityRepository ||
    typeof authorityRepository.findCapabilityByKey !== "function" ||
    typeof authorityRepository.listConnectorInventory !== "function" ||
    typeof authorityRepository.summarizeConnectorProjectionStages !== "function"
  ) {
    throw new TypeError(
      "Effective authority reconciler requires capability, observed inventory, and projection summary repository methods."
    );
  }

  async function run({
    limit = 50,
    observationLimit = 200,
    afterScopeKey = null,
    persist = false,
  } = {}) {
    const boundedLimit = normalizeRunLimit(limit);
    const boundedObservationLimit = normalizeObservationLimit(observationLimit);
    if (persist && evidenceService?.enabled !== true) {
      throw new EffectiveAuthorityError(
        "AUTHORITY_RECONCILIATION_EVIDENCE_DISABLED",
        "Persisted effective-authority reconciliation requires enabled shadow evidence.",
        503
      );
    }

    const [scopePage, capabilityRow] = await Promise.all([
      scopeRepository.listScopes({ limit: boundedLimit, afterScopeKey }),
      authorityRepository.findCapabilityByKey(CONNECTOR_INVENTORY_CAPABILITY_KEY),
    ]);
    const capability = normalizeSemanticCapability(capabilityRow);
    const items = [];
    let matchedCount = 0;
    let driftCount = 0;
    let degradedCount = 0;
    let persistedCount = 0;

    for (const scope of scopePage.scopes) {
      const evaluatedAt = asDate(now(), "Reconciliation clock");
      try {
        const [counts, observation] = await Promise.all([
          authorityRepository.summarizeConnectorProjectionStages({ scope }),
          observeConnectorProjection({
            authorityRepository,
            scope,
            limit: boundedObservationLimit,
          }),
        ]);
        const consistency = evaluateConnectorProjectionConsistency({
          scopeType: scope.scopeType,
          ...counts,
          observedCount: observation.observedCount,
        });
        const manifest = buildEffectiveAuthorityManifest({
          decisionId: decisionIdFactory(),
          resolution: {
            selectionMode: "reconciliation_registered_scope",
            principal: SYNTHETIC_PRINCIPAL,
            scope,
          },
          capability,
          resourceKey:
            scope.scopeType === "platform"
              ? "connectors:platform"
              : `connectors:tenant:${scope.tenantId}`,
          evaluatedAt,
        });
        const evidence = persist
          ? await evidenceService.record({
              manifest,
              projectionConsistency: consistency,
              source: "ueacp_shadow_reconciler",
            })
          : { status: "preview", mode: "preview", driftEventCount: 0 };

        if (consistency.driftDetected) driftCount += 1;
        else matchedCount += 1;
        if (evidence.status === "persisted") persistedCount += 1;
        if (evidence.status === "degraded") degradedCount += 1;

        items.push({
          scope_id: scope.scopeId,
          scope_key: scope.scopeKey,
          scope_type: scope.scopeType,
          tenant_id: scope.tenantId,
          scope_version: scope.version,
          status:
            evidence.status === "degraded"
              ? "degraded"
              : consistency.driftDetected
                ? "drift"
                : "aligned",
          decision_id: manifest.decisionId,
          decision: manifest.decision,
          authority_granted: false,
          enforcement_mode: "shadow_only",
          registered_count: consistency.counts.registeredCount,
          authorized_count: consistency.counts.authorizedCount,
          projected_count: consistency.counts.projectedCount,
          executable_candidate_count: consistency.counts.executableCandidateCount,
          observed_count: consistency.counts.observedCount,
          observation_status: consistency.observationStatus,
          drift_detected: consistency.driftDetected,
          drift_issue_codes: [...consistency.issueCodes],
          evidence_status: evidence.status,
          evidence_readback_verified: evidence.readbackVerified === true,
          evaluated_at: manifest.evaluatedAt,
          expires_at: manifest.expiresAt,
          legacy_runtime_authoritative: true,
          execution_authority_changed: false,
          provider_calls: false,
          credential_payload_reads: false,
          external_writes: false,
          secrets_included: false,
        });
      } catch (error) {
        degradedCount += 1;
        items.push({
          scope_id: scope.scopeId,
          scope_key: scope.scopeKey,
          scope_type: scope.scopeType,
          tenant_id: scope.tenantId,
          scope_version: scope.version,
          status: "degraded",
          error_code: safeErrorCode(error),
          decision: "degraded",
          authority_granted: false,
          enforcement_mode: "shadow_only",
          observed_count: null,
          observation_status: "unavailable",
          drift_detected: true,
          drift_issue_codes: ["AUTHORITY_RECONCILIATION_SCOPE_FAILED"],
          evidence_status: "not_persisted",
          evaluated_at: evaluatedAt.toISOString(),
          legacy_runtime_authoritative: true,
          execution_authority_changed: false,
          provider_calls: false,
          credential_payload_reads: false,
          external_writes: false,
          secrets_included: false,
        });
      }
    }

    return freezeResult({
      ok: degradedCount === 0,
      source: "ueacp_shadow_reconciliation",
      status: degradedCount > 0 ? "degraded" : driftCount > 0 ? "drift_detected" : "aligned",
      mode: persist ? "persist" : "preview",
      capability_key: CONNECTOR_INVENTORY_CAPABILITY_KEY,
      synthetic_principal: SYNTHETIC_PRINCIPAL,
      summary: {
        scope_count: items.length,
        matched_count: matchedCount,
        drift_count: driftCount,
        degraded_count: degradedCount,
        persisted_count: persistedCount,
      },
      items,
      page: scopePage.page,
      legacy_runtime_authoritative: true,
      execution_authority_changed: false,
      provider_calls: false,
      credential_payload_reads: false,
      external_writes: false,
      secrets_included: false,
    });
  }

  return Object.freeze({ run });
}

export const _testingEffectiveAuthorityReconciler = Object.freeze({
  normalizeRunLimit,
  normalizeObservationLimit,
  observeConnectorProjection,
  safeErrorCode,
  SYNTHETIC_PRINCIPAL,
});
