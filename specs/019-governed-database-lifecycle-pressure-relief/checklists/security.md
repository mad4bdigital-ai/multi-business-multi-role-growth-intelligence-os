# Security Checklist — Spec 019

- [ ] No raw SQL input is accepted from callers or agents.
- [ ] No arbitrary table, column, or predicate input is accepted.
- [ ] Resource URI and recipe key are exact and allowlisted.
- [ ] Authority is principal-bound, resource-bound, recipe-bound, and expiring.
- [ ] Approval binds plan ID, fingerprint, cutoff, and resource.
- [ ] Injection, replay, path traversal, object-scope, and secret-exposure tests exist.
- [ ] Unknown outcomes are reconciled before retry.
- [ ] Logs and evidence are bounded and secret-free.
- [ ] Destructive physical reclaim remains disabled until separate review.
