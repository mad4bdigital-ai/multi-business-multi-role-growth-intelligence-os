# Requirements Checklist — Spec 017

## Specification completeness

- [ ] Problem statement distinguishes transport reachability from canonical resource correctness.
- [ ] Canonical MCP resource and OAuth issuer are documented as separate hosts.
- [ ] Scope explicitly excludes live deployment/provider/migration/secret mutations from the specification branch.
- [ ] Existing Spec 016 OAuth implementation is treated as a dependency rather than reimplemented.
- [ ] Functional, non-functional, testing, rollout, and rollback requirements are traceable.

## Host isolation

- [ ] `/mcp` must require exact canonical resource host.
- [ ] OAuth issuer host must not serve as alternate MCP resource host.
- [ ] Activation host must not serve as alternate MCP resource host.
- [ ] Unknown host must fail closed.
- [ ] Host guard runs before MCP execution/database-backed work.
- [ ] Effective-host resolution is centralized.
- [ ] Trusted-proxy rules are explicit.
- [ ] Ambiguous/malformed host values fail closed.

## OAuth metadata isolation

- [ ] Protected-resource routing uses explicit supported-host mapping.
- [ ] Unknown metadata host does not fall through to another OAuth resource family.
- [ ] Remote MCP metadata exposes only Remote MCP resource/scopes/authorization server.
- [ ] Tenant GPT/Activation metadata remains available only on explicit canonical surfaces.
- [ ] Regression tests prove no cross-family scope leakage.

## DCR and persistence

- [ ] DCR remains separately feature-flagged.
- [ ] DCR advertisement requires usable exact redirect-origin policy.
- [ ] Registration remains dependent on governed durable persistence.
- [ ] Migration apply is not performed by source tests/readiness.
- [ ] Schema readiness is observable without mutation.
- [ ] DCR can be disabled independently after registration.

## Secret and privacy safety

- [ ] Remote MCP signing key remains dedicated and distinct from `JWT_SECRET`.
- [ ] No real secret is committed to `.env.example`.
- [ ] Readiness returns signing-key readiness boolean only.
- [ ] Readiness never returns client secrets, registration tokens, authorization codes, access tokens, refresh tokens, raw hashes, raw grant rows, or authorization headers.
- [ ] Logs/evidence remain redacted.

## Operational readiness

- [ ] DNS readiness is separated from source readiness.
- [ ] TLS readiness is separated from source readiness.
- [ ] Reverse-proxy host preservation/trust is explicitly verified.
- [ ] OAuth schema readback is required after migration.
- [ ] OAuth metadata is tested with MCP still disabled before canary activation.
- [ ] DCR is tested in a bounded window.
- [ ] MCP canary is enabled only after OAuth prerequisites pass.

## Client acceptance

- [ ] MCP Inspector acceptance is required.
- [ ] ChatGPT Developer mode acceptance is required.
- [ ] Claude acceptance is required if Claude remains an advertised target.
- [ ] Neutral standards-compliant client acceptance is required.
- [ ] Token expiry/refresh/reconnect is tested live.
- [ ] Revocation is tested live.
- [ ] Wrong-resource and cross-tenant/cross-workspace/cross-Brand denials are tested.

## Rollback and governance

- [ ] DCR disable is the first narrow rollback lever where applicable.
- [ ] Grant/client revocation is available without deleting tables.
- [ ] MCP and OAuth can be disabled independently.
- [ ] Runtime rollback uses an exact previously verified SHA.
- [ ] OAuth tables are retained during incident rollback.
- [ ] Production promotion is a separate authorization boundary.
- [ ] Force push is forbidden.

## Approval gate

Implementation should not begin until reviewers agree on:

1. canonical host identity;
2. trusted-proxy header contract;
3. explicit Tenant GPT/Activation protected-resource host mapping;
4. readiness surface location and authorization model;
5. source/live rollout separation;
6. closeout evidence required for Spec 017 completion.
