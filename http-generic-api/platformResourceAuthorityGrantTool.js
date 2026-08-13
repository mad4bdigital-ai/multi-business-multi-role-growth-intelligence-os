import crypto from "node:crypto";
import {
  assertPlatformResourceAuthorityStoreSource,
  resolvePlatformResourceAuthorityPool,
} from "./platformResourceAuthorityStore.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/i;
const GITHUB_RE = /^github:\/\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const SHELL_ALIAS_RE = /^shell:\/\/([A-Za-z0-9._-]+)$/;
const PRINCIPAL_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const PRINCIPAL_TYPES = new Set(["user", "service", "backend_api_key"]);
const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod", "staging", "release"]);

const RECIPES = Object.freeze({
  repo_patch_apply: {
    resource_type: "github_repo",
    permission_level: "patch",
    allowed_modes: ["write_file", "replace_block", "apply_unified_diff", "delete_file"],
  },
  repo_patch_batch_apply: {
    resource_type: "github_repo",
    permission_level: "patch",
    allowed_modes: ["write_file", "replace_block", "apply_unified_diff", "delete_file", "atomic_change_set"],
  },
  github_pr_create: {
    resource_type: "github_repo",
    permission_level: "admin",
    allowed_modes: ["create_pull_request"],
  },
  dev_growth_intelligence_pilot_read: {
    resource_type: "shell_alias",
    permission_level: "diagnostic",
    allowed_modes: ["dev_governed_migration_client"],
    allowed_aliases: ["dev_governed_migration_client"],
  },
  dev_growth_intelligence_pilot_apply: {
    resource_type: "shell_alias",
    permission_level: "patch",
    allowed_modes: ["dev_governed_migration_client_apply"],
    allowed_aliases: ["dev_governed_migration_client_apply"],
  },
});

function badRequest(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = 400;
  if (details) err.details = details;
  return err;
}

function text(value, max = 512) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : "";
}

function requireUuid(value, field) {
  const normalized = text(value, 64);
  if (!UUID_RE.test(normalized)) {
    throw badRequest("platform_resource_authority_grant_invalid_uuid", `${field} must be a UUID.`, { field });
  }
  return normalized;
}

function normalizePrincipal(args = {}) {
  const rawPrincipal = args.principal && typeof args.principal === "object" && !Array.isArray(args.principal)
    ? args.principal
    : null;
  const legacyUserIdInput = text(args.user_id, 64);
  const legacyUserId = legacyUserIdInput ? requireUuid(legacyUserIdInput, "user_id") : "";

  if (!rawPrincipal) {
    if (!legacyUserId) {
      throw badRequest(
        "platform_resource_authority_grant_principal_required",
        "principal or legacy user_id is required."
      );
    }
    return {
      principal_type: "user",
      principal_id: legacyUserId,
      legacy_user_id: legacyUserId,
    };
  }

  const principalType = text(rawPrincipal.principal_type, 32);
  if (!PRINCIPAL_TYPES.has(principalType)) {
    throw badRequest(
      "platform_resource_authority_grant_invalid_principal_type",
      "principal.principal_type must be user, service, or backend_api_key.",
      { principal_type: principalType, allowed_principal_types: [...PRINCIPAL_TYPES] }
    );
  }

  const principalIdInput = String(rawPrincipal.principal_id ?? "").trim();
  if (!principalIdInput) {
    throw badRequest(
      "platform_resource_authority_grant_principal_id_required",
      "principal.principal_id is required.",
      { field: "principal.principal_id" }
    );
  }
  if (principalIdInput.length > 64) {
    throw badRequest(
      "platform_resource_authority_grant_principal_id_too_long",
      "principal.principal_id must not exceed 64 characters.",
      { field: "principal.principal_id", max_length: 64 }
    );
  }
  let principalId = principalIdInput;
  if (principalType === "user") principalId = requireUuid(principalId, "principal.principal_id");
  else if (!PRINCIPAL_ID_RE.test(principalId)) {
    throw badRequest(
      "platform_resource_authority_grant_invalid_principal_id",
      "principal.principal_id contains unsupported characters.",
      { field: "principal.principal_id" }
    );
  }
  if (legacyUserId && (principalType !== "user" || legacyUserId !== principalId)) {
    throw badRequest(
      "platform_resource_authority_grant_principal_conflict",
      "user_id may only accompany a matching user principal."
    );
  }

  return { principal_type: principalType, principal_id: principalId, legacy_user_id: legacyUserId || null };
}

