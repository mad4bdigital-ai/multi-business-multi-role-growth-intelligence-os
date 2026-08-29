function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function roleSets(manifest) {
  return {
    governance: new Set((manifest?.roles?.governance?.required_tables || []).map(normalizeName)),
    runtime_persistence: new Set((manifest?.roles?.runtime_persistence?.required_tables || []).map(normalizeName)),
  };
}

function baseRoleFor(name, manifest) {
  const normalized = normalizeName(name);
  const sets = roleSets(manifest);
  if (sets.governance.has(normalized)) return "governance";
  if (sets.runtime_persistence.has(normalized)) return "runtime_persistence";
  return "runtime";
}

export function buildRoleObjectPartition({ manifest, objects, viewDependencies }) {
  if (!manifest || typeof manifest !== "object") throw new Error("role manifest is required");
  if (!Array.isArray(objects) || objects.length === 0) throw new Error("schema object inventory is required");
  if (!Array.isArray(viewDependencies)) throw new Error("view dependency inventory is required");

  const normalizedObjects = objects.map((object) => ({
    ...object,
    name: normalizeName(object.name),
    type: String(object.type ?? "BASE TABLE").trim().toUpperCase(),
  }));
  const objectByName = new Map(normalizedObjects.map((object) => [object.name, object]));
  const viewNames = new Set(normalizedObjects.filter((object) => object.type === "VIEW").map((object) => object.name));
  const baseRoles = new Map(
    normalizedObjects
      .filter((object) => object.type !== "VIEW")
      .map((object) => [object.name, baseRoleFor(object.name, manifest)]),
  );

  const dependencyMap = new Map();
  for (const row of viewDependencies) {
    const view = normalizeName(row.view ?? row.view_name);
    const dependency = normalizeName(row.dependency ?? row.table ?? row.table_name);
    if (!view || !dependency || !viewNames.has(view)) continue;
    if (!dependencyMap.has(view)) dependencyMap.set(view, new Set());
    dependencyMap.get(view).add(dependency);
  }

  const memo = new Map();
  const resolving = new Set();
  const resolve = (name) => {
    const normalized = normalizeName(name);
    if (baseRoles.has(normalized)) {
      return { roles: new Set([baseRoles.get(normalized)]), unresolved: new Set() };
    }
    if (!viewNames.has(normalized)) {
      return { roles: new Set(), unresolved: new Set([normalized]) };
    }
    if (memo.has(normalized)) return memo.get(normalized);
    if (resolving.has(normalized)) throw new Error(`view dependency cycle detected at ${normalized}`);

    resolving.add(normalized);
    const directDependencies = [...(dependencyMap.get(normalized) || [])];
    const result = { roles: new Set(), unresolved: new Set() };
    if (directDependencies.length === 0) {
      result.roles.add("runtime");
    } else {
      for (const dependency of directDependencies) {
        const dependencyResult = resolve(dependency);
        for (const role of dependencyResult.roles) result.roles.add(role);
        for (const unresolved of dependencyResult.unresolved) result.unresolved.add(unresolved);
      }
    }
    resolving.delete(normalized);
    memo.set(normalized, result);
    return result;
  };

  const partition = {
    runtime: [],
    governance: [],
    runtime_persistence: [],
    excluded_cross_role_views: [],
  };

  for (const object of normalizedObjects) {
    if (object.type !== "VIEW") {
      partition[baseRoles.get(object.name)].push(object);
      continue;
    }

    const resolution = resolve(object.name);
    if (resolution.unresolved.size > 0) {
      throw new Error(`view ${object.name} has unresolved local dependencies: ${uniqueSorted(resolution.unresolved).join(",")}`);
    }
    const roles = uniqueSorted(resolution.roles);
    if (roles.length === 1) {
      partition[roles[0]].push(object);
      continue;
    }
    partition.excluded_cross_role_views.push({
      name: object.name,
      dependency_roles: roles,
      direct_dependencies: uniqueSorted(dependencyMap.get(object.name) || []),
    });
  }

  const assignedNames = new Set([
    ...partition.runtime,
    ...partition.governance,
    ...partition.runtime_persistence,
  ].map((object) => object.name));
  const excludedNames = new Set(partition.excluded_cross_role_views.map((view) => view.name));
  if (assignedNames.size + excludedNames.size !== normalizedObjects.length) {
    throw new Error("role object partition did not account for every schema object");
  }

  return partition;
}

export function normalizeRoleDump({ dumpSql, buildDatabase = "staging_schema_build" }) {
  const database = String(buildDatabase ?? "").trim();
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) throw new Error("build database identifier is invalid");
  let normalized = String(dumpSql ?? "");
  if (!normalized) throw new Error("schema dump is empty");

  const escaped = database.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  normalized = normalized
    .replace(new RegExp(`\`${escaped}\`\\.`, "gu"), "")
    .replace(new RegExp(`\\b${escaped}\\.`, "gu"), "");

  if (new RegExp(`\`${escaped}\`\\.`, "u").test(normalized) || new RegExp(`\\b${escaped}\\.`, "u").test(normalized)) {
    throw new Error("builder schema qualifier survived portability normalization");
  }
  return normalized;
}
