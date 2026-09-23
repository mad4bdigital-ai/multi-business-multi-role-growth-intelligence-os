// Reviewed provider-protocol authority for MAD4B Managed Google OAuth.
// These values are protocol invariants, not mutable runtime configuration.
export const MANAGED_GOOGLE_OAUTH_PROTOCOL_POLICY = Object.freeze({
  contract: "mad4b.provider-protocol-policy-registry.v1",
  registry_key: "provider_protocol_policy_registry",
  provider: "google",
  product: "google_drive",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  scopes: Object.freeze({
    read_only: "https://www.googleapis.com/auth/drive.readonly",
    read_write: "https://www.googleapis.com/auth/drive",
  }),
  mutable_at_runtime: false,
  environment_override_allowed: false,
  secrets_included: false,
});

export const GOOGLE_AUTHORIZATION_ENDPOINT = MANAGED_GOOGLE_OAUTH_PROTOCOL_POLICY.authorization_endpoint;
export const GOOGLE_TOKEN_ENDPOINT = MANAGED_GOOGLE_OAUTH_PROTOCOL_POLICY.token_endpoint;
export const GOOGLE_DRIVE_READ_SCOPE = MANAGED_GOOGLE_OAUTH_PROTOCOL_POLICY.scopes.read_only;
export const GOOGLE_DRIVE_WRITE_SCOPE = MANAGED_GOOGLE_OAUTH_PROTOCOL_POLICY.scopes.read_write;