function requireSha(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA_RE.test(normalized)) {
    throw badRequest("platform_resource_authority_grant_expected_sha_required", `${field} must be a 40 character commit SHA.`, { field });
  }
  return normalized;
}

function normalizeGithubResourceUri(value) {
  const uri = text(value, 512);
  const match = uri.match(GITHUB_RE);
  if (!match) {
    throw badRequest(
      "platform_resource_authority_grant_invalid_resource_uri",
      "resource_uri must use github://owner/repo format.",
      { resource_uri: uri }
    );
  }
  return { resource_uri: `github://${match[1]}/${match[2]}`, owner: match[1], repo: match[2] };
}

function normalizeShellAliasResourceUri(value, recipe) {
  const uri = text(value, 512);
  const match = uri.match(SHELL_ALIAS_RE);
  const alias = match?.[1] || "";
  if (!alias || !recipe.allowed_aliases?.includes(alias)) {
    throw badRequest(
      "platform_resource_authority_grant_shell_alias_not_allowed",
      "resource_uri must target the exact allowlisted shell alias for this recipe.",
      { resource_uri: uri, allowed_aliases: recipe.allowed_aliases || [] }
    );
  }
  return { resource_uri: `shell://${alias}`, alias };
}

function normalizeBranch(value) {
  const branch = text(value, 255);
  if (!branch) {
    throw badRequest("platform_resource_authority_grant_branch_required", "resource_ref.branch is required.");
  }
  if (PROTECTED_BRANCHES.has(branch.toLowerCase())) {
    throw badRequest(
      "platform_resource_authority_grant_protected_branch_denied",
      "Dynamic bootstrap grants cannot target protected branches.",
      { branch }
    );
  }
  return branch;
}

function normalizeAllowedModes(value, recipe) {
  const requested = Array.isArray(value) && value.length ? value.map((item) => text(item, 128)).filter(Boolean) : recipe.allowed_modes;
  const forbidden = requested.filter((item) => !recipe.allowed_modes.includes(item));
  if (forbidden.length) {
    throw badRequest("platform_resource_authority_grant_mode_not_allowed", "allowed_modes contains modes outside the recipe allowlist.", {
      forbidden,
      recipe_allowed_modes: recipe.allowed_modes,
    });
  }
  return requested;
}

export function expectedResourceAuthorityGrantConfirmation(plan) {
  const resourceTarget = plan.resource_ref.branch || plan.resource_ref.alias || plan.resource_uri;
  const principalType = plan.principal?.principal_type || "legacy_user";
  const principalId = plan.principal?.principal_id || plan.user_id || "";
  const label = [plan.recipe_key, principalType, principalId]
    .join("_")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  const material = JSON.stringify({
    recipe_key: plan.recipe_key,
    resource_uri: plan.resource_uri,
    resource_target: resourceTarget,
    expected_commit_sha: plan.resource_ref.expected_commit_sha,
    principal_type: principalType,
    principal_id: principalId,
  });
  const digest = crypto.createHash("sha256").update(material).digest("hex").slice(0, 16).toUpperCase();
  return `GRANT_RESOURCE_AUTHORITY_${label}_${digest}`;
}

