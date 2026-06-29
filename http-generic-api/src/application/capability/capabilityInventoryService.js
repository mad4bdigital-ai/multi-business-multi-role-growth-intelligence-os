import { assertOneActiveAliasToOneCapability } from "../../domain/capability/capabilityAlias.js";
import { capabilityClassificationComplete } from "../../domain/capability/canonicalCapability.js";

export class CapabilityInventoryService {
  constructor(repository) {
    if (!repository) throw new TypeError("CapabilityInventoryService requires a registry repository.");
    this.repository = repository;
  }

  async buildInventory({ capability_limit = 500, alias_limit = 1000 } = {}) {
    const [capabilities, aliases] = await Promise.all([
      this.repository.listCanonicalCapabilities({ limit: capability_limit }),
      this.repository.listAliases({ limit: alias_limit }),
    ]);
    assertOneActiveAliasToOneCapability(aliases);

    const surfacesByCapability = new Map();
    for (const alias of aliases) {
      if (alias.status !== "active") continue;
      const surfaces = surfacesByCapability.get(alias.canonical_capability_id) || new Set();
      surfaces.add(alias.surface);
      surfacesByCapability.set(alias.canonical_capability_id, surfaces);
    }

    const incomplete = capabilities.filter((capability) => !capabilityClassificationComplete({
      ...capability,
      state_changing: Boolean(capability.state_changing),
    }));
    const dualSurface = capabilities
      .map((capability) => ({
        canonical_capability_id: capability.id,
        capability_key: capability.key,
        surfaces: [...(surfacesByCapability.get(capability.id) || [])].sort(),
      }))
      .filter((entry) => entry.surfaces.length > 1);

    return {
      status: incomplete.length ? "degraded" : "pass",
      counts: {
        canonical_capabilities: capabilities.length,
        aliases: aliases.length,
        dual_surface_capabilities: dualSurface.length,
        incomplete_capabilities: incomplete.length,
      },
      capabilities,
      aliases,
      dual_surface_capabilities: dualSurface,
      incomplete_capabilities: incomplete.map((item) => ({ id: item.id, key: item.key })),
      secrets_included: false,
    };
  }

  async buildIntegrityReport() {
    const findings = await this.repository.integrityFindings();
    return {
      status: findings.length ? "fail" : "pass",
      finding_count: findings.length,
      findings,
      secrets_included: false,
    };
  }
}
