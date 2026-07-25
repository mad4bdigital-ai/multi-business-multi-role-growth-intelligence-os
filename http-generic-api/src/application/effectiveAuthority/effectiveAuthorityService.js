import { randomUUID } from "node:crypto";
import {
  CONNECTOR_INVENTORY_CAPABILITY_KEY,
  EffectiveAuthorityError,
  buildConnectorReadinessItem,
  buildEffectiveAuthorityManifest,
  decodeAuthorityCursor,
  encodeAuthorityCursor,
  normalizeAuthorityLimit,
  normalizeSemanticCapability,
} from "../../domain/effectiveAuthority/effectiveAuthority.js";
import { evaluateConnectorProjectionConsistency } from "../../domain/effectiveAuthority/effectiveAuthorityEvidence.js";

function requireDependencies(authorityScopeService, repository) {
  if (!authorityScopeService || typeof authorityScopeService.resolve !== "function") {
    throw new TypeError("Effective authority service requires an authority scope service.");
  }
  if (
    !repository ||
    typeof repository.findCapabilityByKey !== "function" ||
    typeof repository.listConnectorInventory !== "function" ||
    typeof repository.summarizeConnectorProjectionStages !== "function"
  ) {
    throw new TypeError(
      "Effective authority service requires capability, connector inventory, and projection summary repository methods."
    );
  }
}

export function createEffectiveAuthorityService({
  authorityScopeService,
  repository,
  evidenceService = null,
  now = () => new Date(),
  decisionIdFactory = () => randomUUID(),
}) {
  requireDependencies(authorityScopeService, repository);

  async function resolveContext({ auth = {}, tenantId = null, capabilityKey }) {
    if (capabilityKey !== CONNECTOR_INVENTORY_CAPABILITY_KEY) {
      throw new EffectiveAuthorityError(
        "CAPABILITY_NOT_SUPPORTED_BY_UEACP_STAGE",
        "This UEACP stage supports connector.inventory.read only.",
        422,
        { capabilityKey }
      );
    }

    const resolution = await authorityScopeService.resolve({ auth, tenantId });
    const capabilityRow = await repository.findCapabilityByKey(capabilityKey);
    const capability = normalizeSemanticCapability(capabilityRow);
    const resourceKey =
      resolution.scope.scopeType === "platform"
        ? "connectors:platform"
        : `connectors:tenant:${resolution.scope.tenantId}`;
    const manifest = buildEffectiveAuthorityManifest({
      decisionId: decisionIdFactory(),
      resolution,
      capability,
      resourceKey,
      evaluatedAt: now(),
    });
    return { resolution, capability, manifest };
  }

  async function recordEvidence({ manifest, resolution, source }) {
    if (evidenceService?.enabled !== true) return;
    const counts = await repository.summarizeConnectorProjectionStages({
      scope: resolution.scope,
    });
    const projectionConsistency = evaluateConnectorProjectionConsistency({
      scopeType: resolution.scope.scopeType,
      ...counts,
    });
    await evidenceService.record({ manifest, projectionConsistency, source });
  }

  async function resolveDecision({
    auth = {},
    tenantId = null,
    capabilityKey = CONNECTOR_INVENTORY_CAPABILITY_KEY,
  } = {}) {
    const { resolution, manifest } = await resolveContext({ auth, tenantId, capabilityKey });
    await recordEvidence({
      manifest,
      resolution,
      source: "authority_decision_api",
    });
    return Object.freeze({ manifest, secretsIncluded: false });
  }

  async function listConnectorProjection({
    auth = {},
    tenantId = null,
    capabilityKey = CONNECTOR_INVENTORY_CAPABILITY_KEY,
    limit = 25,
    cursor = null,
  } = {}) {
    const normalizedLimit = normalizeAuthorityLimit(limit);
    const afterSystemId = decodeAuthorityCursor(cursor);
    const { resolution, manifest } = await resolveContext({ auth, tenantId, capabilityKey });
    const page = await repository.listConnectorInventory({
      scope: resolution.scope,
      limit: normalizedLimit,
      afterSystemId,
    });
    const items = Object.freeze(page.rows.map(buildConnectorReadinessItem));
    await recordEvidence({
      manifest,
      resolution,
      source: "connector_projection_api",
    });
    return Object.freeze({
      manifest,
      items,
      page: Object.freeze({
        nextCursor: page.hasMore ? encodeAuthorityCursor(page.nextSystemId) : null,
        hasMore: page.hasMore,
      }),
      secretsIncluded: false,
    });
  }

  return Object.freeze({
    resolveDecision,
    listConnectorProjection,
  });
}
