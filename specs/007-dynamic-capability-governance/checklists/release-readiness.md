# Dynamic Capability Governance Release Readiness Checklist

## Specification PR

- [x] Required Spec Kit files and checklists exist.
- [x] Delivery mode is `multi_pr` because post-merge obligations exist.
- [x] Current PR is specification-only.
- [x] No provider mutation, migration apply, Tenant export, or enforcement change is included.
- [ ] Specification PR CI passes and its number/head SHA are recorded.
- [ ] Specification PR is reviewed and merged through the governed PR gate.

## Foundation implementation

- [ ] Additive migrations pass dry-run, authorization, apply, and schema readback.
- [ ] Inventory compilation reports complete or typed partial state.
- [ ] Manifest hashes are deterministic.
- [ ] No unsafe active Admin/Tenant projection exists.
- [ ] Shadow decisions are observable and bounded.
- [ ] Architecture and OpenAPI gates pass.

## Cohort rollout

- [ ] Internal read-only cohort passes.
- [ ] Operational alert internal-write pilot passes with readback.
- [ ] Provider read-only cohort passes tenant isolation.
- [ ] WordPress validation and draft shadow pass.
- [ ] WordPress draft canary passes certification, idempotency, and readback.
- [ ] High-impact external writes remain disabled until separately approved.

## Production and closeout

- [ ] Release readiness passes with no unexplained critical governance gap.
- [ ] Deployed runtime commit equals approved main commit.
- [ ] Production smoke and readback evidence are recorded.
- [ ] Post-merge audit completes or records owned backlog references.
- [ ] Residual compatibility paths and deprecation windows are documented.
- [ ] Final closeout PR records all implementation evidence.
- [ ] `completion.json` is marked complete only after every required item resolves.
