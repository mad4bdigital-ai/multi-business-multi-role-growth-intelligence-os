# Data Isolation Checklist

- [x] Every tenant-owned row carries `tenant_id`.
- [x] Every lookup begins with authenticated tenant scope.
- [x] Composite scopes cannot omit tenant ownership.
- [x] Platform catalog rows contain no tenant secrets.
- [x] Tenant asset JSON cannot contain credential material.
- [x] Connection binding must match the instance tenant.
- [x] Effective views are tenant-filtered.
- [x] Resolution ledger is no-secret.
- [x] Tenant rollback preserves only that tenant's versions.
- [x] Admin diagnostics remain separate from Tenant GPT surfaces.
- [ ] Repository tests prove cross-tenant denial for every mutation route.
- [ ] Query plans and indexes are reviewed for scoped access.
