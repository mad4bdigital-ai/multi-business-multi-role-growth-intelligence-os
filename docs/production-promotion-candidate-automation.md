# Governed Production Promotion Candidate Automation

## Purpose

`.github/workflows/production-promotion-candidate.yml` builds the immutable Git candidate used by the governed `main` → `Production` release-cut controller.

The candidate is not tied to the latest moving `main` tip after authorization. It is tied to one exact **release cut**: the `main` commit authorized by the governed request. Current `main` may advance while the cut remains an ancestor.

Exact validation is performed by `.github/workflows/production-certified-release-cut-validation.yml` through a `test(release): certify immutable Production candidate …` review surface.

Neither workflow merges `Production`, deploys runtime, runs SQL, applies migrations or grants, calls providers, reads credential payloads, restarts services, or writes protected refs.

## Required inputs

The builder receives:

- `expected_main_sha`: exact authorized release-cut SHA;
- `expected_head_sha`: exact trusted workflow-source SHA, which must contain and be tree-identical to the release cut;
- `expected_production_sha`: exact current Production SHA;
- non-protected release, validation, and validation-base branch names;
- whether review PRs should be created.

The request-head workflow source may be a marker-only descendant of the release cut. It is never allowed to change release bytes.

## Candidate construction

Before construction the builder proves:

- the trusted workflow source contains the release cut and has the same tree;
- the release cut is still an ancestor of current `main`;
- current `Production` equals the pinned Production SHA;
- pinned Production is already an ancestor of the release cut.

The candidate is then created with:

1. first parent = release cut;
2. second parent = pinned Production;
3. tree = exact release-cut tree.

This parent order is part of the certified release contract. It makes the release identity explicit while preserving Production ancestry.

An existing release branch is reused only when it already points to the exact valid release-cut candidate. Otherwise the builder refuses history rewriting instead of manufacturing a new fast-forward chain around an old candidate.

## Ref mutation policy

The builder may update only the supplied non-protected release, validation, and validation-base refs. Existing refs move only by fast-forward.

The validation base points to the release cut. The release and validation branches point to the candidate.

The workflow contains no force push, direct `main` or `Production` push, working-tree merge, PR merge, or merge API call.

## Review surfaces

The builder creates or updates:

- release PR: release branch → `Production`;
- certified validation PR: validation branch → validation-base branch.

The release PR includes the release cut, current main observed at build time, pinned Production, candidate SHA, `release_cut_mode: true`, `main_tip_may_advance: true`, and `governed_promotion_candidate: true`.

The validation PR title activates the existing Certified Production Release Cut Validation workflow.

## Certified validation

The certified validator independently requires:

- same-repository candidate identity;
- candidate first parent = release cut;
- candidate tree = release-cut tree;
- release cut remains an ancestor of current `main` before and after CI;
- candidate contains current pinned Production ancestry;
- Production remains unchanged during validation;
- Syntax Check, Unit & Integration Tests, Execution Resolver Gate, and Architecture Drift Detection succeed on the exact candidate.

The evidence records `main_tip_may_advance: true` because descendant main movement is not release invalidation.

## Invalidating changes

The candidate becomes invalid when:

- Production moves from its pinned SHA;
- the release cut is no longer an ancestor of current `main`;
- the candidate first parent changes;
- candidate bytes differ from the release cut;
- candidate loses pinned Production ancestry;
- a required certified validation or supporting gate fails.

Normal descendant commits on `main` do not invalidate the release cut.

## Evidence

The builder emits `production_promotion_candidate.v3` evidence with separate release-cut and current-main identities, candidate identity, pinned Production, branch identities, `exact_release_cut_tree`, `main_tip_may_advance: true`, `production_must_remain_stable: true`, and explicit false mutation flags.

The controller later combines certified validation and declarative supporting-gate results into `governed_production_promotion_convergence.v2`.

## Post-merge boundary

A GitHub merge into `Production` proves repository ancestry only. Runtime deployment, health/readback, and every database migration remain separately governed and require their own authorization and evidence.
