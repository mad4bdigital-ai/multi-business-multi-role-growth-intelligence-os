import { canonicalResourceIdentity } from "./platformResourceIdentityContract.js";

function text(value, max = 2048) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, max);
}

function lower(value, max = 2048) {
  return text(value, max).toLowerCase();
}

function normalizeSha256(value) {
  const normalized = lower(value, 128).replace(/^sha256:/u, "");
  return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : "";
}

export function adaptAssetIdentity(asset = {}) {
  const assetId = text(asset.asset_id || asset.id, 128);
  const tenantId = text(asset.tenant_id, 128);
  const workspaceId = text(asset.workspace_id, 128);
  const contentSha256 = normalizeSha256(asset.content_sha256 || asset.content_hash);
  if (!contentSha256 && (!assetId || (!workspaceId && !tenantId))) {
    throw Object.assign(new TypeError("Asset identity requires content_sha256 or a scoped asset_id."), {
      code: "asset_identity_input_required",
    });
  }

  const identity = contentSha256
    ? canonicalResourceIdentity({
        resourceType: "asset",
        identityScope: "content_addressed",
        canonicalValue: `sha256:${contentSha256}`,
      })
    : canonicalResourceIdentity({
        resourceType: "asset",
        identityScope: workspaceId ? "workspace" : "tenant",
        canonicalValue: `${workspaceId || tenantId}:${assetId}`,
      });

  return Object.freeze({
    identity,
    identifiers: Object.freeze([
      ...(contentSha256 ? [{ type: "content_sha256", value: contentSha256, confidence_class: "hard" }] : []),
      ...(assetId ? [{ type: "scoped_asset_id", value: assetId, confidence_class: "hard" }] : []),
    ]),
    rights: Object.freeze({
      authority_implied: false,
      authority_source: "separate_resource_grant_and_policy_required",
      tenant_id: tenantId || null,
      workspace_id: workspaceId || null,
      brand_ref: text(asset.brand_ref, 256) || null,
      visibility: lower(asset.visibility, 32) || null,
      lifecycle_status: lower(asset.lifecycle_status, 32) || null,
    }),
    secrets_included: false,
  });
}

export function adaptProviderAccountIdentity(account = {}) {
  const providerFamily = lower(account.provider_family || account.provider || account.source_provider, 128);
  const providerAccountId = text(
    account.provider_account_id || account.provider_native_id || account.account_id || account.external_account_id,
    512,
  );
  if (!providerFamily || !providerAccountId) {
    throw Object.assign(new TypeError("Provider Account identity requires provider_family and provider-native account ID."), {
      code: "provider_account_identity_input_required",
    });
  }

  const identity = canonicalResourceIdentity({
    resourceType: "provider_account",
    identityScope: "provider_native",
    canonicalValue: providerAccountId,
    providerFamily,
  });
  const accountLabel = text(account.account_label || account.display_name, 512);
  const credentialBindingRef = text(account.credential_binding_ref || account.connection_id, 256);

  return Object.freeze({
    identity,
    identifiers: Object.freeze([
      { type: "provider_native_id", value: providerAccountId, provider_family: providerFamily, confidence_class: "hard" },
      ...(accountLabel ? [{ type: "provider_account_label", value: accountLabel, provider_family: providerFamily, confidence_class: "probable" }] : []),
    ]),
    credential_binding: Object.freeze({
      ref: credentialBindingRef || null,
      part_of_identity: false,
      credential_material_included: false,
      authority_implied: false,
    }),
    secrets_included: false,
  });
}

export const _testingPlatformResourceIdentityAdapters = Object.freeze({ normalizeSha256 });
