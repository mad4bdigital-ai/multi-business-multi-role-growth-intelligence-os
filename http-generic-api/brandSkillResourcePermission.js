const PERMISSION_RANKS = Object.freeze({
  view: 1,
  comment: 2,
  edit: 3,
  operate: 4,
  manage: 5,
  admin: 6,
  owner: 7,
});

const OPERATION_PERMISSION = Object.freeze({
  use: "view",
  read: "view",
  list: "view",
  search: "view",
  inspect: "view",
  status: "view",
  preview: "view",
  diagnostic: "view",
  health: "view",
  lookup: "view",
  resolve: "view",
  validate: "view",
  verify: "view",
  plan: "view",
  comment: "comment",
  create: "edit",
  update: "edit",
  edit: "edit",
  write: "edit",
  draft: "edit",
  publish: "operate",
  send: "operate",
  dispatch: "operate",
  trigger: "operate",
  delete: "manage",
  remove: "manage",
  revoke: "manage",
  execute: "manage",
  apply: "manage",
  deploy: "manage",
  restart: "manage",
  migrate: "manage",
  rollback: "manage",
  install: "manage",
  uninstall: "manage",
  approve: "manage",
  "*": "manage",
});

function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeOperations(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(source.map(normalize).filter(Boolean))];
}

export function normalizeResourcePermission(permission = "") {
  const normalized = normalize(permission);
  return Object.hasOwn(PERMISSION_RANKS, normalized) ? normalized : null;
}

export function resourcePermissionRank(permission = "") {
  const normalized = normalizeResourcePermission(permission);
  return normalized ? PERMISSION_RANKS[normalized] : 0;
}

export function requiredResourcePermissionForBrandSkillOperation(operation = "") {
  return OPERATION_PERMISSION[normalize(operation)] || "manage";
}

export function requiredResourcePermissionForBrandSkillOperations(operations = []) {
  const normalized = normalizeOperations(operations);
  if (!normalized.length) return "manage";
  return normalized.reduce((required, operation) => {
    const candidate = requiredResourcePermissionForBrandSkillOperation(operation);
    return resourcePermissionRank(candidate) > resourcePermissionRank(required) ? candidate : required;
  }, "view");
}

export function resourcePermissionCoversBrandSkillOperations(permission = "", operations = []) {
  const required = requiredResourcePermissionForBrandSkillOperations(operations);
  return resourcePermissionRank(permission) >= resourcePermissionRank(required);
}

export const BRAND_SKILL_RESOURCE_PERMISSION_RANKS = PERMISSION_RANKS;
