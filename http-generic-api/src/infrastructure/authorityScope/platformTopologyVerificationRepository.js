import { PLATFORM_TOPOLOGY_CONTRACT } from "../../domain/authorityScope/platformTopologyVerification.js";

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== "function") {
    throw new TypeError("Platform topology verification repository requires a query-capable executor.");
  }
}

async function rows(executor, sql, params = []) {
  const [result] = await executor.query(sql, params);
  return Array.isArray(result) ? result : [];
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

export function createPlatformTopologyVerificationRepository({ executor }) {
  requireExecutor(executor);

  async function readEvidence() {
    try {
      const platformScopes = await rows(executor,
        "SELECT scope_id,scope_key,scope_type,tenant_id,status,version FROM authority_scope_registry WHERE scope_key=? LIMIT 2",
        [PLATFORM_TOPOLOGY_CONTRACT.authorityScopeKey]
      );
      const platformOwnerTenants = await rows(executor,
        "SELECT tenant_id,tenant_type,status FROM tenants WHERE tenant_type='platform_owner' AND status='active' ORDER BY tenant_id"
      );
      const tenantIds = platformOwnerTenants.map((row) => String(row.tenant_id)).filter(Boolean);
      const adminWorkspaces = tenantIds.length ? await rows(executor,
        `SELECT workspace_id,tenant_id,workspace_key,workspace_type,bootstrap_status
           FROM workspace_registry
          WHERE tenant_id IN (${placeholders(tenantIds)})
            AND (
              workspace_key=?
              OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.authority_scope_key'))=?
              OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.platform_admin_workspace'))='true'
            )
          ORDER BY workspace_id`,
        [...tenantIds, PLATFORM_TOPOLOGY_CONTRACT.adminWorkspaceKey, PLATFORM_TOPOLOGY_CONTRACT.authorityScopeKey]
      ) : [];
      const platformBrands = await rows(executor,
        "SELECT id,target_key,status FROM brands WHERE target_key=? LIMIT 2",
        [PLATFORM_TOPOLOGY_CONTRACT.platformBrandTargetKey]
      );
      const workspaceIds = adminWorkspaces.map((row) => String(row.workspace_id)).filter(Boolean);
      const containerConditions = [
        "(tenant_id IS NULL AND container_type_key='platform' AND canonical_subject_type='authority_scope' AND canonical_subject_ref=?)",
        "(container_type_key='brand' AND canonical_subject_type='brand_target_key' AND canonical_subject_ref=?)",
      ];
      const containerParams = [PLATFORM_TOPOLOGY_CONTRACT.authorityScopeKey, PLATFORM_TOPOLOGY_CONTRACT.platformBrandTargetKey];
      if (workspaceIds.length) {
        containerConditions.push(`(container_type_key='workspace' AND canonical_subject_type='workspace' AND canonical_subject_ref IN (${placeholders(workspaceIds)}))`);
        containerParams.push(...workspaceIds);
      }
      const containers = await rows(executor,
        `SELECT container_id,tenant_id,container_key,container_type_key,canonical_subject_type,canonical_subject_ref,status
           FROM containers
          WHERE status='active' AND (${containerConditions.join(" OR ")})
          ORDER BY container_type_key,container_id`,
        containerParams
      );
      const containerIds = containers.map((row) => String(row.container_id)).filter(Boolean);
      const relationships = containerIds.length ? await rows(executor,
        `SELECT relationship_id,tenant_id,from_container_id,to_container_id,relationship_type_key,status
           FROM container_relationships
          WHERE status='active'
            AND from_container_id IN (${placeholders(containerIds)})
            AND to_container_id IN (${placeholders(containerIds)})
          ORDER BY relationship_id`,
        [...containerIds, ...containerIds]
      ) : [];
      const platformContainerIds = containers
        .filter((row) => row.tenant_id === null && String(row.canonical_subject_ref) === PLATFORM_TOPOLOGY_CONTRACT.authorityScopeKey)
        .map((row) => String(row.container_id));
      const roleAssignments = platformContainerIds.length ? await rows(executor,
        `SELECT assignment_id,tenant_id,container_id,principal_type,principal_id,role_template_key,status
           FROM container_role_assignments
          WHERE status='active' AND container_id IN (${placeholders(platformContainerIds)})
          ORDER BY assignment_id`,
        platformContainerIds
      ) : [];

      return Object.freeze({
        platformScope: platformScopes[0] || null,
        platformOwnerTenants,
        adminWorkspaces,
        platformBrand: platformBrands[0] || null,
        platformContainers: containers.filter((row) => row.tenant_id === null && String(row.canonical_subject_ref) === PLATFORM_TOPOLOGY_CONTRACT.authorityScopeKey),
        workspaceContainers: containers.filter((row) => String(row.canonical_subject_type) === "workspace"),
        brandContainers: containers.filter((row) => String(row.canonical_subject_type) === "brand_target_key" && String(row.canonical_subject_ref) === PLATFORM_TOPOLOGY_CONTRACT.platformBrandTargetKey),
        relationships,
        roleAssignments,
      });
    } catch (cause) {
      const error = new Error("Platform topology verification evidence could not be read.");
      error.code = "platform_topology_verification_read_failed";
      error.status = 503;
      error.details = [{ stage: "read_platform_topology_evidence" }];
      error.cause = cause;
      throw error;
    }
  }

  return Object.freeze({ readEvidence });
}

export const _testingPlatformTopologyVerificationRepository = Object.freeze({ placeholders });