export function buildPlatformResourceAuthorityGrantPlan(args = {}) {
  const mode = text(args.mode || "dry_run", 32) || "dry_run";
  if (!["dry_run", "apply"].includes(mode)) {
    throw badRequest("platform_resource_authority_grant_invalid_mode", "mode must be dry_run or apply.", { mode });
  }

  const tenant_id = requireUuid(args.tenant_id, "tenant_id");
  const workspace_id = requireUuid(args.workspace_id, "workspace_id");
  const principal = normalizePrincipal(args);
  const user_id = principal.principal_id;
  const recipe_key = text(args.recipe_key, 128);
  const recipe = RECIPES[recipe_key];
  if (!recipe) {
    throw badRequest("platform_resource_authority_grant_recipe_not_allowed", "recipe_key is not allowlisted for dynamic grants.", {
      recipe_key,
      allowed_recipes: Object.keys(RECIPES),
    });
  }

  const resource_type = text(args.resource_type, 128);
  if (resource_type !== recipe.resource_type) {
    throw badRequest(
      "platform_resource_authority_grant_resource_type_not_allowed",
      "resource_type does not match the selected grant recipe.",
      { resource_type, required_resource_type: recipe.resource_type }
    );
  }

  const resourceRef = args.resource_ref && typeof args.resource_ref === "object" && !Array.isArray(args.resource_ref) ? args.resource_ref : {};
  const expected_commit_sha = requireSha(
    resourceRef.expected_commit_sha || resourceRef.base_sha || args.expected_commit_sha,
    "resource_ref.expected_commit_sha"
  );

  let normalizedUri;
  let normalizedResourceRef;
  if (resource_type === "github_repo") {
    normalizedUri = normalizeGithubResourceUri(args.resource_uri);
    const branch = normalizeBranch(resourceRef.branch || args.branch);
    normalizedResourceRef = {
      owner: normalizedUri.owner,
      repo: normalizedUri.repo,
      branch,
      expected_commit_sha,
      main_write_allowed: false,
      protected_branch_write_allowed: false,
      requires_expected_commit_sha: true,
      requires_typed_confirmation: true,
      requires_same_cycle_readback: true,
      secrets_included: false,
    };
  } else {
    normalizedUri = normalizeShellAliasResourceUri(args.resource_uri, recipe);
    normalizedResourceRef = {
      alias: normalizedUri.alias,
      expected_commit_sha,
      arbitrary_shell_allowed: false,
      production_execution_allowed: recipe.production_execution_allowed === true,
      requires_expected_commit_sha: true,
      requires_typed_confirmation: true,
      requires_same_cycle_readback: true,
      secrets_included: false,
    };
  }
  normalizedResourceRef.principal = {
    principal_type: principal.principal_type,
    principal_id: principal.principal_id,
  };

  const permission_level = text(args.permission_level || recipe.permission_level, 32);
  if (permission_level !== recipe.permission_level) {
    throw badRequest("platform_resource_authority_grant_permission_not_allowed", "permission_level cannot exceed the recipe permission.", {
      permission_level,
      required_permission_level: recipe.permission_level,
    });
  }

  const allowed_modes = normalizeAllowedModes(args.allowed_modes, recipe);
  const ttl_minutes = Number(args.ttl_minutes ?? args.ttlMinutes ?? 0);
  if (mode === "apply" && (!Number.isInteger(ttl_minutes) || ttl_minutes < 5 || ttl_minutes > 1440)) {
    throw badRequest("platform_resource_authority_grant_ttl_required", "apply mode requires ttl_minutes between 5 and 1440.");
  }

  const plan = {
    ok: true,
    mode,
    tenant_id,
    workspace_id,
    user_id,
    principal,
    resource_type,
    resource_uri: normalizedUri.resource_uri,
    recipe_key,
    permission_level,
    allowed_modes,
    ttl_minutes: mode === "apply" ? ttl_minutes : null,
    expires_at_required: true,
    authority_source: text(args.authority_source || "dynamic_resource_authority_grant_tool", 128),
    created_by: text(args.created_by || args.createdBy || "gpt_admin", 64),
    resource_ref: normalizedResourceRef,
    notes: text(args.notes || "Bounded dynamic resource authority grant created by governed admin tool.", 1000),
    secrets_included: false,
  };
  plan.expected_confirm = expectedResourceAuthorityGrantConfirmation(plan);
  if (mode === "apply" && text(args.confirm, 200) !== plan.expected_confirm) {
    throw badRequest("platform_resource_authority_grant_confirmation_required", "apply mode requires the exact typed confirmation.", {
      expected_confirm: plan.expected_confirm,
    });
  }
  return plan;
}

