# Tasks: Repository-Driven Unified Platform Frontend

## Specification and authority

- [x] T001 Define users, scopes, security boundaries, requirements, and success criteria.
- [x] T002 Define repository authority precedence and conflict rules.
- [x] T003 Define source baseline, drift invalidation, dispatch states, blockers, waves, and completion equation.
- [x] T004 Define machine contracts for UI catalog and dispatch plan.
- [x] T005 Correct prior false implementation claims; no shell is marked complete before code and tests exist.

## F0 dynamic planning foundation

- [x] T010 Add mounted-route/OpenAPI/resource/policy/test discovery generator.
- [x] T011 Add deterministic SHA-pinned output and `--write`/`--check` modes.
- [x] T012 Add fail-closed surface policy with explicit owner/rationale rules.
- [x] T013 Add risk, dependency, wave, blocker, and verification packet generation.
- [x] T014 Add local fixture tests for discovery, Admin dependency, safety, determinism, and drift.
- [ ] T015 Register generator scripts in `http-generic-api/package.json`.
- [ ] T016 Register the test in `scripts/test-manifest.mjs`.
- [ ] T017 Generate the first full-repository dispatch artifact on the rebased branch.
- [ ] T018 Review unresolved classifications and commit explicit policy decisions.
- [ ] T019 Add generated-plan schema validation and changed-scope CI gate.

## F1 tenant shell

- [ ] T100 Add browser-safe surface catalog and `/platform` shell.
- [ ] T101 Add MAD4B tokens, light/dark/system themes, responsive navigation, and accessibility states.
- [ ] T102 Add tenant login/session restore, workspace context, and sign-out.
- [ ] T103 Implement overview/growth and logical resources.
- [ ] T104 Implement connections/devices, agents/sessions, support, and settings.
- [ ] T105 Add tenant route, security, accessibility, and regression tests.

## F2 Admin BFF

- [ ] T120 Approve threat model and additive session/audit persistence.
- [ ] T121 Implement short-lived HttpOnly session exchange, CSRF, origin binding, expiry, and revoke.
- [ ] T122 Add explicit read/action adapters; prohibit generic privileged proxying.
- [ ] T123 Add audit, denial, rotation, expiry, and readback tests.

## F3 admin workspaces

- [ ] T140 Implement operations, activation, tenants, resources, and authority.
- [ ] T141 Implement agents, plugins, connected execution, and infrastructure.
- [ ] T142 Implement verification, support, governance, release, and audit evidence.

## F4/F5/F6

- [ ] T160 Consolidate Local Manager while preserving verified compatibility.
- [ ] T161 Implement device trust, local consent, repair, capability, route, and backup UX.
- [ ] T180 Implement jobs, workflows, sessions, API, graph, changes, revisions, and evidence.
- [ ] T200 Complete deep-link cutover, telemetry, WCAG, performance, staging, and production parity.

## Completion governance

- [x] T220 Use `multi_pr` because migrations, production verification, and post-merge audit are required.
- [ ] T221 Record all implementation PRs and merge SHAs.
- [ ] T222 Record migration ledger evidence for Admin session persistence.
- [ ] T223 Record CI and staging/production parity evidence.
- [ ] T224 Complete post-merge audit and closeout PR.
