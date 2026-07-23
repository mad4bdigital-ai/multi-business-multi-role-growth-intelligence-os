import { createActivationEffectiveAuthorityProjectionService } from "./src/application/effectiveAuthority/activationEffectiveAuthorityProjectionService.js";
import { createEffectiveAuthorityRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityRepository.js";

function requireQuery(query) {
  if (typeof query !== "function") {
    throw new TypeError("Activation effective-authority projection requires a query function.");
  }
  return query;
}

function createQueryPool(query) {
  const queryFn = requireQuery(query);
  return Object.freeze({
    async execute(sql, params = []) {
      const result = await queryFn(sql, params);
      if (!result?.ok) {
        const error = new Error(
          result?.error?.message || "Activation effective-authority projection query failed."
        );
        error.code = result?.error?.code || "AUTHORITY_PROJECTION_QUERY_FAILED";
        throw error;
      }
      return [Array.isArray(result.rows) ? result.rows : []];
    },
  });
}

export function createActivationEffectiveAuthorityProjectionForQuery({
  query,
  now,
  logger,
} = {}) {
  const pool = createQueryPool(query);
  const repository = createEffectiveAuthorityRepository({
    resolvePool: async () => pool,
  });
  return createActivationEffectiveAuthorityProjectionService({
    repository,
    ...(now ? { now } : {}),
    ...(logger ? { logger } : {}),
  });
}

export async function buildActivationEffectiveAuthorityProjection({
  query,
  scope,
  now,
  logger,
} = {}) {
  const service = createActivationEffectiveAuthorityProjectionForQuery({
    query,
    now,
    logger,
  });
  return service.project({ scope });
}