export async function applyPlatformResourceAuthorityGrant(args = {}, deps = {}) {
  const plan = buildPlatformResourceAuthorityGrantPlan(args);
  if (plan.mode === "dry_run") {
    return { ...plan, readback_verified: false };
  }

  const writerPool = resolvePlatformResourceAuthorityPool(deps);
  assertPlatformResourceAuthorityStoreSource({
    pool: writerPool,
    runtimePool: deps.runtimePool || deps.pool,
  });
  const bindingId = crypto.randomUUID();
  await writerPool.query(
    `INSERT INTO platform_resource_authority_bindings
      (binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri, resource_ref_json,
       recipe_key, permission_level, allowed_modes_json, authority_source, expires_at, status, notes, created_by)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE), 'active', ?, ?)`,
    [
      bindingId,
      plan.tenant_id,
      plan.workspace_id,
      plan.user_id,
      plan.resource_type,
      plan.resource_uri,
      JSON.stringify(plan.resource_ref),
      plan.recipe_key,
      plan.permission_level,
      JSON.stringify(plan.allowed_modes),
      plan.authority_source,
      plan.ttl_minutes,
      plan.notes,
      plan.created_by,
    ]
  );

  const [[row]] = await writerPool.query(
    `SELECT binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri, recipe_key,
            permission_level, allowed_modes_json, authority_source, resource_ref_json, expires_at, status, created_at
       FROM platform_resource_authority_bindings
      WHERE binding_id = ?
      LIMIT 1`,
    [bindingId]
  );

  let storedResourceRef;
  try {
    storedResourceRef = typeof row?.resource_ref_json === "string" ? JSON.parse(row.resource_ref_json) : row?.resource_ref_json || {};
  } catch {
    storedResourceRef = {};
  }
  const storedPrincipal = storedResourceRef.principal;
  const checks = {
    binding_id: row?.binding_id === bindingId,
    status: row?.status === "active",
    tenant_id: row?.tenant_id === plan.tenant_id,
    workspace_id: row?.workspace_id === plan.workspace_id,
    user_id: row?.user_id === plan.user_id,
    resource_type: row?.resource_type === plan.resource_type,
    resource_uri: row?.resource_uri === plan.resource_uri,
    recipe_key: row?.recipe_key === plan.recipe_key,
    permission_level: row?.permission_level === plan.permission_level,
    authority_source: row?.authority_source === plan.authority_source,
    principal_type: storedPrincipal?.principal_type === plan.principal.principal_type,
    principal_id: storedPrincipal?.principal_id === plan.principal.principal_id,
    expected_commit_sha: storedResourceRef?.expected_commit_sha === plan.resource_ref.expected_commit_sha,
  };
  if (Object.values(checks).some((value) => value !== true)) {
    const err = new Error("Resource authority grant exact readback failed after insert.");
    err.code = "platform_resource_authority_grant_readback_failed";
    err.statusCode = 500;
    err.details = { checks, secrets_included: false };
    throw err;
  }

  const binding = { ...row, principal: storedPrincipal };
  delete binding.resource_ref_json;

  return {
    ok: true,
    mode: "apply",
    binding,
    writer_identity: "governance_db",
    readback_verified: true,
    expected_confirm: plan.expected_confirm,
    secrets_included: false,
  };
}
