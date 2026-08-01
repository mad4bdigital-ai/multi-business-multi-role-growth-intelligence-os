import {
  GrowthControlPlaneError,
  requireCanonicalKey,
} from "../../domain/growthControlPlane/growthControlPlane.js";
import {
  buildAdminConfigurationUiProjection,
} from "../../domain/growthControlPlane/adminGrowthControlUiProjection.js";

function optionalIdentifier(value, field) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 64) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_UI_QUERY_INVALID",
      `${field} must be at most 64 characters.`,
      400,
      [{ field, issue: "invalid" }],
    );
  }
  return normalized;
}

export function createAdminGrowthControlUiProjectionService({ repository } = {}) {
  if (!repository) throw new TypeError("Growth Control Plane repository is required.");
  for (const method of ["getConfigurationDefinition", "getConfigurationVersion"]) {
    if (typeof repository[method] !== "function") {
      throw new TypeError(`Growth Control Plane repository must implement ${method}().`);
    }
  }

  async function projectConfiguration(configKeyValue, input = {}) {
    const configKey = requireCanonicalKey(configKeyValue, "configKey");
    const baseVersionId = optionalIdentifier(input.baseVersionId, "baseVersionId");
    const compareVersionId = optionalIdentifier(input.compareVersionId, "compareVersionId");
    if (Boolean(baseVersionId) !== Boolean(compareVersionId)) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_UI_COMPARISON_PAIR_REQUIRED",
        "baseVersionId and compareVersionId must be provided together.",
        400,
      );
    }
    if (baseVersionId && baseVersionId === compareVersionId) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_UI_COMPARISON_IDENTICAL",
        "baseVersionId and compareVersionId must identify different versions.",
        400,
      );
    }

    const definition = await repository.getConfigurationDefinition(configKey);
    if (!definition) {
      throw new GrowthControlPlaneError(
        "GROWTH_CONTROL_CONFIG_NOT_FOUND",
        "Configuration definition was not found.",
        404,
      );
    }

    let baseVersion = null;
    let compareVersion = null;
    if (baseVersionId && compareVersionId) {
      [baseVersion, compareVersion] = await Promise.all([
        repository.getConfigurationVersion(baseVersionId),
        repository.getConfigurationVersion(compareVersionId),
      ]);
      if (!baseVersion || !compareVersion) {
        throw new GrowthControlPlaneError(
          "GROWTH_CONTROL_CONFIG_VERSION_NOT_FOUND",
          "A requested comparison version was not found.",
          404,
        );
      }
    }

    return buildAdminConfigurationUiProjection({ definition, baseVersion, compareVersion });
  }

  return Object.freeze({ projectConfiguration });
}

export const _testingAdminGrowthControlUiProjectionService = Object.freeze({ optionalIdentifier });
