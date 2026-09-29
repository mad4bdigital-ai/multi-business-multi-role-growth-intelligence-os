import {
  GOOGLE_DRIVE_READ_SCOPE,
  GOOGLE_DRIVE_WRITE_SCOPE,
} from "./managedGoogleOAuthProtocolPolicy.js";

export const MANAGED_GOOGLE_CAPABILITY_REGISTRY_CONTRACT = "mad4b.google-oauth-capability-registry.v1";

const CAPABILITIES = Object.freeze({
  "identity.email": Object.freeze({
    scope: "https://www.googleapis.com/auth/userinfo.email",
    family: "identity",
    risk_class: "basic",
    full_owner: true,
  }),
  "drive.read": Object.freeze({
    scope: GOOGLE_DRIVE_READ_SCOPE,
    family: "drive",
    risk_class: "sensitive",
    full_owner: false,
  }),
  "drive.write": Object.freeze({
    scope: GOOGLE_DRIVE_WRITE_SCOPE,
    family: "drive",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "docs.write": Object.freeze({
    scope: "https://www.googleapis.com/auth/documents",
    family: "workspace",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "sheets.write": Object.freeze({
    scope: "https://www.googleapis.com/auth/spreadsheets",
    family: "workspace",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "calendar.write": Object.freeze({
    scope: "https://www.googleapis.com/auth/calendar",
    family: "workspace",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "gmail.full": Object.freeze({
    scope: "https://mail.google.com/",
    family: "gmail",
    risk_class: "restricted",
    full_owner: true,
  }),
  "gmail.settings.basic": Object.freeze({
    scope: "https://www.googleapis.com/auth/gmail.settings.basic",
    family: "gmail",
    risk_class: "restricted",
    full_owner: true,
  }),
  "gmail.settings.sharing": Object.freeze({
    scope: "https://www.googleapis.com/auth/gmail.settings.sharing",
    family: "gmail",
    risk_class: "restricted_admin",
    full_owner: true,
  }),
  "apps_script.deployments": Object.freeze({
    scope: "https://www.googleapis.com/auth/script.deployments",
    family: "apps_script",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "apps_script.metrics": Object.freeze({
    scope: "https://www.googleapis.com/auth/script.metrics",
    family: "apps_script",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "apps_script.processes": Object.freeze({
    scope: "https://www.googleapis.com/auth/script.processes",
    family: "apps_script",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "apps_script.projects": Object.freeze({
    scope: "https://www.googleapis.com/auth/script.projects",
    family: "apps_script",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "generative_language.retriever": Object.freeze({
    scope: "https://www.googleapis.com/auth/generative-language.retriever",
    family: "generative_language",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "cloud.platform": Object.freeze({
    scope: "https://www.googleapis.com/auth/cloud-platform",
    family: "cloud",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "analytics.full": Object.freeze({
    scope: "https://www.googleapis.com/auth/analytics",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "analytics.read": Object.freeze({
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: false,
  }),
  "analytics.edit": Object.freeze({
    scope: "https://www.googleapis.com/auth/analytics.edit",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "analytics.manage_users": Object.freeze({
    scope: "https://www.googleapis.com/auth/analytics.manage.users",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "analytics.manage_users_read": Object.freeze({
    scope: "https://www.googleapis.com/auth/analytics.manage.users.readonly",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: false,
  }),
  "analytics.provision": Object.freeze({
    scope: "https://www.googleapis.com/auth/analytics.provision",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "search_ads_360.full": Object.freeze({
    scope: "https://www.googleapis.com/auth/doubleclicksearch",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "search_console.full": Object.freeze({
    scope: "https://www.googleapis.com/auth/webmasters",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "tag_manager.full": Object.freeze({
    scope: "https://www.googleapis.com/auth/tagmanager",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "tag_manager.edit_containers": Object.freeze({
    scope: "https://www.googleapis.com/auth/tagmanager.edit.containers",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "tag_manager.manage_accounts": Object.freeze({
    scope: "https://www.googleapis.com/auth/tagmanager.manage.accounts",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "tag_manager.manage_users": Object.freeze({
    scope: "https://www.googleapis.com/auth/tagmanager.manage.users",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "tag_manager.delete_containers": Object.freeze({
    scope: "https://www.googleapis.com/auth/tagmanager.delete.containers",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "tag_manager.edit_container_versions": Object.freeze({
    scope: "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "tag_manager.publish": Object.freeze({
    scope: "https://www.googleapis.com/auth/tagmanager.publish",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
  "google_ads.full": Object.freeze({
    scope: "https://www.googleapis.com/auth/adwords",
    family: "marketing",
    risk_class: "sensitive",
    full_owner: true,
  }),
});

const PROFILES = Object.freeze({
  drive_read_only: Object.freeze(["drive.read"]),
  drive_read_write: Object.freeze(["drive.write"]),
  workspace_full: Object.freeze([
    "identity.email",
    "drive.write",
    "docs.write",
    "sheets.write",
    "calendar.write",
    "gmail.full",
    "gmail.settings.basic",
    "gmail.settings.sharing",
    "apps_script.deployments",
    "apps_script.metrics",
    "apps_script.processes",
    "apps_script.projects",
    "generative_language.retriever",
    "cloud.platform",
  ]),
  marketing_full: Object.freeze([
    "analytics.full",
    "analytics.edit",
    "analytics.manage_users",
    "analytics.provision",
    "search_ads_360.full",
    "search_console.full",
    "tag_manager.full",
    "tag_manager.edit_containers",
    "tag_manager.manage_accounts",
    "tag_manager.manage_users",
    "tag_manager.delete_containers",
    "tag_manager.edit_container_versions",
    "tag_manager.publish",
    "google_ads.full",
  ]),
  full_owner: Object.freeze(
    Object.keys(CAPABILITIES).filter((key) => CAPABILITIES[key].full_owner === true),
  ),
});

function capabilityError(code, message) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

export function normalizeManagedGoogleScopeList(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").trim().split(/\s+/u);
  return [...new Set(values.map((scope) => String(scope || "").trim()).filter(Boolean))];
}

function normalizeCapabilityList(value) {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) {
    throw capabilityError(
      "managed_google_oauth_capabilities_invalid",
      "requested_capabilities must be an array of registered capability IDs.",
    );
  }
  if (value.length > 64) {
    throw capabilityError(
      "managed_google_oauth_capabilities_invalid",
      "requested_capabilities exceeds the maximum supported capability count.",
    );
  }
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function legacyAccessScope(accessMode, requestedScope) {
  const mode = String(accessMode || "").trim().toLowerCase();
  const scope = String(requestedScope || "").trim();
  if (mode === "read_only" && scope === GOOGLE_DRIVE_READ_SCOPE) return { access_mode: mode, requested_scope: scope, baseline_capability: "drive.read" };
  if (mode === "read_write" && scope === GOOGLE_DRIVE_WRITE_SCOPE) return { access_mode: mode, requested_scope: scope, baseline_capability: "drive.write" };
  throw capabilityError(
    "managed_google_oauth_scope_contract_invalid",
    "Requested Google Drive scope does not exactly match the requested managed access mode.",
  );
}

export function managedGoogleCapabilityRegistry() {
  return Object.freeze({
    contract: MANAGED_GOOGLE_CAPABILITY_REGISTRY_CONTRACT,
    capabilities: CAPABILITIES,
    profiles: PROFILES,
    default_profile: "legacy",
    incremental_authorization: true,
    granular_consent_supported: true,
    secrets_included: false,
  });
}

export function resolveManagedGoogleOAuthAccess({
  access_mode,
  requested_scope,
  scope_profile = "",
  requested_capabilities = [],
} = {}) {
  const legacy = legacyAccessScope(access_mode, requested_scope);
  const profile = String(scope_profile || "").trim().toLowerCase();
  const requested = normalizeCapabilityList(requested_capabilities);

  let profileCapabilities = [];
  if (profile && profile !== "legacy" && profile !== "custom") {
    if (!Object.prototype.hasOwnProperty.call(PROFILES, profile)) {
      throw capabilityError(
        "managed_google_oauth_scope_profile_unknown",
        "Requested Google OAuth scope profile is not registered.",
      );
    }
    profileCapabilities = [...PROFILES[profile]];
  }
  if (profile === "custom" && requested.length === 0) {
    throw capabilityError(
      "managed_google_oauth_capabilities_required",
      "The custom Google OAuth scope profile requires at least one registered capability.",
    );
  }

  const capabilityIds = [...new Set([
    legacy.baseline_capability,
    ...profileCapabilities,
    ...requested,
  ])];
  const unknown = capabilityIds.filter((id) => !Object.prototype.hasOwnProperty.call(CAPABILITIES, id));
  if (unknown.length) {
    throw capabilityError(
      "managed_google_oauth_capability_unknown",
      "Requested Google OAuth capability is not registered.",
    );
  }

  const scopes = normalizeManagedGoogleScopeList(capabilityIds.map((id) => CAPABILITIES[id].scope));
  const effectiveProfile = profile || (requested.length ? "custom" : "legacy");
  return Object.freeze({
    ...legacy,
    scope_profile: effectiveProfile,
    requested_capabilities: Object.freeze(capabilityIds),
    requested_scopes: Object.freeze(scopes),
    authorization_scope: scopes.join(" "),
    scope_count: scopes.length,
  });
}

export function validateManagedGoogleGrantedScopes(access, grantedScopesValue) {
  const grantedScopes = normalizeManagedGoogleScopeList(grantedScopesValue);
  if (!grantedScopes.length) {
    throw capabilityError(
      "managed_google_oauth_granted_scope_missing",
      "Google OAuth token response did not include any granted scopes.",
    );
  }
  if (!grantedScopes.includes(access.requested_scope)) {
    throw capabilityError(
      "managed_google_oauth_required_scope_missing",
      "Google OAuth consent did not grant the baseline scope required by the managed access mode.",
    );
  }
  const requested = new Set(access.requested_scopes || [access.requested_scope]);
  const granted = new Set(grantedScopes);
  return Object.freeze({
    granted_scopes: Object.freeze(grantedScopes),
    missing_requested_scopes: Object.freeze([...requested].filter((scope) => !granted.has(scope))),
    previously_granted_scopes: Object.freeze(grantedScopes.filter((scope) => !requested.has(scope))),
    complete: [...requested].every((scope) => granted.has(scope)),
  });
}
