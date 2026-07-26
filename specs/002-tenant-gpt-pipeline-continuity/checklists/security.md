# Security Checklist

- [x] Tenant and user identity come from signed principal context.
- [x] Workspace scope is required for tenant-effective action resolution.
- [x] The canonical semantic capability resolver is reused.
- [x] Missing capability mapping fails closed.
- [x] Resolver failure fails closed.
- [x] No provider call or external delivery is introduced.
- [x] No credential value is queried, logged, or returned.
- [x] No admin-only route is exposed to Tenant GPT.
- [x] No approval, grant, credential, or resource authority is mutated.
- [x] Connector readiness requires installation evidence.
- [x] Regression tests prove optimistic readiness cannot pass.
- [x] New response metadata declares `secrets_included: false`.
