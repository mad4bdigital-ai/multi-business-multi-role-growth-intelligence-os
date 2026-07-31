import {
  TenantGrowthControlProjectionError,
  assertTenantGrowthControlAuth,
  encodeTenantGrowthControlCursor,
  normalizeTenantGrowthControlListQuery,
  projectTenantActivityBinding,
  projectTenantConfigurationVersion
} from "../../domain/growthControlPlane/tenantGrowthControlProjection.js";
import {
  buildTenantGrowthControlFieldPolicy,
} from "../../domain/growthControlPlane/tenantGrowthControlViewPolicy.js";

function buildPage(items, limit, offset) {
  const hasMore = items.length > limit;
  return Object.freeze({
    items: items.slice(0, limit),
    page: Object.freeze({
      nextCursor: hasMore ? encodeTenantGrowthControlCursor(offset + limit) : null,
      hasMore
    })
  });
}

function projectionScope(principal, scope) {
  return Object.freeze({
    tenantId: principal.tenantId,
    workspaceId: scope.workspaceId,
    brandKey: scope.brandKey,
    tenantRole: principal.tenantRole,
    workspaceBootstrapStatus: scope.bootstrapStatus
  });
}

export function createTenantGrowthControlProjectionService({ repository }) {
  if (!repository) throw new Error("tenant growth control projection repository is required");

  async function resolveAuthorizedScope(auth, input) {
    const principal = assertTenantGrowthControlAuth(auth);
    const query = normalizeTenantGrowthControlListQuery(input);
    const scope = await repository.resolveTenantWorkspaceScope({
      tenantId: principal.tenantId,
      userId: principal.userId,
      workspaceId: query.workspaceId,
      brandKey: query.brandKey
    });
    if (!scope) {
      throw new TenantGrowthControlProjectionError(
        "TENANT_GROWTH_CONTROL_SCOPE_FORBIDDEN",
        "The requested tenant, workspace, and brand scope is not authorized.",
        403
      );
    }
    return Object.freeze({ principal, query, scope });
  }

  async function listConfigurationVersions(auth, input = {}) {
    const { principal, query, scope } = await resolveAuthorizedScope(auth, input);
    const rows = await repository.listConfigurationVersions({
      tenantId: principal.tenantId,
      workspaceId: scope.workspaceId,
      brandKey: scope.brandKey,
      limit: query.limit + 1,
      offset: query.offset
    });
    const result = buildPage(
      rows.map((row) => projectTenantConfigurationVersion(row, principal.tenantRole)),
      query.limit,
      query.offset
    );
    return Object.freeze({
      ...result,
      scope: projectionScope(principal, scope),
      fieldPolicy: buildTenantGrowthControlFieldPolicy("configuration_version", principal.tenantRole),
      tenantFacing: true,
      metadataOnly: true,
      providerCalls: false,
      externalWrites: false,
      secretsIncluded: false
    });
  }

  async function listActivityBindings(auth, input = {}) {
    const { principal, query, scope } = await resolveAuthorizedScope(auth, input);
    const rows = await repository.listActivityBindings({
      tenantId: principal.tenantId,
      workspaceId: scope.workspaceId,
      brandKey: scope.brandKey,
      limit: query.limit + 1,
      offset: query.offset
    });
    const result = buildPage(
      rows.map((row) => projectTenantActivityBinding(row, principal.tenantRole)),
      query.limit,
      query.offset
    );
    return Object.freeze({
      ...result,
      scope: projectionScope(principal, scope),
      fieldPolicy: buildTenantGrowthControlFieldPolicy("activity_binding", principal.tenantRole),
      tenantFacing: true,
      metadataOnly: true,
      providerCalls: false,
      externalWrites: false,
      secretsIncluded: false
    });
  }

  return Object.freeze({ listConfigurationVersions, listActivityBindings });
}

export const _testingTenantGrowthControlProjectionService = Object.freeze({
  buildPage,
  projectionScope,
});
