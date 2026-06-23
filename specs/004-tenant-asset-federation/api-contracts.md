# Planned API Contracts

All routes are tenant-scoped from the signed JWT and return stable structured error envelopes.

## Catalog and adoption

- `GET /tenant/assets/catalog`
- `GET /tenant/assets/catalog/{assetRef}`
- `POST /tenant/assets/adoptions`
- `GET /tenant/assets/instances`
- `GET /tenant/assets/instances/{instanceId}`

## Versioning

- `POST /tenant/assets/instances/{instanceId}/versions`
- `GET /tenant/assets/instances/{instanceId}/versions`
- `POST /tenant/assets/instances/{instanceId}/versions/{versionId}/publish`
- `POST /tenant/assets/instances/{instanceId}/rollback`
- `POST /tenant/assets/instances/{instanceId}/upgrade/preview`
- `POST /tenant/assets/instances/{instanceId}/upgrade/apply`

## Scope and composition

- `GET /tenant/assets/composition-profiles`
- `PUT /tenant/assets/composition-profiles/{profileId}`
- `POST /tenant/assets/instances/{instanceId}/scope-bindings`
- `DELETE /tenant/assets/scope-bindings/{bindingId}`
- `POST /tenant/assets/resolve`

## Permissions

- `GET /tenant/assets/instances/{instanceId}/grants`
- `POST /tenant/assets/instances/{instanceId}/grants`
- `DELETE /tenant/assets/grants/{grantId}`

## Credentials and readiness

- `POST /tenant/assets/instances/{instanceId}/connection-bindings`
- `GET /tenant/assets/instances/{instanceId}/readiness`
- `POST /tenant/assets/instances/{instanceId}/validation`

Credential values are accepted only through existing governed intake/OAuth surfaces, never through these asset endpoints.

## Error classes

- `asset_not_adoptable`
- `tenant_asset_not_found`
- `tenant_asset_permission_denied`
- `invalid_composition_profile`
- `composition_scope_missing`
- `composition_conflict`
- `mandatory_policy_denied`
- `credential_binding_required`
- `credential_binding_ambiguous`
- `installation_not_ready`
- `certification_required`
- `approval_required`
- `base_version_conflict`
- `cross_tenant_reference_forbidden`
