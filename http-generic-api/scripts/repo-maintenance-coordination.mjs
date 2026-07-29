import {
  attachRepositoryMutationCoordination,
  evaluateRepositoryMutationCoordination,
} from "../repositoryMutationCoordinationTelemetry.js";

function normalizePaths(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, ""))
    .filter(Boolean))].sort();
}

export function buildRepoMaintenanceCoordinationTelemetry(options = {}) {
  const changedFiles = normalizePaths(options.changed_files || options.changedFiles);
  return evaluateRepositoryMutationCoordination("auto_sync_commit", {
    ...options,
    changes: changedFiles.map((path) => ({ path })),
    repository_current_state: {
      ...(options.repository_current_state || {}),
      unknown_provider_outcome: options.unknown_provider_outcome === true,
      same_cycle_readback_verified: options.same_cycle_readback_verified === true,
    },
  });
}

export function attachRepoMaintenanceCoordination(result = {}, options = {}) {
  return attachRepositoryMutationCoordination(
    result,
    buildRepoMaintenanceCoordinationTelemetry(options),
  );
}
