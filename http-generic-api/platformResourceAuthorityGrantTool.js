import crypto from "node:crypto";
import { getPool } from "./db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/i;
const GITHUB_RE = /^github:\/\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const PROTECTED_BRANCHES = new Set(["main", "master", "production", "prod", "staging", "release"]);

const RECIPES = Object.freeze({
  repo_patch_apply: {
    permission_level: "patch",
    allowed_modes: ["write_file", "replace_block", "apply_unified_diff", "delete_file"],
  },
  repo_patch_batch_apply: {
    permission_level: "patch",
    allowed_modes: ["write_file", "replace_block", "apply_unified_diff", "delete_file", "atomic_change_set"],
  },
  github_pr_create: {
    permission_level: "admin",
    allowed_modes: ["create_pull_request"],
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
  const material = [plan.recipe_key, plan.resource_uri, plan.resource_ref.branch, plan.resource_ref.expected_commit_sha].join(":");
  const suffix = material.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96);
  return `GRANT_RESOURCE_AUTHORITY_${suffix}`;
}

export function buildPlatformResourceAuthorityGrantPlan(args = {}) {
  const mode = text(args.mode || "dry_run", 32) || "dry_run";
  if (!["dry_run", "apply"].includes(mode)) {
    throw badRequest("platform_resource_authority_grant_invalid_mode", "mode must be dry_run or apply.", { mode });
  }

  const tenant_id = requireUuid(args.tenant_id, "tenant_id");
  const workspace_id = requireUuid(args.workspace_id, "workspace_id");
  const user_id = requireUuid(args.user_id, "user_id");
  const resource_type = text(args.resource_type, 128);
  if (resource_type !== "github_repo") {
    throw badRequest("platform_resource_authority_grant_resource_type_not_allowed", "Only github_repo bootstrap grants are supported.", { resource_type });
  }

  const recipe_key = text(args.recipe_key, 128);
  const recipe = RECIPES[recipe_key];
  if (!recipe) {
    throw badRequest("platform_resource_authority_grant_recipe_not_allowed", "recipe_key is not allowlisted for dynamic grants.", {
      recipe_key,
      allowed_recipes: Object.keys(RECIPES),
    });
  }

  const normalizedUri = normalizeGithubResourceUri(args.resource_uri);
  const resourceRef = args.resource_ref && typeof args.resource_ref === "object" && !Array.isArray(args.resource_ref) ? args.resource_ref : {};
  const branch = normalizeBranch(resourceRef.branch || args.branch);
  const expected_commit_sha = requireSha(resourceRef.expected_commit_sha || resourceRef.base_sha || args.expected_commit_sha, "resource_ref.expected_commit_sha");
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
    resource_type,
    resource_uri: normalizedUri.resource_uri,
    recipe_key,
    permission_level,
    allowed_modes,
    ttl_minutes: mode === "apply" ? ttl_minutes : null,
    expires_at_required: true,
    authority_source: text(args.authority_source || "dynamic_resource_authority_grant_tool", 128),
    created_by: text(args.created_by || args.createdBy || "gpt_admin", 64),
    resource_ref: {
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
    },
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

export async function applyPlatformResourceAuthorityGrant(args = {}) {
  const plan = buildPlatformResourceAuthorityGrantPlan(args);
  if (plan.mode === "dry_run") {
    return { ...plan, readback_verified: false };
  }

  const pool = getPool();
  const bindingId = crypto.randomUUID();
  await pool.query(
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

  const [[row]] = await pool.query(
    `SELECT binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri, recipe_key,
            permission_level, allowed_modes_json, authority_source, expires_at, status, created_at
       FROM platform_resource_authority_bindings
      WHERE binding_id = ?
      LIMIT 1`,
    [bindingId]
  );
  if (!row || row.status !== "active") {
    const err = new Error("Resource authority grant readback failed after insert.");
    err.code = "platform_resource_authority_grant_readback_failed";
    err.statusCode = 500;
    throw err;
  }

  return {
    ok: true,
    mode: "apply",
    binding: row,
    readback_verified: true,
    expected_confirm: plan.expected_confirm,
    secrets_included: false,
  };
}
